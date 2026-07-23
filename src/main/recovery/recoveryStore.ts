import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { RecoveryListResult, RecoverySummary } from '../../shared/contracts';
import { MAX_DOCUMENT_BYTES } from '../../shared/contracts';
import {
  recoverInterruptedWritesInFolder,
  writeFileAtomically,
} from '../documents/filePrimitives';
import {
  parseRecovery,
  serializeRecovery,
  type RecoveryPayload,
} from './recoveryPrimitives';

const RECOVERY_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i;
const MAX_RECOVERY_BYTES = MAX_DOCUMENT_BYTES + 1_000_000;
const MAX_RECOVERY_FILES = 100;
const MAX_RECOVERY_TOTAL_BYTES = 256 * 1024 * 1024;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function preview(content: string): string {
  const compact = content.replace(/\s+/gu, ' ').trim();
  return (compact || '(Blank document)').slice(0, 240);
}

export class RecoveryStore {
  constructor(private readonly folder: string) {}

  async write(payload: RecoveryPayload): Promise<void> {
    await writeFileAtomically(
      this.pathFor(payload.documentId),
      serializeRecovery(payload),
    );
  }

  async read(recoveryId: string): Promise<RecoveryPayload> {
    const payload = parseRecovery(await this.readBounded(this.pathFor(recoveryId)));
    if (payload.documentId !== recoveryId) {
      throw new Error('Recovery snapshot identity does not match its file name.');
    }
    return payload;
  }

  async list(): Promise<RecoveryListResult> {
    await recoverInterruptedWritesInFolder(this.folder);
    await this.pruneDiscarded().catch(() => undefined);
    let entries;
    try {
      entries = await readdir(this.folder, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return { recoveries: [], quarantinedCount: 0, skippedCount: 0 };
      }
      throw error;
    }

    const recoveries: RecoverySummary[] = [];
    let quarantinedCount = 0;
    let totalBytes = 0;
    // Only snapshots written by this store are recovery candidates.  In
    // particular, transaction markers and their repair artefacts also end in
    // `.json`, but are owned by the atomic-write recovery routine above.
    const candidates = entries.filter((entry) =>
      entry.isFile() && RECOVERY_FILE.test(entry.name),
    );
    let skippedCount = 0;
    const ranked: Array<{ name: string; size: number; mtimeMs: number }> = [];

    // Directory enumeration order is deliberately unspecified.  Stat every
    // validly-named snapshot before enforcing the read budget so a recently
    // written recovery is never hidden merely because it sorts late.
    for (const entry of candidates) {
      try {
        const metadata = await stat(join(this.folder, entry.name));
        if (!metadata.isFile()) continue;
        ranked.push({
          name: entry.name,
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') skippedCount += 1;
      }
    }

    ranked.sort((left, right) =>
      right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name),
    );
    const selected = ranked.slice(0, MAX_RECOVERY_FILES);
    skippedCount += ranked.length - selected.length;

    for (const [index, entry] of selected.entries()) {
      const match = RECOVERY_FILE.exec(entry.name);
      const filePath = join(this.folder, entry.name);

      try {
        if (!match) throw new Error('Invalid recovery file name.');
        if (entry.size > MAX_RECOVERY_BYTES) {
          throw new Error('Recovery snapshot exceeds the bounded startup budget.');
        }
        if (totalBytes + entry.size > MAX_RECOVERY_TOTAL_BYTES) {
          skippedCount += 1;
          continue;
        }
        totalBytes += entry.size;
        const payload = parseRecovery(await this.readBounded(filePath));
        if (payload.documentId !== match[1].toLowerCase()) {
          throw new Error('Recovery snapshot identity mismatch.');
        }
        recoveries.push({
          recoveryId: payload.documentId,
          sourcePath: payload.sourcePath,
          displayName: payload.sourcePath
            ? basename(payload.sourcePath)
            : 'Untitled document.md',
          updatedAt: payload.updatedAt,
          characterCount: payload.content.length,
          preview: preview(payload.content),
          diskStatus: payload.sourcePath && payload.sourceHash
            ? 'unchecked'
            : 'untracked',
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') continue;
        if (['EACCES', 'EPERM', 'EBUSY', 'EIO', 'EMFILE', 'ENFILE'].includes(code ?? '')) {
          skippedCount += 1;
          continue;
        }
        quarantinedCount += 1;
        await rename(
          filePath,
          `${filePath}.corrupt-${Date.now()}-${index}`,
        ).catch(() => undefined);
      }
    }

    recoveries.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    return { recoveries, quarantinedCount, skippedCount };
  }

  async discard(recoveryId: string): Promise<void> {
    const discardedFolder = join(this.folder, 'discarded');
    await mkdir(discardedFolder, { recursive: true });
    const discardedPath = join(
      discardedFolder,
      `${recoveryId}.${Date.now()}.${randomUUID()}.json`,
    );
    try {
      await rename(this.pathFor(recoveryId), discardedPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  async remove(recoveryId: string): Promise<void> {
    await rm(this.pathFor(recoveryId), { force: true });
  }

  async archive(recoveryId: string): Promise<string | null> {
    try {
      const payload = await this.read(recoveryId);
      const archivedId = randomUUID();
      await this.write({
        ...payload,
        documentId: archivedId,
        updatedAt: new Date().toISOString(),
      });
      await this.remove(recoveryId);
      return archivedId;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async discardIfAtMost(recoveryId: string, revision: number): Promise<void> {
    try {
      const payload = await this.read(recoveryId);
      if (payload.revision <= revision) await this.remove(recoveryId);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  private pathFor(recoveryId: string): string {
    return join(this.folder, `${recoveryId}.json`);
  }

  private async readBounded(filePath: string): Promise<Buffer> {
    const handle = await open(filePath, 'r');
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_RECOVERY_BYTES) {
        throw new Error('Recovery snapshot exceeds the safe read limit.');
      }
      const buffer = Buffer.alloc(metadata.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return buffer.subarray(0, offset);
    } finally {
      await handle.close();
    }
  }

  private async pruneDiscarded(): Promise<void> {
    const discardedFolder = join(this.folder, 'discarded');
    let entries;
    try {
      entries = await readdir(discardedFolder, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    for (const entry of entries.slice(0, 500)) {
      if (!entry.isFile()) continue;
      const filePath = join(discardedFolder, entry.name);
      const metadata = await stat(filePath).catch(() => null);
      if (metadata && metadata.mtimeMs < cutoff) {
        await rm(filePath, { force: true }).catch(() => undefined);
      }
    }
  }
}

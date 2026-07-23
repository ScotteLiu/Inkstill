import { randomUUID } from 'node:crypto';
import { mkdtemp, open, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readDiskDocument } from '../src/main/documents/filePrimitives';
import { MAX_DOCUMENT_BYTES } from '../src/shared/contracts';
import type { RecoveryPayload } from '../src/main/recovery/recoveryPrimitives';
import { RecoveryStore } from '../src/main/recovery/recoveryStore';

const temporaryFolders: string[] = [];

async function makeTemporaryFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'markdown-recovery-store-'));
  temporaryFolders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    temporaryFolders.splice(0).map((folder) =>
      rm(folder, { recursive: true, force: true }),
    ),
  );
});

function payload(
  documentId: string,
  sourcePath: string | null,
  sourceHash: string | null,
  revision = 3,
): RecoveryPayload {
  return {
    documentId,
    sourcePath,
    sourceHash,
    format: { encoding: 'utf8', bom: false, eol: '\n', mixedEol: false },
    content: '# 尚未完成\n\nRecovery 內容',
    revision,
    updatedAt: '2026-07-14T12:00:00.000Z',
  };
}

describe('RecoveryStore', () => {
  it('lists a valid snapshot without eagerly touching its source path', async () => {
    const folder = await makeTemporaryFolder();
    const sourcePath = join(folder, 'note.md');
    const recoveryFolder = join(folder, 'recovery');
    await writeFile(sourcePath, '# 磁碟版本\n', 'utf8');
    const disk = await readDiskDocument(sourcePath);
    const id = randomUUID();
    const store = new RecoveryStore(recoveryFolder);
    await store.write(payload(id, sourcePath, disk.signature.sha256));

    const listed = await store.list();
    expect(listed.recoveries).toHaveLength(1);
    expect(listed.recoveries[0]).toMatchObject({
      recoveryId: id,
      displayName: 'note.md',
      diskStatus: 'unchecked',
    });

    await writeFile(sourcePath, '# 外部更新\n', 'utf8');
    const stillLazy = await store.list();
    expect(stillLazy.recoveries[0].diskStatus).toBe('unchecked');
  });

  it('quarantines malformed JSON without blocking valid recovery', async () => {
    const folder = await makeTemporaryFolder();
    const recoveryFolder = join(folder, 'recovery');
    const store = new RecoveryStore(recoveryFolder);
    const id = randomUUID();
    await store.write(payload(id, null, null));
    await writeFile(join(recoveryFolder, `${randomUUID()}.json`), '{broken', 'utf8');

    const result = await store.list();
    expect(result.recoveries.map((item) => item.recoveryId)).toEqual([id]);
    expect(result.quarantinedCount).toBe(1);
    expect((await readdir(recoveryFolder)).some((name) => name.includes('.corrupt-'))).toBe(true);
  });

  it('only deletes a journal at or below the saved revision', async () => {
    const folder = await makeTemporaryFolder();
    const store = new RecoveryStore(join(folder, 'recovery'));
    const id = randomUUID();
    await store.write(payload(id, null, null, 9));

    await store.discardIfAtMost(id, 8);
    await expect(store.read(id)).resolves.toMatchObject({ revision: 9 });

    await store.discardIfAtMost(id, 9);
    await expect(store.read(id)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('soft-deletes a user-discarded Recovery into a retained folder', async () => {
    const folder = await makeTemporaryFolder();
    const recoveryFolder = join(folder, 'recovery');
    const store = new RecoveryStore(recoveryFolder);
    const id = randomUUID();
    await store.write(payload(id, null, null));

    await store.discard(id);

    await expect(store.read(id)).rejects.toMatchObject({ code: 'ENOENT' });
    const discarded = await readdir(join(recoveryFolder, 'discarded'));
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toContain(id);
  });

  it('quarantines an oversized sparse journal without reading it into memory', async () => {
    const folder = await makeTemporaryFolder();
    const recoveryFolder = join(folder, 'recovery');
    const store = new RecoveryStore(recoveryFolder);
    const id = randomUUID();
    await writeFile(join(recoveryFolder, '.keep'), '', 'utf8').catch(async () => {
      // The store creates the directory on first write.
    });
    await store.write(payload(randomUUID(), null, null));
    const giantPath = join(recoveryFolder, `${id}.json`);
    const handle = await open(giantPath, 'w');
    await handle.truncate(MAX_DOCUMENT_BYTES + 1_000_001);
    await handle.close();

    const result = await store.list();

    expect(result.quarantinedCount).toBe(1);
    expect(result.recoveries).toHaveLength(1);
  });

  it('caps startup enumeration and reports deferred Recovery files', async () => {
    const folder = await makeTemporaryFolder();
    const recoveryFolder = join(folder, 'recovery');
    const store = new RecoveryStore(recoveryFolder);
    await Promise.all(Array.from({ length: 101 }, async () => {
      const id = randomUUID();
      await store.write(payload(id, null, null));
    }));

    const result = await store.list();

    expect(result.recoveries).toHaveLength(100);
    expect(result.skippedCount).toBe(1);
  }, 15_000);

  it('keeps the newest 100 snapshots regardless of directory enumeration order', async () => {
    const folder = await makeTemporaryFolder();
    const recoveryFolder = join(folder, 'recovery');
    const store = new RecoveryStore(recoveryFolder);
    const oldestId = randomUUID();
    const newestId = randomUUID();
    const ids = [oldestId, ...Array.from({ length: 99 }, () => randomUUID())];

    for (const id of ids) {
      await store.write(payload(id, null, null));
    }
    await utimes(
      join(recoveryFolder, `${oldestId}.json`),
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await store.write(payload(newestId, null, null));
    await utimes(
      join(recoveryFolder, `${newestId}.json`),
      new Date('2026-12-31T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z'),
    );

    const result = await store.list();

    expect(result.recoveries).toHaveLength(100);
    expect(result.recoveries.map((item) => item.recoveryId)).toContain(newestId);
    expect(result.recoveries.map((item) => item.recoveryId)).not.toContain(oldestId);
    expect(result.skippedCount).toBe(1);
  }, 15_000);

  it('does not index or quarantine atomic-write transaction markers', async () => {
    const folder = await makeTemporaryFolder();
    const recoveryFolder = join(folder, 'recovery');
    const store = new RecoveryStore(recoveryFolder);
    const markerName = `${randomUUID()}.json.markdown-editor-transaction.json`;
    await store.write(payload(randomUUID(), null, null));
    await writeFile(join(recoveryFolder, markerName), '{not-a-recovery}', 'utf8');

    const result = await store.list();
    const entries = await readdir(recoveryFolder);

    expect(result.recoveries).toHaveLength(1);
    expect(result.quarantinedCount).toBe(0);
    expect(entries).toContain(markerName);
    expect(entries.some((name) => name.includes('.corrupt-'))).toBe(false);
  });
});

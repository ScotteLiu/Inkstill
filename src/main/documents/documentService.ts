import { randomUUID } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';
import { app, dialog } from 'electron';
import { watch, type FSWatcher } from 'chokidar';

import type {
  CreateDocumentRequest,
  DocumentContentRequest,
  DocumentFormat,
  DocumentSnapshot,
  ExternalChangeEvent,
  FileSignature,
  RecoveryListResult,
  RecoveryReceipt,
  SaveConflict,
  SaveResult,
} from '../../shared/contracts';
import { MAX_CONFLICT_CONTENT_CHARACTERS } from '../../shared/contracts';
import {
  encodeUtf8Document,
  FileChangedDuringWriteError,
  normalizeLineEndings,
  readDiskDocument,
  safeDiskState,
  sha256Bytes,
  signaturesMatch,
  writeFileAtomically,
} from './filePrimitives';
import { RecoveryStore } from '../recovery/recoveryStore';

interface DocumentSession {
  id: string;
  path: string | null;
  displayName: string;
  format: DocumentFormat;
  signature: FileSignature | null;
  baseContent: string;
  revision: number;
  savedRevision: number;
  recoveryOriginPath: string | null;
  recoveryOriginHash: string | null;
  recoveryRevision: number;
}

interface PreparedWrite {
  content: string;
  format: DocumentFormat;
}

export class DocumentService {
  private readonly sessions = new Map<string, DocumentSession>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watchGenerations = new Map<string, number>();
  private readonly saveQueues = new Map<string, Promise<void>>();
  private readonly recoveryQueues = new Map<string, Promise<void>>();
  private readonly pathWriteQueues = new Map<string, Promise<void>>();
  private readonly recoveryStore: RecoveryStore;
  private lifecycleGeneration = 0;

  constructor(
    private readonly onExternalChange: (event: ExternalChangeEvent) => void,
    recoveryFolder = join(app.getPath('userData'), 'recovery'),
  ) {
    this.recoveryStore = new RecoveryStore(recoveryFolder);
  }

  createDocument(request: CreateDocumentRequest): DocumentSnapshot {
    const id = randomUUID();
    const session: DocumentSession = {
      id,
      path: null,
      displayName: 'Untitled.md',
      format: {
        encoding: 'utf8',
        bom: false,
        eol: '\n',
        mixedEol: false,
      },
      signature: null,
      baseContent: request.content,
      revision: 0,
      savedRevision: 0,
      recoveryOriginPath: null,
      recoveryOriginHash: null,
      recoveryRevision: -1,
    };
    this.sessions.set(id, session);
    return this.snapshot(session, request.content);
  }

  async openDocument(): Promise<DocumentSnapshot | null> {
    const lifecycleGeneration = this.lifecycleGeneration;
    const result = await dialog.showOpenDialog({
      title: 'Open Markdown File',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: 'Text Files', extensions: ['txt'] },
      ],
    });
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      throw new Error('Open canceled because the session was closed.');
    }
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.openDocumentPath(result.filePaths[0]);
  }

  async openDocumentPath(filePath: string): Promise<DocumentSnapshot> {
    const lifecycleGeneration = this.lifecycleGeneration;
    const disk = await readDiskDocument(filePath);
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      throw new Error('Open canceled because the session closed before reading finished.');
    }
    const id = randomUUID();
    const session: DocumentSession = {
      id,
      path: filePath,
      displayName: basename(filePath),
      format: disk.format,
      signature: disk.signature,
      baseContent: disk.content,
      revision: 0,
      savedRevision: 0,
      recoveryOriginPath: null,
      recoveryOriginHash: null,
      recoveryRevision: -1,
    };
    this.sessions.set(id, session);
    await this.watchSession(session).catch((error) =>
      console.error('File watcher could not start', error),
    );
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      await this.watchers.get(id)?.close().catch(() => undefined);
      this.watchers.delete(id);
      this.watchGenerations.delete(id);
      this.sessions.delete(id);
      throw new Error('Open canceled because the session closed before completion.');
    }
    return this.snapshot(session, disk.content);
  }

  documentPath(documentId: string): string | null {
    return this.requireSession(documentId).path;
  }

  sessionPaths(): string[] {
    return [...new Set([...this.sessions.values()]
      .map((session) => session.path)
      .filter((path): path is string => path !== null))];
  }

  async closeDocument(documentId: string): Promise<void> {
    await Promise.all([
      this.saveQueues.get(documentId),
      this.recoveryQueues.get(documentId),
    ].filter((value): value is Promise<void> => Boolean(value)));

    await this.watchers.get(documentId)?.close().catch((error) =>
      console.error('File watcher could not close', error),
    );
    this.watchers.delete(documentId);
    this.watchGenerations.delete(documentId);
    this.sessions.delete(documentId);
  }

  reloadDocument(documentId: string, expectedRevision: number): Promise<DocumentSnapshot> {
    return this.enqueue(this.saveQueues, documentId, async () => {
      const session = this.requireSession(documentId);
      if (!session.path) throw new Error('An untitled document has no disk path to reload.');
      if (session.revision !== expectedRevision) {
        throw new Error('Reload canceled because the document changed.');
      }

      const disk = await readDiskDocument(session.path);
      if (session.revision !== expectedRevision) {
        throw new Error('Reload canceled because the document changed while reading the disk file.');
      }
      await this.enqueue(this.recoveryQueues, documentId, () =>
        this.recoveryStore.archive(documentId),
      );
      if (session.revision !== expectedRevision) {
        throw new Error('Reload canceled because the document has newer changes.');
      }
      session.format = disk.format;
      session.signature = disk.signature;
      session.baseContent = disk.content;
      session.savedRevision = session.revision;
      session.recoveryOriginPath = null;
      session.recoveryOriginHash = null;
      session.recoveryRevision = -1;
      await this.watchSession(session).catch((error) =>
        console.error('File watcher could not restart', error),
      );
      return this.snapshot(session, disk.content);
    });
  }

  saveDocument(request: DocumentContentRequest): Promise<SaveResult> {
    return this.enqueue(this.saveQueues, request.documentId, () =>
      this.saveDocumentUnlocked(request),
    );
  }

  saveDocumentAs(request: DocumentContentRequest): Promise<SaveResult> {
    return this.enqueue(this.saveQueues, request.documentId, () =>
      this.saveDocumentAsUnlocked(request),
    );
  }

  inspectConflict(request: DocumentContentRequest): Promise<SaveConflict> {
    return this.enqueue(this.saveQueues, request.documentId, async () => {
      const session = this.requireSession(request.documentId);
      if (!session.path) throw new Error('An untitled document has no disk version to compare.');
      session.revision = Math.max(session.revision, request.revision);
      if (session.revision !== request.revision) {
        throw new Error('This comparison is out of date. Open it again.');
      }
      const inspectedPath = session.path;
      const disk = await safeDiskState(inspectedPath);
      if (
        session.path !== inspectedPath ||
        session.revision !== request.revision
      ) {
        throw new Error('The document path changed. Open the comparison again.');
      }
      return this.conflictResult(session, request.content, disk, inspectedPath);
    });
  }

  markEdited(documentId: string, revision: number): void {
    const session = this.requireSession(documentId);
    session.revision = Math.max(session.revision, revision);
  }

  hasDirtyDocuments(): boolean {
    return [...this.sessions.values()].some(
      (session) => session.revision > session.savedRevision,
    );
  }

  writeRecovery(request: DocumentContentRequest): Promise<RecoveryReceipt> {
    const session = this.requireSession(request.documentId);
    session.revision = Math.max(session.revision, request.revision);
    return this.enqueue(this.recoveryQueues, session.id, async () => {
      if (request.revision <= session.savedRevision) {
        return {
          documentId: session.id,
          revision: request.revision,
          contentSha256: sha256Bytes(Buffer.from(request.content, 'utf8')),
        };
      }
      if (request.revision < session.recoveryRevision) {
        const existing = await this.recoveryStore.read(session.id);
        return {
          documentId: existing.documentId,
          revision: existing.revision,
          contentSha256: sha256Bytes(Buffer.from(existing.content, 'utf8')),
        };
      }
      const format = request.eolConversion
        ? {
            ...session.format,
            eol: request.eolConversion,
            mixedEol: false,
          }
        : session.format;
      const content = format.mixedEol
        ? request.content
        : normalizeLineEndings(request.content, format.eol);
      await this.recoveryStore.write({
        documentId: session.id,
        sourcePath: session.path ?? session.recoveryOriginPath,
        sourceHash: session.signature?.sha256 ?? session.recoveryOriginHash,
        format,
        content,
        revision: request.revision,
        updatedAt: new Date().toISOString(),
      });
      session.recoveryRevision = request.revision;
      return {
        documentId: session.id,
        revision: request.revision,
        contentSha256: sha256Bytes(Buffer.from(content, 'utf8')),
      };
    });
  }

  async verifyRecoveryReceipt(receipt: RecoveryReceipt): Promise<boolean> {
    const session = this.sessions.get(receipt.documentId);
    if (!session || session.revision > receipt.revision) return false;
    try {
      const payload = await this.recoveryStore.read(receipt.documentId);
      return payload.revision === receipt.revision &&
        sha256Bytes(Buffer.from(payload.content, 'utf8')) === receipt.contentSha256;
    } catch {
      return false;
    }
  }

  listRecoveries(): Promise<RecoveryListResult> {
    return this.recoveryStore.list();
  }

  async restoreRecovery(recoveryId: string): Promise<DocumentSnapshot> {
    const lifecycleGeneration = this.lifecycleGeneration;
    const recovered = await this.recoveryStore.read(recoveryId);
    const id = randomUUID();
    const revision = Math.max(recovered.revision, 1);
    const migrated = {
      ...recovered,
      documentId: id,
      revision,
      updatedAt: new Date().toISOString(),
    };

    await this.recoveryStore.write(migrated);
    await this.recoveryStore.remove(recoveryId);
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      throw new Error('Restore canceled; the draft remains available.');
    }

    const originalName = recovered.sourcePath
      ? basename(recovered.sourcePath)
      : 'Untitled document.md';
    const session: DocumentSession = {
      id,
      path: null,
      displayName: `Recovered — ${originalName}`,
      format: recovered.format,
      signature: null,
      baseContent: '',
      revision,
      savedRevision: 0,
      recoveryOriginPath: recovered.sourcePath,
      recoveryOriginHash: recovered.sourceHash,
      recoveryRevision: revision,
    };
    this.sessions.set(id, session);
    return this.snapshot(session, recovered.content);
  }

  discardRecovery(recoveryId: string): Promise<void> {
    return this.recoveryStore.discard(recoveryId);
  }

  async close(): Promise<void> {
    this.lifecycleGeneration += 1;
    await Promise.all([
      ...this.saveQueues.values(),
      ...this.recoveryQueues.values(),
      ...this.pathWriteQueues.values(),
    ]);
    const watcherResults = await Promise.allSettled(
      [...this.watchers.values()].map((watcher) => watcher.close()),
    );
    for (const result of watcherResults) {
      if (result.status === 'rejected') {
        console.error('File watcher could not close', result.reason);
      }
    }
    this.watchers.clear();
    this.watchGenerations.clear();
    this.sessions.clear();
  }

  private async saveDocumentUnlocked(
    request: DocumentContentRequest,
  ): Promise<SaveResult> {
    const session = this.requireSession(request.documentId);
    session.revision = Math.max(session.revision, request.revision);
    if (request.revision < session.savedRevision) {
      return this.savedResult(session, session.baseContent);
    }
    if (session.path === null) return this.saveDocumentAsUnlocked(request);

    const disk = await safeDiskState(session.path);
    if (!signaturesMatch(session.signature, disk.signature)) {
      return this.conflictResult(session, request.content, disk);
    }

    if (request.content === session.baseContent && !request.eolConversion) {
      session.savedRevision = Math.max(session.savedRevision, request.revision);
      await this.clearRecovery(session.id, request.revision).catch((error) =>
        console.error('Saved document, but Recovery cleanup failed', error),
      );
      return this.savedResult(session, session.baseContent);
    }

    const prepared = this.prepareWrite(session, request);
    if (!prepared) {
      return {
        status: 'blocked',
        reason: 'mixed-line-endings',
        suggestedEol: session.format.eol,
      };
    }

    return this.writeSession(
      session,
      session.path,
      prepared,
      request,
      disk.signature,
    );
  }

  private async saveDocumentAsUnlocked(
    request: DocumentContentRequest,
  ): Promise<SaveResult> {
    const session = this.requireSession(request.documentId);
    session.revision = Math.max(session.revision, request.revision);
    if (request.revision < session.savedRevision) {
      return this.savedResult(session, session.baseContent);
    }

    const prepared = this.prepareWrite(session, request);
    if (!prepared) {
      return {
        status: 'blocked',
        reason: 'mixed-line-endings',
        suggestedEol: session.format.eol,
      };
    }

    const result = await dialog.showSaveDialog({
      title: 'Save Markdown File',
      defaultPath: session.path ?? session.displayName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { status: 'canceled' };

    const filePath = extname(result.filePath)
      ? result.filePath
      : `${result.filePath}.md`;
    const targetDisk = await safeDiskState(filePath);
    const samePath = session.path !== null &&
      this.pathKey(session.path) === this.pathKey(filePath);
    if (samePath && !signaturesMatch(session.signature, targetDisk.signature)) {
      return this.conflictResult(session, request.content, targetDisk, filePath);
    }
    return this.writeSession(
      session,
      filePath,
      prepared,
      request,
      samePath ? session.signature : targetDisk.signature,
    );
  }

  private prepareWrite(
    session: DocumentSession,
    request: DocumentContentRequest,
  ): PreparedWrite | null {
    if (
      session.format.mixedEol &&
      request.content !== session.baseContent &&
      !request.eolConversion
    ) {
      return null;
    }

    const format = request.eolConversion
      ? {
          ...session.format,
          eol: request.eolConversion,
          mixedEol: false,
        }
      : session.format;
    const content = format.mixedEol
      ? request.content
      : normalizeLineEndings(request.content, format.eol);
    return { content, format };
  }

  private async writeSession(
    session: DocumentSession,
    filePath: string,
    prepared: PreparedWrite,
    request: DocumentContentRequest,
    expectedSignature: FileSignature | null,
  ): Promise<SaveResult> {
    return this.enqueue(this.pathWriteQueues, this.pathKey(filePath), async () => {
      const current = await safeDiskState(filePath);
      if (!signaturesMatch(expectedSignature, current.signature)) {
        return this.conflictResult(session, request.content, current, filePath);
      }

      const bytes = encodeUtf8Document(prepared.content, prepared.format);
      try {
        await writeFileAtomically(filePath, bytes, {
          verifyExpected: true,
          expectedSignature,
        });
      } catch (error) {
        if (error instanceof FileChangedDuringWriteError) {
          const changed = await safeDiskState(filePath);
          return this.conflictResult(session, request.content, changed, filePath);
        }
        throw error;
      }
      const disk = await readDiskDocument(filePath);

      if (disk.signature.sha256 !== sha256Bytes(bytes)) {
        return this.conflictResult(session, request.content, {
          signature: disk.signature,
          content: disk.content,
        }, filePath);
      }

      session.path = filePath;
      session.displayName = basename(filePath);
      session.signature = disk.signature;
      session.format = disk.format;
      session.baseContent = disk.content;
      session.revision = Math.max(session.revision, request.revision);
      session.savedRevision = Math.max(session.savedRevision, request.revision);
      session.recoveryOriginPath = null;
      session.recoveryOriginHash = null;

      await this.clearRecovery(session.id, request.revision).catch((error) =>
        console.error('Saved document, but Recovery cleanup failed', error),
      );
      await this.watchSession(session).catch((error) =>
        console.error('Saved document, but file watcher restart failed', error),
      );
      return this.savedResult(session, disk.content);
    });
  }

  private savedResult(
    session: DocumentSession,
    content: string,
  ): Extract<SaveResult, { status: 'saved' }> {
    return {
      status: 'saved',
      document: this.snapshot(session, content),
      savedRevision: session.savedRevision,
    };
  }

  private conflictResult(
    session: DocumentSession,
    localContent: string,
    disk: { signature: FileSignature | null; content: string | null },
    filePath = session.path ?? '',
  ): Extract<SaveResult, { status: 'conflict' }> {
    return {
      status: 'conflict',
      path: filePath,
      expected: session.signature,
      actual: disk.signature,
      baseContent: this.conflictPreview(session.baseContent),
      localContent: this.conflictPreview(localContent),
      externalContent: disk.content === null
        ? null
        : this.conflictPreview(disk.content),
    };
  }

  private conflictPreview(content: string): string {
    return content.slice(0, MAX_CONFLICT_CONTENT_CHARACTERS);
  }

  private clearRecovery(documentId: string, revision: number): Promise<void> {
    return this.enqueue(this.recoveryQueues, documentId, async () => {
      await this.recoveryStore.discardIfAtMost(documentId, revision);
      const session = this.sessions.get(documentId);
      if (session && session.recoveryRevision <= revision) {
        session.recoveryRevision = -1;
      }
    });
  }

  private async watchSession(session: DocumentSession): Promise<void> {
    await this.watchers.get(session.id)?.close().catch((error) =>
      console.error('Previous file watcher could not close', error),
    );
    this.watchers.delete(session.id);
    const generation = (this.watchGenerations.get(session.id) ?? 0) + 1;
    this.watchGenerations.set(session.id, generation);
    if (!session.path) return;

    const watchedPath = session.path;
    const watcher = watch(watchedPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
    });

    const notify = async (): Promise<void> => {
      if (
        session.path !== watchedPath ||
        this.watchGenerations.get(session.id) !== generation
      ) return;
      const disk = await safeDiskState(watchedPath);
      if (
        session.path !== watchedPath ||
        this.watchGenerations.get(session.id) !== generation
      ) return;
      if (signaturesMatch(session.signature, disk.signature)) return;
      this.onExternalChange({
        documentId: session.id,
        path: watchedPath,
        signature: disk.signature,
      });
    };

    watcher.on('change', () => void notify().catch((error) =>
      console.error('File watcher change check failed', error),
    ));
    watcher.on('unlink', () => void notify().catch((error) =>
      console.error('File watcher unlink check failed', error),
    ));
    watcher.on('error', (error) => console.error('File watcher error', error));
    this.watchers.set(session.id, watcher);
  }

  private snapshot(session: DocumentSession, content: string): DocumentSnapshot {
    return {
      id: session.id,
      path: session.path,
      displayName: session.displayName,
      content,
      format: session.format,
      signature: session.signature,
      revision: session.revision,
      savedRevision: session.savedRevision,
    };
  }

  private requireSession(documentId: string): DocumentSession {
    const session = this.sessions.get(documentId);
    if (!session) throw new Error('Document session does not exist.');
    return session;
  }

  private pathKey(filePath: string): string {
    const canonical = resolve(filePath);
    return process.platform === 'win32' ? canonical.toLocaleLowerCase('en-US') : canonical;
  }

  private enqueue<T>(
    queues: Map<string, Promise<void>>,
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return current;
  }
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  app: { getPath: vi.fn(() => '') },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}));

vi.mock('electron', () => electronMocks);

import { DocumentService } from '../src/main/documents/documentService';

const temporaryFolders: string[] = [];

async function makeTemporaryFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'markdown-document-service-'));
  temporaryFolders.push(folder);
  return folder;
}

beforeEach(() => {
  electronMocks.dialog.showOpenDialog.mockReset();
  electronMocks.dialog.showSaveDialog.mockReset();
});

afterEach(async () => {
  await Promise.all(
    temporaryFolders.splice(0).map((folder) =>
      rm(folder, { recursive: true, force: true }),
    ),
  );
});

describe('DocumentService safety', () => {
  it('disposes a session while preserving its Recovery journal', async () => {
    const folder = await makeTemporaryFolder();
    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const document = service.createDocument({ content: '# Draft' });

    service.markEdited(document.id, 1);
    await service.writeRecovery({
      documentId: document.id,
      content: '# Draft\n\n未儲存',
      revision: 1,
    });
    expect(service.hasDirtyDocuments()).toBe(true);

    await service.closeDocument(document.id);
    expect(service.hasDirtyDocuments()).toBe(false);
    expect((await service.listRecoveries()).recoveries).toHaveLength(1);

    const restored = await service.restoreRecovery(document.id);
    expect(restored).toMatchObject({
      path: null,
      content: '# Draft\n\n未儲存',
      revision: 1,
      savedRevision: 0,
    });
    expect(restored.displayName).toContain('Recovered');
    expect(service.hasDirtyDocuments()).toBe(true);
    await service.close();
  });

  it('blocks a mixed-EOL edit until conversion is explicit', async () => {
    const folder = await makeTemporaryFolder();
    const filePath = join(folder, 'mixed.md');
    const original = Buffer.from('first\r\nsecond\nthird', 'utf8');
    await writeFile(filePath, original);
    electronMocks.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });

    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const document = await service.openDocument();
    expect(document?.format.mixedEol).toBe(true);
    service.markEdited(document!.id, 1);

    const blocked = await service.saveDocument({
      documentId: document!.id,
      content: 'first\nsecond\nthird edited',
      revision: 1,
    });
    expect(blocked).toMatchObject({
      status: 'blocked',
      reason: 'mixed-line-endings',
    });
    expect((await readFile(filePath)).equals(original)).toBe(true);

    const saved = await service.saveDocument({
      documentId: document!.id,
      content: 'first\nsecond\nthird edited',
      revision: 1,
      eolConversion: '\n',
    });
    expect(saved.status).toBe('saved');
    expect(await readFile(filePath, 'utf8')).toBe('first\nsecond\nthird edited');
    if (saved.status === 'saved') {
      expect(saved.document.format).toMatchObject({ eol: '\n', mixedEol: false });
      expect(saved.savedRevision).toBe(1);
    }
    expect(service.hasDirtyDocuments()).toBe(false);
    await service.close();
  });

  it('reloads the same path but keeps a journal of discarded local edits', async () => {
    const folder = await makeTemporaryFolder();
    const filePath = join(folder, 'external.md');
    await writeFile(filePath, '# 磁碟 v1\n', 'utf8');
    electronMocks.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });

    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const document = await service.openDocument();
    service.markEdited(document!.id, 2);
    await service.writeRecovery({
      documentId: document!.id,
      content: '# 本機未儲存版本\n',
      revision: 2,
    });
    await writeFile(filePath, '# 磁碟 v2\n', 'utf8');

    const reloaded = await service.reloadDocument(document!.id, 2);
    expect(reloaded.content).toBe('# 磁碟 v2\n');
    expect(reloaded.savedRevision).toBe(2);
    expect(service.hasDirtyDocuments()).toBe(false);
    const recoveries = await service.listRecoveries();
    expect(recoveries.recoveries).toHaveLength(1);
    expect(recoveries.recoveries[0]).toMatchObject({
      diskStatus: 'unchecked',
    });
    expect(recoveries.recoveries[0].recoveryId).not.toBe(document!.id);

    service.markEdited(document!.id, 3);
    await service.writeRecovery({
      documentId: document!.id,
      content: '# 磁碟 v2\n\n新的本機編輯',
      revision: 3,
    });
    const generations = await service.listRecoveries();
    expect(generations.recoveries).toHaveLength(2);
    expect(generations.recoveries.map((item) => item.preview)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('本機未儲存版本'),
        expect.stringContaining('新的本機編輯'),
      ]),
    );
    await service.close();
  });

  it('reports a verified disk write as saved even if stale Recovery cleanup fails', async () => {
    const folder = await makeTemporaryFolder();
    const recoveryFolder = join(folder, 'recovery');
    const filePath = join(folder, 'cleanup.md');
    await writeFile(filePath, '# Before\n', 'utf8');
    electronMocks.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });

    const service = new DocumentService(() => undefined, recoveryFolder);
    const document = await service.openDocument();
    service.markEdited(document!.id, 1);
    await mkdir(recoveryFolder, { recursive: true });
    await writeFile(join(recoveryFolder, `${document!.id}.json`), '{broken', 'utf8');

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await service.saveDocument({
      documentId: document!.id,
      content: '# After\n',
      revision: 1,
    });
    expect(result.status).toBe('saved');
    expect(await readFile(filePath, 'utf8')).toBe('# After\n');
    expect(service.hasDirtyDocuments()).toBe(false);
    expect(logged).toHaveBeenCalledWith(
      'Saved document, but Recovery cleanup failed',
      expect.anything(),
    );

    service.markEdited(document!.id, 2);
    expect(service.hasDirtyDocuments()).toBe(true);
    await service.close();
  });

  it('keeps conflict inspection read-only even when disk bytes return to the base version', async () => {
    const folder = await makeTemporaryFolder();
    const filePath = join(folder, 'compare.md');
    await writeFile(filePath, 'A', 'utf8');
    electronMocks.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });
    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const document = await service.openDocument();
    service.markEdited(document!.id, 1);
    await writeFile(filePath, 'B', 'utf8');
    await writeFile(filePath, 'A', 'utf8');

    const comparison = await service.inspectConflict({
      documentId: document!.id,
      content: 'LOCAL',
      revision: 1,
    });

    expect(comparison).toMatchObject({
      status: 'conflict',
      baseContent: 'A',
      localContent: 'LOCAL',
      externalContent: 'A',
    });
    expect(await readFile(filePath, 'utf8')).toBe('A');
    await service.close();
  });

  it('clips oversized conflict bodies for IPC without overwriting document data', async () => {
    const folder = await makeTemporaryFolder();
    const filePath = join(folder, 'large-conflict.md');
    const baseContent = `base:${'B'.repeat(20_010)}`;
    const localContent = `local:${'L'.repeat(20_010)}`;
    const externalContent = `external:${'E'.repeat(20_010)}`;
    await writeFile(filePath, baseContent, 'utf8');
    electronMocks.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });

    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const document = await service.openDocument();
    service.markEdited(document!.id, 1);
    await writeFile(filePath, externalContent, 'utf8');

    const conflict = await service.saveDocument({
      documentId: document!.id,
      content: localContent,
      revision: 1,
    });

    expect(conflict.status).toBe('conflict');
    if (conflict.status === 'conflict') {
      expect(conflict.baseContent).toBe(baseContent.slice(0, 20_001));
      expect(conflict.localContent).toBe(localContent.slice(0, 20_001));
      expect(conflict.externalContent).toBe(externalContent.slice(0, 20_001));
      expect(conflict.baseContent).toHaveLength(20_001);
      expect(conflict.localContent).toHaveLength(20_001);
      expect(conflict.externalContent).toHaveLength(20_001);
    }
    expect(await readFile(filePath, 'utf8')).toBe(externalContent);
    expect(localContent).toBe(`local:${'L'.repeat(20_010)}`);
    await service.close();
  });

  it('serializes two sessions saving the same path so exactly one can win', async () => {
    const folder = await makeTemporaryFolder();
    const filePath = join(folder, 'shared.md');
    await writeFile(filePath, 'base', 'utf8');
    electronMocks.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });
    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const first = await service.openDocument();
    const second = await service.openDocument();
    service.markEdited(first!.id, 1);
    service.markEdited(second!.id, 1);

    const results = await Promise.all([
      service.saveDocument({ documentId: first!.id, content: 'first', revision: 1 }),
      service.saveDocument({ documentId: second!.id, content: 'second', revision: 1 }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['conflict', 'saved']);
    const savedIndex = results.findIndex((result) => result.status === 'saved');
    const winner = savedIndex === 0 ? 'first' : 'second';
    const loser = savedIndex === 0 ? 'second' : 'first';
    expect(await readFile(filePath, 'utf8')).toBe(winner);
    expect(results[1 - savedIndex]).toMatchObject({
      status: 'conflict',
      localContent: loser,
      externalContent: winner,
    });
    await service.close();
  });

  it('does not let Save As bypass conflict protection when selecting the same path', async () => {
    const folder = await makeTemporaryFolder();
    const filePath = join(folder, 'same.md');
    await writeFile(filePath, 'base', 'utf8');
    electronMocks.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [filePath],
    });
    electronMocks.dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath,
    });
    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const document = await service.openDocument();
    service.markEdited(document!.id, 1);
    await writeFile(filePath, 'external', 'utf8');

    const result = await service.saveDocumentAs({
      documentId: document!.id,
      content: 'local',
      revision: 1,
    });

    expect(result.status).toBe('conflict');
    expect(await readFile(filePath, 'utf8')).toBe('external');
    await service.close();
  });

  it('verifies Recovery receipts against the latest main-process revision', async () => {
    const folder = await makeTemporaryFolder();
    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const document = service.createDocument({ content: '' });
    service.markEdited(document.id, 1);
    const receipt = await service.writeRecovery({
      documentId: document.id,
      content: 'revision one',
      revision: 1,
    });
    await expect(service.verifyRecoveryReceipt(receipt)).resolves.toBe(true);

    service.markEdited(document.id, 2);
    await expect(service.verifyRecoveryReceipt(receipt)).resolves.toBe(false);
    await service.close();
  });

  it('does not let a deferred Open resurrect a session after close', async () => {
    const folder = await makeTemporaryFolder();
    let resolveDialog!: (value: { canceled: boolean; filePaths: string[] }) => void;
    electronMocks.dialog.showOpenDialog.mockReturnValue(new Promise((resolve) => {
      resolveDialog = resolve;
    }));
    const service = new DocumentService(() => undefined, join(folder, 'recovery'));
    const pendingOpen = service.openDocument();

    await service.close();
    resolveDialog({ canceled: false, filePaths: [join(folder, 'late.md')] });

    await expect(pendingOpen).rejects.toThrow(/canceled|closed/i);
    expect(service.hasDirtyDocuments()).toBe(false);
    const fresh = service.createDocument({ content: 'new lifecycle' });
    expect(fresh.content).toBe('new lifecycle');
    await service.close();
  });
});

import { link, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeUtf8Document,
  detectDocumentFormat,
  encodeUtf8Document,
  readDiskDocument,
  recoverInterruptedWrite,
  sha256Bytes,
  signaturesMatch,
  writeFileAtomically,
} from '../src/main/documents/filePrimitives';
import { makeGoldenBytes } from './fixtures/golden';

const temporaryFolders: string[] = [];

async function makeTemporaryFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'markdown-editor-'));
  temporaryFolders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe('UTF-8 source fidelity', () => {
  it('round-trips BOM, CRLF, Unicode and missing final newline byte-for-byte', () => {
    const original = makeGoldenBytes();
    const decoded = decodeUtf8Document(original);
    const encoded = encodeUtf8Document(decoded.content, decoded.format);

    expect(decoded.format).toEqual({
      encoding: 'utf8',
      bom: true,
      eol: '\r\n',
      mixedEol: false,
    });
    expect(decoded.content.endsWith('\n')).toBe(false);
    expect(encoded.equals(original)).toBe(true);
    expect(decoded.content).toContain('decomposed=e\u0301');
    expect(decoded.content).toContain('precomposed=\u00e9');
    expect(decoded.content).toContain('NBSP=A\u00a0B');
  });

  it('reports mixed line endings instead of silently hiding the risk', () => {
    expect(detectDocumentFormat('a\r\nb\nc', false)).toEqual({
      encoding: 'utf8',
      bom: false,
      eol: '\n',
      mixedEol: true,
    });
  });

  it('treats legacy lone-CR separators as requiring explicit conversion', () => {
    expect(detectDocumentFormat('a\rb\nc', false)).toEqual({
      encoding: 'utf8',
      bom: false,
      eol: '\n',
      mixedEol: true,
    });
  });

  it('rejects invalid UTF-8 instead of replacing bytes', () => {
    expect(() => decodeUtf8Document(Buffer.from([0xc3, 0x28]))).toThrow();
  });
});

describe('atomic file primitives', () => {
  it('creates and replaces a file without leaving temporary artifacts', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'document.md');
    await writeFileAtomically(target, Buffer.from('first', 'utf8'));
    await writeFileAtomically(target, Buffer.from('second 中文', 'utf8'));

    expect(await readFile(target, 'utf8')).toBe('second 中文');
    expect(await readdir(folder)).toEqual(['document.md']);
  });

  it('hashes file content so unchanged mtime cannot hide an external edit', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'conflict.md');
    await writeFile(target, '# v0\n', 'utf8');
    const original = await readDiskDocument(target);
    const originalTime = new Date(original.signature.mtimeMs);

    await writeFile(target, '# ve\n', 'utf8');
    await utimes(target, originalTime, originalTime);
    const external = await readDiskDocument(target);

    expect(external.signature.mtimeMs).toBeCloseTo(original.signature.mtimeMs, -1);
    expect(signaturesMatch(original.signature, external.signature)).toBe(false);
  });

  it('rejects linked files instead of silently replacing their link semantics', async () => {
    const folder = await makeTemporaryFolder();
    const realPath = join(folder, 'real.md');
    const linkedPath = join(folder, 'linked.md');
    await writeFile(realPath, 'shared bytes', 'utf8');
    await link(realPath, linkedPath);

    await expect(readDiskDocument(linkedPath)).rejects.toThrow(/hard link/);
    expect(await readFile(realPath, 'utf8')).toBe('shared bytes');
  });

  it('detects a writer that changes the target after the final preflight check', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'race.md');
    await writeFile(target, 'version A', 'utf8');
    const expected = await readDiskDocument(target);

    await expect(writeFileAtomically(
      target,
      Buffer.from('local C', 'utf8'),
      {
        verifyExpected: true,
        expectedSignature: expected.signature,
        beforeTargetMove: async () => {
          await writeFile(target, 'external B', 'utf8');
        },
      },
    )).rejects.toThrow(/changed|overwrite/i);

    expect(await readFile(target, 'utf8')).toBe('external B');
  });

  it('repairs a crash between moving the old target and installing the new target', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'recover.md');
    const tempName = '.recover.md.1234.00000000-0000-4000-8000-000000000001.tmp';
    const backupName = '.recover.md.00000000-0000-4000-8000-000000000002.markdown-editor-backup';
    const markerName = '.recover.md.markdown-editor-transaction.json';
    const oldBytes = Buffer.from('safe old version', 'utf8');
    const newBytes = Buffer.from('new version', 'utf8');
    await writeFile(join(folder, backupName), oldBytes);
    await writeFile(join(folder, tempName), newBytes);
    await writeFile(join(folder, markerName), JSON.stringify({
      version: 1,
      targetName: 'recover.md',
      tempName,
      backupName,
      newSha256: sha256Bytes(newBytes),
      expectedSha256: sha256Bytes(oldBytes),
      verifyExpected: true,
    }), 'utf8');

    await recoverInterruptedWrite(target);

    expect(await readFile(target, 'utf8')).toBe('new version');
    expect(await readdir(folder)).toEqual(['recover.md']);
  });

  it('does not overwrite a divergent target during crash recovery and preserves all evidence', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'partial.md');
    const tempName = '.partial.md.1234.00000000-0000-4000-8000-000000000003.tmp';
    const backupName = '.partial.md.00000000-0000-4000-8000-000000000004.markdown-editor-backup';
    const markerName = '.partial.md.markdown-editor-transaction.json';
    const oldBytes = Buffer.from('complete old', 'utf8');
    const newBytes = Buffer.from('complete new', 'utf8');
    await writeFile(target, 'part', 'utf8');
    await writeFile(join(folder, backupName), oldBytes);
    await writeFile(join(folder, tempName), newBytes);
    await writeFile(join(folder, markerName), JSON.stringify({
      version: 1,
      targetName: 'partial.md',
      tempName,
      backupName,
      newSha256: sha256Bytes(newBytes),
      expectedSha256: sha256Bytes(oldBytes),
      verifyExpected: true,
    }), 'utf8');

    await expect(recoverInterruptedWrite(target)).rejects.toMatchObject({
      name: 'FileChangedDuringWriteError',
    });

    expect(await readFile(target, 'utf8')).toBe('part');
    expect(await readFile(join(folder, backupName), 'utf8')).toBe('complete old');
    expect(await readFile(join(folder, tempName), 'utf8')).toBe('complete new');
    expect(await readFile(join(folder, markerName), 'utf8')).toContain('expectedSha256');
  });

  it('repairs a crash that interrupted the install copy and left a partial target', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'partial-install.md');
    const tempName = '.partial-install.md.1234.00000000-0000-4000-8000-000000000007.tmp';
    const backupName = '.partial-install.md.00000000-0000-4000-8000-000000000008.markdown-editor-backup';
    const markerName = '.partial-install.md.markdown-editor-transaction.json';
    const oldBytes = Buffer.from('complete old version', 'utf8');
    const newBytes = Buffer.from('complete new version', 'utf8');
    // A crash mid-copy leaves the target holding a byte prefix of the new file.
    await writeFile(target, newBytes.subarray(0, 11));
    await writeFile(join(folder, backupName), oldBytes);
    await writeFile(join(folder, tempName), newBytes);
    await writeFile(join(folder, markerName), JSON.stringify({
      version: 1,
      targetName: 'partial-install.md',
      tempName,
      backupName,
      newSha256: sha256Bytes(newBytes),
      expectedSha256: sha256Bytes(oldBytes),
      verifyExpected: true,
    }), 'utf8');

    await recoverInterruptedWrite(target);

    expect(await readFile(target, 'utf8')).toBe('complete new version');
    const entries = await readdir(folder);
    expect(entries).toContain('partial-install.md');
    expect(entries).not.toContain(tempName);
    expect(entries).not.toContain(backupName);
    expect(entries).not.toContain(markerName);
  });

  it('does not recover from a backup whose hash differs from expected and preserves state', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'backup-conflict.md');
    const tempName = '.backup-conflict.md.1234.00000000-0000-4000-8000-000000000005.tmp';
    const backupName = '.backup-conflict.md.00000000-0000-4000-8000-000000000006.markdown-editor-backup';
    const markerName = '.backup-conflict.md.markdown-editor-transaction.json';
    const expectedBytes = Buffer.from('expected old', 'utf8');
    const externalBytes = Buffer.from('external replacement', 'utf8');
    const newBytes = Buffer.from('local new', 'utf8');
    await writeFile(join(folder, backupName), externalBytes);
    await writeFile(join(folder, tempName), newBytes);
    await writeFile(join(folder, markerName), JSON.stringify({
      version: 1,
      targetName: 'backup-conflict.md',
      tempName,
      backupName,
      newSha256: sha256Bytes(newBytes),
      expectedSha256: sha256Bytes(expectedBytes),
      verifyExpected: true,
    }), 'utf8');

    await expect(recoverInterruptedWrite(target)).rejects.toMatchObject({
      name: 'FileChangedDuringWriteError',
    });

    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(folder, backupName), 'utf8')).toBe('external replacement');
    expect(await readFile(join(folder, tempName), 'utf8')).toBe('local new');
    expect((await readdir(folder)).sort()).toEqual([
      backupName,
      markerName,
      tempName,
    ].sort());
  });

  it('quarantines a transaction marker that aliases the target and an ordinary sibling', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'valuable.md');
    const sibling = join(folder, 'notes.txt');
    const markerName = '.valuable.md.markdown-editor-transaction.json';
    const targetBytes = Buffer.from('valuable target content', 'utf8');
    await writeFile(target, targetBytes);
    await writeFile(sibling, 'unrelated sibling content', 'utf8');
    await writeFile(join(folder, markerName), JSON.stringify({
      version: 1,
      targetName: 'valuable.md',
      tempName: 'valuable.md',
      backupName: 'notes.txt',
      newSha256: sha256Bytes(targetBytes),
      expectedSha256: null,
      verifyExpected: false,
    }), 'utf8');

    await recoverInterruptedWrite(target);

    expect(await readFile(target, 'utf8')).toBe('valuable target content');
    expect(await readFile(sibling, 'utf8')).toBe('unrelated sibling content');
    const entries = await readdir(folder);
    expect(entries).toContain('valuable.md');
    expect(entries).toContain('notes.txt');
    expect(entries.some((name) => name.startsWith(`${markerName}.corrupt-`))).toBe(true);
  });

  it('serializes a read behind an in-flight write to the same canonical path', async () => {
    const folder = await makeTemporaryFolder();
    const target = join(folder, 'locked.md');
    await writeFile(target, 'old', 'utf8');
    const expected = await readDiskDocument(target);
    let releaseWrite!: () => void;
    const writeMayContinue = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let signalWritePaused!: () => void;
    const writePaused = new Promise<void>((resolve) => {
      signalWritePaused = resolve;
    });

    const writing = writeFileAtomically(target, Buffer.from('new', 'utf8'), {
      verifyExpected: true,
      expectedSignature: expected.signature,
      beforeTargetMove: async () => {
        signalWritePaused();
        await writeMayContinue;
      },
    });
    await writePaused;

    let readSettled = false;
    const reading = readDiskDocument(join(folder, '.', 'locked.md')).then((document) => {
      readSettled = true;
      return document;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(readSettled).toBe(false);

    releaseWrite();
    await expect(writing).resolves.toBeUndefined();
    await expect(reading).resolves.toMatchObject({ content: 'new' });
  });
});

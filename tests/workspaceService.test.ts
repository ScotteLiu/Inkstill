import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findWorkspaceMentions,
  resolveWorkspacePath,
  scanWorkspace,
  searchWorkspace,
} from '../src/main/workspace/workspaceService';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'inkstill-workspace-'));
  folders.push(root);
  await mkdir(join(root, 'notes'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'ignored'), { recursive: true });
  await writeFile(join(root, 'Alpha.md'), '# Alpha\n\nLinks to [[Beta]].\n', 'utf8');
  await writeFile(join(root, 'notes', 'Beta.md'), '# Beta\n\nAlpha is mentioned here.\n', 'utf8');
  await writeFile(join(root, 'node_modules', 'ignored', 'Hidden.md'), '# Hidden', 'utf8');
  return root;
}

describe('workspace service', () => {
  it('scans Markdown files and ignores dependency folders', async () => {
    const root = await fixture();
    const snapshot = await scanWorkspace(root);
    expect(snapshot.files.map((file) => file.relativePath)).toEqual(['Alpha.md', 'notes/Beta.md']);
    expect(snapshot.truncated).toBe(false);
  });

  it('searches with line context and finds linked and unlinked mentions', async () => {
    const root = await fixture();
    const search = await searchWorkspace(root, 'mentioned');
    expect(search).toMatchObject([{ relativePath: 'notes/Beta.md', line: 3 }]);
    const betaMentions = await findWorkspaceMentions(root, 'Beta.md');
    expect(betaMentions).toMatchObject([{ relativePath: 'Alpha.md', linked: true }]);
    const alphaMentions = await findWorkspaceMentions(root, 'Alpha.md');
    expect(alphaMentions).toMatchObject([{ relativePath: 'notes/Beta.md', linked: false }]);
  });

  it('finds plain-text mentions of CJK note names', async () => {
    const root = await fixture();
    await writeFile(join(root, '工作日记.md'), '# 工作日记\n', 'utf8');
    await writeFile(join(root, 'Journal.md'), '今天更新了工作日记的内容。\n', 'utf8');
    const mentions = await findWorkspaceMentions(root, '工作日记.md');
    expect(mentions).toMatchObject([{ relativePath: 'Journal.md', line: 1, linked: false }]);
  });

  it('still bounds English mentions at word edges', async () => {
    const root = await fixture();
    await writeFile(join(root, 'Note.md'), 'Keep notes and Alphabet here, Alpha too.\n', 'utf8');
    const mentions = await findWorkspaceMentions(root, 'Alpha.md');
    const noteMention = mentions.filter((mention) => mention.relativePath === 'Note.md');
    expect(noteMention).toHaveLength(1);
  });

  it('rejects paths that escape the workspace', async () => {
    const root = await fixture();
    expect(() => resolveWorkspacePath(root, '../outside.md')).toThrow(/outside/i);
    expect(resolveWorkspacePath(root, 'notes/Beta.md')).toBe(join(root, 'notes', 'Beta.md'));
  });
});

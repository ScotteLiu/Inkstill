import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';

import type {
  WorkspaceMention,
  WorkspaceSearchResult,
  WorkspaceSnapshot,
} from '../../shared/contracts';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);
const IGNORED_FOLDERS = new Set(['.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'out']);
const MAX_WORKSPACE_FILES = 5_000;
const MAX_SEARCH_BYTES = 2_000_000;

function portablePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

export function resolveWorkspacePath(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) throw new Error('Invalid workspace path.');
  const target = resolve(root, ...relativePath.split('/'));
  const rootPrefix = `${resolve(root)}${sep}`;
  const normalizedRoot = process.platform === 'win32' ? rootPrefix.toLocaleLowerCase('en-US') : rootPrefix;
  const normalizedTarget = process.platform === 'win32' ? target.toLocaleLowerCase('en-US') : target;
  if (!normalizedTarget.startsWith(normalizedRoot)) throw new Error('The file is outside the workspace.');
  return target;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (folder: string, depth: number): Promise<void> => {
    if (depth > 20 || files.length >= MAX_WORKSPACE_FILES) return;
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_FOLDERS.has(entry.name) || entry.name.startsWith('.')) continue;
        await visit(path, depth + 1);
      } else if (entry.isFile() && MARKDOWN_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase('en-US'))) {
        files.push(path);
      }
    }
  };
  await visit(resolve(root), 0);
  return files;
}

export async function scanWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const canonicalRoot = resolve(root);
  const info = await stat(canonicalRoot);
  if (!info.isDirectory()) throw new Error('The selected workspace is not a folder.');
  const files = await collectMarkdownFiles(canonicalRoot);
  return {
    rootName: basename(canonicalRoot),
    rootPath: canonicalRoot,
    truncated: files.length >= MAX_WORKSPACE_FILES,
    files: files.map((filePath) => ({
      relativePath: portablePath(canonicalRoot, filePath),
      name: basename(filePath),
    })),
  };
}

function linePreview(line: string, query: string): string {
  const compact = line.trim().replace(/\s+/g, ' ');
  const index = compact.toLocaleLowerCase('en-US').indexOf(query.toLocaleLowerCase('en-US'));
  const start = Math.max(0, index - 55);
  return `${start > 0 ? '…' : ''}${compact.slice(start, start + 180)}${compact.length > start + 180 ? '…' : ''}`;
}

export async function searchWorkspace(root: string, query: string): Promise<WorkspaceSearchResult[]> {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  if (!normalized) return [];
  const files = await collectMarkdownFiles(root);
  const results: WorkspaceSearchResult[] = [];
  for (const filePath of files) {
    if (results.length >= 100) break;
    const info = await stat(filePath);
    if (info.size > MAX_SEARCH_BYTES) continue;
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r\n|\r|\n/);
    for (let index = 0; index < lines.length && results.length < 100; index += 1) {
      if (!lines[index].toLocaleLowerCase('en-US').includes(normalized)) continue;
      results.push({
        relativePath: portablePath(root, filePath),
        line: index + 1,
        preview: linePreview(lines[index], query),
      });
    }
  }
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findWorkspaceMentions(root: string, noteName: string): Promise<WorkspaceMention[]> {
  const target = basename(noteName, extname(noteName));
  if (!target) return [];
  const linkedPattern = new RegExp(`\\[\\[${escapeRegExp(target)}(?:[#|\\]])`, 'i');
  const namePattern = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i');
  const files = await collectMarkdownFiles(root);
  const mentions: WorkspaceMention[] = [];
  for (const filePath of files) {
    if (mentions.length >= 100 || basename(filePath, extname(filePath)).toLocaleLowerCase('en-US') === target.toLocaleLowerCase('en-US')) continue;
    const info = await stat(filePath);
    if (info.size > MAX_SEARCH_BYTES) continue;
    const lines = (await readFile(filePath, 'utf8')).split(/\r\n|\r|\n/);
    for (let index = 0; index < lines.length && mentions.length < 100; index += 1) {
      const linked = linkedPattern.test(lines[index]);
      if (!linked && !namePattern.test(lines[index])) continue;
      mentions.push({
        relativePath: portablePath(root, filePath),
        line: index + 1,
        preview: linePreview(lines[index], target),
        linked,
      });
    }
  }
  return mentions;
}

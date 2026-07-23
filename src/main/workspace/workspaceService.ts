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
const WORKSPACE_CACHE_TTL_MS = 3_000;
const MAX_CACHED_WORKSPACES = 4;
const SEARCH_CONTENT_CACHE_TTL_MS = 3_000;
const MAX_SEARCH_CONTENT_CACHE_BYTES = 16_000_000;

interface WorkspaceFileCacheEntry {
  expiresAt: number;
  files: string[];
}

interface SearchContentCacheEntry {
  bytes: number;
  content: string | null;
  expiresAt: number;
}

const workspaceFileCache = new Map<string, WorkspaceFileCacheEntry>();
const workspaceScans = new Map<string, Promise<string[]>>();
const searchContentCache = new Map<string, SearchContentCacheEntry>();
let searchContentCacheBytes = 0;

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

function cacheWorkspaceFiles(root: string, files: string[]): void {
  workspaceFileCache.delete(root);
  workspaceFileCache.set(root, {
    expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS,
    files,
  });
  while (workspaceFileCache.size > MAX_CACHED_WORKSPACES) {
    const oldest = workspaceFileCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    workspaceFileCache.delete(oldest);
  }
}

async function collectMarkdownFiles(root: string, forceRefresh = false): Promise<string[]> {
  const canonicalRoot = resolve(root);
  const cached = workspaceFileCache.get(canonicalRoot);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.files;
  }
  const activeScan = workspaceScans.get(canonicalRoot);
  if (activeScan) return activeScan;

  const files: string[] = [];
  const visit = async (folder: string, depth: number): Promise<void> => {
    if (depth > 20 || files.length >= MAX_WORKSPACE_FILES) return;
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      // One unreadable subfolder must not abort the whole workspace scan.
      if (depth === 0) throw error;
      return;
    }
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
  const scan = visit(canonicalRoot, 0).then(() => {
    cacheWorkspaceFiles(canonicalRoot, files);
    return files;
  });
  workspaceScans.set(canonicalRoot, scan);
  try {
    return await scan;
  } finally {
    if (workspaceScans.get(canonicalRoot) === scan) {
      workspaceScans.delete(canonicalRoot);
    }
  }
}

function cacheSearchContent(filePath: string, content: string | null, bytes: number): void {
  const previous = searchContentCache.get(filePath);
  if (previous) searchContentCacheBytes -= previous.bytes;
  searchContentCache.delete(filePath);
  searchContentCache.set(filePath, {
    bytes,
    content,
    expiresAt: Date.now() + SEARCH_CONTENT_CACHE_TTL_MS,
  });
  searchContentCacheBytes += bytes;

  while (searchContentCacheBytes > MAX_SEARCH_CONTENT_CACHE_BYTES) {
    const oldestPath = searchContentCache.keys().next().value as string | undefined;
    if (oldestPath === undefined) break;
    const oldest = searchContentCache.get(oldestPath);
    searchContentCache.delete(oldestPath);
    searchContentCacheBytes -= oldest?.bytes ?? 0;
  }
}

async function readSearchableFile(filePath: string): Promise<string | null> {
  const cached = searchContentCache.get(filePath);
  if (cached && cached.expiresAt > Date.now()) {
    searchContentCache.delete(filePath);
    searchContentCache.set(filePath, cached);
    return cached.content;
  }

  const info = await stat(filePath);
  if (info.size > MAX_SEARCH_BYTES) {
    cacheSearchContent(filePath, null, 0);
    return null;
  }
  const content = await readFile(filePath, 'utf8');
  cacheSearchContent(filePath, content, info.size);
  return content;
}

export async function scanWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const canonicalRoot = resolve(root);
  const info = await stat(canonicalRoot);
  if (!info.isDirectory()) throw new Error('The selected workspace is not a folder.');
  const files = await collectMarkdownFiles(canonicalRoot, true);
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
    const content = await readSearchableFile(filePath);
    if (content === null) continue;
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
  // Word boundaries only exist next to ASCII word characters; scripts such as
  // CJK write mentions inside running text with no delimiters at all, so only
  // require a boundary on the sides of the name that end in a word character.
  const leadingBoundary = /^[A-Za-z0-9_]/.test(target) ? '(?<![\\p{L}\\p{N}])' : '';
  const trailingBoundary = /[A-Za-z0-9_]$/.test(target) ? '(?![\\p{L}\\p{N}])' : '';
  const namePattern = new RegExp(
    `${leadingBoundary}${escapeRegExp(target)}${trailingBoundary}`,
    'iu',
  );
  const files = await collectMarkdownFiles(root);
  const mentions: WorkspaceMention[] = [];
  for (const filePath of files) {
    if (mentions.length >= 100 || basename(filePath, extname(filePath)).toLocaleLowerCase('en-US') === target.toLocaleLowerCase('en-US')) continue;
    const content = await readSearchableFile(filePath);
    if (content === null) continue;
    const lines = content.split(/\r\n|\r|\n/);
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

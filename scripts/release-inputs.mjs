import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const releaseInputPaths = [
  '.github',
  'assets',
  'src',
  'tests',
  'e2e',
  'scripts',
  '.gitattributes',
  '.gitignore',
  '.node-version',
  'index.html',
  'README.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'forge.config.ts',
  'tsconfig.json',
  'vite.main.config.ts',
  'vite.preload.config.ts',
  'vite.renderer.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'release/README.md',
];
const optionalReleaseInputPaths = ['LICENSE', 'EULA.md', 'EULA.txt'];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function filesUnder(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function sourceTreeHash(root) {
  const requiredFiles = (await Promise.all(
    releaseInputPaths.map((item) => filesUnder(join(root, item))),
  )).flat();
  const optionalFiles = (await Promise.all(
    optionalReleaseInputPaths.map(async (item) => {
      try {
        return await filesUnder(join(root, item));
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
    }),
  )).flat();
  const files = [...requiredFiles, ...optionalFiles]
    .sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const file of files) {
    const name = relative(root, file).replaceAll('\\', '/');
    hash.update(name);
    hash.update('\0');
    hash.update(sha256(await readFile(file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

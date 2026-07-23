import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function filesBelow(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const platform = option('platform');
const arch = option('arch');
if (!['darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
  throw new Error('Usage: node scripts/platform-artifact-gate.mjs --platform darwin|linux --arch x64|arm64');
}

const makeRoot = resolve('out', 'make');
const files = await filesBelow(makeRoot);
const requiredExtensions = platform === 'darwin'
  ? ['.dmg', '.zip']
  : ['.deb', '.rpm', '.zip'];

for (const extension of requiredExtensions) {
  const matches = files.filter((path) => path.toLocaleLowerCase('en-US').endsWith(extension));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${platform} ${arch} ${extension} artifact, found ${matches.length}.`);
  }
  const details = await stat(matches[0]);
  if (details.size < 100_000) throw new Error(`${matches[0]} is unexpectedly small.`);
  console.log(`${extension}: ${matches[0]} (${details.size} bytes)`);
}

const packagedRoot = resolve('out', `Inkstill-${platform}-${arch}`);
const packagedFiles = await filesBelow(packagedRoot);
if (platform === 'darwin') {
  if (!packagedFiles.some((path) => path.endsWith(join('Inkstill.app', 'Contents', 'MacOS', 'Inkstill')))) {
    throw new Error('The macOS application bundle does not contain the Inkstill executable.');
  }
} else if (!packagedFiles.some((path) => path.endsWith(join('Inkstill-linux-x64', 'Inkstill')))) {
  // Forge normally names this folder Inkstill-linux-x64. Keep the check scoped
  // to the executable basename so future Forge directory changes remain visible.
  if (!packagedFiles.some((path) => path.endsWith(join(`Inkstill-${platform}-${arch}`, 'Inkstill')))) {
    throw new Error('The Linux package does not contain the Inkstill executable.');
  }
}

console.log(`Validated ${platform} ${arch} package and maker artifacts.`);

import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'site');
const output = resolve(root, '_site');
const assets = resolve(output, 'assets');

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(source, output, { recursive: true });

for (const [from, to] of [
  ['assets/icon.png', 'assets/icon.png'],
  ['docs/images/inkstill-split-preview.png', 'assets/inkstill-split-preview.png'],
  ['docs/images/inkstill-command-palette.png', 'assets/inkstill-command-palette.png'],
  ['docs/images/inkstill-writing-tools.png', 'assets/inkstill-writing-tools.png'],
  ['docs/images/inkstill-social-preview.png', 'assets/inkstill-social-preview.png'],
]) {
  await cp(resolve(root, from), resolve(output, to));
}

const requiredSnippets = [
  ['index.html', '<html lang="en">'],
  ['index.html', '"@type": "SoftwareApplication"'],
  ['index.html', 'rel="canonical"'],
  ['zh-cn.html', '<html lang="zh-CN">'],
  ['zh-cn.html', 'hreflang="zh-CN"'],
  ['robots.txt', 'Sitemap: https://scotteliu.github.io/Inkstill/sitemap.xml'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/zh-cn.html'],
  ['updates/windows-preview.json', '"schemaVersion": 1'],
];

for (const [file, snippet] of requiredSnippets) {
  const content = await readFile(resolve(output, file), 'utf8');
  if (!content.includes(snippet)) {
    throw new Error(`${file} is missing required content: ${snippet}`);
  }
}

const updateManifest = JSON.parse(
  await readFile(resolve(output, 'updates', 'windows-preview.json'), 'utf8'),
);
if (
  updateManifest.product !== 'Inkstill'
  || updateManifest.channel !== 'preview'
  || !/^\d+\.\d+\.\d+$/.test(updateManifest.version ?? '')
  || !/^https:\/\/github\.com\/ScotteLiu\/Inkstill\/releases\/tag\//.test(updateManifest.releaseUrl ?? '')
  || !/^https:\/\/github\.com\/ScotteLiu\/Inkstill\/releases\/download\//.test(updateManifest.installer?.url ?? '')
  || !Number.isSafeInteger(updateManifest.installer?.size)
  || updateManifest.installer.size <= 0
  || !/^[a-f\d]{64}$/.test(updateManifest.installer?.sha256 ?? '')
) {
  throw new Error('updates/windows-preview.json is invalid');
}

console.log(`GitHub Pages site built at ${output}`);

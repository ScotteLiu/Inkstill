import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const tag = valueAfter('--tag') ?? process.env.GITHUB_REF_NAME ?? `v${version}-preview.1`;
const output = resolve(valueAfter('--output') ?? join(root, 'site', 'updates', 'windows-preview.json'));
const setup = join(
  root,
  'out',
  'make',
  'squirrel.windows',
  'x64',
  `Inkstill-${version} Setup.exe`,
);

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error(`Invalid release tag: ${tag}`);
}

const digest = createHash('sha256');
for await (const chunk of createReadStream(setup)) digest.update(chunk);
const setupInfo = await stat(setup);
if (!setupInfo.isFile() || setupInfo.size <= 0) {
  throw new Error(`Missing Windows installer: ${setup}`);
}

const assetName = `Inkstill-${version}.Setup.exe`;
const releaseBase = `https://github.com/ScotteLiu/Inkstill/releases`;
const manifest = {
  schemaVersion: 1,
  product: 'Inkstill',
  channel: 'preview',
  version,
  releaseName: `Inkstill ${version} Preview`,
  releaseUrl: `${releaseBase}/tag/${tag}`,
  publishedAt: new Date().toISOString(),
  installer: {
    name: assetName,
    url: `${releaseBase}/download/${tag}/${assetName}`,
    size: setupInfo.size,
    sha256: digest.digest('hex'),
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${basename(output)} for Inkstill ${version}`);

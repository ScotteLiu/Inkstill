import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sourceTreeHash } from './release-inputs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseFolder = join(root, 'release');

// Some published packages omit license metadata or the license file even though
// the tagged upstream source includes it. Keep every exception version-pinned
// and auditable instead of weakening the release checks globally.
const licenseOverrides = new Map([
  ['khroma@2.1.0', {
    expression: 'MIT',
    source: 'https://github.com/fabiospampinato/khroma/blob/master/license',
    text: `The MIT License (MIT)

Copyright (c) 2019-present Fabio Spampinato, Andrew Maney

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  }],
]);

function runPnpm(args) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this generator through pnpm so npm_execpath is pinned.');
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function generatedAt() {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (!sourceDateEpoch) return new Date().toISOString();
  if (!/^\d+$/.test(sourceDateEpoch)) {
    throw new Error('SOURCE_DATE_EPOCH must contain whole Unix seconds.');
  }
  return new Date(Number(sourceDateEpoch) * 1000).toISOString();
}

function packageUrl(name, version) {
  if (name.startsWith('@')) {
    const [scope, packageName] = name.split('/');
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${version}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${version}`;
}

async function licenseFiles(packageRoots) {
  const files = new Set();
  for (const packageRoot of packageRoots) {
    let entries;
    try {
      entries = await readdir(packageRoot, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (
        entry.isFile()
        && /^(license|licence|copying|notice)(?:[._-]|$)/i.test(entry.name)
      ) {
        files.add(join(packageRoot, entry.name));
      }
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const licenseGroups = JSON.parse(runPnpm(['licenses', 'list', '--json', '--prod']));
const componentsByKey = new Map();

for (const [groupLicense, packages] of Object.entries(licenseGroups)) {
  if (!Array.isArray(packages)) throw new Error(`Unexpected pnpm license group: ${groupLicense}`);
  for (const item of packages) {
    const versions = Array.isArray(item.versions) ? item.versions : [];
    const paths = Array.isArray(item.paths) ? item.paths : [];
    for (const [index, version] of versions.entries()) {
      const key = `${item.name}@${version}`;
      const current = componentsByKey.get(key) ?? {
        type: 'library',
        name: item.name,
        version,
        licenses: new Set(),
        packageRoots: new Set(),
        author: item.author ?? null,
        homepage: item.homepage ?? null,
      };
      current.licenses.add(item.license ?? groupLicense);
      // pnpm's hoisted linker can report virtual-store paths that no longer exist;
      // the hoisted package root is a stable fallback for the shipped license text.
      current.packageRoots.add(join(root, 'node_modules', item.name));
      const packageRoot = paths[index] ?? paths[0];
      if (packageRoot) current.packageRoots.add(packageRoot);
      componentsByKey.set(key, current);
    }
  }
}

// Electron is a development dependency in package.json, but its runtime is shipped with every build.
const electronRoot = join(root, 'node_modules', 'electron');
const electronPackage = JSON.parse(await readFile(join(electronRoot, 'package.json'), 'utf8'));
if (electronPackage.version !== packageJson.devDependencies.electron) {
  throw new Error(`Installed Electron ${electronPackage.version} does not match package.json.`);
}
componentsByKey.set(`electron@${electronPackage.version}`, {
  type: 'framework',
  name: 'electron',
  version: electronPackage.version,
  licenses: new Set([electronPackage.license]),
  packageRoots: new Set([electronRoot]),
  author: typeof electronPackage.author === 'string' ? electronPackage.author : null,
  homepage: electronPackage.homepage ?? 'https://www.electronjs.org/',
});

const components = [...componentsByKey.values()].sort((left, right) =>
  left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
);
for (const item of components) {
  const override = licenseOverrides.get(`${item.name}@${item.version}`);
  if (override) item.licenses = new Set([override.expression]);
  for (const expression of item.licenses) {
    if (!expression || /^(unknown|unlicensed|none)$/i.test(expression)) {
      throw new Error(`Unacceptable license metadata for ${item.name}@${item.version}: ${expression}`);
    }
  }
}

const sbomComponents = components.map((item) => ({
  type: item.type,
  name: item.name,
  version: item.version,
  scope: 'required',
  purl: packageUrl(item.name, item.version),
  licenses: [...item.licenses].sort().map((expression) => ({ expression })),
  ...(item.author ? { author: item.author } : {}),
  ...(item.homepage ? { externalReferences: [{ type: 'website', url: item.homepage }] } : {}),
}));

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      name: packageJson.productName,
      version: packageJson.version,
    },
  },
  components: sbomComponents,
};

const lockfile = await readFile(join(root, 'pnpm-lock.yaml'));
const gitCommit = gitOutput(['rev-parse', '--verify', 'HEAD']);
const gitStatus = gitCommit === null
  ? null
  : gitOutput(['status', '--porcelain', '--untracked-files=normal']);
// Keep command failure distinct from a successful, empty status. Public release
// must never treat an unavailable Git status as a clean checkout.
const gitDirty = gitCommit === null || gitStatus === null
  ? null
  : gitStatus.length > 0;
const manifest = {
  schemaVersion: 1,
  generatedAt: generatedAt(),
  product: packageJson.productName,
  version: packageJson.version,
  packageManager: packageJson.packageManager,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  electron: packageJson.devDependencies.electron,
  electronForge: packageJson.devDependencies['@electron-forge/cli'],
  provenance: {
    kind: 'source-tree-sha256',
    sourceTreeSha256: await sourceTreeHash(root),
    gitCommit,
    gitDirty,
    note: gitCommit
      ? 'Git commit is informational; the source-tree SHA-256 is the build input identity.'
      : 'This workspace is not a Git checkout; no commit provenance is claimed.',
  },
  lockfileSha256: sha256(lockfile),
  runtimeComponentCount: components.length,
  embeddedMetadata: [
    'sbom.cdx.json',
    'THIRD_PARTY_LICENSES.md',
    'build-manifest.json',
  ],
};

const licenseLines = [
  `# ${packageJson.productName} third-party licenses`,
  '',
  'Generated from the frozen pnpm installation. Local package paths are intentionally omitted.',
  'Electron distributions also carry `LICENSE` and `LICENSES.chromium.html` beside the executable.',
  '',
];
for (const item of components) {
  const files = await licenseFiles(item.packageRoots);
  const override = licenseOverrides.get(`${item.name}@${item.version}`);
  if (files.length === 0 && !override) {
    throw new Error(`No license text found for ${item.name}@${item.version}.`);
  }
  licenseLines.push(
    `## ${item.name} ${item.version}`,
    '',
    `SPDX/license expression: ${[...item.licenses].sort().join(', ')}`,
    '',
  );
  const seenTexts = new Set();
  if (override) {
    seenTexts.add(override.text);
    licenseLines.push(`Upstream source: ${override.source}`, '');
    licenseLines.push(...override.text.split(/\r?\n/).map((line) => `    ${line}`), '');
  }
  for (const file of files) {
    const licenseText = (await readFile(file, 'utf8')).trim();
    if (!licenseText || seenTexts.has(licenseText)) continue;
    seenTexts.add(licenseText);
    licenseLines.push(`Source file: ${basename(file)}`, '');
    licenseLines.push(...licenseText.split(/\r?\n/).map((line) => `    ${line}`), '');
  }
}

await mkdir(releaseFolder, { recursive: true });
await Promise.all([
  writeFile(join(releaseFolder, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8'),
  writeFile(join(releaseFolder, 'THIRD_PARTY_LICENSES.md'), `${licenseLines.join('\n')}\n`, 'utf8'),
  writeFile(join(releaseFolder, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
]);

console.log(`Release metadata generated for ${components.length} shipped runtime components.`);

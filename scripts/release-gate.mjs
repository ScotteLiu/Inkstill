import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sourceTreeHash } from './release-inputs.mjs';
import { validateWindowsMakerArtifacts } from './release-artifacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const requireInstaller = args.has('--require-installer');
const requireSignature = args.has('--require-signature');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const releaseFolder = join(root, 'release');
const packageFolder = join(root, 'out', `${packageJson.productName}-${process.platform}-${process.arch}`);
const makeRoot = join(root, 'out', 'make');

function fail(message) {
  throw new Error(`Release gate failed: ${message}`);
}

async function filesUnder(path) {
  if (!existsSync(path)) return [];
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

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function signatureDetails(file) {
  const unavailable = {
    status: 'Unavailable',
    signerSubject: null,
    signerThumbprint: null,
    signerNotAfter: null,
    timeStamperSubject: null,
    timeStamperNotAfter: null,
  };
  if (process.platform !== 'win32') {
    return {
      status: 'NotChecked',
      signerSubject: null,
      signerThumbprint: null,
      signerNotAfter: null,
      timeStamperSubject: null,
      timeStamperNotAfter: null,
    };
  }
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        '$ErrorActionPreference="Stop"',
        'try {',
        'Import-Module Microsoft.PowerShell.Security -ErrorAction Stop',
        '$s=Get-AuthenticodeSignature -LiteralPath $env:SIGNATURE_TARGET',
        '$signerSubject=if($s.SignerCertificate){$s.SignerCertificate.Subject}else{$null}',
        '$signerNotAfter=if($s.SignerCertificate){$s.SignerCertificate.NotAfter.ToUniversalTime().ToString("o")}else{$null}',
        '$signerThumbprint=if($s.SignerCertificate){$s.SignerCertificate.Thumbprint}else{$null}',
        '$timeStamperSubject=if($s.TimeStamperCertificate){$s.TimeStamperCertificate.Subject}else{$null}',
        '$timeStamperNotAfter=if($s.TimeStamperCertificate){$s.TimeStamperCertificate.NotAfter.ToUniversalTime().ToString("o")}else{$null}',
        '$o=[pscustomobject]@{Status=$s.Status.ToString();SignerSubject=$signerSubject;SignerThumbprint=$signerThumbprint;SignerNotAfter=$signerNotAfter;TimeStamperSubject=$timeStamperSubject;TimeStamperNotAfter=$timeStamperNotAfter}',
        '} catch {',
        '$o=[pscustomobject]@{Status="Unavailable";SignerSubject=$null;SignerThumbprint=$null;SignerNotAfter=$null;TimeStamperSubject=$null;TimeStamperNotAfter=$null}',
        '}',
        '$o|ConvertTo-Json -Compress',
      ].join('\n'),
    ], {
      encoding: 'utf8',
      env: { ...process.env, SIGNATURE_TARGET: file },
    });
    const details = JSON.parse(output.trim());
    return {
      status: details.Status,
      signerSubject: details.SignerSubject,
      signerThumbprint: details.SignerThumbprint,
      signerNotAfter: details.SignerNotAfter,
      timeStamperSubject: details.TimeStamperSubject,
      timeStamperNotAfter: details.TimeStamperNotAfter,
    };
  } catch {
    return unavailable;
  }
}

if (requireInstaller && (process.platform !== 'win32' || process.arch !== 'x64')) {
  fail(`final candidates require win32/x64, received ${process.platform}/${process.arch}`);
}
const expectedNode = `v${(await readFile(join(root, '.node-version'), 'utf8')).trim()}`;
if (process.version !== expectedNode) {
  fail(`Node must be exactly ${expectedNode}, received ${process.version}`);
}
const expectedPackageManager = packageJson.packageManager;
const expectedPnpm = /^pnpm@(.+)$/.exec(expectedPackageManager)?.[1];
if (!expectedPnpm || !process.env.npm_execpath) {
  fail('packageManager must pin pnpm and the gate must run through pnpm');
}
const actualPnpm = execFileSync(process.execPath, [process.env.npm_execpath, '--version'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (actualPnpm !== expectedPnpm) {
  fail(`pnpm must be exactly ${expectedPnpm}, received ${actualPnpm}`);
}

const metadataNames = ['sbom.cdx.json', 'THIRD_PARTY_LICENSES.md', 'build-manifest.json'];
for (const required of metadataNames) {
  if (!existsSync(join(releaseFolder, required))) fail(`missing release/${required}`);
}
const sbom = await readJson(join(releaseFolder, 'sbom.cdx.json'), 'SBOM');
const manifest = await readJson(join(releaseFolder, 'build-manifest.json'), 'build manifest');
if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6') {
  fail('SBOM must be CycloneDX 1.6');
}
if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
  fail('SBOM has no runtime components');
}
const electronComponent = sbom.components.find((component) => component.name === 'electron');
if (!electronComponent || electronComponent.version !== packageJson.devDependencies.electron) {
  fail('SBOM does not include the shipped Electron runtime');
}
if (
  sbom.metadata?.component?.name !== packageJson.productName ||
  sbom.metadata?.component?.version !== packageJson.version
) {
  fail('SBOM application identity does not match package.json');
}
if (manifest.product !== packageJson.productName || manifest.version !== packageJson.version) {
  fail('build manifest product/version does not match package.json');
}
if (
  manifest.node !== expectedNode ||
  manifest.packageManager !== expectedPackageManager ||
  manifest.platform !== process.platform ||
  manifest.arch !== process.arch ||
  manifest.electron !== packageJson.devDependencies.electron ||
  manifest.electronForge !== packageJson.devDependencies['@electron-forge/cli'] ||
  manifest.runtimeComponentCount !== sbom.components.length
) {
  fail('build manifest toolchain/platform does not match the active release environment');
}
if (manifest.lockfileSha256 !== await sha256(join(root, 'pnpm-lock.yaml'))) {
  fail('build manifest lockfile hash is stale');
}
if (manifest.provenance?.sourceTreeSha256 !== await sourceTreeHash(root)) {
  fail('build manifest source-tree hash is stale');
}

if (!existsSync(packageFolder)) fail(`missing packaged application at ${packageFolder}`);
const executable = process.platform === 'win32'
  ? join(packageFolder, `${packageJson.productName}.exe`)
  : join(packageFolder, packageJson.productName);
if (!existsSync(executable)) fail(`missing packaged executable ${executable}`);

for (const metadataName of metadataNames) {
  const source = join(releaseFolder, metadataName);
  const embedded = join(packageFolder, 'resources', metadataName);
  if (!existsSync(embedded)) fail(`packaged application is missing resources/${metadataName}`);
  if (await sha256(source) !== await sha256(embedded)) {
    fail(`packaged resources/${metadataName} differs from the release copy`);
  }
}
for (const nativeLicense of ['LICENSE', 'LICENSES.chromium.html']) {
  if (!existsSync(join(packageFolder, nativeLicense))) {
    fail(`packaged Electron runtime is missing ${nativeLicense}`);
  }
}

const sourceMaps = (await filesUnder(join(root, '.vite'))).filter((file) => file.endsWith('.map'));
if (sourceMaps.length > 0) fail(`production Vite output contains ${sourceMaps.length} sourcemap(s)`);

const asarPath = join(packageFolder, 'resources', 'app.asar');
const asarCli = join(root, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
if (!existsSync(asarPath) || !existsSync(asarCli)) fail('app.asar or the pinned ASAR inspector is missing');
const asarEntries = execFileSync(process.execPath, [asarCli, 'list', asarPath], {
  cwd: root,
  encoding: 'utf8',
}).split(/\r?\n/).filter(Boolean);
const forbiddenAsarEntries = asarEntries.filter((entry) =>
  /\.map$/i.test(entry)
  || /\.(ts|tsx)$/i.test(entry)
  || /(^|[\\/])(tests?|e2e|test-results)([\\/]|$)/i.test(entry),
);
if (forbiddenAsarEntries.length > 0) {
  fail(`app.asar contains forbidden development files: ${forbiddenAsarEntries.slice(0, 5).join(', ')}`);
}

const fuseCli = join(root, 'node_modules', '@electron', 'fuses', 'dist', 'bin.js');
const fuseOutput = execFileSync(process.execPath, [fuseCli, 'read', '--app', executable], {
  cwd: root,
  encoding: 'utf8',
});
for (const expectation of [
  'RunAsNode is Disabled',
  'EnableCookieEncryption is Enabled',
  'EnableNodeOptionsEnvironmentVariable is Disabled',
  'EnableNodeCliInspectArguments is Disabled',
  'EnableEmbeddedAsarIntegrityValidation is Enabled',
  'OnlyLoadAppFromAsar is Enabled',
  'LoadBrowserProcessSpecificV8Snapshot is Disabled',
  'GrantFileProtocolExtraPrivileges is Disabled',
  'WasmTrapHandlers is Enabled',
]) {
  if (!fuseOutput.includes(expectation)) fail(`Electron fuse mismatch: ${expectation}`);
}

const makeFiles = await filesUnder(makeRoot);
let makerArtifacts = null;
if (requireInstaller) {
  try {
    makerArtifacts = validateWindowsMakerArtifacts(makeFiles, {
      makeRoot,
      productName: packageJson.productName,
      packageName: packageJson.name,
      version: packageJson.version,
      platform: process.platform,
      arch: process.arch,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  for (const artifact of makerArtifacts.all) {
    if ((await stat(artifact)).size === 0) {
      fail(`maker artifact is empty: ${relative(root, artifact).replaceAll('\\', '/')}`);
    }
  }
}
const setup = makerArtifacts?.setup ?? null;

const executableSignature = signatureDetails(executable);
const setupSignature = setup ? signatureDetails(setup) : null;
const publicBlockers = [];
const projectLegalFiles = ['LICENSE', 'EULA.md', 'EULA.txt']
  .map((name) => join(root, name))
  .filter((file) => existsSync(file));
if (executableSignature.status !== 'Valid') {
  publicBlockers.push(`packaged executable signature is ${executableSignature.status}`);
}
if (!setup || setupSignature?.status !== 'Valid') {
  publicBlockers.push(`installer signature is ${setupSignature?.status ?? 'Missing'}`);
}
if (executableSignature.status === 'Valid' && !executableSignature.timeStamperSubject) {
  publicBlockers.push('packaged executable has no trusted timestamp');
}
if (setupSignature?.status === 'Valid' && !setupSignature.timeStamperSubject) {
  publicBlockers.push('installer has no trusted timestamp');
}
const expectedThumbprint = process.env.WINDOWS_EXPECTED_SIGNER_THUMBPRINT
  ?.replaceAll(' ', '')
  .toUpperCase();
if (!expectedThumbprint) {
  publicBlockers.push('WINDOWS_EXPECTED_SIGNER_THUMBPRINT signer allowlist is not configured');
} else if (!/^[0-9A-F]{40}$/.test(expectedThumbprint)) {
  publicBlockers.push('WINDOWS_EXPECTED_SIGNER_THUMBPRINT must be exactly 40 hexadecimal characters');
} else {
  for (const [label, signature] of [
    ['packaged executable', executableSignature],
    ['installer', setupSignature],
  ]) {
    const actualThumbprint = signature?.signerThumbprint
      ?.replaceAll(' ', '')
      .toUpperCase();
    if (actualThumbprint !== expectedThumbprint) {
      publicBlockers.push(`${label} signer is outside the configured allowlist`);
    }
  }
}
if (/spike/i.test(packageJson.productName)) {
  publicBlockers.push('product name is still a Spike placeholder');
}
if (!packageJson.license || packageJson.license === 'UNLICENSED') {
  publicBlockers.push('project license decision is still UNLICENSED');
}
if (projectLegalFiles.length === 0) {
  publicBlockers.push('no project LICENSE or EULA file exists');
} else {
  for (const legalFile of projectLegalFiles) {
    if ((await stat(legalFile)).size === 0) {
      publicBlockers.push(`${basename(legalFile)} is empty`);
      continue;
    }
    const embeddedLegalFile = join(packageFolder, 'resources', basename(legalFile));
    if (
      !existsSync(embeddedLegalFile) ||
      await sha256(legalFile) !== await sha256(embeddedLegalFile)
    ) {
      publicBlockers.push(`${basename(legalFile)} is not embedded unchanged in the application`);
    }
  }
}
if (!manifest.provenance?.gitCommit) {
  publicBlockers.push('build has a source-tree hash but no Git commit provenance');
} else if (manifest.provenance.gitDirty !== false) {
  publicBlockers.push('Git provenance is not from a clean checkout');
}
const workspaceConfig = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
if (!/^\s*blockExoticSubdeps:\s*true\s*$/m.test(workspaceConfig)) {
  publicBlockers.push('pnpm blockExoticSubdeps is not explicitly enabled');
}
const lockfileText = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
if (/gitHosted:\s*true/.test(lockfileText)) {
  publicBlockers.push('lockfile contains a git-hosted tarball without registry integrity provenance');
}

const artifactCandidates = [
  executable,
  asarPath,
  join(packageFolder, 'LICENSE'),
  join(packageFolder, 'LICENSES.chromium.html'),
  join(root, 'pnpm-lock.yaml'),
  ...metadataNames.map((name) => join(releaseFolder, name)),
  ...projectLegalFiles,
  ...projectLegalFiles.map((file) => join(packageFolder, 'resources', basename(file))),
  ...(makerArtifacts?.all ?? []),
].filter((file, index, all) => existsSync(file) && all.indexOf(file) === index);

const hashes = [];
for (const file of artifactCandidates.sort((left, right) => left.localeCompare(right))) {
  hashes.push({
    path: relative(root, file).replaceAll('\\', '/'),
    bytes: (await stat(file)).size,
    sha256: await sha256(file),
  });
}

await mkdir(releaseFolder, { recursive: true });
await Promise.all([
  writeFile(join(releaseFolder, 'artifact-sha256.json'), `${JSON.stringify({
    schemaVersion: 1,
    product: packageJson.productName,
    version: packageJson.version,
    mode: requireSignature ? 'public' : 'candidate',
    publicReleaseEligible: publicBlockers.length === 0,
    signatures: {
      [basename(executable)]: executableSignature,
      ...(setup ? { [basename(setup)]: setupSignature } : {}),
    },
    publicBlockers,
    artifacts: hashes,
  }, null, 2)}\n`, 'utf8'),
  writeFile(
    join(releaseFolder, 'SHA256SUMS.txt'),
    `${[
      ...hashes.map((item) => `${item.sha256}  ${item.path}`),
      // Also list uploaded maker artifacts by bare file name: release assets
      // are downloaded flat, and installed clients (including 1.1.x previews
      // with a strict full-string match) verify the installer against the
      // asset name alone.
      ...hashes
        .filter((item) => item.path.startsWith('out/make/'))
        .map((item) => `${item.sha256}  ${item.path.split('/').at(-1)}`),
    ].join('\n')}\n`,
    'utf8',
  ),
]);

if (requireSignature && publicBlockers.length > 0) {
  fail(`public release is blocked:\n- ${publicBlockers.join('\n- ')}`);
}

console.log(`Release gate passed (${requireSignature ? 'public' : 'candidate'} mode).`);
if (!requireSignature && executableSignature.status !== 'Valid') {
  console.warn(`WARNING: executable signature is ${executableSignature.status}; public release remains blocked.`);
}

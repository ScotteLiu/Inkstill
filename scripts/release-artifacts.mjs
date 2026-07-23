import { join, relative } from 'node:path';

function normalizedRelative(root, file) {
  return relative(root, file).replaceAll('\\', '/');
}

export function validateWindowsMakerArtifacts(files, options) {
  const {
    makeRoot,
    productName,
    packageName,
    version,
    platform,
    arch,
  } = options;
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(`final candidates must be built for win32/x64, received ${platform}/${arch}`);
  }

  const packageId = packageName.replaceAll('-', '_');
  const expected = {
    setup: join(makeRoot, 'squirrel.windows', 'x64', `${productName}-${version} Setup.exe`),
    nupkg: join(makeRoot, 'squirrel.windows', 'x64', `${packageId}-${version}-full.nupkg`),
    releases: join(makeRoot, 'squirrel.windows', 'x64', 'RELEASES'),
    zip: join(makeRoot, 'zip', 'win32', 'x64', `${productName}-win32-x64-${version}.zip`),
  };
  const expectedByRelativePath = new Map(
    Object.entries(expected).map(([label, file]) => [normalizedRelative(makeRoot, file), label]),
  );
  const actualRelativePaths = files.map((file) => normalizedRelative(makeRoot, file)).sort();
  const duplicates = actualRelativePaths.filter((path, index) =>
    index > 0 && path === actualRelativePaths[index - 1],
  );
  if (duplicates.length > 0) {
    throw new Error(`duplicate maker artifacts: ${[...new Set(duplicates)].join(', ')}`);
  }

  const missing = [...expectedByRelativePath.keys()].filter((path) =>
    !actualRelativePaths.includes(path),
  );
  const unexpected = actualRelativePaths.filter((path) => !expectedByRelativePath.has(path));
  if (missing.length > 0 || unexpected.length > 0) {
    const detail = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : null,
      unexpected.length > 0 ? `unexpected: ${unexpected.join(', ')}` : null,
    ].filter(Boolean).join('; ');
    throw new Error(`maker artifact set does not match ${productName} ${version}: ${detail}`);
  }

  return { ...expected, all: Object.values(expected) };
}

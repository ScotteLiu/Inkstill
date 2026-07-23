export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface PublicRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: ReleaseAsset[];
}

export interface UpdateCandidate {
  version: string;
  releaseName: string;
  releaseUrl: string;
  installer: ReleaseAsset;
  checksums?: ReleaseAsset;
  expectedSha256?: string;
}

export interface UpdateChannelManifest {
  schemaVersion: 1;
  product: 'Inkstill';
  channel: 'preview';
  version: string;
  releaseName: string;
  releaseUrl: string;
  publishedAt: string;
  installer: {
    name: string;
    url: string;
    size: number;
    sha256: string;
  };
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/i;

export function parseVersion(value: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value.trim());
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
}

function parsePrerelease(value: string): string[] | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return match[4] ? match[4].split('.') : [];
}

function comparePrereleaseIdentifiers(left: string[], right: string[]): number {
  // A release without prerelease identifiers is newer than any prerelease of
  // the same core version; among prereleases, identifiers compare per semver.
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const difference = Number(leftPart) - Number(rightPart);
      if (difference !== 0) return difference;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion[index] - rightVersion[index];
    if (difference !== 0) return difference;
  }
  return comparePrereleaseIdentifiers(
    parsePrerelease(left) ?? [],
    parsePrerelease(right) ?? [],
  );
}

function safeGitHubDownload(asset: ReleaseAsset): boolean {
  try {
    const url = new URL(asset.browser_download_url);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/ScotteLiu/Inkstill/releases/download/')
      && asset.size > 0;
  } catch {
    return false;
  }
}

function safeGitHubReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/ScotteLiu/Inkstill/releases/');
  } catch {
    return false;
  }
}

function validPublishedAt(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function parseUpdateChannelManifest(value: unknown): UpdateChannelManifest | null {
  if (!value || typeof value !== 'object') return null;
  const manifest = value as Record<string, unknown>;
  const installer = manifest.installer;
  if (
    manifest.schemaVersion !== 1
    || manifest.product !== 'Inkstill'
    || manifest.channel !== 'preview'
    || typeof manifest.version !== 'string'
    || !parseVersion(manifest.version)
    || typeof manifest.releaseName !== 'string'
    || manifest.releaseName.trim().length === 0
    || typeof manifest.releaseUrl !== 'string'
    || !safeGitHubReleaseUrl(manifest.releaseUrl)
    || typeof manifest.publishedAt !== 'string'
    || !validPublishedAt(manifest.publishedAt)
    || !installer
    || typeof installer !== 'object'
  ) return null;

  const artifact = installer as Record<string, unknown>;
  const releaseAsset: ReleaseAsset = {
    name: typeof artifact.name === 'string' ? artifact.name : '',
    browser_download_url: typeof artifact.url === 'string' ? artifact.url : '',
    size: typeof artifact.size === 'number' ? artifact.size : 0,
  };
  const installerMatch = /^Inkstill-([\d.]+)(?:[ ._-])Setup\.exe$/i.exec(releaseAsset.name);
  let releaseTag = '';
  let downloadTag = '';
  let downloadName = '';
  try {
    const releaseUrl = new URL(manifest.releaseUrl);
    const downloadUrl = new URL(releaseAsset.browser_download_url);
    releaseTag = releaseUrl.pathname.split('/releases/tag/')[1] ?? '';
    const downloadPath = downloadUrl.pathname.split('/releases/download/')[1] ?? '';
    [downloadTag, downloadName] = downloadPath.split('/');
    downloadName = decodeURIComponent(downloadName ?? '');
  } catch {
    return null;
  }
  if (
    !installerMatch
    || installerMatch[1] !== manifest.version
    || !/^\d+\.\d+\.\d+$/.test(manifest.version)
    || !safeGitHubDownload(releaseAsset)
    || !releaseTag
    || releaseTag !== downloadTag
    || parseVersion(releaseTag)?.join('.') !== manifest.version
    || downloadName !== releaseAsset.name
    || typeof artifact.sha256 !== 'string'
    || !/^[a-f\d]{64}$/i.test(artifact.sha256)
  ) return null;

  return {
    schemaVersion: 1,
    product: 'Inkstill',
    channel: 'preview',
    version: manifest.version,
    releaseName: manifest.releaseName,
    releaseUrl: manifest.releaseUrl,
    publishedAt: manifest.publishedAt,
    installer: {
      name: releaseAsset.name,
      url: releaseAsset.browser_download_url,
      size: releaseAsset.size,
      sha256: artifact.sha256.toLocaleLowerCase('en-US'),
    },
  };
}

export function selectManifestUpdate(
  value: unknown,
  currentVersion: string,
): UpdateCandidate | null {
  const manifest = parseUpdateChannelManifest(value);
  if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) return null;
  return {
    version: manifest.version,
    releaseName: manifest.releaseName,
    releaseUrl: manifest.releaseUrl,
    installer: {
      name: manifest.installer.name,
      browser_download_url: manifest.installer.url,
      size: manifest.installer.size,
    },
    expectedSha256: manifest.installer.sha256,
  };
}

export function selectUpdate(
  releases: PublicRelease[],
  currentVersion: string,
): UpdateCandidate | null {
  const candidates = releases.flatMap((release) => {
    if (release.draft || !safeGitHubReleaseUrl(release.html_url)) return [];
    const parsed = parseVersion(release.tag_name);
    if (!parsed) return [];
    const version = parsed.join('.');
    // Compare full tags so prerelease ordering (e.g. -preview.2 vs -preview.1,
    // and stable over prerelease) is respected.
    if (compareVersions(release.tag_name, currentVersion) <= 0) return [];
    const installer = release.assets.find((asset) =>
      /^Inkstill-[\d.]+(?:[ ._-])Setup\.exe$/i.test(asset.name)
      && safeGitHubDownload(asset));
    const checksums = release.assets.find((asset) =>
      asset.name.toLocaleLowerCase('en-US') === 'sha256sums.txt'
      && safeGitHubDownload(asset));
    if (!installer || !checksums) return [];
    return [{
      candidate: {
        version,
        releaseName: release.name?.trim() || `Inkstill ${version}`,
        releaseUrl: release.html_url,
        installer,
        checksums,
      },
      tag: release.tag_name,
    }];
  });
  return candidates
    .sort((left, right) => compareVersions(right.tag, left.tag))[0]?.candidate ?? null;
}

function normalizedAssetName(value: string): string {
  // Checksum manifests list repo-relative paths (for example
  // "out/make/squirrel.windows/x64/Inkstill-1.1.1 Setup.exe"), while release
  // assets carry bare file names, so compare by base name only.
  const baseName = value.trim().split(/[\\/]/).at(-1) ?? '';
  return baseName.toLocaleLowerCase('en-US').replace(/[ ._-]+/g, '-');
}

export function checksumForAsset(checksumFile: string, assetName: string): string | null {
  const expectedName = normalizedAssetName(assetName);
  if (!expectedName) return null;
  for (const line of checksumFile.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match && normalizedAssetName(match[2]) === expectedName) {
      return match[1].toLocaleLowerCase('en-US');
    }
  }
  return null;
}

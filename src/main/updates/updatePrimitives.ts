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
  checksums: ReleaseAsset;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i;

export function parseVersion(value: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value.trim());
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion[index] - rightVersion[index];
    if (difference !== 0) return difference;
  }
  return 0;
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

export function selectUpdate(
  releases: PublicRelease[],
  currentVersion: string,
): UpdateCandidate | null {
  const candidates = releases.flatMap((release) => {
    if (release.draft || !safeGitHubReleaseUrl(release.html_url)) return [];
    const parsed = parseVersion(release.tag_name);
    if (!parsed) return [];
    const version = parsed.join('.');
    if (compareVersions(version, currentVersion) <= 0) return [];
    const installer = release.assets.find((asset) =>
      /^Inkstill-[\d.]+(?:[ ._-])Setup\.exe$/i.test(asset.name)
      && safeGitHubDownload(asset));
    const checksums = release.assets.find((asset) =>
      asset.name.toLocaleLowerCase('en-US') === 'sha256sums.txt'
      && safeGitHubDownload(asset));
    if (!installer || !checksums) return [];
    return [{
      version,
      releaseName: release.name?.trim() || `Inkstill ${version}`,
      releaseUrl: release.html_url,
      installer,
      checksums,
    }];
  });
  return candidates.sort((left, right) => compareVersions(right.version, left.version))[0] ?? null;
}

function normalizedAssetName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/[ ._-]+/g, '-');
}

export function checksumForAsset(checksumFile: string, assetName: string): string | null {
  const expectedName = normalizedAssetName(assetName);
  for (const line of checksumFile.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match && normalizedAssetName(match[2]) === expectedName) {
      return match[1].toLocaleLowerCase('en-US');
    }
  }
  return null;
}

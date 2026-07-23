import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checksumForAsset,
  compareVersions,
  parseUpdateChannelManifest,
  selectManifestUpdate,
  selectUpdate,
  type PublicRelease,
} from '../src/main/updates/updatePrimitives';

function release(version: string, options?: { draft?: boolean; installer?: boolean }): PublicRelease {
  const installerName = `Inkstill-${version} Setup.exe`;
  return {
    tag_name: `v${version}-preview.1`,
    name: `Inkstill ${version} Preview`,
    draft: options?.draft ?? false,
    prerelease: true,
    html_url: `https://github.com/ScotteLiu/Inkstill/releases/tag/v${version}-preview.1`,
    assets: [
      ...(options?.installer === false ? [] : [{
        name: installerName,
        browser_download_url: `https://github.com/ScotteLiu/Inkstill/releases/download/v${version}-preview.1/${installerName}`,
        size: 140_000_000,
      }]),
      {
        name: 'SHA256SUMS.txt',
        browser_download_url: `https://github.com/ScotteLiu/Inkstill/releases/download/v${version}-preview.1/SHA256SUMS.txt`,
        size: 500,
      },
    ],
  };
}

describe('update primitives', () => {
  const channelManifest = {
    schemaVersion: 1,
    product: 'Inkstill',
    channel: 'preview',
    version: '1.1.2',
    releaseName: 'Inkstill 1.1.2 Preview',
    releaseUrl: 'https://github.com/ScotteLiu/Inkstill/releases/tag/v1.1.2-preview.1',
    publishedAt: '2026-07-23T14:22:10.000Z',
    installer: {
      name: 'Inkstill-1.1.2.Setup.exe',
      url: 'https://github.com/ScotteLiu/Inkstill/releases/download/v1.1.2-preview.1/Inkstill-1.1.2.Setup.exe',
      size: 141_933_568,
      sha256: 'a'.repeat(64),
    },
  };

  it('compares release versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
    expect(compareVersions('1.1.0', '1.1.1')).toBeLessThan(0);
  });

  it('selects the newest complete public GitHub release', () => {
    const selected = selectUpdate([
      release('1.1.1'),
      release('1.3.0', { draft: true }),
      release('1.2.0', { installer: false }),
      release('1.1.2'),
    ], '1.1.0');
    expect(selected?.version).toBe('1.1.2');
    expect(selected?.installer.name).toBe('Inkstill-1.1.2 Setup.exe');
  });

  it('rejects release metadata that points outside the project', () => {
    const forged = release('9.0.0');
    forged.assets[0].browser_download_url = 'https://example.com/Inkstill-9.0.0-Setup.exe';
    expect(selectUpdate([forged], '1.1.0')).toBeNull();
  });

  it('matches checksums even when GitHub normalizes spaces in asset names', () => {
    const hash = 'a'.repeat(64);
    expect(checksumForAsset(`${hash}  Inkstill-1.1.1 Setup.exe\n`, 'Inkstill-1.1.1.Setup.exe')).toBe(hash);
    expect(checksumForAsset(`${hash}  other.exe\n`, 'Inkstill-1.1.1.Setup.exe')).toBeNull();
  });

  it('matches checksum entries that list repo-relative paths', () => {
    const hash = 'b'.repeat(64);
    const manifest = [
      `${'c'.repeat(64)}  out/make/zip/win32/x64/Inkstill-win32-x64-1.1.1.zip`,
      `${hash}  out/make/squirrel.windows/x64/Inkstill-1.1.1 Setup.exe`,
    ].join('\n');
    expect(checksumForAsset(manifest, 'Inkstill-1.1.1.Setup.exe')).toBe(hash);
  });

  it('orders prerelease identifiers below their stable release', () => {
    expect(compareVersions('1.1.1', '1.1.1-preview.1')).toBeGreaterThan(0);
    expect(compareVersions('1.1.1-preview.2', '1.1.1-preview.1')).toBeGreaterThan(0);
    expect(compareVersions('1.1.1-preview.10', '1.1.1-preview.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.1-preview.1', '1.1.1-preview.1')).toBe(0);
    expect(compareVersions('1.1.1-preview.1', '1.1.1')).toBeLessThan(0);
  });

  it('prefers the stable release over a same-version prerelease', () => {
    const stable = release('1.2.0');
    stable.tag_name = 'v1.2.0';
    stable.prerelease = false;
    stable.html_url = 'https://github.com/ScotteLiu/Inkstill/releases/tag/v1.2.0';
    const selected = selectUpdate([release('1.2.0'), stable], '1.1.0');
    expect(selected?.releaseUrl).toBe('https://github.com/ScotteLiu/Inkstill/releases/tag/v1.2.0');
  });

  it('offers a newer preview of the same core version', () => {
    const older = release('1.2.0');
    const newer = release('1.2.0');
    newer.tag_name = 'v1.2.0-preview.2';
    newer.html_url = 'https://github.com/ScotteLiu/Inkstill/releases/tag/v1.2.0-preview.2';
    expect(selectUpdate([older], '1.2.0-preview.1')).toBeNull();
    expect(selectUpdate([older, newer], '1.2.0-preview.1')?.releaseUrl).toBe(newer.html_url);
  });

  it('selects a newer update from the static preview channel', () => {
    const candidate = selectManifestUpdate(channelManifest, '1.1.1');
    expect(candidate?.version).toBe('1.1.2');
    expect(candidate?.expectedSha256).toBe('a'.repeat(64));
    expect(candidate?.installer.size).toBe(141_933_568);
    expect(selectManifestUpdate(channelManifest, '1.1.2')).toBeNull();
  });

  it('rejects forged or malformed static update manifests', () => {
    expect(parseUpdateChannelManifest({
      ...channelManifest,
      installer: {
        ...channelManifest.installer,
        url: 'https://example.com/Inkstill-1.1.2.Setup.exe',
      },
    })).toBeNull();
    expect(parseUpdateChannelManifest({
      ...channelManifest,
      installer: {
        ...channelManifest.installer,
        sha256: 'not-a-checksum',
      },
    })).toBeNull();
    expect(parseUpdateChannelManifest({
      ...channelManifest,
      product: 'Other',
    })).toBeNull();
    expect(parseUpdateChannelManifest({
      ...channelManifest,
      version: '1.1.3',
    })).toBeNull();
  });

  it('keeps the published Pages update manifest valid', () => {
    const published = JSON.parse(readFileSync(
      resolve(process.cwd(), 'site', 'updates', 'windows-preview.json'),
      'utf8',
    ));
    expect(parseUpdateChannelManifest(published)?.version).toBe('1.1.2');
  });
});

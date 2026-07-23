import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateWindowsMakerArtifacts } from '../scripts/release-artifacts.mjs';

const makeRoot = join('C:', 'workspace', 'out', 'make');
const options = {
  makeRoot,
  productName: 'Inkstill',
  packageName: 'markdown-editor',
  version: '1.1.0',
  platform: 'win32',
  arch: 'x64',
};
const expectedFiles = [
  join(makeRoot, 'squirrel.windows', 'x64', 'Inkstill-1.1.0 Setup.exe'),
  join(makeRoot, 'squirrel.windows', 'x64', 'markdown_editor-1.1.0-full.nupkg'),
  join(makeRoot, 'squirrel.windows', 'x64', 'RELEASES'),
  join(makeRoot, 'zip', 'win32', 'x64', 'Inkstill-win32-x64-1.1.0.zip'),
];

describe('Windows maker artifact validation', () => {
  it('accepts exactly one current x64 artifact from each maker', () => {
    expect(validateWindowsMakerArtifacts(expectedFiles, options).all).toHaveLength(4);
  });

  it.each([
    ['a stale product/version', [
      ...expectedFiles,
      join(makeRoot, 'squirrel.windows', 'x64', 'Inkstill Spike-0.1.0 Setup.exe'),
    ]],
    ['multiple setup executables', [
      ...expectedFiles,
      join(makeRoot, 'squirrel.windows', 'x64', 'Inkstill-1.1.0-copy Setup.exe'),
    ]],
    ['a missing ZIP', expectedFiles.filter((file) => !file.endsWith('.zip'))],
  ])('rejects %s', (_label, files) => {
    expect(() => validateWindowsMakerArtifacts(files, options)).toThrow();
  });

  it('rejects a non-x64 candidate', () => {
    expect(() => validateWindowsMakerArtifacts(expectedFiles, { ...options, arch: 'arm64' }))
      .toThrow(/win32\/x64/);
  });
});

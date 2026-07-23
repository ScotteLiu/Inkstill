import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedPaths = [
  '.vite',
  'out',
  'test-results',
  'playwright-report',
  'release/artifact-sha256.json',
  'release/build-manifest.json',
  'release/sbom.cdx.json',
  'release/SHA256SUMS.txt',
  'release/THIRD_PARTY_LICENSES.md',
];

await Promise.all(generatedPaths.map((path) =>
  rm(join(root, path), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
));

console.log('Removed stale build, test, and generated release outputs.');

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'scripts/social-card.html');
const output = resolve(root, 'docs/images/inkstill-social-preview.png');

await mkdir(dirname(output), { recursive: true });

const browserCandidates = process.platform === 'win32'
  ? [
      process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      process.env['PROGRAMFILES(X86)'] &&
        resolve(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
      process.env.LOCALAPPDATA &&
        resolve(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const executablePath = browserCandidates.find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.screenshot({
    path: output,
    animations: 'disabled',
  });
  console.log(`Social preview written to ${output}`);
} finally {
  await browser.close();
}

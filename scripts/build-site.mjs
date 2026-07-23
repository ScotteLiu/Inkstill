import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLocalizedPages, writeLocalizedSitemap } from './site-locales.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'site');
const output = resolve(root, '_site');
const assets = resolve(output, 'assets');

await rm(output, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(source, output, { recursive: true });
await writeLocalizedPages(output);
await writeLocalizedSitemap(output);

for (const [from, to] of [
  ['assets/icon.png', 'assets/icon.png'],
  ['docs/images/inkstill-split-preview.png', 'assets/inkstill-split-preview.png'],
  ['docs/images/inkstill-command-palette.png', 'assets/inkstill-command-palette.png'],
  ['docs/images/inkstill-writing-tools.png', 'assets/inkstill-writing-tools.png'],
  ['docs/images/inkstill-social-preview.png', 'assets/inkstill-social-preview.png'],
]) {
  await cp(resolve(root, from), resolve(output, to));
}

const requiredSnippets = [
  ['index.html', '<html lang="en">'],
  ['index.html', '"@type": "SoftwareApplication"'],
  ['index.html', 'rel="canonical"'],
  ['zh-cn.html', '<html lang="zh-CN">'],
  ['zh-tw.html', '<html lang="zh-Hant-TW">'],
  ['es.html', '<html lang="es">'],
  ['pt-br.html', '<html lang="pt-BR">'],
  ['hi.html', '<html lang="hi">'],
  ['ru.html', '<html lang="ru">'],
  ['de.html', '<html lang="de">'],
  ['robots.txt', 'Sitemap: https://scotteliu.github.io/Inkstill/sitemap.xml'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/zh-cn.html'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/zh-tw.html'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/es.html'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/pt-br.html'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/hi.html'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/ru.html'],
  ['sitemap.xml', 'https://scotteliu.github.io/Inkstill/de.html'],
  ['updates/windows-preview.json', '"schemaVersion": 1'],
];

for (const [file, snippet] of requiredSnippets) {
  const content = await readFile(resolve(output, file), 'utf8');
  if (!content.includes(snippet)) {
    throw new Error(`${file} is missing required content: ${snippet}`);
  }
}

const localizedPages = ['index.html', 'zh-cn.html', 'zh-tw.html', 'es.html', 'pt-br.html', 'hi.html', 'ru.html', 'de.html'];
const alternateLanguages = ['en', 'zh-CN', 'zh-TW', 'es', 'pt-BR', 'hi', 'ru', 'de', 'x-default'];
for (const file of localizedPages) {
  const content = await readFile(resolve(output, file), 'utf8');
  for (const language of alternateLanguages) {
    if (!content.includes(`hreflang="${language}"`)) {
      throw new Error(`${file} is missing hreflang="${language}"`);
    }
  }
  if (!content.includes('class="language-menu"')) {
    throw new Error(`${file} is missing the language menu`);
  }
  if (!content.includes('class="skip-link" href="#main-content"')
    || !content.includes('<main id="main-content">')) {
    throw new Error(`${file} is missing keyboard skip navigation`);
  }
  if ((content.match(/<section(?:\s|>)/g) ?? []).length !== 6) {
    throw new Error(`${file} does not contain the complete six-section landing page`);
  }
  if ((content.match(/aria-current="page"/g) ?? []).length !== 1) {
    throw new Error(`${file} must identify exactly one current language`);
  }
  if ((content.match(/property="og:locale:alternate"/g) ?? []).length !== 7) {
    throw new Error(`${file} is missing Open Graph locale alternates`);
  }
  if (!content.includes('property="og:image:width" content="1280"')
    || !content.includes('property="og:image:height" content="640"')) {
    throw new Error(`${file} is missing social image dimensions`);
  }
  if (!content.includes('property="og:image:alt"')
    || !content.includes('name="twitter:image"')) {
    throw new Error(`${file} is missing accessible social sharing metadata`);
  }
  if (!content.includes('fetchpriority="high" decoding="async"')
    || (content.match(/decoding="async"/g) ?? []).length < 3) {
    throw new Error(`${file} is missing optimized screenshot loading`);
  }
}

const updateManifest = JSON.parse(
  await readFile(resolve(output, 'updates', 'windows-preview.json'), 'utf8'),
);
if (
  updateManifest.product !== 'Inkstill'
  || updateManifest.channel !== 'preview'
  || !/^\d+\.\d+\.\d+$/.test(updateManifest.version ?? '')
  || !/^https:\/\/github\.com\/ScotteLiu\/Inkstill\/releases\/tag\//.test(updateManifest.releaseUrl ?? '')
  || !/^https:\/\/github\.com\/ScotteLiu\/Inkstill\/releases\/download\//.test(updateManifest.installer?.url ?? '')
  || !Number.isSafeInteger(updateManifest.installer?.size)
  || updateManifest.installer.size <= 0
  || !/^[a-f\d]{64}$/.test(updateManifest.installer?.sha256 ?? '')
) {
  throw new Error('updates/windows-preview.json is invalid');
}

console.log(`GitHub Pages site built at ${output}`);

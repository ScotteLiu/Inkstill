import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = 'https://scotteliu.github.io/Inkstill/';
const release = 'https://github.com/ScotteLiu/Inkstill/releases/download/v1.1.2-preview.1/';
const repository = 'https://github.com/ScotteLiu/Inkstill';
const languages = [
  ['en', '', 'English'],
  ['zh-CN', 'zh-cn.html', '简体中文'],
  ['zh-TW', 'zh-tw.html', '繁體中文'],
  ['es', 'es.html', 'Español'],
  ['pt-BR', 'pt-br.html', 'Português'],
  ['hi', 'hi.html', 'हिन्दी'],
  ['ru', 'ru.html', 'Русский'],
  ['de', 'de.html', 'Deutsch'],
];

const locales = [
  {
    file: 'es.html', lang: 'es', locale: 'es_ES', current: 'Español',
    title: 'Inkstill — Editor Markdown de código abierto para Windows, macOS y Linux',
    description: 'Un editor Markdown tranquilo y de código abierto con vista previa, búsqueda, backlinks, Mermaid, KaTeX y exportación PDF.',
    nav: 'Funciones', choose: 'Elegir idioma', download: 'Descargar',
    eyebrow: 'Markdown de código abierto para escritorio', heading: 'Una forma más tranquila de escribir Markdown.',
    intro: 'Escritura cuidada, notas conectadas y una vista previa potente, todo sobre archivos normales de tu ordenador.',
    installer: 'Descargar instalador', portable: 'ZIP portátil', source: 'Ver código',
    note: 'Windows disponible · versiones candidatas para macOS y Linux · licencia MIT',
    section: 'Hecho para el trabajo', sectionTitle: 'Todo lo necesario. Nada que distraiga.',
    cards: [['Escribe a tu ritmo', 'Combina las vistas Editar, Dividir y Leer con modos de concentración, máquina de escribir y Hemingway.'], ['Conecta cada idea', 'Busca carpetas, sigue enlaces Wiki y consulta backlinks sin cambiar el formato de tus archivos.'], ['Conserva archivos normales', 'Tu trabajo sigue siendo Markdown estándar en disco, sin necesidad de crear una cuenta.']],
    cta: 'Deja espacio para las palabras.', ctaText: 'Descarga la versión preliminar para Windows o revisa el código y el proceso de compilación en GitHub.',
    issues: 'Problemas', copyright: 'Inkstill se publica bajo la licencia MIT.',
  },
  {
    file: 'pt-br.html', lang: 'pt-BR', locale: 'pt_BR', current: 'Português',
    title: 'Inkstill — Editor Markdown de código aberto para Windows, macOS e Linux',
    description: 'Um editor Markdown tranquilo e de código aberto com visualização, busca, backlinks, Mermaid, KaTeX e exportação em PDF.',
    nav: 'Recursos', choose: 'Escolher idioma', download: 'Baixar',
    eyebrow: 'Markdown de código aberto para desktop', heading: 'Uma forma mais tranquila de escrever Markdown.',
    intro: 'Escrita agradável, notas conectadas e uma visualização poderosa em arquivos comuns do seu computador.',
    installer: 'Baixar instalador', portable: 'ZIP portátil', source: 'Ver código',
    note: 'Windows disponível · versões candidatas para macOS e Linux · licença MIT',
    section: 'Feito para o trabalho', sectionTitle: 'Tudo o que você precisa. Nada para distrair.',
    cards: [['Escreva no seu ritmo', 'Combine as visualizações Editar, Dividir e Ler com os modos foco, máquina de escrever e Hemingway.'], ['Conecte cada ideia', 'Pesquise pastas, siga links Wiki e veja backlinks sem alterar o formato dos arquivos.'], ['Mantenha arquivos comuns', 'Seu trabalho continua como Markdown padrão no disco, sem exigir uma conta.']],
    cta: 'Abra espaço para as palavras.', ctaText: 'Baixe a prévia para Windows ou confira o código e o processo de compilação no GitHub.',
    issues: 'Problemas', copyright: 'Inkstill é distribuído sob a licença MIT.',
  },
  {
    file: 'hi.html', lang: 'hi', locale: 'hi_IN', current: 'हिन्दी',
    title: 'Inkstill — Windows, macOS और Linux के लिए ओपन-सोर्स Markdown एडिटर',
    description: 'लाइव प्रीव्यू, खोज, बैकलिंक, Mermaid, KaTeX और PDF एक्सपोर्ट वाला शांत, ओपन-सोर्स Markdown एडिटर।',
    nav: 'विशेषताएँ', choose: 'भाषा चुनें', download: 'डाउनलोड',
    eyebrow: 'डेस्कटॉप के लिए ओपन-सोर्स Markdown', heading: 'Markdown लिखने का अधिक शांत तरीका।',
    intro: 'सुंदर लेखन, जुड़े हुए नोट्स और शक्तिशाली प्रीव्यू—आपके कंप्यूटर की सामान्य फ़ाइलों में।',
    installer: 'इंस्टॉलर डाउनलोड करें', portable: 'पोर्टेबल ZIP', source: 'सोर्स देखें',
    note: 'Windows उपलब्ध · macOS और Linux कैंडिडेट बिल्ड · MIT लाइसेंस',
    section: 'काम पर केंद्रित', sectionTitle: 'ज़रूरत की हर चीज़। ध्यान भटकाने वाली कोई चीज़ नहीं।',
    cards: [['अपनी लय में लिखें', 'Edit, Split और Read व्यू को focus, typewriter और Hemingway मोड के साथ उपयोग करें।'], ['हर विचार को जोड़ें', 'फ़ोल्डर खोजें, Wiki लिंक खोलें और फ़ाइल फ़ॉर्मेट बदले बिना बैकलिंक देखें।'], ['सामान्य फ़ाइलें रखें', 'आपका काम डिस्क पर मानक Markdown रहता है और शुरू करने के लिए खाते की ज़रूरत नहीं।']],
    cta: 'शब्दों के लिए जगह बनाएँ।', ctaText: 'Windows प्रीव्यू डाउनलोड करें या GitHub पर पूरा सोर्स और बिल्ड प्रक्रिया देखें।',
    issues: 'समस्याएँ', copyright: 'Inkstill MIT लाइसेंस के अंतर्गत जारी किया गया है।',
  },
  {
    file: 'ru.html', lang: 'ru', locale: 'ru_RU', current: 'Русский',
    title: 'Inkstill — Markdown-редактор с открытым исходным кодом для Windows, macOS и Linux',
    description: 'Спокойный Markdown-редактор с предпросмотром, поиском, обратными ссылками, Mermaid, KaTeX и экспортом PDF.',
    nav: 'Возможности', choose: 'Выбрать язык', download: 'Скачать',
    eyebrow: 'Открытый Markdown для компьютера', heading: 'Более спокойный способ писать в Markdown.',
    intro: 'Удобное письмо, связанные заметки и мощный предпросмотр в обычных файлах на вашем компьютере.',
    installer: 'Скачать установщик', portable: 'Портативный ZIP', source: 'Исходный код',
    note: 'Версия для Windows · кандидаты для macOS и Linux · лицензия MIT',
    section: 'Создан для работы', sectionTitle: 'Всё необходимое. Ничего отвлекающего.',
    cards: [['Пишите в своём ритме', 'Режимы редактирования, разделения и чтения дополняют фокус, печатная машинка и Hemingway.'], ['Связывайте идеи', 'Ищите по папкам, переходите по Wiki-ссылкам и изучайте обратные ссылки, не меняя формат файлов.'], ['Обычные файлы', 'Ваши материалы остаются стандартными Markdown-файлами на диске, а аккаунт не требуется.']],
    cta: 'Освободите место для слов.', ctaText: 'Скачайте предварительную версию для Windows или изучите код и процесс сборки на GitHub.',
    issues: 'Ошибки', copyright: 'Inkstill распространяется по лицензии MIT.',
  },
  {
    file: 'de.html', lang: 'de', locale: 'de_DE', current: 'Deutsch',
    title: 'Inkstill — Open-Source-Markdown-Editor für Windows, macOS und Linux',
    description: 'Ein ruhiger Open-Source-Markdown-Editor mit Vorschau, Suche, Backlinks, Mermaid, KaTeX und PDF-Export.',
    nav: 'Funktionen', choose: 'Sprache wählen', download: 'Download',
    eyebrow: 'Open-Source-Markdown für den Desktop', heading: 'Markdown schreiben, ganz in Ruhe.',
    intro: 'Angenehmes Schreiben, vernetzte Notizen und eine leistungsfähige Vorschau für gewöhnliche Dateien auf deinem Computer.',
    installer: 'Installer herunterladen', portable: 'Portable ZIP', source: 'Quellcode',
    note: 'Windows verfügbar · Kandidaten für macOS und Linux · MIT-Lizenz',
    section: 'Für die eigentliche Arbeit', sectionTitle: 'Alles, was du brauchst. Nichts, was ablenkt.',
    cards: [['Schreibe in deinem Rhythmus', 'Kombiniere Bearbeiten, Teilen und Lesen mit Fokus-, Schreibmaschinen- und Hemingway-Modus.'], ['Verbinde deine Gedanken', 'Durchsuche Ordner, folge Wiki-Links und prüfe Backlinks, ohne das Dateiformat zu ändern.'], ['Behalte normale Dateien', 'Deine Arbeit bleibt Standard-Markdown auf der Festplatte und benötigt kein Benutzerkonto.']],
    cta: 'Schaffe Raum für Worte.', ctaText: 'Lade die Windows-Vorschau herunter oder prüfe Quellcode und Build-Prozess auf GitHub.',
    issues: 'Probleme', copyright: 'Inkstill wird unter der MIT-Lizenz veröffentlicht.',
  },
];

const alternates = languages.map(([code, file]) => `<link rel="alternate" hreflang="${code}" href="${base}${file}">`).join('');
const menu = (current) => languages.map(([code, file, label]) => `<a href="${file || './'}" lang="${code}"${label === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');

function render(locale) {
  const cards = locale.cards.map(([title, body], index) => `<article class="card"><span class="card-number">0${index + 1}</span><h3>${title}</h3><p>${body}</p></article>`).join('');
  return `<!doctype html>
<html lang="${locale.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${locale.title}</title><meta name="description" content="${locale.description}"><meta name="theme-color" content="#f7f4ec"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${base}${locale.file}">${alternates}<link rel="alternate" hreflang="x-default" href="${base}">
<link rel="icon" href="assets/icon.png"><link rel="stylesheet" href="styles.css">
<meta property="og:type" content="website"><meta property="og:site_name" content="Inkstill"><meta property="og:title" content="${locale.title}"><meta property="og:description" content="${locale.description}"><meta property="og:url" content="${base}${locale.file}"><meta property="og:locale" content="${locale.locale}"><meta property="og:image" content="${base}assets/inkstill-social-preview.png"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Inkstill","applicationCategory":"UtilitiesApplication","operatingSystem":"Windows 10, Windows 11, macOS, Linux","softwareVersion":"1.1.2","url":"${base}${locale.file}","downloadUrl":"${release}Inkstill-1.1.2.Setup.exe","license":"https://opensource.org/license/mit","author":{"@type":"Person","name":"Scotte Liu"},"offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}</script></head>
<body><header class="site-header"><nav class="nav container" aria-label="${locale.nav}"><a class="brand" href="./"><img src="assets/icon.png" alt=""><span>Inkstill</span></a><div class="nav-links"><a href="#features">${locale.nav}</a><a href="${repository}">GitHub</a><a href="${repository}/releases/tag/v1.1.2-preview.1">${locale.download}</a><details class="language-menu"><summary aria-label="${locale.choose}">${locale.current}</summary><div class="language-options">${menu(locale.current)}</div></details></div></nav></header>
<main><section class="hero"><div class="container"><p class="eyebrow">${locale.eyebrow}</p><h1>${locale.heading}</h1><p class="hero-copy">${locale.intro}</p><div class="actions"><a class="button primary" href="${release}Inkstill-1.1.2.Setup.exe">${locale.installer}</a><a class="button" href="${release}Inkstill-win32-x64-1.1.2.zip">${locale.portable}</a><a class="button" href="${repository}">${locale.source}</a></div><p class="preview-note">${locale.note}</p><div class="product-frame"><img src="assets/inkstill-split-preview.png" alt="Inkstill Markdown editor" width="1240" height="820"></div></div></section>
<section id="features"><div class="container"><div class="section-heading center"><p class="eyebrow">${locale.section}</p><h2>${locale.sectionTitle}</h2></div><div class="benefit-grid">${cards}</div></div></section>
<section class="final-cta"><div class="container"><div class="final-panel"><h2>${locale.cta}</h2><p>${locale.ctaText}</p><a class="button" href="${release}Inkstill-1.1.2.Setup.exe">${locale.installer}</a></div></div></section></main>
<footer><div class="container footer-inner"><span>Copyright © 2026 Scotte Liu. ${locale.copyright}</span><div class="footer-links"><a href="${repository}">${locale.source}</a><a href="${repository}/issues">${locale.issues}</a></div></div></footer></body></html>`;
}

export async function writeLocalizedPages(output) {
  await Promise.all(locales.map((locale) => writeFile(resolve(output, locale.file), render(locale), 'utf8')));
}

export async function writeLocalizedSitemap(output) {
  const alternateLinks = languages.map(([code, file]) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${base}${file}"/>`).join('\n');
  const urls = languages.map(([, file], index) => `  <url>
    <loc>${base}${file}</loc>
    <lastmod>2026-07-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${index === 0 ? '1.0' : '0.9'}</priority>
${alternateLinks}
    <xhtml:link rel="alternate" hreflang="x-default" href="${base}"/>
  </url>`).join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
  await writeFile(resolve(output, 'sitemap.xml'), sitemap, 'utf8');
}

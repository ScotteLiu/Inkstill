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
const openGraphLocales = ['en_US', 'zh_CN', 'zh_TW', 'es_ES', 'pt_BR', 'hi_IN', 'ru_RU', 'de_DE'];

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
    workspaceEyebrow: 'Primero el teclado', workspaceTitle: 'Todo tu espacio de trabajo a un comando de distancia.', workspaceText: 'Busca comandos, formatos, vistas, exportaciones y acciones desde una paleta rápida y accesible por teclado.',
    workspaceItems: ['Apertura rápida y búsqueda de texto', 'Esquema del documento con búsqueda', 'Buscar, reemplazar y crear tablas', 'Pestañas y restauración de sesión'],
    markdownEyebrow: 'Markdown enriquecido', markdownTitle: 'Edición fiel al código, resultados impecables.', markdownText: 'Previsualiza diagramas, fórmulas, tablas, notas al pie, código y alertas sin perder un código fuente legible y portátil.',
    markdownItems: ['Diagramas Mermaid y fórmulas KaTeX', 'Tablas GFM, tareas y notas al pie', 'Copiar como HTML y exportar HTML/PDF', 'Importar y pegar imágenes locales'],
    quietTitle: 'Tranquilo por diseño. Eficiente por costumbre.', quietText: 'La protección de archivos grandes, las cachés limitadas y el trabajo en segundo plano controlado mantienen el editor ágil.',
    facts: [['Sin cuenta', 'Empieza con un archivo'], ['Sin telemetría', 'Sin seguimiento de uso'], ['Local primero', 'Tus carpetas elegidas'], ['Código abierto', 'Licencia MIT']],
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
    workspaceEyebrow: 'Teclado em primeiro lugar', workspaceTitle: 'Todo o espaço de trabalho a um comando de distância.', workspaceText: 'Encontre comandos, formatação, visualizações, exportações e ações em uma paleta rápida e amigável ao teclado.',
    workspaceItems: ['Abertura rápida e busca de texto', 'Estrutura do documento pesquisável', 'Localizar, substituir e criar tabelas', 'Várias abas e restauração da sessão'],
    markdownEyebrow: 'Markdown avançado', markdownTitle: 'Edição fiel ao código, resultado bem acabado.', markdownText: 'Visualize diagramas, fórmulas, tabelas, notas, código e alertas mantendo o texto legível e portátil.',
    markdownItems: ['Diagramas Mermaid e fórmulas KaTeX', 'Tabelas GFM, tarefas e notas de rodapé', 'Copiar como HTML e exportar HTML/PDF', 'Importar e colar imagens locais'],
    quietTitle: 'Tranquilo por design. Eficiente no uso.', quietText: 'Proteção para arquivos grandes, caches limitados e trabalho em segundo plano controlado mantêm o editor responsivo.',
    facts: [['Sem conta', 'Comece com um arquivo'], ['Sem telemetria', 'Sem rastrear o uso'], ['Local primeiro', 'As pastas que você escolher'], ['Código aberto', 'Licença MIT']],
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
    workspaceEyebrow: 'कीबोर्ड पहले', workspaceTitle: 'आपका पूरा कार्यक्षेत्र, बस एक कमांड दूर।', workspaceText: 'तेज़, कीबोर्ड-अनुकूल पैलेट से कमांड, फ़ॉर्मेटिंग, व्यू, एक्सपोर्ट और कार्यक्षेत्र क्रियाएँ खोजें।',
    workspaceItems: ['त्वरित खोलना और पूर्ण-पाठ खोज', 'खोज योग्य दस्तावेज़ रूपरेखा', 'खोजें, बदलें और टेबल बनाएँ', 'कई टैब और सत्र पुनर्स्थापना'],
    markdownEyebrow: 'समृद्ध Markdown', markdownTitle: 'सोर्स के प्रति सच्चा संपादन, सुंदर आउटपुट।', markdownText: 'सोर्स को पढ़ने योग्य और पोर्टेबल रखते हुए डायग्राम, गणित, टेबल, फुटनोट, कोड और अलर्ट का प्रीव्यू देखें।',
    markdownItems: ['Mermaid डायग्राम और KaTeX गणित', 'GFM टेबल, कार्य और फुटनोट', 'HTML के रूप में कॉपी और HTML/PDF एक्सपोर्ट', 'स्थानीय चित्र आयात और पेस्ट'],
    quietTitle: 'डिज़ाइन में शांत। उपयोग में कुशल।', quietText: 'बड़ी फ़ाइल सुरक्षा, सीमित कैश और नियंत्रित बैकग्राउंड कार्य एडिटर को तेज़ बनाए रखते हैं।',
    facts: [['खाता नहीं', 'एक फ़ाइल से शुरू करें'], ['टेलीमेट्री नहीं', 'उपयोग ट्रैकिंग नहीं'], ['लोकल पहले', 'आपके चुने हुए फ़ोल्डर'], ['ओपन सोर्स', 'MIT लाइसेंस']],
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
    workspaceEyebrow: 'Управление с клавиатуры', workspaceTitle: 'Всё рабочее пространство — в одной команде.', workspaceText: 'Быстро находите команды, форматирование, представления, экспорт и действия с помощью удобной палитры.',
    workspaceItems: ['Быстрое открытие и полнотекстовый поиск', 'Поиск по структуре документа', 'Поиск, замена и конструктор таблиц', 'Несколько вкладок и восстановление сессии'],
    markdownEyebrow: 'Расширенный Markdown', markdownTitle: 'Точное редактирование, аккуратный результат.', markdownText: 'Просматривайте диаграммы, формулы, таблицы, сноски, код и предупреждения, сохраняя исходный текст читаемым и переносимым.',
    markdownItems: ['Диаграммы Mermaid и формулы KaTeX', 'Таблицы GFM, задачи и сноски', 'Копирование HTML и экспорт HTML/PDF', 'Импорт и вставка локальных изображений'],
    quietTitle: 'Спокойный дизайн. Экономная работа.', quietText: 'Защита больших файлов, ограниченные кэши и контролируемые фоновые задачи сохраняют быстрый отклик редактора.',
    facts: [['Без аккаунта', 'Начните с файла'], ['Без телеметрии', 'Без отслеживания'], ['Сначала локально', 'Только выбранные папки'], ['Открытый код', 'Лицензия MIT']],
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
    workspaceEyebrow: 'Tastatur zuerst', workspaceTitle: 'Der ganze Arbeitsbereich, nur einen Befehl entfernt.', workspaceText: 'Finde Befehle, Formatierungen, Ansichten, Exporte und Arbeitsbereichsaktionen in einer schnellen Befehlspalette.',
    workspaceItems: ['Schnellöffnen und Volltextsuche', 'Durchsuchbare Dokumentgliederung', 'Suchen, Ersetzen und Tabelleneditor', 'Mehrere Tabs und Sitzungswiederherstellung'],
    markdownEyebrow: 'Umfangreiches Markdown', markdownTitle: 'Quelltexttreu bearbeiten, hochwertig ausgeben.', markdownText: 'Zeige Diagramme, Mathematik, Tabellen, Fußnoten, Code und Hinweise an, während der Quelltext lesbar und portabel bleibt.',
    markdownItems: ['Mermaid-Diagramme und KaTeX-Formeln', 'GFM-Tabellen, Aufgaben und Fußnoten', 'Als HTML kopieren und HTML/PDF exportieren', 'Lokale Bilder importieren und einfügen'],
    quietTitle: 'Ruhig im Design. Sparsam im Betrieb.', quietText: 'Schutz für große Dateien, begrenzte Caches und kontrollierte Hintergrundarbeit halten den Editor reaktionsschnell.',
    facts: [['Kein Konto', 'Mit einer Datei beginnen'], ['Keine Telemetrie', 'Keine Nutzungsverfolgung'], ['Lokal zuerst', 'Deine gewählten Ordner'], ['Open Source', 'MIT-Lizenz']],
    cta: 'Schaffe Raum für Worte.', ctaText: 'Lade die Windows-Vorschau herunter oder prüfe Quellcode und Build-Prozess auf GitHub.',
    issues: 'Probleme', copyright: 'Inkstill wird unter der MIT-Lizenz veröffentlicht.',
  },
];

const alternates = languages.map(([code, file]) => `<link rel="alternate" hreflang="${code}" href="${base}${file}">`).join('');
const menu = (current) => languages.map(([code, file, label]) => `<a href="${file || './'}" lang="${code}"${label === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');

function render(locale) {
  const cards = locale.cards.map(([title, body], index) => `<article class="card"><span class="card-number">0${index + 1}</span><h3>${title}</h3><p>${body}</p></article>`).join('');
  const workspaceItems = locale.workspaceItems.map((item) => `<li>${item}</li>`).join('');
  const markdownItems = locale.markdownItems.map((item) => `<li>${item}</li>`).join('');
  const facts = locale.facts.map(([title, body]) => `<div class="fact"><strong>${title}</strong><span>${body}</span></div>`).join('');
  const ogAlternates = openGraphLocales.filter((item) => item !== locale.locale).map((item) => `<meta property="og:locale:alternate" content="${item}">`).join('');
  return `<!doctype html>
<html lang="${locale.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${locale.title}</title><meta name="description" content="${locale.description}"><meta name="theme-color" content="#f7f4ec"><meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${base}${locale.file}">${alternates}<link rel="alternate" hreflang="x-default" href="${base}">
<link rel="icon" href="assets/icon.png"><link rel="stylesheet" href="styles.css">
<meta property="og:type" content="website"><meta property="og:site_name" content="Inkstill"><meta property="og:title" content="${locale.title}"><meta property="og:description" content="${locale.description}"><meta property="og:url" content="${base}${locale.file}"><meta property="og:locale" content="${locale.locale}">${ogAlternates}<meta property="og:image" content="${base}assets/inkstill-social-preview.png"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="640"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Inkstill","applicationCategory":"UtilitiesApplication","operatingSystem":"Windows 10, Windows 11, macOS, Linux","softwareVersion":"1.1.2","description":${JSON.stringify(locale.description)},"url":"${base}${locale.file}","downloadUrl":"${release}Inkstill-1.1.2.Setup.exe","license":"https://opensource.org/license/mit","author":{"@type":"Person","name":"Scotte Liu"},"offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}</script></head>
<body><header class="site-header"><nav class="nav container" aria-label="${locale.nav}"><a class="brand" href="./"><img src="assets/icon.png" alt=""><span>Inkstill</span></a><div class="nav-links"><a href="#features">${locale.nav}</a><a href="${repository}">GitHub</a><a href="${repository}/releases/tag/v1.1.2-preview.1">${locale.download}</a><details class="language-menu"><summary aria-label="${locale.choose}">${locale.current}</summary><div class="language-options">${menu(locale.current)}</div></details></div></nav></header>
<main><section class="hero"><div class="container"><p class="eyebrow">${locale.eyebrow}</p><h1>${locale.heading}</h1><p class="hero-copy">${locale.intro}</p><div class="actions"><a class="button primary" href="${release}Inkstill-1.1.2.Setup.exe">${locale.installer}</a><a class="button" href="${release}Inkstill-win32-x64-1.1.2.zip">${locale.portable}</a><a class="button" href="${repository}">${locale.source}</a></div><p class="preview-note">${locale.note}</p><div class="product-frame"><img src="assets/inkstill-split-preview.png" alt="Inkstill Markdown editor" width="1240" height="820"></div></div></section>
<section id="features"><div class="container"><div class="section-heading center"><p class="eyebrow">${locale.section}</p><h2>${locale.sectionTitle}</h2></div><div class="benefit-grid">${cards}</div></div></section>
<section><div class="container showcase"><div class="showcase-image"><img src="assets/inkstill-command-palette.png" alt="Inkstill command palette" loading="lazy" width="1240" height="820"></div><div class="showcase-copy"><p class="eyebrow">${locale.workspaceEyebrow}</p><h2>${locale.workspaceTitle}</h2><p>${locale.workspaceText}</p><ul class="feature-list">${workspaceItems}</ul></div></div></section>
<section><div class="container showcase reverse"><div class="showcase-copy"><p class="eyebrow">${locale.markdownEyebrow}</p><h2>${locale.markdownTitle}</h2><p>${locale.markdownText}</p><ul class="feature-list">${markdownItems}</ul></div><div class="showcase-image"><img src="assets/inkstill-writing-tools.png" alt="Inkstill writing tools" loading="lazy" width="1240" height="820"></div></div></section>
<section class="quiet-section"><div class="container quiet-grid"><h2>${locale.quietTitle}</h2><div class="quiet-copy"><p>${locale.quietText}</p><div class="facts">${facts}</div></div></div></section>
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

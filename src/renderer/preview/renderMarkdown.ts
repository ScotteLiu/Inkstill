import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import katex from 'katex';
import { Marked, type Renderer } from 'marked';

import { EMOJI_SHORTCODES } from '../markdown/emoji';

for (const [name, language] of Object.entries({
  bash,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
})) {
  hljs.registerLanguage(name, language);
}

const LANGUAGE_ALIASES: Record<string, string> = {
  c: 'cpp',
  'c++': 'cpp',
  cs: 'csharp',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Shell',
  cpp: 'C / C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  python: 'Python',
  rust: 'Rust',
  sql: 'SQL',
  typescript: 'TypeScript',
  xml: 'HTML / XML',
  yaml: 'YAML',
};

interface PlaceholderStore {
  values: string[];
  add(html: string): string;
  restore(html: string): string;
}

function placeholders(prefix: string): PlaceholderStore {
  const values: string[] = [];
  const pattern = new RegExp(`${prefix}(\\d+)E`, 'g');
  return {
    values,
    add(html) {
      const index = values.push(html) - 1;
      return `${prefix}${index}E`;
    },
    restore(html) {
      return html.replace(pattern, (_match, rawIndex: string) =>
        values[Number(rawIndex)] ?? '');
    },
  };
}

// A per-render nonce keeps placeholder tokens unguessable, so literal token-like
// text in a document can never expand into internal markup.
function renderNonce(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

function maskInlineCode(line: string, codeStore: PlaceholderStore): string {
  return line.replace(/(?<!`)(`+)(?!`)(.+?)\1(?!`)/g, (span) => codeStore.add(span));
}

// Fenced code blocks and inline code spans are opaque to every Markdown
// transformation below; masking them first keeps `$`, `~`, `^`, `==`, `[[`,
// `[^`, and `:emoji:` sequences inside code exactly as written.
function maskCodeRegions(markdown: string, codeStore: PlaceholderStore): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let fence: string | null = null;
  let block: string[] = [];
  for (const line of lines) {
    if (fence) {
      block.push(line);
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        output.push(codeStore.add(block.join('\n')));
        fence = null;
        block = [];
      }
      continue;
    }
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = open[1];
      block = [line];
      continue;
    }
    output.push(maskInlineCode(line, codeStore));
  }
  if (fence) {
    // An unclosed fence runs to the end of the document.
    output.push(codeStore.add(block.join('\n')));
  }
  return output.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function renderMath(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source.trim(), {
      displayMode,
      throwOnError: false,
      strict: 'warn',
      trust: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return `<code class="math-error">${escapeHtml(source)}</code>`;
  }
}

function extractHeadings(markdown: string): Array<{ depth: number; text: string; id: string }> {
  const counts = new Map<string, number>();
  const headings: Array<{ depth: number; text: string; id: string }> = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/[*_~`=[\]]/g, '').trim();
    const base = slugify(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    headings.push({ depth: match[1].length, text, id: count === 0 ? base : `${base}-${count + 1}` });
  }
  return headings;
}

function frontMatter(markdown: string, store: PlaceholderStore): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return markdown;
  const rows = match[1].split(/\r?\n/).flatMap((line) => {
    const field = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    return field
      ? [`<dt>${escapeHtml(field[1])}</dt><dd>${escapeHtml(field[2] || '—')}</dd>`]
      : [];
  });
  const card = rows.length > 0
    ? `<details class="front-matter"><summary>Document metadata</summary><dl>${rows.join('')}</dl></details>`
    : '';
  return `${card ? `${store.add(card)}\n\n` : ''}${markdown.slice(match[0].length)}`;
}

function preprocess(
  markdown: string,
  store: PlaceholderStore,
  codeStore: PlaceholderStore,
  alertMarker: string,
): string {
  const footnotes = new Map<string, string>();
  const headings = extractHeadings(markdown);
  let prepared = maskCodeRegions(frontMatter(markdown, store), codeStore)
    .replace(/^\[\^([^\]]+)\]:\s*(.+(?:\n(?: {2,}|\t).+)*)$/gm, (_match, id: string, body: string) => {
      footnotes.set(id, body.replace(/\n(?: {2,}|\t)/g, '\n'));
      return '';
    });

  prepared = prepared.replace(/\$\$([\s\S]+?)\$\$/g, (_match, source: string) =>
    `\n\n${store.add(`<div class="math-block">${renderMath(source, true)}</div>`)}\n\n`);
  prepared = prepared.replace(/\\\[([\s\S]+?)\\\]/g, (_match, source: string) =>
    `\n\n${store.add(`<div class="math-block">${renderMath(source, true)}</div>`)}\n\n`);
  prepared = prepared.replace(/^\s*\[\s*([^\]\n]*(?:\\[A-Za-z]+|[_^]\{?)[^\]\n]*?)\s*\]\s*$/gm, (_match, source: string) =>
    `\n\n${store.add(`<div class="math-block">${renderMath(source, true)}</div>`)}\n\n`);
  prepared = prepared.replace(/\\\((.+?)\\\)/g, (_match, source: string) =>
    store.add(`<span class="math-inline">${renderMath(source, false)}</span>`));
  prepared = prepared.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_match, prefix: string, source: string) =>
    `${prefix}${store.add(`<span class="math-inline">${renderMath(source, false)}</span>`)}`);

  prepared = prepared.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => {
    const cleanTarget = target.trim();
    const label = (alias ?? target).trim();
    return store.add(
      `<a href="#" class="wikilink" data-wikilink="${escapeHtml(cleanTarget)}">${escapeHtml(label)}</a>`,
    );
  });
  prepared = prepared.replace(/==([^=\n]+)==/g, (_match, text: string) =>
    store.add(`<mark>${escapeHtml(text)}</mark>`));
  prepared = prepared.replace(/(?<!~)~([^~\n]+)~(?!~)/g, (_match, text: string) =>
    store.add(`<sub>${escapeHtml(text)}</sub>`));
  prepared = prepared.replace(/\^([^\^\n]+)\^/g, (_match, text: string) =>
    store.add(`<sup>${escapeHtml(text)}</sup>`));
  prepared = prepared.replace(/:([a-z0-9_+-]+):/gi, (match, name: string) => {
    const emoji = EMOJI_SHORTCODES[name.toLocaleLowerCase('en-US')];
    return emoji ? store.add(`<span class="emoji" role="img" aria-label="${escapeHtml(name)}">${emoji}</span>`) : match;
  });
  prepared = prepared.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim, (_match, type: string) =>
    `> ${alertMarker}${type.toLocaleUpperCase('en-US')}`);
  prepared = prepared.replace(/^\s*\[toc\]\s*$/gim, () => {
    if (headings.length === 0) return store.add('<nav class="table-of-contents"><strong>Contents</strong><p>No headings</p></nav>');
    const items = headings.map((heading) =>
      `<li class="toc-level-${heading.depth}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`).join('');
    return store.add(`<nav class="table-of-contents"><strong>Contents</strong><ol>${items}</ol></nav>`);
  });
  prepared = prepared.replace(/\[\^([^\]]+)\]/g, (_match, id: string) =>
    store.add(`<sup class="footnote-ref"><a href="#fn-${escapeHtml(id)}">${escapeHtml(id)}</a></sup>`));

  if (footnotes.size > 0) {
    const items = [...footnotes.entries()].map(([id, body]) =>
      `<li id="fn-${escapeHtml(id)}">${escapeHtml(body)} <a href="#" data-footnote-back="${escapeHtml(id)}">↩</a></li>`)
      .join('');
    prepared += `\n\n${store.add(`<section class="footnotes"><hr><ol>${items}</ol></section>`)}`;
  }
  return codeStore.restore(prepared);
}

function createRenderer(store: PlaceholderStore): Renderer {
  const headingCounts = new Map<string, number>();
  const marked = new Marked();
  const renderer = new marked.Renderer();
  renderer.html = function html({ text }) {
      return `<pre class="raw-html"><code>${escapeHtml(text)}</code></pre>`;
    };
  renderer.heading = function heading({ tokens, depth }) {
      const content = this.parser.parseInline(tokens);
      const base = slugify(content);
      const count = headingCounts.get(base) ?? 0;
      headingCounts.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;
      return `<h${depth} id="${id}">${content}</h${depth}>`;
    };
  renderer.code = function code({ text, lang }) {
      const requestedLanguage = (lang ?? '').trim().split(/\s+/)[0].toLocaleLowerCase('en-US');
      if (requestedLanguage === 'mermaid') {
        return store.add(`<div class="mermaid" data-mermaid="true">${escapeHtml(text)}</div>`);
      }
      const normalizedLanguage = LANGUAGE_ALIASES[requestedLanguage] ?? requestedLanguage;
      let language = hljs.getLanguage(normalizedLanguage) ? normalizedLanguage : '';
      let highlighted = escapeHtml(text);
      if (language) {
        highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      } else if (!requestedLanguage && text.trim() && text.length <= 12_000) {
        const detected = hljs.highlightAuto(text);
        language = detected.language ?? '';
        highlighted = detected.value;
      }
      const label = language
        ? LANGUAGE_LABELS[language] ?? language
        : requestedLanguage
          ? requestedLanguage.toLocaleUpperCase('en-US')
          : 'Plain text';
      const className = language ? ` hljs language-${escapeHtml(language)}` : '';
      return `<figure class="code-block" data-language="${escapeHtml(language || 'text')}"><figcaption>${escapeHtml(label)}</figcaption><pre><code class="${className.trim()}">${highlighted}</code></pre></figure>`;
    };
  renderer.link = function link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safeHref = escapeHtml(href);
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
      const external = /^(?:https?:|mailto:)/i.test(href)
        ? ' data-external="true" rel="noreferrer noopener"'
        : '';
      return `<a href="${safeHref}"${titleAttribute}${external}>${label}</a>`;
    };
  renderer.image = function image({ href, title, text }) {
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttribute} loading="lazy">`;
    };
  return renderer;
}

export function renderMarkdown(markdown: string): string {
  const nonce = renderNonce();
  const store = placeholders(`INKSTILLHTML${nonce}N`);
  const codeStore = placeholders(`INKSTILLCODE${nonce}N`);
  const alertMarker = `INKSTILLALERT${nonce}`;
  const parser = new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: createRenderer(store),
  });
  const prepared = preprocess(markdown, store, codeStore, alertMarker);
  const rendered = parser.parse(prepared, { async: false });
  const restored = store.restore(rendered).replace(
    new RegExp(`<blockquote>\\s*<p>${alertMarker}(NOTE|TIP|IMPORTANT|WARNING|CAUTION)(?:\\s*</p>)?`, 'gi'),
    (_match, type: string) => `<blockquote class="markdown-alert alert-${type.toLocaleLowerCase('en-US')}"><p><strong>${type[0]}${type.slice(1).toLocaleLowerCase('en-US')}</strong><br>`,
  );
  return DOMPurify.sanitize(restored, {
    ADD_ATTR: ['data-wikilink', 'data-external', 'data-footnote-back', 'data-mermaid', 'data-language', 'role', 'aria-label'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc'],
  });
}

export function extractWikiLinks(markdown: string): string[] {
  const links = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) links.add(target);
  }
  return [...links];
}

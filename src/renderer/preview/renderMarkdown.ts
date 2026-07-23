import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked, type Renderer } from 'marked';

import { EMOJI_SHORTCODES } from '../markdown/emoji';

interface PlaceholderStore {
  values: string[];
  add(html: string): string;
  restore(html: string): string;
}

function placeholders(): PlaceholderStore {
  const values: string[] = [];
  return {
    values,
    add(html) {
      const index = values.push(html) - 1;
      return `INKSTILLPLACEHOLDER${index}END`;
    },
    restore(html) {
      return html.replace(/INKSTILLPLACEHOLDER(\d+)END/g, (_match, rawIndex: string) =>
        values[Number(rawIndex)] ?? '');
    },
  };
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

function preprocess(markdown: string, store: PlaceholderStore): string {
  const footnotes = new Map<string, string>();
  const headings = extractHeadings(markdown);
  let prepared = frontMatter(markdown, store).replace(/^\[\^([^\]]+)\]:\s*(.+(?:\n(?: {2,}|\t).+)*)$/gm, (_match, id: string, body: string) => {
    footnotes.set(id, body.replace(/\n(?: {2,}|\t)/g, '\n'));
    return '';
  });

  prepared = prepared.replace(/\$\$([\s\S]+?)\$\$/g, (_match, source: string) =>
    `\n\n${store.add(`<div class="math-block">${renderMath(source, true)}</div>`)}\n\n`);
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
    `> INKSTILLALERT${type.toLocaleUpperCase('en-US')}`);
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
  return prepared;
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
      const language = (lang ?? '').trim().split(/\s+/)[0].toLocaleLowerCase('en-US');
      if (language === 'mermaid') {
        return store.add(`<div class="mermaid" data-mermaid="true">${escapeHtml(text)}</div>`);
      }
      const className = language ? ` class="language-${escapeHtml(language)}"` : '';
      return `<pre><code${className}>${escapeHtml(text)}</code></pre>`;
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
  const store = placeholders();
  const parser = new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: createRenderer(store),
  });
  const prepared = preprocess(markdown, store);
  const rendered = parser.parse(prepared, { async: false });
  const restored = store.restore(rendered).replace(
    /<blockquote>\s*<p>INKSTILLALERT(NOTE|TIP|IMPORTANT|WARNING|CAUTION)(?:\s*<\/p>)?/gi,
    (_match, type: string) => `<blockquote class="markdown-alert alert-${type.toLocaleLowerCase('en-US')}"><p><strong>${type[0]}${type.slice(1).toLocaleLowerCase('en-US')}</strong><br>`,
  );
  return DOMPurify.sanitize(restored, {
    ADD_ATTR: ['data-wikilink', 'data-external', 'data-footnote-back', 'data-mermaid', 'role', 'aria-label'],
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

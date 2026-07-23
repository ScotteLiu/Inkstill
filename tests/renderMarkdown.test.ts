import { describe, expect, it } from 'vitest';

import { extractWikiLinks, renderMarkdown } from '../src/renderer/preview/renderMarkdown';

describe('renderMarkdown', () => {
  it('renders common writing extensions', () => {
    const html = renderMarkdown([
      '# Heading',
      '',
      '- [x] done',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '==highlight== $x^2$ [[Note|Related note]] [^1]',
      '',
      '[^1]: Footnote text',
    ].join('\n'));
    expect(html).toContain('<h1 id="heading">Heading</h1>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<table>');
    expect(html).toContain('<mark>highlight</mark>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('data-wikilink="Note"');
    expect(html).toContain('class="footnotes"');
  });

  it('neutralizes raw HTML and dangerous URLs', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img src="x"');
    expect(html).toContain('raw-html');
  });

  it('marks Mermaid blocks for isolated rendering', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('data-mermaid="true"');
    expect(html).toContain('graph TD');
  });

  it('highlights fenced code and labels its language', () => {
    const html = renderMarkdown('```python\nvalue = len(items)\n```');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('<figcaption>Python</figcaption>');
    expect(html).toContain('class="hljs language-python"');
    expect(html).toContain('hljs-built_in');
  });

  it('renders bracketed LaTeX display equations from common document exports', () => {
    const source = String.raw`\[ M_z(y,x)=\operatorname{median}_{(u,v)\in 3\times3} I_z(y+v,x+u) \]`;
    const plainBracketSource = String.raw`[ M_z(y,x)=\operatorname{median}_{(u,v)\in 3\times3} I_z(y+v,x+u) ]`;
    for (const markdown of [source, plainBracketSource]) {
      const html = renderMarkdown(markdown);
      expect(html).toContain('class="math-block"');
      expect(html).toContain('class="katex"');
      expect(html).not.toContain('<p>[ M_z');
    }
  });

  it('renders common document extensions', () => {
    const html = renderMarkdown([
      '---',
      'title: Product note',
      'tags: writing, markdown',
      '---',
      '',
      '[toc]',
      '',
      '# Overview',
      '',
      '> [!NOTE]',
      '> Keep the source portable.',
      '',
      'Ship it :rocket: with H~2~O and x^2^.',
    ].join('\n'));
    expect(html).toContain('class="front-matter"');
    expect(html).toContain('<dt>title</dt><dd>Product note</dd>');
    expect(html).toContain('class="table-of-contents"');
    expect(html).toContain('href="#overview"');
    expect(html).toContain('markdown-alert alert-note');
    expect(html).toContain('Keep the source portable.');
    expect(html).toContain('🚀');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
  });
});

describe('extractWikiLinks', () => {
  it('deduplicates targets and ignores aliases and headings', () => {
    expect(extractWikiLinks('[[Alpha]] [[Alpha|A]] [[Beta#Part|B]]')).toEqual(['Alpha', 'Beta']);
  });
});

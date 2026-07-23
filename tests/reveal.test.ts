import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import {
  collectRevealModel,
  markdownRevealExtension,
  revealPlugin,
} from '../src/renderer/editor/reveal';

function createState(
  doc: string,
  anchor = 0,
  head = anchor,
): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function hiddenText(state: EditorState): string[] {
  return collectRevealModel(state).hiddenRanges.map((range) =>
    state.sliceDoc(range.from, range.to),
  );
}

function createView(
  doc: string,
  anchor: number,
  extensions: Extension[],
): { parent: HTMLDivElement; view: EditorView } {
  const parent = document.createElement('div');
  document.body.append(parent);
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(anchor),
    extensions,
  });
  return { parent, view: new EditorView({ state, parent }) };
}

function hiddenTextInView(view: EditorView): string[] {
  const hidden: string[] = [];
  view.plugin(revealPlugin)?.hidden.between(
    0,
    view.state.doc.length,
    (from, to) => {
      hidden.push(view.state.sliceDoc(from, to));
    },
  );
  return hidden;
}

describe('Markdown block reveal model', () => {
  const document = [
    '# H',
    '**B**',
    '*E*',
    '~~S~~',
    '[Label](https://x.test "title")',
    '`C`',
  ].join('\n');

  it('keeps the active line markers visible and hides other complete markers', () => {
    const state = createState(document, 2);
    const hidden = hiddenText(state);

    expect(hidden).not.toContain('#');
    expect(hidden.filter((value) => value === '**')).toHaveLength(2);
    expect(hidden.filter((value) => value === '*')).toHaveLength(2);
    expect(hidden.filter((value) => value === '~~')).toHaveLength(2);
    expect(hidden).toContain('[');
    expect(hidden).toContain('](https://x.test "title")');
    expect(hidden.filter((value) => value === '`')).toHaveLength(2);
    expect(state.doc.toString()).toBe(document);
  });

  it('reveals all delimiters for the line containing the cursor', () => {
    const boldPosition = document.indexOf('B');
    const state = createState(document, boldPosition);
    const hidden = hiddenText(state);

    expect(hidden).toContain('#');
    expect(hidden).not.toContain('**');
  });

  it('does not include the next line when a selection ends at its start', () => {
    const thirdLineStart = document.indexOf('*E*');
    const state = createState(document, 0, thirdLineStart);
    const hidden = hiddenText(state);

    expect(hidden).not.toContain('#');
    expect(hidden).not.toContain('**');
    expect(hidden.filter((value) => value === '*')).toHaveLength(2);
  });

  it('reveals only the disjoint lines touched by multiple selections', () => {
    const doc = ['**A**', '**B**', '**C**'].join('\n');
    const thirdLine = doc.indexOf('C');
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([
        EditorSelection.cursor(doc.indexOf('A')),
        EditorSelection.cursor(thirdLine),
      ]),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage }),
      ],
    });

    expect(hiddenText(state)).toEqual(['**', '**']);
  });

  it('fails open for incomplete Markdown', () => {
    const incomplete = '**open\n[bad](<\n`open';
    const state = createState(incomplete, 0);
    expect(hiddenText(state)).toEqual([]);
    expect(state.doc.toString()).toBe(incomplete);
  });

  it('only hides InlineCode markers, never fenced-code markers', () => {
    const code = ['```js', 'const a = 1;', '```', '', '`inline`'].join('\n');
    const state = createState(code, 0);
    expect(hiddenText(state)).toEqual(['`', '`']);
  });

  it('fails open for images until an image preview exists', () => {
    const image = '![**alt**](image.png)\nplain';
    const state = createState(image, image.length);
    expect(hiddenText(state)).toEqual([]);
  });

  it('reveals everything while IME composition is active', () => {
    const state = createState(document, 0);
    expect(collectRevealModel(state, { revealAll: true }).hiddenRanges).toEqual([]);
  });

  it('adds visual heading classes without touching source text', () => {
    const state = createState('# H1\n\n### H3', 0);
    const model = collectRevealModel(state);
    expect(model.lineStyles.map((style) => style.className)).toEqual([
      'cm-heading cm-heading-1',
      'cm-heading cm-heading-3',
    ]);
    expect(state.doc.toString()).toBe('# H1\n\n### H3');
  });
});

describe('Markdown reveal view integration', () => {
  const doc = '**B**\nplain';

  it('rebuilds when only the syntax tree changes', () => {
    const language = new Compartment();
    let updateFlags: {
      docChanged: boolean;
      selectionSet: boolean;
      viewportChanged: boolean;
    } | null = null;
    const { parent, view } = createView(doc, doc.length, [
      language.of([]),
      markdownRevealExtension(),
      EditorView.updateListener.of((update) => {
        updateFlags = {
          docChanged: update.docChanged,
          selectionSet: update.selectionSet,
          viewportChanged: update.viewportChanged,
        };
      }),
    ]);

    try {
      expect(hiddenTextInView(view)).toEqual([]);
      const previousTree = syntaxTree(view.state);

      view.dispatch({
        effects: language.reconfigure(markdown({ base: markdownLanguage })),
      });

      expect(syntaxTree(view.state)).not.toBe(previousTree);
      expect(updateFlags).toEqual({
        docChanged: false,
        selectionSet: false,
        viewportChanged: false,
      });
      expect(hiddenTextInView(view)).toEqual(['**', '**']);
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it('keeps all markers open until composition teardown is safely delayed', () => {
    const { parent, view } = createView(doc, doc.length, [
      markdown({ base: markdownLanguage }),
      markdownRevealExtension(),
    ]);
    vi.useFakeTimers();

    try {
      expect(hiddenTextInView(view)).toEqual(['**', '**']);

      view.contentDOM.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      expect(hiddenTextInView(view)).toEqual([]);

      view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
      expect(hiddenTextInView(view)).toEqual([]);

      vi.advanceTimersByTime(50);
      expect(hiddenTextInView(view)).toEqual([]);

      vi.advanceTimersByTime(50);
      expect(hiddenTextInView(view)).toEqual(['**', '**']);
    } finally {
      view.destroy();
      parent.remove();
      vi.useRealTimers();
    }
  });
});

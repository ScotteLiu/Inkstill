import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { collectRevealModel } from '../src/renderer/editor/reveal';

describe('large document budget', () => {
  it('creates a 1 MB text state and derives viewport decorations within the Phase 0 budget', () => {
    const paragraph = [
      '## Section',
      '',
      '中文 paragraph with **bold**, *emphasis*, ~~strike~~ and [link](https://example.test).',
      '',
    ].join('\n');
    const repetitions = Math.ceil(1_000_000 / paragraph.length);
    const source = paragraph.repeat(repetitions).slice(0, 1_000_000);

    const startedAt = performance.now();
    const state = EditorState.create({
      doc: source,
      extensions: [markdown({ base: markdownLanguage })],
    });
    const model = collectRevealModel(state, { from: 0, to: 20_000 });
    const transaction = state.update({ changes: { from: 128, insert: '測' } });
    const elapsed = performance.now() - startedAt;

    expect(source.length).toBe(1_000_000);
    expect(model.hiddenRanges.length).toBeGreaterThan(0);
    expect(transaction.state.doc.length).toBe(1_000_001);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('bounds a large fenced block to visible line decorations', () => {
    const source = `\`\`\`\n${'x\n'.repeat(10_000)}\`\`\``;
    let state = EditorState.create({
      doc: source,
      selection: EditorSelection.single(0, source.length),
      extensions: [markdown({ base: markdownLanguage })],
    });

    expect(ensureSyntaxTree(state, state.doc.length, 2_000)).not.toBeNull();
    state = state.update({}).state;
    const visibleLine = state.doc.line(5_000);
    const model = collectRevealModel(state, {
      from: visibleLine.from,
      to: visibleLine.to,
    });

    expect(model.lineStyles).toEqual([
      {
        from: visibleLine.from,
        to: visibleLine.from,
        className: 'cm-codeblock',
      },
    ]);
  });
});

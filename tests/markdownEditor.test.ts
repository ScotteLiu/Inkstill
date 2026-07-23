import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';

import {
  maximumDocumentLengthFilter,
  serializedDocumentLength,
} from '../src/renderer/editor/MarkdownEditor';

describe('MarkdownEditor safety policies', () => {
  it('counts serialized CRLF characters instead of CodeMirror positions', () => {
    const state = EditorState.create({ doc: 'one\ntwo\nthree' });

    expect(state.doc.length).toBe(13);
    expect(serializedDocumentLength(state.doc, '\r\n')).toBe(15);
    expect(serializedDocumentLength(state.doc, '\n')).toBe(13);
  });

  it('rejects growth past the save/Recovery limit but still allows deletion', async () => {
    const onLimit = vi.fn();
    const state = EditorState.create({
      doc: '12345',
      extensions: [maximumDocumentLengthFilter('\n', onLimit, 5)],
    });

    const rejected = state.update({ changes: { from: 5, insert: '6' } });
    expect(rejected.newDoc.toString()).toBe('12345');
    await new Promise<void>((resolve) => window.queueMicrotask(() => resolve()));
    expect(onLimit).toHaveBeenCalledOnce();

    const deletion = state.update({ changes: { from: 4, to: 5 } });
    expect(deletion.newDoc.toString()).toBe('1234');
  });
});

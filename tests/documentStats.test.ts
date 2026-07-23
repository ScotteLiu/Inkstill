import { describe, expect, it } from 'vitest';

import { analyzeDocument, countWords } from '../src/renderer/editor/documentStats';

describe('document statistics', () => {
  it('counts natural-language words without treating punctuation as words', () => {
    expect(countWords('Hello, calm Markdown world.')).toBe(4);
  });

  it('counts CJK text with the platform word segmenter', () => {
    expect(countWords('Hello 世界，歡迎使用 Markdown')).toBe(5);
  });

  it('extracts headings and preserves physical line counts', () => {
    expect(analyzeDocument('# One\r\nText\r\n## Two')).toMatchObject({
      characters: 19,
      lines: 3,
      headings: [
        { level: 1, text: 'One', line: 1 },
        { level: 2, text: 'Two', line: 3 },
      ],
    });
  });
});

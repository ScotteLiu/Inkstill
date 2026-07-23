export interface HeadingItem {
  level: number;
  text: string;
  line: number;
}

export interface DocumentStats {
  characters: number;
  words: number;
  lines: number;
  headings: HeadingItem[];
}

export function countWords(content: string): number {
  if (!content.trim()) return 0;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  let count = 0;
  for (const segment of segmenter.segment(content)) {
    if (segment.isWordLike) count += 1;
  }
  return count;
}

export function analyzeDocument(content: string): DocumentStats {
  const lines = content.split(/\r\n|\r|\n/);
  const headings: HeadingItem[] = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2],
        line: index + 1,
      });
    }
  });
  return {
    characters: content.length,
    words: countWords(content),
    lines: lines.length,
    headings,
  };
}

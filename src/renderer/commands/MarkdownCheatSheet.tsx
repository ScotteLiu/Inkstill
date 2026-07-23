import { useEffect } from 'react';

interface MarkdownCheatSheetProps {
  onClose(): void;
}

const EXAMPLES = [
  ['Heading', '# Heading'],
  ['Bold', '**bold**'],
  ['Italic', '*italic*'],
  ['Highlight', '==highlight=='],
  ['Link', '[label](https://example.com)'],
  ['Wiki link', '[[Note|label]]'],
  ['Image', '![alt](image.png)'],
  ['Task', '- [ ] task'],
  ['Quote', '> quoted text'],
  ['Alert', '> [!NOTE]  /  > Helpful detail'],
  ['Contents', '[toc]'],
  ['Metadata', '---  /  title: Note  /  ---'],
  ['Emoji', ':sparkles:  :rocket:'],
  ['Sub / superscript', 'H~2~O  /  x^2^'],
  ['Footnote', 'Text[^1]  /  [^1]: Note'],
  ['Math', '$x^2$  /  $$x^2$$'],
  ['Mermaid', '```mermaid  graph TD  A-->B  ```'],
] as const;

export function MarkdownCheatSheet({ onClose }: MarkdownCheatSheetProps): React.JSX.Element {
  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="cheat-sheet" role="dialog" aria-modal="true" aria-labelledby="cheat-sheet-title">
        <header>
          <div><span>Reference</span><h2 id="cheat-sheet-title">Markdown cheat sheet</h2></div>
          <button type="button" aria-label="Close cheat sheet" onClick={onClose}>×</button>
        </header>
        <div>
          {EXAMPLES.map(([label, example]) => (
            <article key={label}><strong>{label}</strong><code>{example}</code></article>
          ))}
        </div>
        <footer><button type="button" onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
}

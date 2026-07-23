import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteCommand {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  keywords?: string;
  run(): void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose(): void;
}

function commandScore(command: PaletteCommand, rawQuery: string): number {
  const query = rawQuery.trim().toLocaleLowerCase('en-US');
  if (!query) return 1;
  const label = command.label.toLocaleLowerCase('en-US');
  const haystack = `${label} ${command.detail ?? ''} ${command.keywords ?? ''}`.toLocaleLowerCase('en-US');
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (haystack.includes(query)) return 50;
  let queryIndex = 0;
  for (const character of haystack) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return 20;
  }
  return 0;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const matches = useMemo(() => commands
    .map((command) => ({ command, score: commandScore(command, query) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
    .slice(0, 12), [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // Escape must close the palette even when focus is on a result button.
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const run = (command: PaletteCommand | undefined): void => {
    if (!command) return;
    onClose();
    window.requestAnimationFrame(command.run);
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <span aria-hidden="true">›</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Type a command…"
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant={matches.length > 0 ? `command-option-${selectedIndex}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((value) => Math.min(matches.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(matches[selectedIndex]?.command);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div id="command-results" className="palette-results" role="listbox" aria-label="Commands">
          {matches.length === 0 ? (
            <p>No matching commands</p>
          ) : matches.map(({ command }, index) => (
            <button
              type="button"
              role="option"
              id={`command-option-${index}`}
              aria-selected={index === selectedIndex}
              key={command.id}
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => run(command)}
            >
              <span><strong>{command.label}</strong>{command.detail && <small>{command.detail}</small>}</span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

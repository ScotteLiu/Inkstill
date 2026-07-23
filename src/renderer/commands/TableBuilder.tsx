import { useEffect, useMemo, useRef, useState } from 'react';

type Alignment = 'left' | 'center' | 'right';

interface TableBuilderProps {
  onClose(): void;
  onInsert(markdown: string): void;
}

function separator(alignment: Alignment): string {
  if (alignment === 'center') return ':---:';
  if (alignment === 'right') return '---:';
  return ':---';
}

export function TableBuilder({ onClose, onInsert }: TableBuilderProps): React.JSX.Element {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [columnCount, setColumnCount] = useState(3);
  const [rowCount, setRowCount] = useState(2);
  const [headers, setHeaders] = useState(['Column 1', 'Column 2', 'Column 3']);
  const [alignments, setAlignments] = useState<Alignment[]>(['left', 'left', 'left']);

  useEffect(() => firstInputRef.current?.focus(), []);
  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  useEffect(() => {
    setHeaders((current) => Array.from({ length: columnCount }, (_, index) => current[index] ?? `Column ${index + 1}`));
    setAlignments((current) => Array.from({ length: columnCount }, (_, index) => current[index] ?? 'left'));
  }, [columnCount]);

  const markdown = useMemo(() => {
    const safeHeaders = headers.map((header, index) => (header.trim() || `Column ${index + 1}`).replaceAll('|', '\\|'));
    const header = `| ${safeHeaders.join(' | ')} |`;
    const dividers = `| ${alignments.map(separator).join(' | ')} |`;
    const row = `| ${Array.from({ length: columnCount }, () => ' ').join(' | ')} |`;
    return [header, dividers, ...Array.from({ length: rowCount }, () => row)].join('\n');
  }, [alignments, columnCount, headers, rowCount]);

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="table-builder" role="dialog" aria-modal="true" aria-labelledby="table-builder-title">
        <header>
          <div><span>Insert</span><h2 id="table-builder-title">Build a table</h2></div>
          <button type="button" aria-label="Close table builder" onClick={onClose}>×</button>
        </header>
        <div className="table-builder-size">
          <label>Columns<input ref={firstInputRef} type="number" min="1" max="8" value={columnCount} onChange={(event) => setColumnCount(Math.min(8, Math.max(1, Number(event.target.value) || 1)))} /></label>
          <label>Body rows<input type="number" min="1" max="12" value={rowCount} onChange={(event) => setRowCount(Math.min(12, Math.max(1, Number(event.target.value) || 1)))} /></label>
        </div>
        <div className="table-builder-columns">
          {headers.map((header, index) => (
            <div key={index}>
              <label>
                Header {index + 1}
                <input value={header} onChange={(event) => setHeaders((current) => current.map((value, item) => item === index ? event.target.value : value))} />
              </label>
              <label>
                Alignment
                <select value={alignments[index]} onChange={(event) => setAlignments((current) => current.map((value, item) => item === index ? event.target.value as Alignment : value))}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>
          ))}
        </div>
        <pre aria-label="Markdown table preview">{markdown}</pre>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-action" onClick={() => onInsert(markdown)}>Insert table</button>
        </footer>
      </section>
    </div>
  );
}

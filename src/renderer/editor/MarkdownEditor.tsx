import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
} from '@codemirror/commands';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap,
} from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import type { DocumentSnapshot } from '../../shared/contracts';
import { MAX_DOCUMENT_CHARACTERS } from '../../shared/contracts';
import { EMOJI_SHORTCODES } from '../markdown/emoji';
import { markdownRevealExtension } from './reveal';

export interface MarkdownEditorHandle {
  focus(): void;
  getContent(): string;
  getMetrics(): { characters: number; lines: number };
  isComposing(): boolean;
  openSearch(): void;
  wrapSelection(before: string, after: string, placeholderText?: string): void;
  setHeading(level: 1 | 2 | 3 | 4 | 5 | 6): void;
  prefixLines(prefix: string): void;
  insertSnippet(snippet: string, cursorMarker?: string): void;
  goToLine(lineNumber: number): void;
}

interface MarkdownEditorProps {
  document: DocumentSnapshot;
  sourceMode: boolean;
  largeFileMode: boolean;
  readOnly: boolean;
  lineNumbers: boolean;
  spellcheck: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  hemingwayMode: boolean;
  onChange(): void;
  onSelectionChange(content: string, lineNumber: number): void;
  onOpenCommandPalette(): void;
  onPasteImage(): void;
  onScrollRatio(ratio: number): void;
  onCompositionEnd(): void;
  onLimitExceeded(): void;
}

const revealCompartment = new Compartment();
const appearanceCompartment = new Compartment();
const wrappingCompartment = new Compartment();
const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const accessibilityCompartment = new Compartment();
const lineNumbersCompartment = new Compartment();
const focusCompartment = new Compartment();

function accessibilityAttributes(displayName: string, readOnly: boolean, spellcheck: boolean): Extension {
  return EditorView.contentAttributes.of({
    'aria-label': `Markdown editor: ${displayName}`,
    'aria-readonly': readOnly ? 'true' : 'false',
    spellcheck: spellcheck ? 'true' : 'false',
    autocapitalize: 'sentences',
  });
}

const focusAppearance = EditorView.theme({
  '.cm-line': {
    opacity: '0.24',
    transition: 'opacity 120ms ease',
  },
  '.cm-activeLine': {
    opacity: '1',
  },
});

function emojiCompletion(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/:[a-z0-9_+-]*/i);
  if (!match || (match.from === match.to && !context.explicit)) return null;
  return {
    from: match.from,
    options: Object.entries(EMOJI_SHORTCODES).map(([name, emoji]) => ({
      label: `:${name}:`,
      apply: `:${name}:`,
      detail: emoji,
      type: 'text',
    })),
    validFor: /^:[a-z0-9_+-]*$/i,
  };
}

function wrapRanges(
  view: EditorView,
  before: string,
  after: string,
  placeholderText = 'text',
): boolean {
  if (view.composing || view.compositionStarted) return false;
  const transaction = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const inner = selected || placeholderText;
    const insert = `${before}${inner}${after}`;
    const anchor = range.from + before.length;
    const head = anchor + inner.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, head),
    };
  });
  view.dispatch(transaction);
  view.focus();
  return true;
}

function prefixSelectedLines(view: EditorView, prefix: string): boolean {
  if (view.composing || view.compositionStarted) return false;
  const ranges = view.state.selection.ranges;
  const lineStarts = new Set<number>();
  for (const range of ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
      lineStarts.add(view.state.doc.line(lineNumber).from);
    }
  }
  const starts = [...lineStarts].sort((a, b) => a - b);
  const allPrefixed = starts.every((from) =>
    view.state.sliceDoc(from, Math.min(view.state.doc.length, from + prefix.length)) === prefix);
  view.dispatch({
    changes: starts.map((from) => allPrefixed
      ? { from, to: from + prefix.length, insert: '' }
      : { from, insert: prefix }),
  });
  view.focus();
  return true;
}

function insertSnippetAtSelection(
  view: EditorView,
  snippet: string,
  cursorMarker = '{{cursor}}',
): boolean {
  if (view.composing || view.compositionStarted) return false;
  const markerIndex = snippet.indexOf(cursorMarker);
  const insert = markerIndex >= 0 ? snippet.replace(cursorMarker, '') : snippet;
  const range = view.state.selection.main;
  const anchor = range.from + (markerIndex >= 0 ? markerIndex : insert.length);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor },
  });
  view.focus();
  return true;
}

function setHeadingAtCursor(view: EditorView, level: 1 | 2 | 3 | 4 | 5 | 6): boolean {
  if (view.composing || view.compositionStarted) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const current = view.state.sliceDoc(line.from, line.to);
  const marker = `${'#'.repeat(level)} `;
  const existing = /^(#{1,6})\s+/.exec(current);
  view.dispatch({
    changes: {
      from: line.from,
      to: existing ? line.from + existing[0].length : line.from,
      insert: marker,
    },
  });
  view.focus();
  return true;
}

export function serializedDocumentLength(
  document: { length: number; lines: number },
  eol: '\n' | '\r\n',
): number {
  return document.length + (eol.length - 1) * Math.max(0, document.lines - 1);
}

export function maximumDocumentLengthFilter(
  eol: '\n' | '\r\n',
  onLimitExceeded: () => void,
  maximum = MAX_DOCUMENT_CHARACTERS,
): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    const before = serializedDocumentLength(transaction.startState.doc, eol);
    const after = serializedDocumentLength(transaction.newDoc, eol);
    if (after <= maximum || after <= before) return transaction;
    window.queueMicrotask(onLimitExceeded);
    return [];
  });
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--ink)',
    fontSize: '17px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--editor-font)',
    lineHeight: '1.82',
    overflow: 'auto',
  },
  '.cm-content': {
    width: 'min(100%, var(--editor-width))',
    margin: '0 auto',
    padding: 'clamp(32px, 7vh, 72px) 56px clamp(72px, 14vh, 160px)',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-line.cm-heading': {
    fontFamily: 'var(--display-font)',
    fontWeight: '650',
    letterSpacing: '-0.025em',
    lineHeight: '1.28',
    paddingTop: '0.65em',
    paddingBottom: '0.2em',
  },
  '.cm-line.cm-heading-1': { fontSize: '2.1em' },
  '.cm-line.cm-heading-2': { fontSize: '1.55em' },
  '.cm-line.cm-heading-3': { fontSize: '1.25em' },
  '.cm-line.cm-heading-4, .cm-line.cm-heading-5, .cm-line.cm-heading-6': {
    fontSize: '1.05em',
  },
  '.cm-line.cm-blockquote': {
    borderLeft: '3px solid var(--accent-soft)',
    color: 'var(--ink-muted)',
    paddingLeft: '18px',
  },
  '.cm-line.cm-codeblock': {
    backgroundColor: 'var(--code-bg)',
    fontFamily: 'var(--mono-font)',
    fontSize: '0.88em',
    lineHeight: '1.6',
    paddingLeft: '18px',
    paddingRight: '18px',
  },
  '.cm-line.cm-codeblock:first-of-type': { borderRadius: '10px 10px 0 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-placeholder': { color: 'var(--ink-faint)' },
  '.cm-panels': {
    backgroundColor: 'var(--panel)',
    color: 'var(--ink)',
    borderBottom: '1px solid var(--line)',
  },
  '.cm-search': { padding: '10px 14px' },
  '.cm-search input': {
    border: '1px solid var(--line)',
    borderRadius: '7px',
    background: 'var(--surface)',
    color: 'var(--ink)',
    padding: '5px 8px',
  },
});

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--ink)', fontWeight: '650' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '700' },
  { tag: [tags.strikethrough], textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)', textDecoration: 'underline' },
  {
    tag: [tags.monospace],
    fontFamily: 'var(--mono-font)',
    color: 'var(--code-ink)',
  },
  { tag: [tags.processingInstruction, tags.meta], color: 'var(--syntax)' },
  { tag: tags.comment, color: 'var(--ink-faint)' },
]);

const sourceAppearance = EditorView.theme({
  '.cm-scroller': {
    fontFamily: 'var(--mono-font)',
    lineHeight: '1.62',
  },
  '.cm-content': {
    width: 'min(100%, var(--source-width))',
  },
  '.cm-line.cm-heading, .cm-line.cm-blockquote, .cm-line.cm-codeblock': {
    fontFamily: 'var(--mono-font)',
    fontSize: '1em',
    fontWeight: '400',
    letterSpacing: 'normal',
    lineHeight: '1.62',
    paddingTop: '0',
    paddingBottom: '0',
    paddingLeft: '2px',
    paddingRight: '2px',
    borderLeft: '0',
    borderRadius: '0',
    backgroundColor: 'transparent',
  },
});

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      document,
      sourceMode,
      largeFileMode,
      readOnly,
      lineNumbers: showLineNumbers,
      spellcheck,
      focusMode,
      typewriterMode,
      hemingwayMode,
      onChange,
      onSelectionChange,
      onOpenCommandPalette,
      onPasteImage,
      onScrollRatio,
      onCompositionEnd,
      onLimitExceeded,
    },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onOpenCommandPaletteRef = useRef(onOpenCommandPalette);
    const onPasteImageRef = useRef(onPasteImage);
    const onScrollRatioRef = useRef(onScrollRatio);
    const onCompositionEndRef = useRef(onCompositionEnd);
    const onLimitExceededRef = useRef(onLimitExceeded);
    const sourceModeRef = useRef(sourceMode);
    const typewriterModeRef = useRef(typewriterMode);
    const hemingwayModeRef = useRef(hemingwayMode);

    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onOpenCommandPaletteRef.current = onOpenCommandPalette;
    onPasteImageRef.current = onPasteImage;
    onScrollRatioRef.current = onScrollRatio;
    onCompositionEndRef.current = onCompositionEnd;
    onLimitExceededRef.current = onLimitExceeded;
    sourceModeRef.current = sourceMode;
    typewriterModeRef.current = typewriterMode;
    hemingwayModeRef.current = hemingwayMode;

    useImperativeHandle(forwardedRef, () => ({
      focus: () => viewRef.current?.focus(),
      getContent: () => viewRef.current?.state.sliceDoc() ?? document.content,
      getMetrics: () => ({
        characters: viewRef.current
          ? serializedDocumentLength(viewRef.current.state.doc, document.format.eol)
          : document.content.length,
        lines: viewRef.current?.state.doc.lines ?? 1,
      }),
      isComposing: () => Boolean(
        viewRef.current?.composing || viewRef.current?.compositionStarted,
      ),
      openSearch: () => {
        const view = viewRef.current;
        if (view) openSearchPanel(view);
      },
      wrapSelection(before, after, placeholderText = 'text') {
        const view = viewRef.current;
        if (view) wrapRanges(view, before, after, placeholderText);
      },
      prefixLines(prefix) {
        const view = viewRef.current;
        if (view) prefixSelectedLines(view, prefix);
      },
      insertSnippet(snippet, cursorMarker = '{{cursor}}') {
        const view = viewRef.current;
        if (view) insertSnippetAtSelection(view, snippet, cursorMarker);
      },
      setHeading(level) {
        const view = viewRef.current;
        if (view) setHeadingAtCursor(view, level);
      },
      goToLine(lineNumber) {
        const view = viewRef.current;
        if (!view || lineNumber < 1 || lineNumber > view.state.doc.lines) return;
        const line = view.state.doc.line(lineNumber);
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
        view.focus();
      },
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const state = EditorState.create({
        doc: document.content,
        extensions: [
          EditorState.lineSeparator.of(document.format.eol),
          languageCompartment.of(
            largeFileMode ? [] : markdown({ base: markdownLanguage }),
          ),
          history(),
          drawSelection(),
          dropCursor(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ override: [emojiCompletion], activateOnTyping: true }),
          highlightSelectionMatches(),
          highlightActiveLine(),
          lineNumbersCompartment.of(
            showLineNumbers && !largeFileMode ? lineNumbers() : [],
          ),
          focusCompartment.of(focusMode ? focusAppearance : []),
          wrappingCompartment.of(
            largeFileMode ? [] : EditorView.lineWrapping,
          ),
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          accessibilityCompartment.of(
            accessibilityAttributes(document.displayName, readOnly, spellcheck),
          ),
          placeholder('Start writing…'),
          editorTheme,
          syntaxHighlighting(markdownHighlight),
          keymap.of([
            { key: 'Mod-p', run: () => {
              onOpenCommandPaletteRef.current();
              return true;
            } },
            { key: 'Mod-b', run: (view) => wrapRanges(view, '**', '**') },
            { key: 'Mod-i', run: (view) => wrapRanges(view, '*', '*') },
            { key: 'Mod-k', run: (view) => wrapRanges(view, '[', '](https://)', 'link text') },
            ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
              key: `Mod-Alt-${level}`,
              run: (view: EditorView) => setHeadingAtCursor(view, level),
            })),
            { key: 'Mod-Shift-z', run: redo, preventDefault: true },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...closeBracketsKeymap,
            ...searchKeymap,
          ]),
          revealCompartment.of(
            sourceModeRef.current || largeFileMode
              ? []
              : markdownRevealExtension(),
          ),
          appearanceCompartment.of(
            sourceModeRef.current || largeFileMode ? sourceAppearance : [],
          ),
          maximumDocumentLengthFilter(
            document.format.eol,
            () => onLimitExceededRef.current(),
          ),
          EditorView.domEventHandlers({
            paste: (event) => {
              const types = [...(event.clipboardData?.types ?? [])];
              if (!types.some((type) => type.startsWith('image/') || type === 'Files')) return false;
              event.preventDefault();
              onPasteImageRef.current();
              return true;
            },
            keydown: (event) => {
              if (
                hemingwayModeRef.current &&
                (event.key === 'Backspace' || event.key === 'Delete')
              ) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            compositionend: () => {
              window.queueMicrotask(() => onCompositionEndRef.current());
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current();
            if (update.viewportChanged) {
              const maximum = update.view.scrollDOM.scrollHeight - update.view.scrollDOM.clientHeight;
              const ratio = update.view.viewport.from === 0
                ? 0
                : update.view.viewport.to === update.state.doc.length
                  ? 1
                  : maximum > 0 ? update.view.scrollDOM.scrollTop / maximum : 0;
              onScrollRatioRef.current(ratio);
            }
            if (update.selectionSet || update.docChanged) {
              const selected = update.state.selection.ranges
                .filter((range) => !range.empty)
                .map((range) => update.state.sliceDoc(range.from, range.to))
                .join('\n');
              onSelectionChangeRef.current(
                selected,
                update.state.doc.lineAt(update.state.selection.main.head).number,
              );
            }
            if (typewriterModeRef.current && update.selectionSet) {
              const head = update.state.selection.main.head;
              window.requestAnimationFrame(() => {
                if (viewRef.current === update.view) {
                  update.view.dispatch({
                    effects: EditorView.scrollIntoView(head, { y: 'center' }),
                  });
                }
              });
            }
          }),
        ],
      });

      const view = new EditorView({ state, parent: host });
      viewRef.current = view;
      view.focus();

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, [document.id]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: revealCompartment.reconfigure(
          sourceMode || largeFileMode ? [] : markdownRevealExtension(),
        ),
      });
      view.dispatch({
        effects: appearanceCompartment.reconfigure(
          sourceMode || largeFileMode ? sourceAppearance : [],
        ),
      });
      view.dispatch({
        effects: wrappingCompartment.reconfigure(
          largeFileMode ? [] : EditorView.lineWrapping,
        ),
      });
      view.dispatch({
        effects: languageCompartment.reconfigure(
          largeFileMode ? [] : markdown({ base: markdownLanguage }),
        ),
      });
      view.dispatch({
        effects: lineNumbersCompartment.reconfigure(
          showLineNumbers && !largeFileMode ? lineNumbers() : [],
        ),
      });
    }, [sourceMode, largeFileMode, showLineNumbers]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: focusCompartment.reconfigure(focusMode ? focusAppearance : []),
      });
    }, [focusMode]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: [
          readOnlyCompartment.reconfigure([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          accessibilityCompartment.reconfigure(
            accessibilityAttributes(document.displayName, readOnly, spellcheck),
          ),
        ],
      });
    }, [document.displayName, readOnly, spellcheck]);

    return (
      <div
        ref={hostRef}
        className="editor-host"
      />
    );
  },
);

import { syntaxTree } from '@codemirror/language';
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';

export interface TextRange {
  from: number;
  to: number;
}

export interface LineStyleRange extends TextRange {
  className: string;
}

export interface RevealModel {
  hiddenRanges: TextRange[];
  lineStyles: LineStyleRange[];
}

interface CollectOptions {
  from?: number;
  to?: number;
  revealAll?: boolean;
}

interface LineInterval {
  from: number;
  to: number;
}

const headingPattern = /^ATXHeading([1-6])$/;

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

function activeLineIntervals(state: EditorState): LineInterval[] {
  const intervals: LineInterval[] = [];
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const endPosition = range.empty ? range.to : Math.max(range.from, range.to - 1);
    const end = state.doc.lineAt(endPosition).number;
    intervals.push({ from: start, to: end });
  }

  intervals.sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: LineInterval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, interval.to);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function nodeTouchesActiveLine(
  state: EditorState,
  node: SyntaxNode,
  activeLines: readonly LineInterval[],
): boolean {
  const start = state.doc.lineAt(node.from).number;
  const end = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
  for (const interval of activeLines) {
    if (interval.from > end) return false;
    if (interval.to >= start) return true;
  }
  return false;
}

function addDirectMarkers(
  node: SyntaxNode,
  markerName: string,
  expectedMinimum: number,
  target: TextRange[],
): void {
  const markers = childrenOf(node).filter((child) => child.name === markerName);
  if (markers.length < expectedMinimum) return;
  for (const marker of markers) target.push({ from: marker.from, to: marker.to });
}

function addLinkMarkers(node: SyntaxNode, target: TextRange[]): void {
  const children = childrenOf(node);
  const markers = children.filter((child) => child.name === 'LinkMark');
  const hasInlineDestination = children.some((child) => child.name === 'URL');
  if (markers.length < 4 || !hasInlineDestination) return;

  const labelStart = markers[0].to;
  const labelEnd = markers[1].from;
  if (labelStart > node.from) target.push({ from: node.from, to: labelStart });
  if (node.to > labelEnd) target.push({ from: labelEnd, to: node.to });
}

function uniqueSortedRanges(ranges: TextRange[]): TextRange[] {
  const unique = new Map<string, TextRange>();
  for (const range of ranges) {
    if (range.from >= range.to) continue;
    unique.set(`${range.from}:${range.to}`, range);
  }
  return [...unique.values()].sort((left, right) => left.from - right.from || left.to - right.to);
}

function uniqueSortedLineStyles(ranges: LineStyleRange[]): LineStyleRange[] {
  const unique = new Map<string, LineStyleRange>();
  for (const range of ranges) {
    unique.set(`${range.from}:${range.className}`, range);
  }
  return [...unique.values()].sort(
    (left, right) => left.from - right.from || left.className.localeCompare(right.className),
  );
}

export function collectRevealModel(
  state: EditorState,
  options: CollectOptions = {},
): RevealModel {
  const hiddenRanges: TextRange[] = [];
  const lineStyles: LineStyleRange[] = [];
  const activeLines = activeLineIntervals(state);
  const from = Math.max(0, Math.min(options.from ?? 0, state.doc.length));
  const to = Math.max(from, Math.min(options.to ?? state.doc.length, state.doc.length));
  const firstVisibleLine = state.doc.lineAt(from).number;
  const lastVisiblePosition = to > from ? to - 1 : to;
  const lastVisibleLine = state.doc.lineAt(lastVisiblePosition).number;

  syntaxTree(state).iterate({
    from,
    to,
    enter(reference) {
      const node = reference.node;
      if (node.name === 'Image') return false;

      const heading = headingPattern.exec(node.name);
      if (heading) {
        const line = state.doc.lineAt(node.from);
        if (line.number >= firstVisibleLine && line.number <= lastVisibleLine) {
          lineStyles.push({
            from: line.from,
            to: line.from,
            className: `cm-heading cm-heading-${heading[1]}`,
          });
        }

        if (!options.revealAll && !nodeTouchesActiveLine(state, node, activeLines)) {
          addDirectMarkers(node, 'HeaderMark', 1, hiddenRanges);
        }
        return;
      } else if (node.name === 'Blockquote') {
        const first = Math.max(state.doc.lineAt(node.from).number, firstVisibleLine);
        const last = Math.min(
          state.doc.lineAt(Math.max(node.from, node.to - 1)).number,
          lastVisibleLine,
        );
        for (let number = first; number <= last; number += 1) {
          const line = state.doc.line(number);
          lineStyles.push({ from: line.from, to: line.from, className: 'cm-blockquote' });
        }
        return;
      } else if (node.name === 'QuoteMark') {
        let parent = node.parent;
        while (parent && parent.name !== 'Blockquote') parent = parent.parent;
        if (parent && !options.revealAll && !nodeTouchesActiveLine(state, parent, activeLines)) {
          hiddenRanges.push({ from: node.from, to: node.to });
        }
        return;
      } else if (node.name === 'FencedCode') {
        const first = Math.max(state.doc.lineAt(node.from).number, firstVisibleLine);
        const last = Math.min(
          state.doc.lineAt(Math.max(node.from, node.to - 1)).number,
          lastVisibleLine,
        );
        for (let number = first; number <= last; number += 1) {
          const line = state.doc.line(number);
          lineStyles.push({ from: line.from, to: line.from, className: 'cm-codeblock' });
        }
        return;
      }

      const supported =
        node.name === 'StrongEmphasis' ||
        node.name === 'Emphasis' ||
        node.name === 'Strikethrough' ||
        node.name === 'InlineCode' ||
        node.name === 'Link';
      if (
        !supported ||
        options.revealAll ||
        nodeTouchesActiveLine(state, node, activeLines)
      ) return;

      if (node.name === 'StrongEmphasis' || node.name === 'Emphasis') {
        addDirectMarkers(node, 'EmphasisMark', 2, hiddenRanges);
      } else if (node.name === 'Strikethrough') {
        addDirectMarkers(node, 'StrikethroughMark', 2, hiddenRanges);
      } else if (node.name === 'InlineCode') {
        addDirectMarkers(node, 'CodeMark', 2, hiddenRanges);
      } else if (node.name === 'Link') {
        addLinkMarkers(node, hiddenRanges);
      }
    },
  });

  return {
    hiddenRanges: uniqueSortedRanges(hiddenRanges),
    lineStyles: uniqueSortedLineStyles(lineStyles),
  };
}

export const setImeReveal = StateEffect.define<boolean>();

const imeRevealField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setImeReveal)) value = effect.value;
    }
    return value;
  },
});

interface BuiltDecorations {
  all: DecorationSet;
  hidden: DecorationSet;
}

function buildDecorations(view: EditorView): BuiltDecorations {
  const allRanges: ReturnType<Decoration['range']>[] = [];
  const hiddenRanges: ReturnType<Decoration['range']>[] = [];
  const hiddenModelRanges: TextRange[] = [];
  const lineStyleRanges: LineStyleRange[] = [];
  const revealAll =
    view.state.field(imeRevealField, false) === true ||
    view.compositionStarted ||
    view.composing;

  for (const visible of view.visibleRanges) {
    const model = collectRevealModel(view.state, {
      from: visible.from,
      to: visible.to,
      revealAll,
    });
    hiddenModelRanges.push(...model.hiddenRanges);
    lineStyleRanges.push(...model.lineStyles);
  }

  const hiddenMark = Decoration.replace({
    inclusive: false,
    block: false,
  });
  for (const range of uniqueSortedRanges(hiddenModelRanges)) {
    const decoration = hiddenMark.range(range.from, range.to);
    allRanges.push(decoration);
    hiddenRanges.push(decoration);
  }

  for (const style of uniqueSortedLineStyles(lineStyleRanges)) {
    allRanges.push(
      Decoration.line({ attributes: { class: style.className } }).range(style.from),
    );
  }

  return {
    all: Decoration.set(allRanges, true),
    hidden: Decoration.set(hiddenRanges, true),
  };
}

const imeCloseDelayMs = 60;

class RevealView {
  decorations: DecorationSet;
  hidden: DecorationSet;
  private tree: Tree;
  private composing: boolean;
  private imeGeneration = 0;
  private imeCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(view: EditorView) {
    this.tree = syntaxTree(view.state);
    this.composing = view.compositionStarted || view.composing;
    const built = buildDecorations(view);
    this.decorations = built.all;
    this.hidden = built.hidden;
  }

  update(update: ViewUpdate): void {
    const imeChanged = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(setImeReveal)),
    );
    const tree = syntaxTree(update.state);
    const composing = update.view.compositionStarted || update.view.composing;
    const compositionChanged = composing !== this.composing;
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      imeChanged ||
      tree !== this.tree ||
      compositionChanged
    ) {
      this.tree = tree;
      this.composing = composing;
      const built = buildDecorations(update.view);
      this.decorations = built.all;
      this.hidden = built.hidden;
    }
  }

  startIme(view: EditorView): void {
    this.imeGeneration += 1;
    if (this.imeCloseTimer !== null) {
      clearTimeout(this.imeCloseTimer);
      this.imeCloseTimer = null;
    }
    if (view.state.field(imeRevealField, false) !== true) {
      view.dispatch({ effects: setImeReveal.of(true) });
    }
  }

  finishImeSoon(view: EditorView): void {
    if (view.state.field(imeRevealField, false) !== true) return;

    const generation = ++this.imeGeneration;
    if (this.imeCloseTimer !== null) clearTimeout(this.imeCloseTimer);
    this.imeCloseTimer = setTimeout(() => {
      this.imeCloseTimer = null;
      if (
        generation !== this.imeGeneration ||
        view.compositionStarted ||
        view.composing ||
        view.state.field(imeRevealField, false) !== true
      ) return;
      view.dispatch({ effects: setImeReveal.of(false) });
    }, imeCloseDelayMs);
  }

  destroy(): void {
    if (this.imeCloseTimer !== null) clearTimeout(this.imeCloseTimer);
  }
}

export const revealPlugin = ViewPlugin.fromClass(RevealView, {
  decorations: (value) => value.decorations,
  eventHandlers: {
    compositionstart(_event, view) {
      this.startIme(view);
      return false;
    },
    compositionend(_event, view) {
      this.finishImeSoon(view);
      return false;
    },
    blur(_event, view) {
      this.finishImeSoon(view);
      return false;
    },
  },
});

export function markdownRevealExtension(): Extension {
  return [
    imeRevealField,
    revealPlugin,
    EditorView.atomicRanges.of(
      (view) => view.plugin(revealPlugin)?.hidden ?? Decoration.none,
    ),
  ];
}

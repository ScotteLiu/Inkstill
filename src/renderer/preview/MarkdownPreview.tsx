import { useEffect, useMemo, useRef, useState } from 'react';

import { renderMarkdown } from './renderMarkdown';

interface MarkdownPreviewProps {
  content: string;
  documentId: string;
  scrollRatio?: number;
  onOpenExternal?(href: string): void;
  onOpenWikiLink?(target: string): void;
}

let diagramSequence = 0;
let mermaidPromise: Promise<(typeof import('mermaid'))['default']> | null = null;
const PREVIEW_UPDATE_DELAY_MS = 80;
const LARGE_PREVIEW_UPDATE_DELAY_MS = 180;
const LARGE_PREVIEW_THRESHOLD = 500_000;

function loadMermaid(): Promise<(typeof import('mermaid'))['default']> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      const preference = document.documentElement.dataset.theme;
      const dark = preference === 'dark'
        || (preference !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: dark ? 'dark' : 'neutral',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function MarkdownPreview({
  content,
  documentId,
  scrollRatio = 0,
  onOpenExternal,
  onOpenWikiLink,
}: MarkdownPreviewProps): React.JSX.Element {
  const hostRef = useRef<HTMLElement>(null);
  const [renderedSource, setRenderedSource] = useState({ content, documentId });
  const source = renderedSource.documentId === documentId
    ? renderedSource.content
    : content;
  const html = useMemo(() => renderMarkdown(source), [source]);

  useEffect(() => {
    if (renderedSource.documentId !== documentId) {
      setRenderedSource({ content, documentId });
      return;
    }
    if (renderedSource.content === content) return;
    const delay = content.length >= LARGE_PREVIEW_THRESHOLD
      ? LARGE_PREVIEW_UPDATE_DELAY_MS
      : PREVIEW_UPDATE_DELAY_MS;
    const timer = window.setTimeout(() => {
      setRenderedSource({ content, documentId });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [content, documentId, renderedSource.content, renderedSource.documentId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const frame = window.requestAnimationFrame(() => {
      const maximum = host.scrollHeight - host.clientHeight;
      host.scrollTop = Math.max(0, Math.min(1, scrollRatio)) * Math.max(0, maximum);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [html, scrollRatio]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let canceled = false;
    const diagrams = [...host.querySelectorAll<HTMLElement>('.mermaid[data-mermaid]')];
    if (diagrams.length === 0) return;
    void (async () => {
      let mermaid: (typeof import('mermaid'))['default'];
      try {
        mermaid = await loadMermaid();
      } catch {
        for (const diagram of diagrams) {
          diagram.classList.add('diagram-error');
          diagram.textContent = 'Unable to load the Mermaid renderer.';
        }
        return;
      }
      for (const diagram of diagrams) {
        const source = diagram.textContent ?? '';
        try {
          const id = `inkstill-diagram-${++diagramSequence}`;
          const result = await mermaid.render(id, source, diagram);
          if (canceled || !diagram.isConnected) return;
          diagram.innerHTML = result.svg;
          result.bindFunctions?.(diagram);
          diagram.removeAttribute('data-mermaid');
        } catch {
          if (!canceled) {
            diagram.classList.add('diagram-error');
            diagram.textContent = 'Unable to render this Mermaid diagram.';
          }
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [html]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let canceled = false;
    const images = [...host.querySelectorAll<HTMLImageElement>('img[src]')];
    void Promise.all(images.map(async (image) => {
      const source = image.getAttribute('src') ?? '';
      if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return;
      try {
        const asset = await window.desktop.readLocalAsset({
          documentId,
          relativePath: source,
        });
        if (!canceled && image.isConnected) {
          image.src = `data:${asset.mimeType};base64,${asset.base64}`;
        }
      } catch {
        if (!canceled) image.classList.add('missing-image');
      }
    }));
    return () => {
      canceled = true;
    };
  }, [documentId, html]);

  return (
    <article
      ref={hostRef}
      className="markdown-preview"
      aria-label="Rendered Markdown preview"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
        if (!anchor) return;
        const wikiTarget = anchor.dataset.wikilink;
        if (wikiTarget) {
          event.preventDefault();
          onOpenWikiLink?.(wikiTarget);
          return;
        }
        const rawHref = anchor.getAttribute('href') ?? '';
        if (rawHref.startsWith('#')) {
          event.preventDefault();
          const id = decodeURIComponent(rawHref.slice(1));
          if (id) hostRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          else hostRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (anchor.dataset.external === 'true') {
          event.preventDefault();
          onOpenExternal?.(anchor.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

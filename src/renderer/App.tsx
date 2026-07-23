import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type {
  DocumentSnapshot,
  ExternalChangeEvent,
  MenuCommand,
  RecoveryListResult,
  RecoveryReceipt,
  RecoverySummary,
  SaveConflict,
  WorkspaceMention,
  WorkspaceSearchResult,
  WorkspaceSnapshot,
} from '../shared/contracts';
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from './editor/MarkdownEditor';
import { analyzeDocument, countWords, type DocumentStats, type HeadingItem } from './editor/documentStats';
import { CommandPalette, type PaletteCommand } from './commands/CommandPalette';
import { MarkdownCheatSheet } from './commands/MarkdownCheatSheet';
import { TableBuilder } from './commands/TableBuilder';
import { MarkdownPreview } from './preview/MarkdownPreview';

const OUTLINE_ANALYSIS_LIMIT = 2_000_000;
const LONG_LINE_LIMIT = 100_000;

type WorkspaceView = 'editor' | 'split' | 'preview';

interface EditorPreferences {
  theme: 'system' | 'light' | 'dark';
  editorWidth: 'narrow' | 'comfortable' | 'wide';
  lineNumbers: boolean;
  spellcheck: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  hemingwayMode: boolean;
  writingGoal: number;
}

interface OpenDocumentTab {
  document: DocumentSnapshot;
  pendingEolConversion: '\n' | '\r\n' | null;
  lastRecoveryRevision: number;
}

interface DocumentTabSummary {
  id: string;
  displayName: string;
  path: string | null;
  dirty: boolean;
  externalChanged: boolean;
}

const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  theme: 'system',
  editorWidth: 'comfortable',
  lineNumbers: false,
  spellcheck: true,
  focusMode: false,
  typewriterMode: false,
  hemingwayMode: false,
  writingGoal: 0,
};

function loadEditorPreferences(): EditorPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem('inkstill.editor-preferences') ?? '{}') as Partial<EditorPreferences>;
    return {
      theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : 'system',
      editorWidth: stored.editorWidth === 'narrow' || stored.editorWidth === 'wide' ? stored.editorWidth : 'comfortable',
      lineNumbers: Boolean(stored.lineNumbers),
      spellcheck: stored.spellcheck !== false,
      focusMode: Boolean(stored.focusMode),
      typewriterMode: Boolean(stored.typewriterMode),
      hemingwayMode: Boolean(stored.hemingwayMode),
      writingGoal: Number.isFinite(stored.writingGoal) ? Math.max(0, Math.floor(stored.writingGoal ?? 0)) : 0,
    };
  } catch {
    return DEFAULT_EDITOR_PREFERENCES;
  }
}

type DisplayDocumentStats = Omit<DocumentStats, 'words'> & { words: number | null };

type ConflictState = SaveConflict | ExternalChangeEvent;

function isSaveConflict(conflict: ConflictState): conflict is SaveConflict {
  return 'status' in conflict && conflict.status === 'conflict';
}

function normalizeLineEndings(content: string, eol: '\n' | '\r\n'): string {
  return content.replace(/\r\n|\r|\n/g, eol);
}

function requiresLargeFileMode(content: string): boolean {
  if (content.length > OUTLINE_ANALYSIS_LIMIT) return true;
  let lineStart = 0;
  while (lineStart < content.length) {
    const lineEnd = content.indexOf('\n', lineStart);
    if ((lineEnd === -1 ? content.length : lineEnd) - lineStart > LONG_LINE_LIMIT) {
      return true;
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  return false;
}

function recoveryStatusLabel(recovery: RecoverySummary): string {
  const labels = {
    untracked: 'Never saved',
    unchecked: 'Source not checked',
    unchanged: 'Source unchanged',
    changed: 'Source changed',
    missing: 'Source removed',
    unreadable: 'Source unreadable',
  } as const;
  return labels[recovery.diskStatus];
}

function formatRecoveryTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function useDialogFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  busy: boolean,
): void {
  const onEscapeRef = useRef(onEscape);
  const busyRef = useRef(busy);
  onEscapeRef.current = onEscape;
  busyRef.current = busy;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [dialogRef]);
}

function ToolbarButton({
  label,
  title,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
}): React.JSX.Element {
  return (
    <button
      className={`toolbar-button${active ? ' is-active' : ''}`}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function RecoveryPanel({
  index,
  busyId,
  onRestore,
  onDiscard,
  onLater,
  error,
}: {
  index: RecoveryListResult;
  busyId: string | null;
  onRestore(recovery: RecoverySummary): void;
  onDiscard(recovery: RecoverySummary): void;
  onLater(): void;
  error: string | null;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocusTrap(dialogRef, onLater, busyId !== null);
  return (
    <section ref={dialogRef} className="recovery-panel" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <header>
        <span className="recovery-symbol" aria-hidden="true">↺</span>
        <div>
          <h1 id="recovery-title">Unsaved drafts</h1>
          <p>Restored drafts open as new documents.</p>
        </div>
      </header>

      {index.quarantinedCount > 0 && (
        <p className="quarantine-note" role="status">
          Unable to recover {index.quarantinedCount} draft{index.quarantinedCount === 1 ? '' : 's'}.
        </p>
      )}
      {index.skippedCount > 0 && (
        <p className="quarantine-note" role="status">
          {index.skippedCount} older draft{index.skippedCount === 1 ? ' is' : 's are'} not shown.
        </p>
      )}
      {error && <p className="quarantine-note" role="alert">{error}</p>}

      <div className="recovery-list">
        {index.recoveries.map((recovery) => (
          <article className="recovery-card" key={recovery.recoveryId}>
            <div className="recovery-card-title">
              <strong>{recovery.displayName}</strong>
              <span className={`disk-state is-${recovery.diskStatus}`}>
                {recoveryStatusLabel(recovery)}
              </span>
            </div>
            <p className="recovery-preview">{recovery.preview}</p>
            <div className="recovery-meta">
              <span>{formatRecoveryTime(recovery.updatedAt)}</span>
              <span>
                {recovery.characterCount.toLocaleString('en-US')} {recovery.characterCount === 1 ? 'character' : 'characters'}
              </span>
              {recovery.sourcePath && <span className="recovery-path" title={recovery.sourcePath}>{recovery.sourcePath}</span>}
            </div>
            <div className="recovery-actions">
              <button
                className="primary-action"
                type="button"
                disabled={busyId !== null}
                onClick={() => onRestore(recovery)}
              >
                {busyId === recovery.recoveryId ? 'Restoring…' : 'Restore'}
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => onDiscard(recovery)}
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>

      <footer>
        <button type="button" disabled={busyId !== null} onClick={onLater}>
          Later
        </button>
      </footer>
    </section>
  );
}

function ConflictReview({
  conflict,
  onClose,
  onSaveAs,
  onReload,
  busy,
}: {
  conflict: SaveConflict;
  onClose(): void;
  onSaveAs(): void;
  onReload(): void;
  busy: boolean;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocusTrap(dialogRef, onClose, busy);
  const clip = (value: string | null): string => {
    if (value === null) return '(Disk file removed)';
    return value.length > 20_000
      ? `${value.slice(0, 20_000)}\n\n…Preview truncated…`
      : value;
  };

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} className="conflict-review" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <header>
          <div>
            <h2 id="conflict-title">Compare versions</h2>
          </div>
          <button type="button" disabled={busy} onClick={onClose}>Close</button>
        </header>
        <div className="conflict-columns">
          <article><strong>Base version</strong><pre tabIndex={0} aria-label="Base version content">{clip(conflict.baseContent)}</pre></article>
          <article><strong>Current edits</strong><pre tabIndex={0} aria-label="Current edited content">{clip(conflict.localContent)}</pre></article>
          <article><strong>Disk version</strong><pre tabIndex={0} aria-label="Disk version content">{clip(conflict.externalContent)}</pre></article>
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>Continue editing</button>
          <button type="button" disabled={busy} onClick={onReload}>Use disk version</button>
          <button className="primary-action" type="button" disabled={busy} onClick={onSaveAs}>Save current version as…</button>
        </footer>
      </section>
    </div>
  );
}

export default function App(): React.JSX.Element {
  const shortcutModifier = window.desktop.platform === 'darwin' ? '⌘' : 'Ctrl';
  const optionModifier = window.desktop.platform === 'darwin' ? '⌥' : 'Alt';
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const currentDocumentRef = useRef<DocumentSnapshot | null>(null);
  const tabsRef = useRef(new Map<string, OpenDocumentTab>());
  const externalChangesRef = useRef(new Map<string, ExternalChangeEvent>());
  const documentIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const contentRef = useRef('');
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const saveInFlightRef = useRef(0);
  const recoveryInFlightRef = useRef(0);
  const savingRef = useRef(false);
  const commandHandlerRef = useRef<(command: MenuCommand) => void>(() => undefined);
  const analysisTimerRef = useRef<number | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const lastRecoveryRevisionRef = useRef(-1);
  const pendingEolConversionRef = useRef<'\n' | '\r\n' | null>(null);
  const transitioningRef = useRef(false);
  const largeFileModeRef = useRef(false);
  const mixedDecisionPendingRef = useRef(false);
  const eolGateRef = useRef<HTMLElement>(null);
  const workspaceSearchRef = useRef<HTMLInputElement>(null);

  const [document, setDocument] = useState<DocumentSnapshot | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('editor');
  const workspaceViewRef = useRef<WorkspaceView>('editor');
  const [previewContent, setPreviewContent] = useState('');
  const [previewScrollRatio, setPreviewScrollRatio] = useState(0);
  const [editorPreferences, setEditorPreferences] = useState<EditorPreferences>(loadEditorPreferences);
  const [writingToolsOpen, setWritingToolsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [tableBuilderOpen, setTableBuilderOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [sidebarPanel, setSidebarPanel] = useState<'files' | 'outline' | 'links'>('outline');
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [outlineQuery, setOutlineQuery] = useState('');
  const [activeEditorLine, setActiveEditorLine] = useState(1);
  const [workspaceResults, setWorkspaceResults] = useState<WorkspaceSearchResult[]>([]);
  const [workspaceMentions, setWorkspaceMentions] = useState<WorkspaceMention[]>([]);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [tabs, setTabs] = useState<DocumentTabSummary[]>([]);
  const [largeFileMode, setLargeFileMode] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [needsEolChoice, setNeedsEolChoice] = useState(false);
  const [status, setStatus] = useState('Preparing…');
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [conflictReviewOpen, setConflictReviewOpen] = useState(false);
  const [blockedSave, setBlockedSave] = useState<{ saveAs: boolean; suggestedEol: '\n' | '\r\n' } | null>(null);
  const [stats, setStats] = useState<DisplayDocumentStats>(() => analyzeDocument(''));
  const [selectionStats, setSelectionStats] = useState<{ characters: number; words: number } | null>(null);
  const [recoveryIndex, setRecoveryIndex] = useState<RecoveryListResult | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryBusyId, setRecoveryBusyId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mixedDecisionPending, setMixedDecisionPending] = useState(false);
  const [safetyFault, setSafetyFault] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem('inkstill.editor-preferences', JSON.stringify(editorPreferences));
    } catch {
      // Preferences are optional; document editing must continue if storage is unavailable.
    }
  }, [editorPreferences]);

  useEffect(() => {
    window.document.documentElement.dataset.theme = editorPreferences.theme;
    window.document.documentElement.dataset.editorWidth = editorPreferences.editorWidth;
  }, [editorPreferences.editorWidth, editorPreferences.theme]);

  useEffect(() => {
    workspaceViewRef.current = workspaceView;
  }, [workspaceView]);

  useEffect(() => {
    const handleApplicationShortcut = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      const overlaysOpen = recoveryOpen || conflictReviewOpen || cheatSheetOpen || commandPaletteOpen || tableBuilderOpen;
      if (event.key === 'F1' && !overlaysOpen) {
        event.preventDefault();
        event.stopPropagation();
        commandHandlerRef.current('cheat-sheet');
        return;
      }
      if (!modifier || event.altKey || overlaysOpen) return;
      const command = event.shiftKey
        ? ({ o: 'open-workspace', s: 'save-as', f: 'find-workspace', e: 'export-pdf' } as const)[key]
        : ({ n: 'new', o: 'open', s: 'save', p: 'command-palette', f: 'find', t: 'insert-table', '/': 'toggle-source', '1': 'view-editor', '2': 'view-split', '3': 'view-preview' } as const)[key];
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      commandHandlerRef.current(command);
    };
    window.addEventListener('keydown', handleApplicationShortcut, true);
    return () => window.removeEventListener('keydown', handleApplicationShortcut, true);
  }, [cheatSheetOpen, commandPaletteOpen, conflictReviewOpen, recoveryOpen, tableBuilderOpen]);

  useEffect(() => {
    currentDocumentRef.current = document;
  }, [document]);

  const beginTransition = useCallback((): boolean => {
    if (transitioningRef.current) return false;
    transitioningRef.current = true;
    setTransitioning(true);
    return true;
  }, []);

  const endTransition = useCallback((): void => {
    transitioningRef.current = false;
    setTransitioning(false);
  }, []);

  const getCurrentContent = useCallback((): string => {
    const content = editorRef.current?.getContent() ?? contentRef.current;
    contentRef.current = content;
    return content;
  }, []);

  const syncTabs = useCallback((): void => {
    setTabs([...tabsRef.current.values()].map((tab) => ({
      id: tab.document.id,
      displayName: tab.document.displayName,
      path: tab.document.path,
      dirty: tab.document.revision > tab.document.savedRevision,
      externalChanged: externalChangesRef.current.has(tab.document.id),
    })));
  }, []);

  const captureCurrentTab = useCallback((): void => {
    const current = currentDocumentRef.current;
    const documentId = documentIdRef.current;
    if (!current || !documentId) return;
    tabsRef.current.set(documentId, {
      document: {
        ...current,
        content: getCurrentContent(),
        revision: revisionRef.current,
        savedRevision: savedRevisionRef.current,
      },
      pendingEolConversion: pendingEolConversionRef.current,
      lastRecoveryRevision: lastRecoveryRevisionRef.current,
    });
    syncTabs();
  }, [getCurrentContent, syncTabs]);

  const flushCurrentRecovery = useCallback(async (): Promise<RecoveryReceipt | null> => {
    const documentId = documentIdRef.current;
    if (!documentId || !dirtyRef.current) return null;
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition first');
      return null;
    }
    recoveryInFlightRef.current += 1;
    try {
      for (;;) {
        const revision = revisionRef.current;
        const content = getCurrentContent();
        const receipt = await window.desktop.writeRecovery({
          documentId,
          content,
          revision,
          eolConversion: pendingEolConversionRef.current ?? undefined,
        });
        if (documentIdRef.current !== documentId) return null;
        lastRecoveryRevisionRef.current = Math.max(
          lastRecoveryRevisionRef.current,
          receipt.revision,
        );
        if (
          revisionRef.current === revision &&
          getCurrentContent() === content
        ) {
          setSafetyFault(null);
          return receipt;
        }
      }
    } catch {
      setSafetyFault('Save this document as a new file now.');
      setStatus('Unable to preserve the draft; save it as a new file now');
      return null;
    } finally {
      recoveryInFlightRef.current -= 1;
    }
  }, [getCurrentContent]);

  const activateDocument = useCallback(async (
    next: DocumentSnapshot,
    options?: { status?: string; recoveryAlreadyWritten?: boolean },
  ): Promise<void> => {
    const previousId = documentIdRef.current;
    if (previousId && previousId !== next.id) {
      if (dirtyRef.current && !(await flushCurrentRecovery())) {
        throw new Error('Unable to preserve the draft; document switch canceled.');
      }
      captureCurrentTab();
    }

    const stored = tabsRef.current.get(next.id);
    documentIdRef.current = next.id;
    contentRef.current = next.content;
    revisionRef.current = next.revision;
    savedRevisionRef.current = next.savedRevision;
    dirtyRef.current = next.revision > next.savedRevision;
    lastRecoveryRevisionRef.current = options?.recoveryAlreadyWritten
      ? next.revision
      : stored?.lastRecoveryRevision ?? -1;
    pendingEolConversionRef.current = stored?.pendingEolConversion ?? null;

    currentDocumentRef.current = next;
    tabsRef.current.set(next.id, {
      document: next,
      pendingEolConversion: pendingEolConversionRef.current,
      lastRecoveryRevision: lastRecoveryRevisionRef.current,
    });
    syncTabs();
    setDocument(next);
    setPreviewContent(next.content);
    setPreviewScrollRatio(0);
    setSelectionStats(null);
    setActiveEditorLine(1);
    setDirtyState(dirtyRef.current);
    setStats(
      next.content.length <= OUTLINE_ANALYSIS_LIMIT
        ? analyzeDocument(next.content)
        : {
            characters: next.content.length,
            words: null,
            lines: next.content.split(/\r\n|\r|\n/).length,
            headings: [],
          },
    );
    largeFileModeRef.current = requiresLargeFileMode(next.content);
    setLargeFileMode(largeFileModeRef.current);
    setNeedsEolChoice(next.format.mixedEol);
    setEditorRevision((value) => value + 1);
    setConflict(externalChangesRef.current.get(next.id) ?? null);
    setConflictReviewOpen(false);
    setBlockedSave(null);
    setStatus(options?.status ?? (next.path ? 'Opened' : 'New document'));
  }, [captureCurrentTab, flushCurrentRecovery, syncTabs]);

  const saveDocument = useCallback(async (
    saveAs = false,
    explicitEol?: '\n' | '\r\n',
  ): Promise<boolean> => {
    const documentId = documentIdRef.current;
    if (!documentId) return false;
    if (savingRef.current) {
      setStatus('Save already in progress…');
      return false;
    }
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition before saving');
      return false;
    }

    const revision = revisionRef.current;
    const content = getCurrentContent();
    const eolConversion = explicitEol ?? pendingEolConversionRef.current ?? undefined;
    savingRef.current = true;
    saveInFlightRef.current += 1;
    setSaving(true);
    setStatus('Saving…');

    try {
      const request = { documentId, content, revision, eolConversion };
      const result = saveAs
        ? await window.desktop.saveDocumentAs(request)
        : await window.desktop.saveDocument(request);

      if (documentIdRef.current !== documentId) return false;

      if (result.status === 'saved') {
        savedRevisionRef.current = Math.max(
          savedRevisionRef.current,
          result.savedRevision,
        );
        const fullySaved = revisionRef.current <= result.savedRevision;
        const shouldResetEditor = fullySaved && (
          result.document.content !== content ||
          result.document.format.eol !== document?.format.eol ||
          result.document.format.mixedEol !== document?.format.mixedEol
        );

        currentDocumentRef.current = result.document;
        setDocument(result.document);
        setConflict(null);
        externalChangesRef.current.delete(documentId);
        setConflictReviewOpen(false);
        setBlockedSave(null);

        if (fullySaved) {
          contentRef.current = result.document.content;
          setPreviewContent(result.document.content);
          revisionRef.current = result.document.revision;
          dirtyRef.current = false;
          setDirtyState(false);
          pendingEolConversionRef.current = null;
          lastRecoveryRevisionRef.current = result.savedRevision;
          setNeedsEolChoice(false);
          if (shouldResetEditor) setEditorRevision((value) => value + 1);
          setStatus('Saved');
        } else {
          dirtyRef.current = true;
          setDirtyState(true);
          setStatus('An older version was saved; newer changes remain');
        }
        const tabDocument = fullySaved
          ? result.document
          : {
              ...result.document,
              content: getCurrentContent(),
              revision: revisionRef.current,
              savedRevision: savedRevisionRef.current,
            };
        currentDocumentRef.current = tabDocument;
        tabsRef.current.set(documentId, {
          document: tabDocument,
          pendingEolConversion: pendingEolConversionRef.current,
          lastRecoveryRevision: lastRecoveryRevisionRef.current,
        });
        syncTabs();
        return fullySaved;
      }

      if (result.status === 'conflict') {
        setConflict(result);
        setStatus('External change detected; save stopped');
      } else if (result.status === 'blocked') {
        setBlockedSave({ saveAs, suggestedEol: result.suggestedEol });
        setStatus('Choose a line-ending format first');
      } else {
        setStatus(dirtyRef.current ? 'Save canceled; changes remain' : 'Save canceled');
      }
      return false;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed; draft preserved');
      return false;
    } finally {
      saveInFlightRef.current -= 1;
      savingRef.current = false;
      setSaving(false);
    }
  }, [document?.format.eol, document?.format.mixedEol, getCurrentContent, syncTabs]);

  const prepareForDocumentChange = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      setStatus('Wait for the save to finish before switching documents');
      return false;
    }
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition before switching documents');
      return false;
    }
    if (dirtyRef.current && !(await flushCurrentRecovery())) return false;
    captureCurrentTab();
    return true;
  }, [captureCurrentTab, flushCurrentRecovery]);

  const createInitialDocument = useCallback(async (
    statusMessage = 'Ready',
  ): Promise<void> => {
    if (!beginTransition()) return;
    try {
      const next = await window.desktop.createDocument({ content: '' });
      await activateDocument(next, { status: statusMessage });
    } finally {
      endTransition();
    }
  }, [activateDocument, beginTransition, endTransition]);

  const createNew = useCallback(async (): Promise<void> => {
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition first');
      return;
    }
    if (!beginTransition()) return;
    try {
      if (!(await prepareForDocumentChange())) return;
      const next = await window.desktop.createDocument({ content: '' });
      await activateDocument(next, { status: 'Created new document' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create document');
    } finally {
      endTransition();
    }
  }, [activateDocument, beginTransition, endTransition, prepareForDocumentChange]);

  const openDocument = useCallback(async (): Promise<void> => {
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition first');
      return;
    }
    if (!beginTransition()) return;
    try {
      if (!(await prepareForDocumentChange())) return;
      const next = await window.desktop.openDocument();
      if (next) await activateDocument(next);
      else setStatus(dirtyRef.current ? 'Open canceled; current content unchanged' : 'Open canceled');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to open document');
    } finally {
      endTransition();
    }
  }, [activateDocument, beginTransition, endTransition, prepareForDocumentChange]);

  const openWorkspace = useCallback(async (): Promise<void> => {
    if (workspaceBusy || transitioningRef.current) return;
    setWorkspaceBusy(true);
    try {
      const next = await window.desktop.openWorkspace();
      if (!next) {
        setStatus('Open folder canceled');
        return;
      }
      setWorkspace(next);
      setSidebarPanel('files');
      setWorkspaceQuery('');
      setWorkspaceResults([]);
      setStatus(`Opened folder with ${next.files.length.toLocaleString('en-US')} Markdown file${next.files.length === 1 ? '' : 's'}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to open folder');
    } finally {
      setWorkspaceBusy(false);
    }
  }, [workspaceBusy]);

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    if (!workspace || workspaceBusy) return;
    setWorkspaceBusy(true);
    try {
      const next = await window.desktop.refreshWorkspace();
      if (next) setWorkspace(next);
      setStatus('Folder refreshed');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to refresh folder');
    } finally {
      setWorkspaceBusy(false);
    }
  }, [workspace, workspaceBusy]);

  const openWorkspaceFile = useCallback(async (relativePath: string, line?: number): Promise<void> => {
    if (!beginTransition()) return;
    try {
      if (!(await prepareForDocumentChange())) return;
      const next = await window.desktop.openWorkspaceFile({ relativePath });
      await activateDocument(next, { status: `Opened ${relativePath}` });
      if (line) window.requestAnimationFrame(() => editorRef.current?.goToLine(line));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to open workspace file');
    } finally {
      endTransition();
    }
  }, [activateDocument, beginTransition, endTransition, prepareForDocumentChange]);

  const openWikiLink = useCallback((target: string): void => {
    if (!workspace) {
      setStatus(`Open a folder to follow [[${target}]]`);
      return;
    }
    const normalized = target.split('#')[0].trim().toLocaleLowerCase('en-US');
    const match = workspace.files.find((file) => {
      const fileName = file.name.replace(/\.[^.]+$/, '').toLocaleLowerCase('en-US');
      const relativeName = file.relativePath.replace(/\.[^.]+$/, '').toLocaleLowerCase('en-US');
      return fileName === normalized || relativeName === normalized;
    });
    if (!match) {
      setStatus(`No workspace note matches [[${target}]]`);
      return;
    }
    void openWorkspaceFile(match.relativePath);
  }, [openWorkspaceFile, workspace]);

  const switchTab = useCallback(async (documentId: string): Promise<void> => {
    if (documentId === documentIdRef.current || !beginTransition()) return;
    try {
      const tab = tabsRef.current.get(documentId);
      if (!tab) return;
      await activateDocument(tab.document, { status: `Switched to ${tab.document.displayName}` });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to switch tabs');
    } finally {
      endTransition();
    }
  }, [activateDocument, beginTransition, endTransition]);

  const closeTab = useCallback(async (documentId: string): Promise<void> => {
    if (!beginTransition()) return;
    try {
      const wasActive = documentId === documentIdRef.current;
      if (wasActive) captureCurrentTab();
      const tab = tabsRef.current.get(documentId);
      if (!tab) return;
      let finalDocument = tab.document;
      if (tab.document.revision > tab.document.savedRevision) {
        const decision = await window.desktop.confirmUnsavedChanges();
        if (decision === 'cancel') return;
        if (decision === 'save') {
          const result = await window.desktop.saveDocument({
            documentId,
            content: tab.document.content,
            revision: tab.document.revision,
            eolConversion: tab.pendingEolConversion ?? undefined,
          });
          if (result.status !== 'saved') {
            await activateDocument(tab.document);
            if (result.status === 'conflict') setConflict(result);
            if (result.status === 'blocked') {
              setBlockedSave({ saveAs: false, suggestedEol: result.suggestedEol });
            }
            setStatus(result.status === 'canceled' ? 'Close canceled' : 'Resolve the save issue before closing this tab');
            return;
          }
          finalDocument = result.document;
        } else {
          await window.desktop.discardRecovery({ recoveryId: documentId }).catch(() => undefined);
        }
      }
      await window.desktop.closeDocument({ documentId: finalDocument.id });
      tabsRef.current.delete(documentId);
      externalChangesRef.current.delete(documentId);
      if (!wasActive) {
        syncTabs();
        setStatus(`Closed ${tab.document.displayName}`);
        return;
      }
      documentIdRef.current = null;
      currentDocumentRef.current = null;
      dirtyRef.current = false;
      syncTabs();
      const next = [...tabsRef.current.values()].at(-1);
      if (next) {
        await activateDocument(next.document, { status: `Closed ${tab.document.displayName}` });
      } else {
        const fresh = await window.desktop.createDocument({ content: '' });
        await activateDocument(fresh, { status: 'New document' });
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to close tab');
    } finally {
      endTransition();
    }
  }, [activateDocument, beginTransition, captureCurrentTab, endTransition, syncTabs]);

  useEffect(() => {
    if (!workspace || !workspaceQuery.trim()) {
      setWorkspaceResults([]);
      return;
    }
    let canceled = false;
    const timer = window.setTimeout(() => {
      void window.desktop.searchWorkspace({ query: workspaceQuery }).then((results) => {
        if (!canceled) setWorkspaceResults(results);
      }).catch(() => {
        if (!canceled) setStatus('Folder search failed');
      });
    }, 220);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [workspace, workspaceQuery]);

  useEffect(() => {
    if (!workspace || !document?.path) {
      setWorkspaceMentions([]);
      return;
    }
    let canceled = false;
    void window.desktop.workspaceMentions({ noteName: document.displayName }).then((mentions) => {
      if (!canceled) setWorkspaceMentions(mentions);
    }).catch(() => {
      if (!canceled) setWorkspaceMentions([]);
    });
    return () => {
      canceled = true;
    };
  }, [document?.displayName, document?.path, workspace]);

  const reloadDocument = useCallback(async (): Promise<void> => {
    const documentId = documentIdRef.current;
    if (!documentId) return;
    if (savingRef.current) {
      setStatus('Wait for the save to finish before loading the disk version');
      return;
    }
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition before loading the disk version');
      return;
    }
    if (
      dirtyRef.current &&
      !window.confirm('Reloading will discard your current changes. Continue?')
    ) return;
    if (!beginTransition()) return;

    try {
      if (dirtyRef.current && !(await flushCurrentRecovery())) {
        throw new Error('Unable to preserve the draft; reload canceled.');
      }
      const expectedRevision = revisionRef.current;
      const next = await window.desktop.reloadDocument({
        documentId,
        expectedRevision,
      });
      if (documentIdRef.current !== documentId) return;
      documentIdRef.current = next.id;
      contentRef.current = next.content;
      revisionRef.current = next.revision;
      savedRevisionRef.current = next.savedRevision;
      dirtyRef.current = false;
      lastRecoveryRevisionRef.current = next.savedRevision;
      pendingEolConversionRef.current = null;
      setDocument(next);
      setPreviewContent(next.content);
      setDirtyState(false);
      setStats(next.content.length <= OUTLINE_ANALYSIS_LIMIT
        ? analyzeDocument(next.content)
        : { characters: next.content.length, words: null, lines: next.content.split(/\r\n|\r|\n/).length, headings: [] });
      largeFileModeRef.current = requiresLargeFileMode(next.content);
      setLargeFileMode(largeFileModeRef.current);
      setNeedsEolChoice(next.format.mixedEol);
      setEditorRevision((value) => value + 1);
      setConflict(null);
      externalChangesRef.current.delete(documentId);
      setConflictReviewOpen(false);
      setBlockedSave(null);
      currentDocumentRef.current = next;
      tabsRef.current.set(next.id, {
        document: next,
        pendingEolConversion: null,
        lastRecoveryRevision: next.savedRevision,
      });
      syncTabs();
      setStatus('Reloaded');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to reload the disk version');
    } finally {
      endTransition();
    }
  }, [beginTransition, endTransition, flushCurrentRecovery, syncTabs]);

  const chooseMixedEol = useCallback((eol: '\n' | '\r\n'): void => {
    if (!document || !document.format.mixedEol) return;
    const content = normalizeLineEndings(document.content, eol);
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    contentRef.current = content;
    dirtyRef.current = true;
    pendingEolConversionRef.current = eol;
    window.desktop.markEdited({ documentId: document.id, revision });

    const next = {
      ...document,
      content,
      revision,
      format: { ...document.format, eol, mixedEol: false },
    };
    setDocument(next);
    setPreviewContent(content);
    setDirtyState(true);
    setNeedsEolChoice(false);
    setStats(content.length <= OUTLINE_ANALYSIS_LIMIT
      ? analyzeDocument(content)
      : { characters: content.length, words: null, lines: content.split(/\r\n|\r|\n/).length, headings: [] });
    largeFileModeRef.current = requiresLargeFileMode(content);
    setLargeFileMode(largeFileModeRef.current);
    setEditorRevision((value) => value + 1);
    currentDocumentRef.current = next;
    tabsRef.current.set(next.id, {
      document: next,
      pendingEolConversion: eol,
      lastRecoveryRevision: lastRecoveryRevisionRef.current,
    });
    syncTabs();
    setStatus(`Line endings: ${eol === '\r\n' ? 'CRLF' : 'LF'} (not saved)`);
  }, [document, syncTabs]);

  const onEditorChange = useCallback((): void => {
    const documentId = documentIdRef.current;
    if (!documentId) return;
    const revision = revisionRef.current + 1;
    const wasDirty = dirtyRef.current;
    revisionRef.current = revision;
    dirtyRef.current = true;
    setDirtyState(true);
    const currentContent = getCurrentContent();
    if (workspaceViewRef.current !== 'editor') {
      setPreviewContent(currentContent);
    }
    const currentDocument = currentDocumentRef.current;
    if (currentDocument) {
      const updatedDocument = { ...currentDocument, content: currentContent, revision };
      currentDocumentRef.current = updatedDocument;
      tabsRef.current.set(documentId, {
        document: updatedDocument,
        pendingEolConversion: pendingEolConversionRef.current,
        lastRecoveryRevision: lastRecoveryRevisionRef.current,
      });
      if (!wasDirty) syncTabs();
    }

    if (!wasDirty || saveInFlightRef.current > 0 || transitioningRef.current) {
      try {
        window.desktop.markEdited({ documentId, revision });
      } catch {
        setStatus('Unable to track unsaved changes; save as a new file now');
        return;
      }
    }

    const metrics = editorRef.current?.getMetrics();
    if (metrics) {
      setStats((current) => ({
        ...current,
        characters: metrics.characters,
        lines: metrics.lines,
        ...(metrics.characters > OUTLINE_ANALYSIS_LIMIT
          ? { words: null, headings: [] }
          : {}),
      }));
      if (
        !largeFileModeRef.current &&
        (metrics.characters > OUTLINE_ANALYSIS_LIMIT ||
          (metrics.lines === 1 && metrics.characters > LONG_LINE_LIMIT))
      ) {
        largeFileModeRef.current = true;
        setLargeFileMode(true);
      }
    }
    setStatus('');

    if (analysisTimerRef.current !== null) {
      window.clearTimeout(analysisTimerRef.current);
    }
    if (metrics && metrics.characters <= OUTLINE_ANALYSIS_LIMIT) {
      const scheduledDocument = documentId;
      analysisTimerRef.current = window.setTimeout(() => {
        if (documentIdRef.current !== scheduledDocument) return;
        setStats(analyzeDocument(getCurrentContent()));
        analysisTimerRef.current = null;
      }, 500);
    }

    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current);
    }
    const scheduledDocument = documentId;
    const attemptRecovery = (): void => {
      recoveryTimerRef.current = null;
      if (
        documentIdRef.current !== scheduledDocument ||
        !dirtyRef.current
      ) return;
      if (
        editorRef.current?.isComposing() ||
        recoveryInFlightRef.current > 0
      ) {
        recoveryTimerRef.current = window.setTimeout(attemptRecovery, 1000);
        return;
      }
      void flushCurrentRecovery();
    };
    recoveryTimerRef.current = window.setTimeout(attemptRecovery, 400);
  }, [flushCurrentRecovery, getCurrentContent, syncTabs]);

  const toggleSourceMode = useCallback((): void => {
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition before changing views');
      return;
    }
    setSourceMode((value) => {
      const next = !value;
      setStatus(next ? 'Switched to source view' : 'Switched to visual view');
      return next;
    });
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }, []);

  const changeWorkspaceView = useCallback((next: WorkspaceView): void => {
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition before changing views');
      return;
    }
    setPreviewContent(getCurrentContent());
    workspaceViewRef.current = next;
    setWorkspaceView(next);
    setStatus(
      next === 'editor'
        ? 'Editor view'
        : next === 'split'
          ? 'Split preview'
          : 'Preview',
    );
    if (next !== 'preview') {
      window.requestAnimationFrame(() => editorRef.current?.focus());
    }
  }, [getCurrentContent]);

  const waitForRenderedPreview = useCallback(async (): Promise<string> => {
    if (largeFileModeRef.current) {
      throw new Error('Preview export is disabled for large documents.');
    }
    setPreviewContent(getCurrentContent());
    setWorkspaceView('preview');
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 250);
      }));
    });
    return window.document.querySelector<HTMLElement>('.markdown-preview')?.innerHTML ?? '';
  }, [getCurrentContent]);

  const exportHtml = useCallback(async (): Promise<void> => {
    if (!document) return;
    const previousView = workspaceView;
    try {
      const html = await waitForRenderedPreview();
      const exported = await window.desktop.exportHtml({
        suggestedName: document.displayName,
        html,
      });
      setStatus(exported ? 'HTML exported' : 'HTML export canceled');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to export HTML');
    } finally {
      workspaceViewRef.current = previousView;
      setWorkspaceView(previousView);
    }
  }, [document, waitForRenderedPreview, workspaceView]);

  const exportPdf = useCallback(async (): Promise<void> => {
    if (!document) return;
    const previousView = workspaceView;
    try {
      await waitForRenderedPreview();
      const exported = await window.desktop.exportPdf({ suggestedName: document.displayName });
      setStatus(exported ? 'PDF exported' : 'PDF export canceled');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to export PDF');
    } finally {
      workspaceViewRef.current = previousView;
      setWorkspaceView(previousView);
    }
  }, [document, waitForRenderedPreview, workspaceView]);

  const copyHtml = useCallback(async (): Promise<void> => {
    const previousView = workspaceView;
    try {
      const html = await waitForRenderedPreview();
      await window.desktop.copyHtml({ html });
      setStatus('Copied as HTML');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to copy HTML');
    } finally {
      workspaceViewRef.current = previousView;
      setWorkspaceView(previousView);
    }
  }, [waitForRenderedPreview, workspaceView]);

  const saveAllDocumentsForClose = useCallback(async (): Promise<void> => {
    captureCurrentTab();
    const openTabs = [...tabsRef.current.values()];
    const dirtyTabs = openTabs.filter((tab) => tab.document.revision > tab.document.savedRevision);
    const targets = dirtyTabs.length > 0 ? dirtyTabs : openTabs.slice(0, 1);
    for (const tab of targets) {
      try {
        const result = await window.desktop.saveDocument({
          documentId: tab.document.id,
          content: tab.document.content,
          revision: tab.document.revision,
          eolConversion: tab.pendingEolConversion ?? undefined,
        });
        if (result.status !== 'saved') {
          await activateDocument(tab.document);
          if (result.status === 'conflict') setConflict(result);
          if (result.status === 'blocked') {
            setBlockedSave({ saveAs: false, suggestedEol: result.suggestedEol });
          }
          setStatus('Save all was interrupted; resolve the active document first');
          await window.desktop.completeDiscardClose({ success: false });
          return;
        }
        tabsRef.current.set(result.document.id, {
          document: result.document,
          pendingEolConversion: null,
          lastRecoveryRevision: result.savedRevision,
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to save all documents');
        await window.desktop.completeDiscardClose({ success: false });
        return;
      }
    }
  }, [activateDocument, captureCurrentTab]);

  const flushAllRecoveriesForClose = useCallback(async (): Promise<void> => {
    captureCurrentTab();
    let latestReceipt: RecoveryReceipt | null = null;
    try {
      for (const tab of tabsRef.current.values()) {
        if (tab.document.revision <= tab.document.savedRevision) continue;
        latestReceipt = await window.desktop.writeRecovery({
          documentId: tab.document.id,
          content: tab.document.content,
          revision: tab.document.revision,
          eolConversion: tab.pendingEolConversion ?? undefined,
        });
      }
      const accepted = await window.desktop.completeDiscardClose(
        latestReceipt ? { success: true, receipt: latestReceipt } : { success: false },
      );
      if (!accepted) endTransition();
    } catch (error) {
      await window.desktop.completeDiscardClose({ success: false });
      endTransition();
      setStatus(error instanceof Error ? error.message : 'Unable to preserve all drafts');
    }
  }, [captureCurrentTab, endTransition]);

  commandHandlerRef.current = (command): void => {
    const handlers: Record<MenuCommand, () => void> = {
      new: () => void createNew(),
      open: () => void openDocument(),
      'open-workspace': () => void openWorkspace(),
      'refresh-workspace': () => void refreshWorkspace(),
      'find-workspace': () => {
        if (!workspace) {
          void openWorkspace();
          return;
        }
        setSidebarPanel('files');
        window.requestAnimationFrame(() => workspaceSearchRef.current?.focus());
      },
      save: () => void saveDocument(false),
      'save-and-close': () => {
        void saveAllDocumentsForClose();
      },
      'save-as': () => void saveDocument(true),
      'toggle-source': toggleSourceMode,
      'view-editor': () => changeWorkspaceView('editor'),
      'view-split': () => changeWorkspaceView('split'),
      'view-preview': () => changeWorkspaceView('preview'),
      'command-palette': () => setCommandPaletteOpen(true),
      'insert-table': () => setTableBuilderOpen(true),
      'cheat-sheet': () => setCheatSheetOpen(true),
      'export-html': () => void exportHtml(),
      'export-pdf': () => void exportPdf(),
      'copy-html': () => void copyHtml(),
      find: () => {
        if (editorRef.current?.isComposing()) {
          setStatus('Finish IME composition before opening Find');
          return;
        }
        editorRef.current?.openSearch();
      },
      'flush-recovery-and-close': () => {
        if (editorRef.current?.isComposing()) {
          setStatus('Finish IME composition before closing');
          void window.desktop.completeDiscardClose({ success: false });
          return;
        }
        if (!beginTransition()) {
          void window.desktop.completeDiscardClose({ success: false });
          return;
        }
        void flushAllRecoveriesForClose();
      },
    };
    if (transitioningRef.current && command !== 'flush-recovery-and-close') {
      if (command === 'save' || command === 'save-and-close') {
        void window.desktop.completeDiscardClose({ success: false });
      }
      return;
    }
    handlers[command]();
  };

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      void (async () => {
        try {
          const index = await window.desktop.listRecoveries();
          setRecoveryIndex(index);
          if (index.recoveries.length > 0) {
            setRecoveryOpen(true);
            setStatus(`Found ${index.recoveries.length} unsaved draft${index.recoveries.length === 1 ? '' : 's'}`);
          } else if (!documentIdRef.current) {
            const restored = await window.desktop.restoreSession();
            if (restored.length > 0) {
              for (const snapshot of restored) {
                await activateDocument(snapshot, { status: `Restored ${restored.length} tab${restored.length === 1 ? '' : 's'}` });
              }
            } else {
              await createInitialDocument(
                index.quarantinedCount > 0
                  ? `Unable to recover ${index.quarantinedCount} draft${index.quarantinedCount === 1 ? '' : 's'}`
                  : 'Ready',
              );
            }
          }
        } catch (error) {
          if (!documentIdRef.current) {
            await createInitialDocument('Draft scan failed; created a new document');
          }
          console.error('Draft scan failed', error);
          setStatus('Draft scan failed');
        }
      })();
    }

    const removeMenu = window.desktop.onMenuCommand((command) => commandHandlerRef.current(command));
    let systemOpenChain = Promise.resolve();
    const removeSystemOpen = window.desktop.onSystemOpenDocument((next) => {
      systemOpenChain = systemOpenChain.then(async () => {
        while (transitioningRef.current) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        }
        if (!beginTransition()) {
          window.desktop.acknowledgeSystemOpen();
          return;
        }
        try {
          if (!(await prepareForDocumentChange())) return;
          await activateDocument(next, { status: `Opened ${next.displayName}` });
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Unable to open document');
        } finally {
          endTransition();
          window.desktop.acknowledgeSystemOpen();
        }
      });
    });
    const removeExternal = window.desktop.onExternalChange((event) => {
      externalChangesRef.current.set(event.documentId, event);
      syncTabs();
      if (event.documentId === documentIdRef.current) {
        setConflict(event);
        setStatus('The file was modified by another application');
      } else {
        setStatus('A background tab was modified by another application');
      }
    });
    window.desktop.rendererReady();
    return () => {
      removeMenu();
      removeSystemOpen();
      removeExternal();
    };
  }, [
    activateDocument,
    beginTransition,
    createInitialDocument,
    endTransition,
    prepareForDocumentChange,
    syncTabs,
  ]);

  useEffect(() => () => {
    if (analysisTimerRef.current !== null) {
      window.clearTimeout(analysisTimerRef.current);
    }
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current);
    }
  }, []);

  const restoreRecovery = useCallback(async (recovery: RecoverySummary): Promise<void> => {
    if (!beginTransition()) return;
    setRecoveryBusyId(recovery.recoveryId);
    setRecoveryError(null);
    try {
      if (!(await prepareForDocumentChange())) return;
      const next = await window.desktop.restoreRecovery({ recoveryId: recovery.recoveryId });
      await activateDocument(next, {
        status: 'Draft restored',
        recoveryAlreadyWritten: true,
      });
      setRecoveryIndex((current) => current ? {
        ...current,
        recoveries: current.recoveries.filter((item) => item.recoveryId !== recovery.recoveryId),
      } : current);
      setRecoveryOpen(false);
    } catch (error) {
      console.error('Draft restore failed', error);
      const message = 'Unable to restore draft';
      setRecoveryError(message);
      setStatus(message);
    } finally {
      setRecoveryBusyId(null);
      endTransition();
    }
  }, [activateDocument, beginTransition, endTransition, prepareForDocumentChange]);

  const discardRecovery = useCallback(async (recovery: RecoverySummary): Promise<void> => {
    if (!window.confirm(
      `Remove “${recovery.displayName}”?\n\n${recovery.sourcePath ?? 'Never saved'}\n${recovery.characterCount.toLocaleString('en-US')} characters`,
    )) return;
    setRecoveryBusyId(recovery.recoveryId);
    setRecoveryError(null);
    try {
      await window.desktop.discardRecovery({ recoveryId: recovery.recoveryId });
      const remaining = recoveryIndex?.recoveries.filter(
        (item) => item.recoveryId !== recovery.recoveryId,
      ) ?? [];
      setRecoveryIndex((current) => current ? { ...current, recoveries: remaining } : current);
      if (remaining.length === 0) {
        setRecoveryOpen(false);
        if (!documentIdRef.current) await createInitialDocument();
      }
    } catch (error) {
      console.error('Draft removal failed', error);
      const message = 'Unable to remove draft';
      setRecoveryError(message);
      setStatus(message);
    } finally {
      setRecoveryBusyId(null);
    }
  }, [createInitialDocument, recoveryIndex?.recoveries]);

  const deferRecovery = useCallback((): void => {
    setRecoveryOpen(false);
    if (!documentIdRef.current) void createInitialDocument();
  }, [createInitialDocument]);

  const showConflictReview = useCallback((): void => {
    const documentId = documentIdRef.current;
    if (!documentId || transitioningRef.current || savingRef.current) return;
    const revision = revisionRef.current;
    const content = getCurrentContent();
    void window.desktop.inspectConflict({
      documentId,
      content,
      revision,
      eolConversion: pendingEolConversionRef.current ?? undefined,
    }).then((latest) => {
      if (
        documentIdRef.current !== documentId ||
        revisionRef.current !== revision
      ) return;
      setConflict(latest);
      setConflictReviewOpen(true);
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Unable to read the disk version');
    });
  }, [getCurrentContent]);

  useEffect(() => {
    if (!needsEolChoice) return;
    const frame = window.requestAnimationFrame(() => eolGateRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [document?.id, needsEolChoice]);

  const runEditorAction = useCallback((action: () => void): void => {
    if (transitioningRef.current) return;
    if (editorRef.current?.isComposing()) {
      setStatus('Finish IME composition first');
      return;
    }
    if (workspaceView === 'preview') {
      setWorkspaceView('editor');
      window.requestAnimationFrame(() => window.requestAnimationFrame(action));
      return;
    }
    action();
  }, [workspaceView]);

  const importImage = useCallback(async (): Promise<void> => {
    const documentId = documentIdRef.current;
    if (!documentId || transitioningRef.current) return;
    try {
      const image = await window.desktop.importImage({ documentId });
      if (!image) {
        setStatus('Image insertion canceled');
        return;
      }
      runEditorAction(() => editorRef.current?.insertSnippet(
        `![${image.fileName.replace(/\.[^.]+$/, '')}](${image.markdownPath})`,
      ));
      setStatus(`Imported ${image.fileName}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to import image');
    }
  }, [runEditorAction]);

  const pasteImage = useCallback(async (): Promise<void> => {
    const documentId = documentIdRef.current;
    if (!documentId || transitioningRef.current) return;
    try {
      const image = await window.desktop.pasteImage({ documentId });
      if (!image) {
        setStatus('The clipboard does not contain an image');
        return;
      }
      runEditorAction(() => editorRef.current?.insertSnippet(
        `![${image.fileName.replace(/\.[^.]+$/, '')}](${image.markdownPath})`,
      ));
      setStatus(`Pasted ${image.fileName}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to paste image');
    }
  }, [runEditorAction]);

  const resolveBlockedSave = useCallback(async (eol: '\n' | '\r\n'): Promise<void> => {
    if (!blockedSave || mixedDecisionPendingRef.current) return;
    mixedDecisionPendingRef.current = true;
    setMixedDecisionPending(true);
    try {
      await saveDocument(blockedSave.saveAs, eol);
    } finally {
      mixedDecisionPendingRef.current = false;
      setMixedDecisionPending(false);
    }
  }, [blockedSave, saveDocument]);

  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    { id: 'new', label: 'New document', detail: 'Create a blank Markdown document', shortcut: `${shortcutModifier}+N`, keywords: 'file', run: () => void createNew() },
    { id: 'open', label: 'Open file', detail: 'Open a Markdown file from disk', shortcut: `${shortcutModifier}+O`, keywords: 'file', run: () => void openDocument() },
    { id: 'open-folder', label: 'Open folder', detail: 'Browse and search a Markdown workspace', shortcut: `${shortcutModifier}+Shift+O`, keywords: 'workspace project', run: () => void openWorkspace() },
    { id: 'refresh-folder', label: 'Refresh folder', detail: 'Rescan the current workspace', keywords: 'workspace project', run: () => void refreshWorkspace() },
    { id: 'find-folder', label: 'Find in folder', detail: 'Search every Markdown file in the workspace', shortcut: `${shortcutModifier}+Shift+F`, keywords: 'workspace search', run: () => {
      setSidebarPanel('files');
      window.requestAnimationFrame(() => workspaceSearchRef.current?.focus());
    } },
    ...(workspace?.files.map((file): PaletteCommand => ({
      id: `workspace-file:${file.relativePath}`,
      label: file.name,
      detail: file.relativePath,
      keywords: `quick open file ${file.relativePath}`,
      run: () => void openWorkspaceFile(file.relativePath),
    })) ?? []),
    { id: 'save', label: 'Save', detail: 'Save the current document', shortcut: `${shortcutModifier}+S`, keywords: 'file', run: () => void saveDocument(false) },
    { id: 'save-as', label: 'Save as', detail: 'Save to a different file', shortcut: `${shortcutModifier}+Shift+S`, keywords: 'file', run: () => void saveDocument(true) },
    { id: 'export-html', label: 'Export HTML', detail: 'Create a standalone rendered HTML file', keywords: 'share output', run: () => void exportHtml() },
    { id: 'export-pdf', label: 'Export PDF', detail: 'Create a print-ready PDF', shortcut: `${shortcutModifier}+Shift+E`, keywords: 'share output print', run: () => void exportPdf() },
    { id: 'copy-html', label: 'Copy as HTML', detail: 'Copy rendered HTML to the clipboard', keywords: 'share clipboard', run: () => void copyHtml() },
    { id: 'find', label: 'Find and replace', detail: 'Search within the current document', shortcut: `${shortcutModifier}+F`, keywords: 'search', run: () => editorRef.current?.openSearch() },
    { id: 'view-editor', label: 'Editor view', detail: 'Show only the editor', shortcut: `${shortcutModifier}+1`, keywords: 'write', run: () => changeWorkspaceView('editor') },
    { id: 'view-split', label: 'Split preview', detail: 'Edit and preview side by side', shortcut: `${shortcutModifier}+2`, keywords: 'view render', run: () => changeWorkspaceView('split') },
    { id: 'view-preview', label: 'Preview', detail: 'Show rendered Markdown', shortcut: `${shortcutModifier}+3`, keywords: 'view read render', run: () => changeWorkspaceView('preview') },
    { id: 'source', label: 'Toggle source mode', detail: 'Show or hide Markdown punctuation', shortcut: `${shortcutModifier}+/`, keywords: 'view markdown', run: toggleSourceMode },
    ...([1, 2, 3, 4, 5, 6] as const).map((level): PaletteCommand => ({
      id: `heading-${level}`,
      label: `Heading ${level}`,
      detail: `Convert the current line to H${level}`,
      shortcut: `${shortcutModifier}+${optionModifier}+${level}`,
      keywords: 'format title',
      run: () => runEditorAction(() => editorRef.current?.setHeading(level)),
    })),
    { id: 'bold', label: 'Bold', detail: 'Wrap the selection in bold markers', shortcut: `${shortcutModifier}+B`, keywords: 'format', run: () => runEditorAction(() => editorRef.current?.wrapSelection('**', '**')) },
    { id: 'italic', label: 'Italic', detail: 'Wrap the selection in emphasis markers', shortcut: `${shortcutModifier}+I`, keywords: 'format', run: () => runEditorAction(() => editorRef.current?.wrapSelection('*', '*')) },
    { id: 'strike', label: 'Strikethrough', detail: 'Strike the selected text', keywords: 'format delete', run: () => runEditorAction(() => editorRef.current?.wrapSelection('~~', '~~')) },
    { id: 'highlight', label: 'Highlight', detail: 'Highlight the selected text', keywords: 'format mark', run: () => runEditorAction(() => editorRef.current?.wrapSelection('==', '==')) },
    { id: 'link', label: 'Insert link', detail: 'Insert a Markdown link', shortcut: `${shortcutModifier}+K`, keywords: 'url', run: () => runEditorAction(() => editorRef.current?.wrapSelection('[', '](https://)', 'link text')) },
    { id: 'image', label: 'Insert local image', detail: 'Copy an image beside the document and insert a relative link', keywords: 'asset picture photo', run: () => void importImage() },
    { id: 'paste-image', label: 'Paste clipboard image', detail: 'Save clipboard image data beside the document', keywords: 'asset picture screenshot', run: () => void pasteImage() },
    { id: 'wikilink', label: 'Insert Wiki link', detail: 'Link to another Markdown note', keywords: 'note backlink', run: () => runEditorAction(() => editorRef.current?.wrapSelection('[[', ']]', 'Note')) },
    { id: 'inline-code', label: 'Inline code', detail: 'Format the selection as code', keywords: 'format', run: () => runEditorAction(() => editorRef.current?.wrapSelection('`', '`', 'code')) },
    { id: 'code-block', label: 'Insert code block', detail: 'Insert a fenced code block', keywords: 'fence snippet', run: () => runEditorAction(() => editorRef.current?.insertSnippet('```text\n{{cursor}}\n```')) },
    { id: 'bullet-list', label: 'Toggle bullet list', detail: 'Prefix selected lines with bullets', keywords: 'unordered list', run: () => runEditorAction(() => editorRef.current?.prefixLines('- ')) },
    { id: 'number-list', label: 'Toggle numbered list', detail: 'Prefix selected lines with numbers', keywords: 'ordered list', run: () => runEditorAction(() => editorRef.current?.prefixLines('1. ')) },
    { id: 'task-list', label: 'Toggle task list', detail: 'Prefix selected lines with checkboxes', keywords: 'todo checkbox', run: () => runEditorAction(() => editorRef.current?.prefixLines('- [ ] ')) },
    { id: 'quote', label: 'Toggle block quote', detail: 'Prefix selected lines as a quotation', keywords: 'format', run: () => runEditorAction(() => editorRef.current?.prefixLines('> ')) },
    { id: 'table', label: 'Build table', detail: 'Choose columns, rows, headers, and alignment', shortcut: `${shortcutModifier}+T`, keywords: 'insert grid', run: () => setTableBuilderOpen(true) },
    { id: 'footnote', label: 'Insert footnote', detail: 'Insert a footnote reference and definition', keywords: 'reference', run: () => runEditorAction(() => editorRef.current?.insertSnippet('Text[^1]\n\n[^1]: {{cursor}}')) },
    { id: 'math', label: 'Insert math block', detail: 'Insert a KaTeX display equation', keywords: 'equation latex', run: () => runEditorAction(() => editorRef.current?.insertSnippet('$$\n{{cursor}}\n$$')) },
    { id: 'mermaid', label: 'Insert Mermaid diagram', detail: 'Insert a flowchart block', keywords: 'diagram graph', run: () => runEditorAction(() => editorRef.current?.insertSnippet('```mermaid\ngraph TD\n    {{cursor}}A --> B\n```')) },
    { id: 'rule', label: 'Insert horizontal rule', detail: 'Insert a section divider', keywords: 'separator', run: () => runEditorAction(() => editorRef.current?.insertSnippet('\n---\n{{cursor}}')) },
    { id: 'focus', label: `${editorPreferences.focusMode ? 'Disable' : 'Enable'} focus mode`, detail: 'Fade everything except the active line', keywords: 'writing', run: () => setEditorPreferences((current) => ({ ...current, focusMode: !current.focusMode })) },
    { id: 'typewriter', label: `${editorPreferences.typewriterMode ? 'Disable' : 'Enable'} typewriter mode`, detail: 'Keep the cursor vertically centered', keywords: 'writing', run: () => setEditorPreferences((current) => ({ ...current, typewriterMode: !current.typewriterMode })) },
    { id: 'hemingway', label: `${editorPreferences.hemingwayMode ? 'Disable' : 'Enable'} Hemingway mode`, detail: 'Disable deletion while drafting', keywords: 'writing', run: () => setEditorPreferences((current) => ({ ...current, hemingwayMode: !current.hemingwayMode })) },
    { id: 'line-numbers', label: `${editorPreferences.lineNumbers ? 'Hide' : 'Show'} line numbers`, detail: 'Toggle editor line numbers', keywords: 'view gutter', run: () => setEditorPreferences((current) => ({ ...current, lineNumbers: !current.lineNumbers })) },
    { id: 'cheat-sheet', label: 'Markdown cheat sheet', detail: 'Show common Markdown syntax', shortcut: 'F1', keywords: 'help reference', run: () => setCheatSheetOpen(true) },
  ], [changeWorkspaceView, copyHtml, createNew, editorPreferences, exportHtml, exportPdf, importImage, openDocument, openWorkspace, openWorkspaceFile, optionModifier, pasteImage, refreshWorkspace, runEditorAction, saveDocument, shortcutModifier, toggleSourceMode, workspace]);

  const filteredOutlineHeadings = useMemo(() => {
    const query = outlineQuery.trim().toLocaleLowerCase('en-US');
    return query
      ? stats.headings.filter((heading) => heading.text.toLocaleLowerCase('en-US').includes(query))
      : stats.headings;
  }, [outlineQuery, stats.headings]);
  const activeHeadingLine = useMemo(() => stats.headings.reduce(
    (line, heading) => heading.line <= activeEditorLine ? heading.line : line,
    0,
  ), [activeEditorLine, stats.headings]);

  const recoveryPanel = recoveryIndex && recoveryIndex.recoveries.length > 0 ? (
    <RecoveryPanel
      index={recoveryIndex}
      busyId={recoveryBusyId}
      onRestore={(item) => void restoreRecovery(item)}
      onDiscard={(item) => void discardRecovery(item)}
      onLater={deferRecovery}
      error={recoveryError}
    />
  ) : null;

  if (!document) {
    return recoveryOpen && recoveryPanel ? (
      <main className="recovery-startup">{recoveryPanel}</main>
    ) : (
      <main className="loading-screen">Preparing…</main>
    );
  }

  return (
    <main className="app-shell">
      <aside
        className="sidebar"
        inert={recoveryOpen || conflictReviewOpen || commandPaletteOpen || cheatSheetOpen || tableBuilderOpen}
        aria-hidden={recoveryOpen || conflictReviewOpen || commandPaletteOpen || cheatSheetOpen || tableBuilderOpen || undefined}
      >
        <header className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 1024 1024" focusable="false">
              <path d="M326 272h372v112H574v256h124v112H326V640h124V384H326V272Z" />
            </svg>
          </span>
          <strong>Inkstill</strong>
        </header>

        <div className="file-actions">
          <button type="button" aria-label="New document" title={`New document (${shortcutModifier}+N)`} disabled={transitioning || saving} onClick={() => void createNew()}>＋ New</button>
          <button type="button" aria-label="Open document" title={`Open document (${shortcutModifier}+O)`} disabled={transitioning || saving} onClick={() => void openDocument()}>↗ Open</button>
          <button type="button" aria-label="Open folder" title={`Open folder (${shortcutModifier}+Shift+O)`} disabled={workspaceBusy} onClick={() => void openWorkspace()}>▣ Folder</button>
        </div>

        {recoveryIndex && recoveryIndex.recoveries.length > 0 && (
          <button
            className="recovery-entry"
            type="button"
            aria-label={`Drafts, ${recoveryIndex.recoveries.length} recoverable item${recoveryIndex.recoveries.length === 1 ? '' : 's'}`}
            disabled={transitioning || saving}
            onClick={() => setRecoveryOpen(true)}
          >
            <span>↺ Drafts</span>
            <strong>{recoveryIndex.recoveries.length}</strong>
          </button>
        )}

        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar">
          <button type="button" role="tab" aria-selected={sidebarPanel === 'files'} onClick={() => setSidebarPanel('files')}>Files</button>
          <button type="button" role="tab" aria-selected={sidebarPanel === 'outline'} onClick={() => setSidebarPanel('outline')}>Outline</button>
          <button type="button" role="tab" aria-selected={sidebarPanel === 'links'} onClick={() => setSidebarPanel('links')}>Links</button>
        </div>

        <section className="outline-section sidebar-panel">
          {sidebarPanel === 'files' && (
            <>
              <div className="section-label">
                <span>{workspace?.rootName ?? 'Workspace'}</span>
                {workspace && <button type="button" title="Refresh folder" disabled={workspaceBusy} onClick={() => void refreshWorkspace()}>↻</button>}
              </div>
              {workspace ? (
                <>
                  <input
                    ref={workspaceSearchRef}
                    className="workspace-search"
                    type="search"
                    value={workspaceQuery}
                    placeholder="Search folder…"
                    aria-label="Search folder"
                    onChange={(event) => setWorkspaceQuery(event.target.value)}
                  />
                  <nav className="workspace-files" aria-label="Workspace files">
                    {(workspaceQuery.trim() ? workspaceResults : workspace.files).map((item) => (
                      <button
                        type="button"
                        className="workspace-file"
                        key={`${item.relativePath}${'line' in item ? `:${item.line}` : ''}`}
                        title={item.relativePath}
                        onClick={() => void openWorkspaceFile(item.relativePath, 'line' in item ? item.line : undefined)}
                      >
                        <span style={{ paddingInlineStart: `${Math.min(3, item.relativePath.split('/').length - 1) * 10}px` }}>
                          {'name' in item ? item.name : item.relativePath.split('/').at(-1)}
                        </span>
                        {'preview' in item && <small>{item.preview}</small>}
                      </button>
                    ))}
                    {workspaceQuery.trim() && workspaceResults.length === 0 && <p className="empty-outline">No matches</p>}
                    {!workspaceQuery.trim() && workspace.files.length === 0 && <p className="empty-outline">No Markdown files</p>}
                  </nav>
                </>
              ) : (
                <button className="open-workspace-prompt" type="button" onClick={() => void openWorkspace()}>Open a folder</button>
              )}
            </>
          )}

          {sidebarPanel === 'outline' && (
            <>
              <div className="section-label">Outline</div>
              <input
                className="workspace-search"
                type="search"
                value={outlineQuery}
                placeholder="Filter headings…"
                aria-label="Filter outline"
                onChange={(event) => setOutlineQuery(event.target.value)}
              />
              <nav aria-label="Document outline">
                {largeFileMode ? (
                  <p className="empty-outline" title="The outline is hidden for large files">Outline hidden for large file</p>
                ) : stats.headings.length === 0 ? (
                  <p className="empty-outline">No headings</p>
                ) : filteredOutlineHeadings.length === 0 ? (
                  <p className="empty-outline">No matching headings</p>
                ) : filteredOutlineHeadings.map((heading, index) => (
                  <button
                    type="button"
                    className={`outline-item${heading.line === activeHeadingLine ? ' is-active' : ''}`}
                    style={{ paddingInlineStart: `${12 + (heading.level - 1) * 12}px` }}
                    key={`${heading.line}-${index}`}
                    title={heading.text}
                    aria-label={`${heading.text}, line ${heading.line}`}
                    onClick={() => editorRef.current?.goToLine(heading.line)}
                  >
                    {heading.text}
                  </button>
                ))}
              </nav>
            </>
          )}

          {sidebarPanel === 'links' && (
            <>
              <div className="section-label">Backlinks</div>
              <nav className="workspace-files" aria-label="Backlinks">
                {!workspace ? (
                  <p className="empty-outline">Open a folder to discover links</p>
                ) : workspaceMentions.length === 0 ? (
                  <p className="empty-outline">No mentions</p>
                ) : workspaceMentions.map((mention) => (
                  <button
                    type="button"
                    className="workspace-file"
                    key={`${mention.relativePath}:${mention.line}`}
                    onClick={() => void openWorkspaceFile(mention.relativePath, mention.line)}
                  >
                    <span>{mention.linked ? '↙ ' : '○ '}{mention.relativePath}</span>
                    <small>{mention.preview}</small>
                  </button>
                ))}
              </nav>
            </>
          )}
        </section>

      </aside>

      <section
        className="workspace"
        inert={recoveryOpen || conflictReviewOpen || commandPaletteOpen || cheatSheetOpen || tableBuilderOpen}
        aria-hidden={recoveryOpen || conflictReviewOpen || commandPaletteOpen || cheatSheetOpen || tableBuilderOpen || undefined}
      >
        <header className="topbar">
          <div className="document-title">
            <span title={document.path ?? document.displayName}>{document.displayName}</span>
            {dirty && (
              <span className="unsaved-label" aria-label="Unsaved">
                <i aria-hidden="true" /> Unsaved
              </span>
            )}
          </div>
          <div className="format-tools" role="group" aria-label="Formatting tools">
            <ToolbarButton disabled={transitioning || needsEolChoice} label="H1" title="Heading 1" onClick={() => runEditorAction(() => editorRef.current?.setHeading(1))} />
            <ToolbarButton disabled={transitioning || needsEolChoice} label="H2" title="Heading 2" onClick={() => runEditorAction(() => editorRef.current?.setHeading(2))} />
            <span className="toolbar-divider" />
            <ToolbarButton disabled={transitioning || needsEolChoice} label="B" title={`Bold (${shortcutModifier}+B)`} onClick={() => runEditorAction(() => editorRef.current?.wrapSelection('**', '**'))} />
            <ToolbarButton disabled={transitioning || needsEolChoice} label="I" title={`Italic (${shortcutModifier}+I)`} onClick={() => runEditorAction(() => editorRef.current?.wrapSelection('*', '*'))} />
            <ToolbarButton disabled={transitioning || needsEolChoice} label="↗" title="Insert link" onClick={() => runEditorAction(() => editorRef.current?.wrapSelection('[', '](https://)', 'link text'))} />
            <ToolbarButton disabled={transitioning || needsEolChoice} label="▧" title="Insert local image" onClick={() => void importImage()} />
            <ToolbarButton disabled={transitioning || needsEolChoice} label="‹›" title="Inline code" onClick={() => runEditorAction(() => editorRef.current?.wrapSelection('`', '`', 'code'))} />
          </div>
          <div className="topbar-actions">
            <div className="view-switcher" role="group" aria-label="Workspace view">
              <button type="button" aria-pressed={workspaceView === 'editor'} title={`Editor (${shortcutModifier}+1)`} onClick={() => changeWorkspaceView('editor')}>Edit</button>
              <button type="button" aria-pressed={workspaceView === 'split'} title={`Split preview (${shortcutModifier}+2)`} onClick={() => changeWorkspaceView('split')}>Split</button>
              <button type="button" aria-pressed={workspaceView === 'preview'} title={`Preview (${shortcutModifier}+3)`} onClick={() => changeWorkspaceView('preview')}>Read</button>
            </div>
            <button
              className="command-toggle"
              type="button"
              title={`Command palette (${shortcutModifier}+P)`}
              aria-label="Open command palette"
              onClick={() => setCommandPaletteOpen(true)}
            >
              ›_
            </button>
            <button
              className={`writing-toggle${writingToolsOpen ? ' is-active' : ''}`}
              type="button"
              aria-expanded={writingToolsOpen}
              aria-controls="writing-tools"
              title="Writing tools"
              onClick={() => setWritingToolsOpen((value) => !value)}
            >
              Aa
            </button>
            <button
              className={`source-toggle${sourceMode ? ' is-active' : ''}`}
              type="button"
              disabled={transitioning || needsEolChoice}
              aria-pressed={sourceMode}
              aria-label="Source mode"
              title={`${sourceMode ? 'Switch to visual mode' : 'Switch to source mode'} (${shortcutModifier}+/)`}
              onClick={toggleSourceMode}
            >
              Source
            </button>
            <button
              className={`save-button${document.path && !dirty && !saving ? ' is-saved' : ''}`}
              type="button"
              title={`Save (${shortcutModifier}+S)`}
              disabled={transitioning || saving}
              aria-busy={saving}
              onClick={() => void saveDocument(false)}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </header>

        <div className="document-tabs" role="tablist" aria-label="Open documents">
          {tabs.map((tab) => (
            <div className={`document-tab${tab.id === document.id ? ' is-active' : ''}`} key={tab.id}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === document.id}
                title={tab.path ?? tab.displayName}
                onClick={() => void switchTab(tab.id)}
              >
                {tab.dirty && <i aria-hidden="true" />}
                {tab.externalChanged && <b aria-label="Modified outside Inkstill">!</b>}
                <span>{tab.displayName}</span>
              </button>
              <button type="button" className="tab-close" aria-label={`Close ${tab.displayName}`} title="Close tab" onClick={() => void closeTab(tab.id)}>×</button>
            </div>
          ))}
          <button type="button" className="new-tab" aria-label="New document" title={`New document (${shortcutModifier}+N)`} onClick={() => void createNew()}>＋</button>
        </div>

        {writingToolsOpen && (
          <section id="writing-tools" className="writing-tools-popover" role="dialog" aria-label="Writing tools">
            <header>
              <strong>Writing tools</strong>
              <button type="button" aria-label="Close writing tools" onClick={() => setWritingToolsOpen(false)}>×</button>
            </header>
            <div className="writing-selects">
              <label>
                <span>Theme</span>
                <select value={editorPreferences.theme} onChange={(event) => setEditorPreferences((current) => ({
                  ...current,
                  theme: event.target.value as EditorPreferences['theme'],
                }))}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label>
                <span>Page width</span>
                <select value={editorPreferences.editorWidth} onChange={(event) => setEditorPreferences((current) => ({
                  ...current,
                  editorWidth: event.target.value as EditorPreferences['editorWidth'],
                }))}>
                  <option value="narrow">Narrow</option>
                  <option value="comfortable">Comfortable</option>
                  <option value="wide">Wide</option>
                </select>
              </label>
            </div>
            {([
              ['focusMode', 'Focus mode', 'Fade everything except the active line'],
              ['typewriterMode', 'Typewriter mode', 'Keep the cursor vertically centered'],
              ['hemingwayMode', 'Hemingway mode', 'Disable Backspace and Delete while drafting'],
              ['lineNumbers', 'Line numbers', 'Show source line numbers'],
              ['spellcheck', 'Spellcheck', 'Use the system spelling checker'],
            ] as const).map(([key, label, description]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={editorPreferences[key]}
                  onChange={(event) => setEditorPreferences((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))}
                />
                <span><strong>{label}</strong><small>{description}</small></span>
              </label>
            ))}
            <label className="writing-goal">
              <span><strong>Writing goal</strong><small>Target word count for this document</small></span>
              <input
                type="number"
                min="0"
                step="100"
                value={editorPreferences.writingGoal || ''}
                placeholder="No goal"
                onChange={(event) => setEditorPreferences((current) => ({
                  ...current,
                  writingGoal: Math.max(0, Number.parseInt(event.target.value || '0', 10) || 0),
                }))}
              />
            </label>
          </section>
        )}

        <div className="alert-stack">
          {safetyFault && (
            <div className="safety-banner" role="alert" aria-live="assertive">
              <strong>Unable to preserve draft</strong>
              <span>{safetyFault}</span>
            </div>
          )}
          {conflict && (
            <div className="conflict-banner" role="alert">
              <strong>File modified by another application</strong>
              <button type="button" disabled={transitioning || saving} onClick={showConflictReview}>Compare</button>
              <button type="button" disabled={transitioning || saving} onClick={() => void saveDocument(true)}>Save As</button>
              <button type="button" disabled={transitioning || saving} onClick={() => void reloadDocument()}>Load disk version</button>
            </div>
          )}
          {blockedSave && (
            <div className="safety-banner" role="alert">
              <strong>Choose line endings</strong>
              <span>This file uses both LF and CRLF.</span>
              <button type="button" disabled={mixedDecisionPending || transitioning} onClick={() => void resolveBlockedSave('\n')}>Convert to LF and Save</button>
              <button type="button" disabled={mixedDecisionPending || transitioning} onClick={() => void resolveBlockedSave('\r\n')}>Convert to CRLF and Save</button>
              <button type="button" disabled={mixedDecisionPending} onClick={() => setBlockedSave(null)}>Cancel</button>
            </div>
          )}
        </div>

        <div className={`editor-surface view-${workspaceView}`}>
          {needsEolChoice ? (
            <section
              ref={eolGateRef}
              className="eol-gate"
              role="region"
              tabIndex={-1}
              aria-labelledby="eol-gate-title"
              aria-describedby="eol-gate-description"
            >
              <span className="eol-gate-symbol" aria-hidden="true">↵</span>
              <h2 id="eol-gate-title">Choose line endings</h2>
              <p id="eol-gate-description">This file uses both LF and CRLF.</p>
              <div>
                <button type="button" onClick={() => chooseMixedEol('\n')}>Edit with LF</button>
                <button type="button" onClick={() => chooseMixedEol('\r\n')}>Edit with CRLF</button>
              </div>
              <pre tabIndex={0} aria-label="Original content preview">{document.content.slice(0, 4000)}</pre>
            </section>
          ) : (
            <>
              <MarkdownEditor
                  key={`${document.id}:${editorRevision}`}
                  ref={editorRef}
                  document={document}
                  sourceMode={sourceMode}
                  largeFileMode={largeFileMode}
                  readOnly={transitioning}
                  lineNumbers={editorPreferences.lineNumbers}
                  spellcheck={editorPreferences.spellcheck}
                  focusMode={editorPreferences.focusMode}
                  typewriterMode={editorPreferences.typewriterMode}
                  hemingwayMode={editorPreferences.hemingwayMode}
                  onChange={onEditorChange}
                  onSelectionChange={(content, lineNumber) => {
                    setActiveEditorLine(lineNumber);
                    setSelectionStats(content
                      ? { characters: content.length, words: countWords(content) }
                      : null);
                  }}
                  onOpenCommandPalette={() => setCommandPaletteOpen(true)}
                  onPasteImage={() => void pasteImage()}
                  onScrollRatio={setPreviewScrollRatio}
                  onCompositionEnd={() => {
                    if (recoveryTimerRef.current !== null) {
                      window.clearTimeout(recoveryTimerRef.current);
                      recoveryTimerRef.current = null;
                    }
                    if (dirtyRef.current) void flushCurrentRecovery();
                  }}
                  onLimitExceeded={() => setStatus('The 20 million character limit has been reached; shorten the document to continue')}
              />
              {workspaceView !== 'editor' && (
                largeFileMode ? (
                  <div className="preview-unavailable">Preview is disabled for large documents.</div>
                ) : (
                  <MarkdownPreview
                    content={previewContent}
                    documentId={document.id}
                    scrollRatio={previewScrollRatio}
                    onOpenExternal={(url) => void window.desktop.openExternal({ url }).catch(() => setStatus('Unable to open the link'))}
                    onOpenWikiLink={openWikiLink}
                  />
                )
              )}
            </>
          )}
        </div>

        <footer className="statusbar">
          <span role="status" aria-live="polite">{status}</span>
          <div>
            {selectionStats && (
              <span className="selection-stats">
                Selected: {selectionStats.words.toLocaleString('en-US')} {selectionStats.words === 1 ? 'word' : 'words'}, {selectionStats.characters.toLocaleString('en-US')} {selectionStats.characters === 1 ? 'character' : 'characters'}
              </span>
            )}
            {largeFileMode && <span>Large file mode</span>}
            {document.format.bom && <span>UTF-8 BOM</span>}
            <span>{document.format.eol === '\r\n' ? 'CRLF' : 'LF'}</span>
            {document.format.mixedEol && <span className="warning-text">Mixed line endings</span>}
            {stats.words !== null && (
              <span>{stats.words.toLocaleString('en-US')} {stats.words === 1 ? 'word' : 'words'}</span>
            )}
            {stats.words !== null && stats.words > 0 && (
              <span>{Math.max(1, Math.ceil(stats.words / 200))} min read</span>
            )}
            {stats.words !== null && editorPreferences.writingGoal > 0 && (
              <span className="goal-progress">
                Goal {Math.min(100, Math.round((stats.words / editorPreferences.writingGoal) * 100))}%
              </span>
            )}
            <span className="status-line-count">
              {stats.lines.toLocaleString('en-US')} {stats.lines === 1 ? 'line' : 'lines'}
            </span>
            <span className="status-character-count">
              {stats.characters.toLocaleString('en-US')} {stats.characters === 1 ? 'character' : 'characters'}
            </span>
          </div>
        </footer>
      </section>

      {recoveryOpen && recoveryPanel && (
        <div className="modal-backdrop">{recoveryPanel}</div>
      )}

      {conflictReviewOpen && conflict && isSaveConflict(conflict) && (
        <ConflictReview
          conflict={conflict}
          busy={transitioning || saving}
          onClose={() => setConflictReviewOpen(false)}
          onSaveAs={() => void saveDocument(true)}
          onReload={() => void reloadDocument()}
        />
      )}

      {commandPaletteOpen && (
        <CommandPalette commands={paletteCommands} onClose={() => setCommandPaletteOpen(false)} />
      )}

      {cheatSheetOpen && (
        <MarkdownCheatSheet onClose={() => setCheatSheetOpen(false)} />
      )}

      {tableBuilderOpen && (
        <TableBuilder
          onClose={() => setTableBuilderOpen(false)}
          onInsert={(markdown) => {
            setTableBuilderOpen(false);
            runEditorAction(() => editorRef.current?.insertSnippet(`${markdown}\n{{cursor}}`));
          }}
        />
      )}
    </main>
  );
}

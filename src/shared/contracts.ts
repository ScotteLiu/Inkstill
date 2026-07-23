import { z } from 'zod';

export const MAX_DOCUMENT_CHARACTERS = 20_000_000;
export const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_CHARACTERS * 4 + 3;
// Conflict bodies are preview payloads for the renderer, not document storage.
// The extra UTF-16 unit lets the renderer distinguish a clipped 20,000-unit view.
export const MAX_CONFLICT_CONTENT_CHARACTERS = 20_001;

export const IPC = {
  createDocument: 'document:create',
  openDocument: 'document:open',
  closeDocument: 'document:close',
  reloadDocument: 'document:reload',
  saveDocument: 'document:save',
  saveDocumentAs: 'document:save-as',
  inspectConflict: 'document:inspect-conflict',
  markEdited: 'document:mark-edited',
  confirmUnsavedChanges: 'document:confirm-unsaved-changes',
  completeDiscardClose: 'document:complete-discard-close',
  writeRecovery: 'recovery:write',
  listRecoveries: 'recovery:list',
  restoreRecovery: 'recovery:restore',
  discardRecovery: 'recovery:discard',
  menuCommand: 'app:menu-command',
  openExternal: 'app:open-external',
  exportHtml: 'app:export-html',
  exportPdf: 'app:export-pdf',
  copyHtml: 'app:copy-html',
  openWorkspace: 'workspace:open',
  refreshWorkspace: 'workspace:refresh',
  openWorkspaceFile: 'workspace:open-file',
  searchWorkspace: 'workspace:search',
  workspaceMentions: 'workspace:mentions',
  importImage: 'document:import-image',
  pasteImage: 'document:paste-image',
  readLocalAsset: 'document:read-local-asset',
  restoreSession: 'document:restore-session',
  externalChange: 'document:external-change',
} as const;

export const menuCommandSchema = z.enum([
  'new',
  'open',
  'open-workspace',
  'refresh-workspace',
  'find-workspace',
  'save',
  'save-and-close',
  'save-as',
  'toggle-source',
  'view-editor',
  'view-split',
  'view-preview',
  'command-palette',
  'insert-table',
  'cheat-sheet',
  'export-html',
  'export-pdf',
  'copy-html',
  'find',
  'flush-recovery-and-close',
]);
export type MenuCommand = z.infer<typeof menuCommandSchema>;

export const openExternalRequestSchema = z.object({
  url: z.string().url().max(4096),
});
export type OpenExternalRequest = z.infer<typeof openExternalRequestSchema>;

export const exportContentRequestSchema = z.object({
  suggestedName: z.string().min(1).max(255),
  html: z.string().max(80_000_000),
});
export type ExportContentRequest = z.infer<typeof exportContentRequestSchema>;

export const exportPdfRequestSchema = z.object({
  suggestedName: z.string().min(1).max(255),
});
export type ExportPdfRequest = z.infer<typeof exportPdfRequestSchema>;

export const copyHtmlRequestSchema = z.object({
  html: z.string().max(80_000_000),
});
export type CopyHtmlRequest = z.infer<typeof copyHtmlRequestSchema>;

export const workspaceFileSchema = z.object({
  relativePath: z.string().min(1).max(2048),
  name: z.string().min(1).max(255),
});
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

export const workspaceSnapshotSchema = z.object({
  rootName: z.string().min(1).max(255),
  rootPath: z.string().min(1).max(4096),
  truncated: z.boolean(),
  files: z.array(workspaceFileSchema).max(5_000),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

export const workspacePathRequestSchema = z.object({
  relativePath: z.string().min(1).max(2048),
});
export type WorkspacePathRequest = z.infer<typeof workspacePathRequestSchema>;

export const workspaceSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(200),
});
export type WorkspaceSearchRequest = z.infer<typeof workspaceSearchRequestSchema>;

export const workspaceSearchResultSchema = z.object({
  relativePath: z.string().min(1).max(2048),
  line: z.number().int().positive(),
  preview: z.string().max(240),
});
export type WorkspaceSearchResult = z.infer<typeof workspaceSearchResultSchema>;

export const workspaceMentionSchema = workspaceSearchResultSchema.extend({
  linked: z.boolean(),
});
export type WorkspaceMention = z.infer<typeof workspaceMentionSchema>;

export const workspaceMentionsRequestSchema = z.object({
  noteName: z.string().min(1).max(255),
});
export type WorkspaceMentionsRequest = z.infer<typeof workspaceMentionsRequestSchema>;

export const importedImageSchema = z.object({
  markdownPath: z.string().min(1).max(2048),
  fileName: z.string().min(1).max(255),
});
export type ImportedImage = z.infer<typeof importedImageSchema>;

export const localAssetRequestSchema = z.object({
  documentId: z.string().uuid(),
  relativePath: z.string().min(1).max(2048),
});
export type LocalAssetRequest = z.infer<typeof localAssetRequestSchema>;

export const localAssetSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']),
  base64: z.string().max(40_000_000),
});
export type LocalAsset = z.infer<typeof localAssetSchema>;

export const documentFormatSchema = z.object({
  encoding: z.literal('utf8'),
  bom: z.boolean(),
  eol: z.enum(['\n', '\r\n']),
  mixedEol: z.boolean(),
});
export type DocumentFormat = z.infer<typeof documentFormatSchema>;

export const fileSignatureSchema = z.object({
  mtimeMs: z.number().finite().nonnegative(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type FileSignature = z.infer<typeof fileSignatureSchema>;

export const documentSnapshotSchema = z.object({
  id: z.string().uuid(),
  path: z.string().nullable(),
  displayName: z.string().min(1),
  content: z.string().max(MAX_DOCUMENT_CHARACTERS),
  format: documentFormatSchema,
  signature: fileSignatureSchema.nullable(),
  revision: z.number().int().nonnegative(),
  savedRevision: z.number().int().nonnegative(),
});
export type DocumentSnapshot = z.infer<typeof documentSnapshotSchema>;

export const createDocumentRequestSchema = z.object({
  content: z.string().max(MAX_DOCUMENT_CHARACTERS).default(''),
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

export const documentContentRequestSchema = z.object({
  documentId: z.string().uuid(),
  content: z.string().max(MAX_DOCUMENT_CHARACTERS),
  revision: z.number().int().nonnegative(),
  eolConversion: z.enum(['\n', '\r\n']).optional(),
});
export type DocumentContentRequest = z.infer<typeof documentContentRequestSchema>;

export const documentIdRequestSchema = z.object({
  documentId: z.string().uuid(),
});
export type DocumentIdRequest = z.infer<typeof documentIdRequestSchema>;

export const reloadDocumentRequestSchema = z.object({
  documentId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
export type ReloadDocumentRequest = z.infer<typeof reloadDocumentRequestSchema>;

export const markEditedRequestSchema = z.object({
  documentId: z.string().uuid(),
  revision: z.number().int().positive(),
});
export type MarkEditedRequest = z.infer<typeof markEditedRequestSchema>;

export const saveConflictSchema = z.object({
  status: z.literal('conflict'),
  path: z.string(),
  expected: fileSignatureSchema.nullable(),
  actual: fileSignatureSchema.nullable(),
  baseContent: z.string().max(MAX_CONFLICT_CONTENT_CHARACTERS),
  localContent: z.string().max(MAX_CONFLICT_CONTENT_CHARACTERS),
  externalContent: z.string().max(MAX_CONFLICT_CONTENT_CHARACTERS).nullable(),
});
export type SaveConflict = z.infer<typeof saveConflictSchema>;

export const saveResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('saved'),
    document: documentSnapshotSchema,
    savedRevision: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal('canceled') }),
  z.object({
    status: z.literal('blocked'),
    reason: z.literal('mixed-line-endings'),
    suggestedEol: z.enum(['\n', '\r\n']),
  }),
  saveConflictSchema,
]);
export type SaveResult = z.infer<typeof saveResultSchema>;

export const unsavedDecisionSchema = z.enum(['save', 'discard', 'cancel']);
export type UnsavedDecision = z.infer<typeof unsavedDecisionSchema>;

export const recoveryReceiptSchema = z.object({
  documentId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type RecoveryReceipt = z.infer<typeof recoveryReceiptSchema>;

export const discardCloseRequestSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(false) }),
  z.object({ success: z.literal(true), receipt: recoveryReceiptSchema }),
]);
export type DiscardCloseRequest = z.infer<typeof discardCloseRequestSchema>;

export const recoveryIdRequestSchema = z.object({
  recoveryId: z.string().uuid(),
});
export type RecoveryIdRequest = z.infer<typeof recoveryIdRequestSchema>;

export const recoveryDiskStatusSchema = z.enum([
  'untracked',
  'unchecked',
  'unchanged',
  'changed',
  'missing',
  'unreadable',
]);
export type RecoveryDiskStatus = z.infer<typeof recoveryDiskStatusSchema>;

export const recoverySummarySchema = z.object({
  recoveryId: z.string().uuid(),
  sourcePath: z.string().nullable(),
  displayName: z.string().min(1),
  updatedAt: z.string().datetime(),
  characterCount: z.number().int().nonnegative(),
  preview: z.string().max(240),
  diskStatus: recoveryDiskStatusSchema,
});
export type RecoverySummary = z.infer<typeof recoverySummarySchema>;

export const recoveryListResultSchema = z.object({
  recoveries: z.array(recoverySummarySchema),
  quarantinedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
});
export type RecoveryListResult = z.infer<typeof recoveryListResultSchema>;

export const externalChangeEventSchema = z.object({
  documentId: z.string().uuid(),
  path: z.string(),
  signature: fileSignatureSchema.nullable(),
});
export type ExternalChangeEvent = z.infer<typeof externalChangeEventSchema>;

export interface DesktopApi {
  createDocument(request: CreateDocumentRequest): Promise<DocumentSnapshot>;
  openDocument(): Promise<DocumentSnapshot | null>;
  closeDocument(request: DocumentIdRequest): Promise<void>;
  reloadDocument(request: ReloadDocumentRequest): Promise<DocumentSnapshot>;
  saveDocument(request: DocumentContentRequest): Promise<SaveResult>;
  saveDocumentAs(request: DocumentContentRequest): Promise<SaveResult>;
  inspectConflict(request: DocumentContentRequest): Promise<SaveConflict>;
  markEdited(request: MarkEditedRequest): void;
  confirmUnsavedChanges(): Promise<UnsavedDecision>;
  completeDiscardClose(request: DiscardCloseRequest): Promise<boolean>;
  writeRecovery(request: DocumentContentRequest): Promise<RecoveryReceipt>;
  listRecoveries(): Promise<RecoveryListResult>;
  restoreRecovery(request: RecoveryIdRequest): Promise<DocumentSnapshot>;
  discardRecovery(request: RecoveryIdRequest): Promise<void>;
  openExternal(request: OpenExternalRequest): Promise<void>;
  exportHtml(request: ExportContentRequest): Promise<boolean>;
  exportPdf(request: ExportPdfRequest): Promise<boolean>;
  copyHtml(request: CopyHtmlRequest): Promise<void>;
  openWorkspace(): Promise<WorkspaceSnapshot | null>;
  refreshWorkspace(): Promise<WorkspaceSnapshot | null>;
  openWorkspaceFile(request: WorkspacePathRequest): Promise<DocumentSnapshot>;
  searchWorkspace(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult[]>;
  workspaceMentions(request: WorkspaceMentionsRequest): Promise<WorkspaceMention[]>;
  importImage(request: DocumentIdRequest): Promise<ImportedImage | null>;
  pasteImage(request: DocumentIdRequest): Promise<ImportedImage | null>;
  readLocalAsset(request: LocalAssetRequest): Promise<LocalAsset>;
  restoreSession(): Promise<DocumentSnapshot[]>;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  onExternalChange(listener: (event: ExternalChangeEvent) => void): () => void;
}

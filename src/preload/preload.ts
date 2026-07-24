import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';

import {
  createDocumentRequestSchema,
  copyHtmlRequestSchema,
  documentContentRequestSchema,
  documentIdRequestSchema,
  documentSnapshotSchema,
  desktopPlatformSchema,
  discardCloseRequestSchema,
  externalChangeEventSchema,
  exportContentRequestSchema,
  exportPdfRequestSchema,
  IPC,
  importedImageSchema,
  localAssetRequestSchema,
  localAssetSchema,
  markEditedRequestSchema,
  menuCommandSchema,
  openExternalRequestSchema,
  recoveryIdRequestSchema,
  recoveryListResultSchema,
  recoveryReceiptSchema,
  reloadDocumentRequestSchema,
  saveConflictSchema,
  saveResultSchema,
  unsavedDecisionSchema,
  workspaceMentionSchema,
  workspaceMentionsRequestSchema,
  workspacePathRequestSchema,
  workspaceSearchRequestSchema,
  workspaceSearchResultSchema,
  workspaceSnapshotSchema,
  zoomDirectionSchema,
  type DesktopApi,
} from '../shared/contracts';

const api: DesktopApi = {
  platform: desktopPlatformSchema.parse(process.platform),
  async changeZoom(direction) {
    await ipcRenderer.invoke(IPC.changeZoom, zoomDirectionSchema.parse(direction));
  },
  async createDocument(request) {
    const result = await ipcRenderer.invoke(
      IPC.createDocument,
      createDocumentRequestSchema.parse(request),
    );
    return documentSnapshotSchema.parse(result);
  },
  async openDocument() {
    const result = await ipcRenderer.invoke(IPC.openDocument);
    return result === null ? null : documentSnapshotSchema.parse(result);
  },
  async closeDocument(request) {
    await ipcRenderer.invoke(
      IPC.closeDocument,
      documentIdRequestSchema.parse(request),
    );
  },
  async reloadDocument(request) {
    const result = await ipcRenderer.invoke(
      IPC.reloadDocument,
      reloadDocumentRequestSchema.parse(request),
    );
    return documentSnapshotSchema.parse(result);
  },
  async saveDocument(request) {
    const result = await ipcRenderer.invoke(
      IPC.saveDocument,
      documentContentRequestSchema.parse(request),
    );
    return saveResultSchema.parse(result);
  },
  async saveDocumentAs(request) {
    const result = await ipcRenderer.invoke(
      IPC.saveDocumentAs,
      documentContentRequestSchema.parse(request),
    );
    return saveResultSchema.parse(result);
  },
  async inspectConflict(request) {
    const result = await ipcRenderer.invoke(
      IPC.inspectConflict,
      documentContentRequestSchema.parse(request),
    );
    return saveConflictSchema.parse(result);
  },
  markEdited(request) {
    ipcRenderer.sendSync(
      IPC.markEdited,
      markEditedRequestSchema.parse(request),
    );
  },
  async confirmUnsavedChanges() {
    const result = await ipcRenderer.invoke(IPC.confirmUnsavedChanges);
    return unsavedDecisionSchema.parse(result);
  },
  async completeDiscardClose(request) {
    const result = await ipcRenderer.invoke(
      IPC.completeDiscardClose,
      discardCloseRequestSchema.parse(request),
    );
    return z.boolean().parse(result);
  },
  async writeRecovery(request) {
    const result = await ipcRenderer.invoke(
      IPC.writeRecovery,
      documentContentRequestSchema.parse(request),
    );
    return recoveryReceiptSchema.parse(result);
  },
  async listRecoveries() {
    const result = await ipcRenderer.invoke(IPC.listRecoveries);
    return recoveryListResultSchema.parse(result);
  },
  async restoreRecovery(request) {
    const result = await ipcRenderer.invoke(
      IPC.restoreRecovery,
      recoveryIdRequestSchema.parse(request),
    );
    return documentSnapshotSchema.parse(result);
  },
  async discardRecovery(request) {
    await ipcRenderer.invoke(
      IPC.discardRecovery,
      recoveryIdRequestSchema.parse(request),
    );
  },
  async openExternal(request) {
    await ipcRenderer.invoke(
      IPC.openExternal,
      openExternalRequestSchema.parse(request),
    );
  },
  async exportHtml(request) {
    const result = await ipcRenderer.invoke(
      IPC.exportHtml,
      exportContentRequestSchema.parse(request),
    );
    return z.boolean().parse(result);
  },
  async exportPdf(request) {
    const result = await ipcRenderer.invoke(
      IPC.exportPdf,
      exportPdfRequestSchema.parse(request),
    );
    return z.boolean().parse(result);
  },
  async copyHtml(request) {
    await ipcRenderer.invoke(
      IPC.copyHtml,
      copyHtmlRequestSchema.parse(request),
    );
  },
  async openWorkspace() {
    const result = await ipcRenderer.invoke(IPC.openWorkspace);
    return result === null ? null : workspaceSnapshotSchema.parse(result);
  },
  async refreshWorkspace() {
    const result = await ipcRenderer.invoke(IPC.refreshWorkspace);
    return result === null ? null : workspaceSnapshotSchema.parse(result);
  },
  async openWorkspaceFile(request) {
    const result = await ipcRenderer.invoke(
      IPC.openWorkspaceFile,
      workspacePathRequestSchema.parse(request),
    );
    return documentSnapshotSchema.parse(result);
  },
  async searchWorkspace(request) {
    const result = await ipcRenderer.invoke(
      IPC.searchWorkspace,
      workspaceSearchRequestSchema.parse(request),
    );
    return z.array(workspaceSearchResultSchema).max(100).parse(result);
  },
  async workspaceMentions(request) {
    const result = await ipcRenderer.invoke(
      IPC.workspaceMentions,
      workspaceMentionsRequestSchema.parse(request),
    );
    return z.array(workspaceMentionSchema).max(100).parse(result);
  },
  async importImage(request) {
    const result = await ipcRenderer.invoke(
      IPC.importImage,
      documentIdRequestSchema.parse(request),
    );
    return result === null ? null : importedImageSchema.parse(result);
  },
  async pasteImage(request) {
    const result = await ipcRenderer.invoke(
      IPC.pasteImage,
      documentIdRequestSchema.parse(request),
    );
    return result === null ? null : importedImageSchema.parse(result);
  },
  async readLocalAsset(request) {
    const result = await ipcRenderer.invoke(
      IPC.readLocalAsset,
      localAssetRequestSchema.parse(request),
    );
    return localAssetSchema.parse(result);
  },
  async restoreSession() {
    const result = await ipcRenderer.invoke(IPC.restoreSession);
    return z.array(documentSnapshotSchema).max(12).parse(result);
  },
  rendererReady() {
    ipcRenderer.send(IPC.rendererReady);
  },
  acknowledgeSystemOpen() {
    ipcRenderer.send(IPC.systemOpenHandled);
  },
  onMenuCommand(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(menuCommandSchema.parse(value));
    };
    ipcRenderer.on(IPC.menuCommand, wrapped);
    return () => ipcRenderer.removeListener(IPC.menuCommand, wrapped);
  },
  onSystemOpenDocument(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(documentSnapshotSchema.parse(value));
    };
    ipcRenderer.on(IPC.systemOpenDocument, wrapped);
    return () => ipcRenderer.removeListener(IPC.systemOpenDocument, wrapped);
  },
  onExternalChange(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(externalChangeEventSchema.parse(value));
    };
    ipcRenderer.on(IPC.externalChange, wrapped);
    return () => ipcRenderer.removeListener(IPC.externalChange, wrapped);
  },
};

contextBridge.exposeInMainWorld('desktop', api);

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  createDocumentRequestSchema,
  copyHtmlRequestSchema,
  discardCloseRequestSchema,
  documentContentRequestSchema,
  documentIdRequestSchema,
  exportContentRequestSchema,
  exportPdfRequestSchema,
  localAssetRequestSchema,
  IPC,
  markEditedRequestSchema,
  menuCommandSchema,
  openExternalRequestSchema,
  recoveryIdRequestSchema,
  reloadDocumentRequestSchema,
  unsavedDecisionSchema,
  workspaceMentionsRequestSchema,
  workspacePathRequestSchema,
  workspaceSearchRequestSchema,
  zoomDirectionSchema,
  type ExternalChangeEvent,
  type MenuCommand,
  type SaveResult,
} from '../shared/contracts';
import { DocumentService } from './documents/documentService';
import { writeFileAtomically } from './documents/filePrimitives';
import {
  findWorkspaceMentions,
  resolveWorkspacePath,
  scanWorkspace,
  searchWorkspace,
} from './workspace/workspaceService';
import {
  checksumForAsset,
  parseUpdateChannelManifest,
  selectManifestUpdate,
  selectUpdate,
  type PublicRelease,
  type UpdateChannelManifest,
  type UpdateCandidate,
} from './updates/updatePrimitives';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function exportedHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{max-width:780px;margin:0 auto;padding:48px 28px 100px;color:#282b29;background:#fff;font:17px/1.75 Georgia,serif}
h1,h2,h3,h4,h5,h6{font-family:system-ui,sans-serif;line-height:1.25}a{color:#236b5a}img,svg{max-width:100%;height:auto}
pre{overflow:auto;padding:16px;border-radius:8px;background:#f3f1eb}code{font-family:Consolas,monospace}table{width:100%;border-collapse:collapse}
th,td{padding:8px 10px;border:1px solid #d8d5cd;text-align:left}blockquote{margin-left:0;padding-left:18px;border-left:3px solid #7fa697;color:#656862}
.table-of-contents,.front-matter{margin:24px 0;padding:14px 18px;border:1px solid #d8d5cd;border-radius:8px;background:#f7f5ef;font-family:system-ui,sans-serif}
.table-of-contents ol{list-style:none;padding:0}.toc-level-2{margin-left:16px}.toc-level-3{margin-left:32px}.toc-level-4,.toc-level-5,.toc-level-6{margin-left:48px}
.front-matter dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 14px}.front-matter dd{margin:0}.markdown-alert{padding:12px 16px;border-radius:0 8px 8px 0;background:#edf5f1}
@media(prefers-color-scheme:dark){body{color:#e8e8e1;background:#242825}pre{background:#202422}th,td{border-color:#454a47}}
</style></head><body>${body}</body></html>`;
}

type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';

const IMAGE_MIME_TYPES = new Map<string, ImageMimeType>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
] as const);

function relativeImageTarget(documentPath: string, rawRelativePath: string): string {
  const decoded = decodeURIComponent(rawRelativePath.split(/[?#]/, 1)[0]);
  const folder = dirname(documentPath);
  const target = resolve(folder, ...decoded.replaceAll('\\', '/').split('/'));
  const prefix = `${resolve(folder)}${sep}`;
  const normalizedPrefix = process.platform === 'win32' ? prefix.toLocaleLowerCase('en-US') : prefix;
  const normalizedTarget = process.platform === 'win32' ? target.toLocaleLowerCase('en-US') : target;
  if (!normalizedTarget.startsWith(normalizedPrefix)) throw new Error('The image is outside the document folder.');
  return target;
}

async function storeImageBytes(
  documentPath: string,
  originalName: string,
  extension: string,
  bytes: Buffer,
): Promise<{ markdownPath: string; fileName: string }> {
  if (bytes.byteLength > 25_000_000) throw new Error('Images must be smaller than 25 MB.');
  if (!IMAGE_MIME_TYPES.has(extension)) throw new Error('Unsupported image format.');
  const assetFolderName = `${basename(documentPath, extname(documentPath))}-assets`;
  const assetFolder = join(dirname(documentPath), assetFolderName);
  const originalBase = originalName.replace(/[^\p{L}\p{N}._ -]+/gu, '-').slice(0, 120) || 'image';
  let fileName = `${originalBase}${extension}`;
  let target = join(assetFolder, fileName);
  for (let index = 2; index < 10_000; index += 1) {
    try {
      await stat(target);
      fileName = `${originalBase}-${index}${extension}`;
      target = join(assetFolder, fileName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  await writeFileAtomically(target, bytes);
  return {
    markdownPath: `${encodeURIComponent(assetFolderName)}/${encodeURIComponent(fileName)}`,
    fileName,
  };
}

function handleSquirrelStartup(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) return false;

  const squirrelEvent = process.argv[1];
  const executableName = basename(process.execPath);
  const legacyExecutableName = 'Markdown Editor.exe';
  const shortcutOperations: Array<[string, string]> =
    squirrelEvent === '--squirrel-install'
      ? [['--createShortcut', executableName]]
      : squirrelEvent === '--squirrel-updated'
        ? [
            ['--removeShortcut', legacyExecutableName],
            ['--createShortcut', executableName],
          ]
        : squirrelEvent === '--squirrel-uninstall'
          ? [
              ['--removeShortcut', executableName],
              ['--removeShortcut', legacyExecutableName],
            ]
          : [];
  if (shortcutOperations.length === 0 && squirrelEvent !== '--squirrel-obsolete') return false;

  const registry = (args: string[]): void => {
    const result = spawnSync('reg.exe', args, {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      console.error(`Windows file association command failed: reg.exe ${args.join(' ')}`, result.error ?? result.stderr);
    }
  };
  const addDefault = (key: string, value: string): void =>
    registry(['ADD', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f']);
  const addValue = (key: string, name: string, value: string): void =>
    registry(['ADD', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f']);
  const removeKey = (key: string): void =>
    registry(['DELETE', key, '/f']);
  const removeValue = (key: string, name: string): void =>
    registry(['DELETE', key, '/v', name, '/f']);

  if (squirrelEvent === '--squirrel-install' || squirrelEvent === '--squirrel-updated') {
    const classes = 'HKCU\\Software\\Classes';
    const applicationKey = `${classes}\\Applications\\${executableName}`;
    const progId = 'Inkstill.Markdown';
    const progIdKey = `${classes}\\${progId}`;
    const capabilitiesKey = 'HKCU\\Software\\Inkstill\\Capabilities';
    const openCommand = `"${process.execPath}" "%1"`;

    addValue(applicationKey, 'FriendlyAppName', 'Inkstill');
    addDefault(`${applicationKey}\\shell\\open\\command`, openCommand);
    for (const extension of ['.md', '.markdown', '.txt']) {
      addValue(`${applicationKey}\\SupportedTypes`, extension, '');
      addValue(`${classes}\\${extension}\\OpenWithProgids`, progId, '');
      addValue(`${capabilitiesKey}\\FileAssociations`, extension, progId);
    }
    addDefault(progIdKey, 'Markdown document');
    addDefault(`${progIdKey}\\DefaultIcon`, `${process.execPath},0`);
    addDefault(`${progIdKey}\\shell\\open\\command`, openCommand);
    addValue(capabilitiesKey, 'ApplicationName', 'Inkstill');
    addValue(capabilitiesKey, 'ApplicationDescription', 'A focused Markdown editor and workspace.');
    addValue('HKCU\\Software\\RegisteredApplications', 'Inkstill', 'Software\\Inkstill\\Capabilities');
  } else if (squirrelEvent === '--squirrel-uninstall') {
    const classes = 'HKCU\\Software\\Classes';
    for (const extension of ['.md', '.markdown', '.txt']) {
      removeValue(`${classes}\\${extension}\\OpenWithProgids`, 'Inkstill.Markdown');
    }
    removeKey(`${classes}\\Applications\\${executableName}`);
    removeKey(`${classes}\\Inkstill.Markdown`);
    removeKey('HKCU\\Software\\Inkstill');
    removeValue('HKCU\\Software\\RegisteredApplications', 'Inkstill');
  }

  if (shortcutOperations.length > 0) {
    const applicationFolder = resolve(process.execPath, '..');
    const updateExecutable = resolve(applicationFolder, '..', 'Update.exe');
    const uniqueOperations = new Map(
      shortcutOperations.map((operation) => [operation.join('\0'), operation]),
    );
    for (const [operation, target] of uniqueOperations.values()) {
      try {
        const child = spawn(
          updateExecutable,
          [operation, target],
          { detached: true, stdio: 'ignore' },
        );
        child.unref();
      } catch (error) {
        console.error(`Squirrel ${operation} failed for ${target}`, error);
      }
    }
  }

  app.quit();
  return true;
}

const squirrelStartupHandled = handleSquirrelStartup();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

if (
  !app.isPackaged &&
  process.env.PLAYWRIGHT_TEST === '1' &&
  process.env.MARKDOWN_EDITOR_USER_DATA_DIR
) {
  app.setPath('userData', process.env.MARKDOWN_EDITOR_USER_DATA_DIR);
} else if (
  app.isPackaged &&
  process.platform === 'win32' &&
  !app.commandLine.hasSwitch('user-data-dir')
) {
  // Keep existing drafts available after the public product name changes.
  app.setPath('userData', resolve(app.getPath('appData'), 'Markdown Editor'));
}

app.enableSandbox();

let mainWindow: BrowserWindow | null = null;
let documentService: DocumentService | null = null;
let workspaceRoot: string | null = null;
let permitWindowClose = false;
let allowApplicationQuit = false;
let quitRequested = false;
let closePromptOpen = false;
let closeAfterSave = false;
let discardClosePending = false;
let shutdownInProgress = false;
let shutdownComplete = false;
let windowCleanup: Promise<void> | null = null;
let rendererReady = false;
let systemOpenInFlight = false;
let updateCheckInFlight = false;
const pendingSystemOpenPaths: string[] = [];

const devServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(devServerUrl);

function lastSessionPath(): string {
  return join(app.getPath('userData'), 'last-session.json');
}

async function persistLastSession(): Promise<void> {
  const paths = documentService?.sessionPaths().slice(0, 12) ?? [];
  await writeFileAtomically(
    lastSessionPath(),
    Buffer.from(JSON.stringify({ version: 1, paths }, null, 2), 'utf8'),
  );
}

function sendMenuCommand(command: MenuCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC.menuCommand, menuCommandSchema.parse(command));
}

const APPLICATION_ZOOM_FACTORS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function changeApplicationZoom(direction: -1 | 0 | 1): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (direction === 0) {
    mainWindow.webContents.setZoomFactor(1);
    return;
  }

  const current = mainWindow.webContents.getZoomFactor();
  const next = direction > 0
    ? APPLICATION_ZOOM_FACTORS.find((factor) => factor > current + 0.001)
    : [...APPLICATION_ZOOM_FACTORS].reverse().find((factor) => factor < current - 0.001);
  if (next !== undefined) mainWindow.webContents.setZoomFactor(next);
}

// Keep in sync with the Open dialog filters (documentService) and the
// workspace scanner: every extension the app can open must also be accepted
// when the operating system hands us a file.
const supportedDocumentExtensions = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

function queueSystemOpenPath(candidate: string): void {
  if (!candidate || candidate.startsWith('-')) return;
  const target = resolve(candidate);
  if (!supportedDocumentExtensions.has(extname(target).toLocaleLowerCase('en-US'))) return;
  if (!pendingSystemOpenPaths.includes(target)) pendingSystemOpenPaths.push(target);
}

function queueSystemOpenArguments(commandLine: string[]): void {
  for (const argument of commandLine) queueSystemOpenPath(argument);
}

// Capture launch arguments before window creation. On Windows an Open With launch can
// reach the renderer immediately, so queuing only after loadURL risks missing its
// one-time ready handshake.
if (!squirrelStartupHandled) {
  queueSystemOpenArguments(process.argv.slice(app.isPackaged ? 1 : 2));
}

async function dispatchNextSystemOpen(): Promise<void> {
  if (
    !rendererReady ||
    systemOpenInFlight ||
    !documentService ||
    !mainWindow ||
    mainWindow.isDestroyed()
  ) return;

  const target = pendingSystemOpenPaths.shift();
  if (!target) return;
  try {
    const document = await documentService.openDocumentPath(target);
    if (!mainWindow || mainWindow.isDestroyed()) {
      pendingSystemOpenPaths.unshift(target);
      return;
    }
    systemOpenInFlight = true;
    mainWindow.webContents.send(IPC.systemOpenDocument, document);
  } catch (error) {
    console.error(`Unable to open ${target}`, error);
    void dispatchNextSystemOpen();
  }
}

const RELEASES_API = 'https://api.github.com/repos/ScotteLiu/Inkstill/releases?per_page=10';
const UPDATE_MANIFEST_URL = 'https://scotteliu.github.io/Inkstill/updates/windows-preview.json';
const MAX_RELEASE_RESPONSE_BYTES = 2_000_000;
const MAX_MANIFEST_RESPONSE_BYTES = 64_000;
const MAX_CHECKSUM_RESPONSE_BYTES = 256_000;
const MAX_INSTALLER_BYTES = 250_000_000;
const AUTOMATIC_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTOMATIC_UPDATE_JITTER_MS = 30 * 60 * 1000;

class UpdateHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly resetAt: Date | null,
  ) {
    super(message);
  }
}

async function responseText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.ok) {
    const resetSeconds = Number(response.headers.get('x-ratelimit-reset') ?? Number.NaN);
    const resetAt = Number.isFinite(resetSeconds)
      ? new Date(resetSeconds * 1000)
      : null;
    const resetDetail = resetAt
      ? ` Try again after ${resetAt.toLocaleString()}.`
      : '';
    throw new UpdateHttpError(
      `The update service returned HTTP ${response.status}.${resetDetail}`,
      response.status,
      resetAt,
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new Error('The update response is unexpectedly large.');
  }
  return text;
}

function parsePublicReleases(value: unknown): PublicRelease[] {
  if (!Array.isArray(value)) throw new Error('GitHub returned an invalid release list.');
  return value.flatMap((item): PublicRelease[] => {
    if (!item || typeof item !== 'object') return [];
    const release = item as Record<string, unknown>;
    if (
      typeof release.tag_name !== 'string'
      || (typeof release.name !== 'string' && release.name !== null)
      || typeof release.draft !== 'boolean'
      || typeof release.prerelease !== 'boolean'
      || typeof release.html_url !== 'string'
      || !Array.isArray(release.assets)
    ) return [];
    const assets = release.assets.flatMap((item): PublicRelease['assets'] => {
      if (!item || typeof item !== 'object') return [];
      const asset = item as Record<string, unknown>;
      return typeof asset.name === 'string'
        && typeof asset.browser_download_url === 'string'
        && typeof asset.size === 'number'
        ? [{
            name: asset.name,
            browser_download_url: asset.browser_download_url,
            size: asset.size,
          }]
        : [];
    });
    return [{
      tag_name: release.tag_name,
      name: release.name,
      draft: release.draft,
      prerelease: release.prerelease,
      html_url: release.html_url,
      assets,
    }];
  });
}

async function sha256(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function downloadVerifiedInstaller(candidate: UpdateCandidate): Promise<string> {
  if (candidate.installer.size > MAX_INSTALLER_BYTES) {
    throw new Error('The update installer is larger than the permitted limit.');
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `Inkstill/${app.getVersion()}`,
  };
  let expectedHash = candidate.expectedSha256 ?? null;
  if (!expectedHash && candidate.checksums) {
    const checksumResponse = await net.fetch(candidate.checksums.browser_download_url, { headers });
    const checksumText = await responseText(checksumResponse, MAX_CHECKSUM_RESPONSE_BYTES);
    expectedHash = checksumForAsset(checksumText, candidate.installer.name);
  }
  if (!expectedHash) throw new Error('The release does not contain a checksum for its installer.');

  const updateFolder = join(app.getPath('temp'), 'Inkstill', 'updates');
  const target = join(updateFolder, `Inkstill-${candidate.version}-Setup.exe`);
  const partial = `${target}.partial`;
  await mkdir(updateFolder, { recursive: true });
  try {
    if ((await sha256(target)) === expectedHash) return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await rm(partial, { force: true });
  const response = await net.fetch(candidate.installer.browser_download_url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`The installer download failed with HTTP ${response.status}.`);
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_INSTALLER_BYTES) {
    throw new Error('The update installer is larger than the permitted limit.');
  }
  let downloadedBytes = 0;
  const sizeLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.byteLength;
      callback(
        downloadedBytes > MAX_INSTALLER_BYTES
          ? new Error('The update installer exceeded the permitted limit.')
          : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      sizeLimit,
      createWriteStream(partial, { flags: 'wx' }),
    );
    if (downloadedBytes !== candidate.installer.size) {
      throw new Error('The downloaded installer size does not match the update manifest.');
    }
    if ((await sha256(partial)) !== expectedHash) {
      throw new Error('The downloaded installer failed SHA-256 verification.');
    }
    await rm(target, { force: true });
    await rename(partial, target);
    return target;
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

function updatePreferencesPath(): string {
  return join(app.getPath('userData'), 'update-preferences.json');
}

interface UpdatePreferences {
  schemaVersion: 1;
  declinedVersion?: string;
  manifestEtag?: string;
  cachedManifest?: UpdateChannelManifest;
  lastSuccessfulCheckAt?: string;
  nextAutomaticCheckAt?: string;
  failureCount?: number;
}

function emptyUpdatePreferences(): UpdatePreferences {
  return { schemaVersion: 1 };
}

async function readUpdatePreferences(): Promise<UpdatePreferences> {
  try {
    const parsed = JSON.parse(await readFile(updatePreferencesPath(), 'utf8')) as Record<string, unknown>;
    if (parsed.schemaVersion !== 1) return emptyUpdatePreferences();
    const cachedManifest = parseUpdateChannelManifest(parsed.cachedManifest);
    return {
      schemaVersion: 1,
      ...(typeof parsed.declinedVersion === 'string'
        ? { declinedVersion: parsed.declinedVersion }
        : {}),
      ...(typeof parsed.manifestEtag === 'string'
        ? { manifestEtag: parsed.manifestEtag }
        : {}),
      ...(cachedManifest ? { cachedManifest } : {}),
      ...(typeof parsed.lastSuccessfulCheckAt === 'string'
        ? { lastSuccessfulCheckAt: parsed.lastSuccessfulCheckAt }
        : {}),
      ...(typeof parsed.nextAutomaticCheckAt === 'string'
        ? { nextAutomaticCheckAt: parsed.nextAutomaticCheckAt }
        : {}),
      ...(typeof parsed.failureCount === 'number'
        && Number.isInteger(parsed.failureCount)
        && parsed.failureCount >= 0
        ? { failureCount: Math.min(parsed.failureCount, 8) }
        : {}),
    };
  } catch {
    return emptyUpdatePreferences();
  }
}

async function writeUpdatePreferences(preferences: UpdatePreferences): Promise<void> {
  try {
    await writeFileAtomically(
      updatePreferencesPath(),
      Buffer.from(JSON.stringify(preferences, null, 2), 'utf8'),
    );
  } catch (error) {
    console.error('Unable to save update preferences', error);
  }
}

function nextSuccessfulAutomaticCheck(): string {
  return new Date(
    Date.now()
    + AUTOMATIC_UPDATE_INTERVAL_MS
    + Math.floor(Math.random() * AUTOMATIC_UPDATE_JITTER_MS),
  ).toISOString();
}

function nextFailedAutomaticCheck(failureCount: number, resetAt?: Date | null): string {
  const exponentialDelay = Math.min(
    15 * 60 * 1000 * (2 ** Math.max(0, failureCount - 1)),
    AUTOMATIC_UPDATE_INTERVAL_MS,
  );
  const retryAt = Date.now() + exponentialDelay;
  return new Date(Math.max(retryAt, resetAt?.getTime() ?? 0)).toISOString();
}

function automaticCheckDue(preferences: UpdatePreferences): boolean {
  const nextCheck = Date.parse(preferences.nextAutomaticCheckAt ?? '');
  return !Number.isFinite(nextCheck) || nextCheck <= Date.now();
}

async function fetchManifestUpdate(
  preferences: UpdatePreferences,
): Promise<{ candidate: UpdateCandidate | null; manifest: UpdateChannelManifest; etag?: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': `Inkstill/${app.getVersion()}`,
  };
  if (preferences.manifestEtag) headers['If-None-Match'] = preferences.manifestEtag;

  let response = await net.fetch(UPDATE_MANIFEST_URL, {
    headers,
    cache: 'no-cache',
  });
  if (response.status === 304) {
    if (preferences.cachedManifest) {
      return {
        candidate: selectManifestUpdate(preferences.cachedManifest, app.getVersion()),
        manifest: preferences.cachedManifest,
        ...(preferences.manifestEtag ? { etag: preferences.manifestEtag } : {}),
      };
    }
    response = await net.fetch(UPDATE_MANIFEST_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `Inkstill/${app.getVersion()}`,
      },
      cache: 'reload',
    });
  }

  const parsed = JSON.parse(await responseText(response, MAX_MANIFEST_RESPONSE_BYTES));
  const manifest = parseUpdateChannelManifest(parsed);
  if (!manifest) throw new Error('The update channel returned an invalid manifest.');
  const etag = response.headers.get('etag') ?? undefined;
  return {
    candidate: selectManifestUpdate(manifest, app.getVersion()),
    manifest,
    ...(etag ? { etag } : {}),
  };
}

async function fetchGitHubUpdate(): Promise<UpdateCandidate | null> {
  const response = await net.fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `Inkstill/${app.getVersion()}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const releases = parsePublicReleases(JSON.parse(
    await responseText(response, MAX_RELEASE_RESPONSE_BYTES),
  ));
  return selectUpdate(releases, app.getVersion());
}

async function updateDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
}

async function checkForUpdates(manual: boolean): Promise<void> {
  if (!app.isPackaged || process.platform !== 'win32') {
    if (manual) {
      await updateDialog({
        type: 'info',
        title: 'Updates',
        message: 'Automatic updates are available in the installed Windows edition.',
        buttons: ['OK'],
      });
    }
    return;
  }
  if (updateCheckInFlight) {
    if (manual) {
      await updateDialog({
        type: 'info',
        title: 'Updates',
        message: 'Inkstill is already checking for an update.',
        buttons: ['OK'],
      });
    }
    return;
  }

  let preferences = await readUpdatePreferences();
  if (!manual && !automaticCheckDue(preferences)) return;

  updateCheckInFlight = true;
  try {
    let candidate: UpdateCandidate | null;
    try {
      const result = await fetchManifestUpdate(preferences);
      candidate = result.candidate;
      preferences = {
        ...preferences,
        cachedManifest: result.manifest,
        ...(result.etag ? { manifestEtag: result.etag } : {}),
      };
    } catch (manifestError) {
      if (!manual) throw manifestError;
      console.warn('Static update channel unavailable; trying the GitHub API', manifestError);
      candidate = await fetchGitHubUpdate();
    }

    preferences = {
      ...preferences,
      lastSuccessfulCheckAt: new Date().toISOString(),
      nextAutomaticCheckAt: nextSuccessfulAutomaticCheck(),
      failureCount: 0,
    };
    await writeUpdatePreferences(preferences);

    if (!candidate) {
      if (manual) {
        await updateDialog({
          type: 'info',
          title: 'Inkstill is up to date',
          message: `You have the latest version (${app.getVersion()}).`,
          buttons: ['OK'],
        });
      }
      return;
    }
    // A declined version is only re-offered when the user checks manually.
    if (!manual && preferences.declinedVersion === candidate.version) return;

    const decision = await updateDialog({
      type: 'info',
      title: 'Inkstill update available',
      message: `${candidate.releaseName} is available.`,
      detail: 'Download the verified installer in the background? Your open documents will not be interrupted.',
      buttons: ['Download', 'Later', 'View Release'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (decision.response === 2) {
      await shell.openExternal(candidate.releaseUrl);
      return;
    }
    if (decision.response !== 0) {
      preferences = { ...preferences, declinedVersion: candidate.version };
      await writeUpdatePreferences(preferences);
      return;
    }

    mainWindow?.setProgressBar(2);
    const installer = await downloadVerifiedInstaller(candidate);
    mainWindow?.setProgressBar(-1);
    const installDecision = await updateDialog({
      type: 'info',
      title: 'Update ready',
      message: `Inkstill ${candidate.version} has been downloaded and verified.`,
      detail: 'Open the installer now? Your current document remains open; restart Inkstill after installation.',
      buttons: ['Install Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (installDecision.response === 0) {
      const error = await shell.openPath(installer);
      if (error) throw new Error(error);
    }
  } catch (error) {
    mainWindow?.setProgressBar(-1);
    console.error('Update check failed', error);
    const failureCount = Math.min((preferences.failureCount ?? 0) + 1, 8);
    preferences = {
      ...preferences,
      failureCount,
      nextAutomaticCheckAt: nextFailedAutomaticCheck(
        failureCount,
        error instanceof UpdateHttpError ? error.resetAt : null,
      ),
    };
    await writeUpdatePreferences(preferences);
    if (manual) {
      await updateDialog({
        type: 'error',
        title: 'Unable to check for updates',
        message: 'Inkstill could not securely download an update.',
        detail: error instanceof Error ? error.message : 'Unknown update error.',
        buttons: ['OK'],
      });
    }
  } finally {
    updateCheckInFlight = false;
  }
}

function buildApplicationMenu(): void {
  const modifier = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        } satisfies Electron.MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: `${modifier}+N`, click: () => sendMenuCommand('new') },
        { label: 'Open…', accelerator: `${modifier}+O`, click: () => sendMenuCommand('open') },
        { label: 'Open Folder…', accelerator: `${modifier}+Shift+O`, click: () => sendMenuCommand('open-workspace') },
        { label: 'Refresh Folder', click: () => sendMenuCommand('refresh-workspace') },
        { type: 'separator' },
        { label: 'Save', accelerator: `${modifier}+S`, click: () => sendMenuCommand('save') },
        { label: 'Save As…', accelerator: `${modifier}+Shift+S`, click: () => sendMenuCommand('save-as') },
        { type: 'separator' },
        { label: 'Export HTML…', click: () => sendMenuCommand('export-html') },
        { label: 'Export PDF…', accelerator: `${modifier}+Shift+E`, click: () => sendMenuCommand('export-pdf') },
        { label: 'Copy as HTML', click: () => sendMenuCommand('copy-html') },
        ...(process.platform === 'darwin'
          ? []
          : [
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Exit' },
            ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' },
        { type: 'separator' },
        { label: 'Find', accelerator: `${modifier}+F`, click: () => sendMenuCommand('find') },
        { label: 'Find in Folder', accelerator: `${modifier}+Shift+F`, click: () => sendMenuCommand('find-workspace') },
        { label: 'Command Palette', accelerator: `${modifier}+P`, click: () => sendMenuCommand('command-palette') },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: `${modifier}+Shift+L`,
          click: () => sendMenuCommand('toggle-sidebar'),
        },
        { type: 'separator' },
        {
          label: 'Source Mode',
          accelerator: `${modifier}+/`,
          click: () => sendMenuCommand('toggle-source'),
        },
        { type: 'separator' },
        { label: 'Editor', accelerator: `${modifier}+1`, click: () => sendMenuCommand('view-editor') },
        { label: 'Split Preview', accelerator: `${modifier}+2`, click: () => sendMenuCommand('view-split') },
        { label: 'Preview', accelerator: `${modifier}+3`, click: () => sendMenuCommand('view-preview') },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: `${modifier}+0`, click: () => changeApplicationZoom(0) },
        { label: 'Zoom In', accelerator: `${modifier}+Plus`, click: () => changeApplicationZoom(1) },
        { label: 'Zoom Out', accelerator: `${modifier}+-`, click: () => changeApplicationZoom(-1) },
        { role: 'togglefullscreen', label: 'Full Screen' },
        ...(isDevelopment
          ? ([{ role: 'toggleDevTools', label: 'Developer Tools' }] as Electron.MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: 'Insert',
      submenu: [
        { label: 'Table…', accelerator: `${modifier}+T`, click: () => sendMenuCommand('insert-table') },
      ],
    },
    ...(process.platform === 'darwin'
      ? [{
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' },
          ],
        } satisfies Electron.MenuItemConstructorOptions]
      : []),
    {
      label: 'Help',
      submenu: [
        { label: 'Markdown Cheat Sheet', accelerator: 'F1', click: () => sendMenuCommand('cheat-sheet') },
        ...(process.platform === 'win32'
          ? [
              { type: 'separator' as const },
              { label: 'Check for Updates…', click: () => void checkForUpdates(true) },
            ]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function expectedRenderer(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  if (event.senderFrame !== mainWindow.webContents.mainFrame) return false;

  try {
    const url = new URL(event.senderFrame.url);
    if (devServerUrl) {
      const expected = new URL(devServerUrl);
      return url.origin === expected.origin;
    }
    return url.protocol === 'app:' && url.host === 'bundle';
  } catch {
    return false;
  }
}

function assertExpectedRenderer(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (!expectedRenderer(event)) throw new Error('Rejected untrusted IPC sender.');
}

function registerIpc(): void {
  if (!documentService) throw new Error('Document service is not ready.');
  const service = documentService;

  const finishPendingClose = (result: SaveResult): void => {
    if (!closeAfterSave) return;
    closeAfterSave = false;
    if (result.status !== 'saved' || service.hasDirtyDocuments()) return;

    permitWindowClose = true;
    if (quitRequested) {
      allowApplicationQuit = true;
      app.quit();
      return;
    }
    if (process.platform !== 'darwin') {
      allowApplicationQuit = true;
    }
    mainWindow?.close();
  };

  ipcMain.handle(IPC.changeZoom, (event, raw) => {
    assertExpectedRenderer(event);
    changeApplicationZoom(zoomDirectionSchema.parse(raw));
  });
  ipcMain.handle(IPC.createDocument, (event, raw) => {
    assertExpectedRenderer(event);
    return service.createDocument(createDocumentRequestSchema.parse(raw));
  });
  ipcMain.handle(IPC.openDocument, (event) => {
    assertExpectedRenderer(event);
    return service.openDocument();
  });
  ipcMain.on(IPC.rendererReady, (event) => {
    assertExpectedRenderer(event);
    rendererReady = true;
    void dispatchNextSystemOpen();
  });
  ipcMain.on(IPC.systemOpenHandled, (event) => {
    assertExpectedRenderer(event);
    systemOpenInFlight = false;
    void dispatchNextSystemOpen();
  });
  ipcMain.handle(IPC.closeDocument, (event, raw) => {
    assertExpectedRenderer(event);
    const request = documentIdRequestSchema.parse(raw);
    return service.closeDocument(request.documentId);
  });
  ipcMain.handle(IPC.reloadDocument, (event, raw) => {
    assertExpectedRenderer(event);
    const request = reloadDocumentRequestSchema.parse(raw);
    return service.reloadDocument(request.documentId, request.expectedRevision);
  });
  ipcMain.handle(IPC.saveDocument, async (event, raw) => {
    assertExpectedRenderer(event);
    try {
      const result = await service.saveDocument(
        documentContentRequestSchema.parse(raw),
      );
      finishPendingClose(result);
      return result;
    } catch (error) {
      closeAfterSave = false;
      throw error;
    }
  });
  ipcMain.handle(IPC.saveDocumentAs, async (event, raw) => {
    assertExpectedRenderer(event);
    try {
      const result = await service.saveDocumentAs(
        documentContentRequestSchema.parse(raw),
      );
      finishPendingClose(result);
      return result;
    } catch (error) {
      closeAfterSave = false;
      throw error;
    }
  });
  ipcMain.handle(IPC.inspectConflict, (event, raw) => {
    assertExpectedRenderer(event);
    return service.inspectConflict(documentContentRequestSchema.parse(raw));
  });
  ipcMain.on(IPC.markEdited, (event, raw) => {
    assertExpectedRenderer(event);
    const request = markEditedRequestSchema.parse(raw);
    service.markEdited(request.documentId, request.revision);
    event.returnValue = null;
  });
  ipcMain.handle(IPC.confirmUnsavedChanges, async (event) => {
    assertExpectedRenderer(event);
    if (!mainWindow) return unsavedDecisionSchema.parse('cancel');
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Unsaved Changes',
      message: 'Save changes to this document?',
      buttons: ['Cancel', 'Save', "Don't Save"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    return unsavedDecisionSchema.parse(
      response === 1 ? 'save' : response === 2 ? 'discard' : 'cancel',
    );
  });
  ipcMain.handle(IPC.completeDiscardClose, async (event, raw) => {
    assertExpectedRenderer(event);
    const result = discardCloseRequestSchema.parse(raw);
    if (!discardClosePending) {
      if (!result.success) {
        closeAfterSave = false;
        quitRequested = false;
      }
      return false;
    }
    const receiptVerified = result.success &&
      await service.verifyRecoveryReceipt(result.receipt);
    if (!receiptVerified) {
      discardClosePending = false;
      quitRequested = false;
      if (mainWindow) {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Unable to Preserve Draft',
          message: 'Save this document as a new file first.',
          buttons: ['OK'],
        });
      }
      return false;
    }

    discardClosePending = false;
    permitWindowClose = true;
    if (quitRequested) {
      allowApplicationQuit = true;
      app.quit();
      return true;
    }
    if (process.platform !== 'darwin') {
      allowApplicationQuit = true;
    }
    mainWindow?.close();
    return true;
  });
  ipcMain.handle(IPC.writeRecovery, (event, raw) => {
    assertExpectedRenderer(event);
    return service.writeRecovery(documentContentRequestSchema.parse(raw));
  });
  ipcMain.handle(IPC.listRecoveries, (event) => {
    assertExpectedRenderer(event);
    return service.listRecoveries();
  });
  ipcMain.handle(IPC.restoreRecovery, (event, raw) => {
    assertExpectedRenderer(event);
    const request = recoveryIdRequestSchema.parse(raw);
    return service.restoreRecovery(request.recoveryId);
  });
  ipcMain.handle(IPC.discardRecovery, (event, raw) => {
    assertExpectedRenderer(event);
    const request = recoveryIdRequestSchema.parse(raw);
    return service.discardRecovery(request.recoveryId);
  });
  ipcMain.handle(IPC.openExternal, async (event, raw) => {
    assertExpectedRenderer(event);
    const { url } = openExternalRequestSchema.parse(raw);
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      throw new Error('Only web and email links can be opened externally.');
    }
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle(IPC.exportHtml, async (event, raw) => {
    assertExpectedRenderer(event);
    if (!mainWindow) return false;
    const request = exportContentRequestSchema.parse(raw);
    const base = basename(request.suggestedName, extname(request.suggestedName)) || 'Untitled';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export HTML',
      defaultPath: `${base}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const target = extname(result.filePath) ? result.filePath : `${result.filePath}.html`;
    await writeFileAtomically(
      target,
      Buffer.from(exportedHtml(base, request.html), 'utf8'),
    );
    return true;
  });
  ipcMain.handle(IPC.exportPdf, async (event, raw) => {
    assertExpectedRenderer(event);
    if (!mainWindow) return false;
    const request = exportPdfRequestSchema.parse(raw);
    const base = basename(request.suggestedName, extname(request.suggestedName)) || 'Untitled';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export PDF',
      defaultPath: `${base}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const target = extname(result.filePath) ? result.filePath : `${result.filePath}.pdf`;
    const bytes = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.55, bottom: 0.55, left: 0.6, right: 0.6 },
    });
    await writeFileAtomically(target, bytes);
    return true;
  });
  ipcMain.handle(IPC.copyHtml, (event, raw) => {
    assertExpectedRenderer(event);
    const request = copyHtmlRequestSchema.parse(raw);
    clipboard.writeHTML(request.html);
  });
  ipcMain.handle(IPC.openWorkspace, async (event) => {
    assertExpectedRenderer(event);
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Markdown Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const snapshot = await scanWorkspace(result.filePaths[0]);
    workspaceRoot = snapshot.rootPath;
    return snapshot;
  });
  ipcMain.handle(IPC.refreshWorkspace, async (event) => {
    assertExpectedRenderer(event);
    return workspaceRoot ? scanWorkspace(workspaceRoot) : null;
  });
  ipcMain.handle(IPC.openWorkspaceFile, (event, raw) => {
    assertExpectedRenderer(event);
    if (!workspaceRoot) throw new Error('Open a folder first.');
    const request = workspacePathRequestSchema.parse(raw);
    return service.openDocumentPath(resolveWorkspacePath(workspaceRoot, request.relativePath));
  });
  ipcMain.handle(IPC.searchWorkspace, (event, raw) => {
    assertExpectedRenderer(event);
    if (!workspaceRoot) return [];
    const request = workspaceSearchRequestSchema.parse(raw);
    return searchWorkspace(workspaceRoot, request.query);
  });
  ipcMain.handle(IPC.workspaceMentions, (event, raw) => {
    assertExpectedRenderer(event);
    if (!workspaceRoot) return [];
    const request = workspaceMentionsRequestSchema.parse(raw);
    return findWorkspaceMentions(workspaceRoot, request.noteName);
  });
  ipcMain.handle(IPC.importImage, async (event, raw) => {
    assertExpectedRenderer(event);
    if (!mainWindow) return null;
    const { documentId } = documentIdRequestSchema.parse(raw);
    const documentPath = service.documentPath(documentId);
    if (!documentPath) throw new Error('Save the document before importing an image.');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Insert Image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const source = result.filePaths[0];
    const sourceInfo = await stat(source);
    if (!sourceInfo.isFile() || sourceInfo.size > 25_000_000) {
      throw new Error('Images must be smaller than 25 MB.');
    }
    const extension = extname(source).toLocaleLowerCase('en-US');
    return storeImageBytes(documentPath, basename(source, extname(source)), extension, await readFile(source));
  });
  ipcMain.handle(IPC.pasteImage, async (event, raw) => {
    assertExpectedRenderer(event);
    const { documentId } = documentIdRequestSchema.parse(raw);
    const documentPath = service.documentPath(documentId);
    if (!documentPath) throw new Error('Save the document before pasting an image.');
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    return storeImageBytes(documentPath, 'pasted-image', '.png', image.toPNG());
  });
  ipcMain.handle(IPC.readLocalAsset, async (event, raw) => {
    assertExpectedRenderer(event);
    const request = localAssetRequestSchema.parse(raw);
    const documentPath = service.documentPath(request.documentId);
    if (!documentPath) throw new Error('This document does not have a file location.');
    const target = relativeImageTarget(documentPath, request.relativePath);
    const [realFolder, realTarget] = await Promise.all([
      realpath(dirname(documentPath)),
      realpath(target),
    ]);
    const realPrefix = `${realFolder}${sep}`;
    const normalizedPrefix = process.platform === 'win32' ? realPrefix.toLocaleLowerCase('en-US') : realPrefix;
    const normalizedTarget = process.platform === 'win32' ? realTarget.toLocaleLowerCase('en-US') : realTarget;
    if (!normalizedTarget.startsWith(normalizedPrefix)) throw new Error('The image is outside the document folder.');
    const extension = extname(realTarget).toLocaleLowerCase('en-US');
    const mimeType = IMAGE_MIME_TYPES.get(extension);
    if (!mimeType) throw new Error('Unsupported image format.');
    const info = await stat(realTarget);
    if (!info.isFile() || info.size > 25_000_000) throw new Error('The image is too large to preview.');
    return { mimeType, base64: (await readFile(realTarget)).toString('base64') };
  });
  ipcMain.handle(IPC.restoreSession, async (event) => {
    assertExpectedRenderer(event);
    try {
      const raw = await readFile(lastSessionPath(), 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown; paths?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.paths)) return [];
      const paths = parsed.paths
        .filter((path): path is string => typeof path === 'string' && path.length > 0 && path.length <= 4096)
        .slice(0, 12);
      const restored: Awaited<ReturnType<DocumentService['openDocumentPath']>>[] = [];
      for (const path of paths) {
        try {
          restored.push(await service.openDocumentPath(path));
        } catch {
          // Missing, moved, or unsupported files are skipped without blocking startup.
        }
      }
      return restored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  });
}

function configureSessionSecurity(): void {
  const currentSession = session.defaultSession;
  currentSession.setPermissionCheckHandler(() => false);
  currentSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const productionCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: markdown-asset:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  currentSession.webRequest.onHeadersReceived((details, callback) => {
    if (isDevelopment) return callback({ responseHeaders: details.responseHeaders });
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [productionCsp],
      },
    });
  });
}

async function registerAppProtocol(): Promise<void> {
  if (isDevelopment) return;
  const rendererRoot = resolve(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  await protocol.handle('app', async (request) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }
    let url: URL;
    let relativePath: string;
    try {
      url = new URL(request.url);
      if (url.host !== 'bundle') return new Response('Forbidden', { status: 403 });
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    const target = resolve(rendererRoot, relativePath);
    const allowedPrefix = `${rendererRoot}${sep}`;

    if (target !== resolve(rendererRoot, 'index.html') && !target.startsWith(allowedPrefix)) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(target).toString());
  });
}

async function createMainWindow(): Promise<void> {
  permitWindowClose = false;
  closePromptOpen = false;
  closeAfterSave = false;
  discardClosePending = false;
  rendererReady = false;
  systemOpenInFlight = false;
  if (process.platform === 'darwin' && !quitRequested) {
    allowApplicationQuit = false;
  }

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#f5f2ea',
    ...(process.platform === 'linux'
      ? { icon: resolve(app.getAppPath(), 'assets/icon.png') }
      : {}),
    webPreferences: {
      preload: resolve(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
    },
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (targetUrl !== currentUrl) event.preventDefault();
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt) return;
    const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;
    if (!primaryModifier) return;

    if (input.key === '+' || input.key === '=' || input.code === 'NumpadAdd') {
      event.preventDefault();
      changeApplicationZoom(1);
    } else if (input.key === '-' || input.code === 'NumpadSubtract') {
      event.preventDefault();
      changeApplicationZoom(-1);
    } else if (input.key === '0' || input.code === 'Numpad0') {
      event.preventDefault();
      changeApplicationZoom(0);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (permitWindowClose) {
      permitWindowClose = false;
      return;
    }
    if (!documentService?.hasDirtyDocuments()) return;
    event.preventDefault();
    if (closeAfterSave) return;
    if (closePromptOpen || discardClosePending) return;
    closePromptOpen = true;
    void dialog
      .showMessageBox(mainWindow!, {
        type: 'warning',
        title: 'Unsaved Changes',
        message: 'Save changes to all open documents?',
        buttons: ['Cancel', 'Save', "Don't Save and Exit"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 1) {
          closeAfterSave = true;
          sendMenuCommand('save-and-close');
        } else if (response === 2) {
          discardClosePending = true;
          sendMenuCommand('flush-recovery-and-close');
        } else {
          quitRequested = false;
        }
      })
      .finally(() => {
        closePromptOpen = false;
      });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    systemOpenInFlight = false;
    closeAfterSave = false;
    discardClosePending = false;
    if (process.platform === 'darwin' && !quitRequested) {
      allowApplicationQuit = false;
    }
    windowCleanup = (async () => {
      await persistLastSession().catch((error) => console.error('Session could not be persisted', error));
      await documentService?.close();
    })().finally(() => {
      windowCleanup = null;
    });
  });

  if (devServerUrl) await mainWindow.loadURL(devServerUrl);
  else await mainWindow.loadURL('app://bundle/index.html');
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

const hasSingleInstanceLock = squirrelStartupHandled || app.requestSingleInstanceLock();
if (!squirrelStartupHandled) {
  if (!hasSingleInstanceLock) app.quit();
  app.on('second-instance', (_event, commandLine) => {
    queueSystemOpenArguments(commandLine);
    if (!app.isReady() || !documentService) return;
    void (async () => {
      await windowCleanup;
      if (!mainWindow) await createMainWindow();
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      void dispatchNextSystemOpen();
    })();
  });
}

if (!squirrelStartupHandled) {
  app.on('open-file', (event, path) => {
    event.preventDefault();
    queueSystemOpenPath(path);
    if (!app.isReady() || !documentService) return;
    void (async () => {
      await windowCleanup;
      if (!mainWindow) await createMainWindow();
      void dispatchNextSystemOpen();
    })();
  });
}

if (!squirrelStartupHandled && hasSingleInstanceLock) void app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.markdown_editor.Inkstill');
  configureSessionSecurity();
  await registerAppProtocol();

  const notifyExternalChange = (event: ExternalChangeEvent): void => {
    mainWindow?.webContents.send(IPC.externalChange, event);
  };
  documentService = new DocumentService(notifyExternalChange);
  registerIpc();
  buildApplicationMenu();
  await createMainWindow();
  void dispatchNextSystemOpen();
  if (app.isPackaged && process.platform === 'win32') {
    const initialDelay = 20_000 + Math.floor(Math.random() * 60_000);
    const initialUpdateTimer = setTimeout(() => void checkForUpdates(false), initialDelay);
    initialUpdateTimer.unref();
    const recurringUpdateTimer = setInterval(
      () => void checkForUpdates(false),
      AUTOMATIC_UPDATE_INTERVAL_MS,
    );
    recurringUpdateTimer.unref();
  }

  app.on('activate', () => {
    void (async () => {
      await windowCleanup;
      if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
    })();
  });
});

if (!squirrelStartupHandled) app.on('before-quit', (event) => {
  if (!allowApplicationQuit && documentService?.hasDirtyDocuments()) {
    event.preventDefault();
    quitRequested = true;
    if (!mainWindow) {
      void Promise.resolve(windowCleanup).finally(() => {
        allowApplicationQuit = true;
        app.quit();
      });
      return;
    }
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.close();
    return;
  }

  if (!shutdownComplete) {
    event.preventDefault();
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    void Promise.resolve(documentService?.close())
      .catch((error) => console.error('Shutdown flush failed', error))
      .finally(() => {
        shutdownComplete = true;
        allowApplicationQuit = true;
        app.quit();
      });
  }
});

if (!squirrelStartupHandled) app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

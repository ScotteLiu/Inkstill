import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';

import type {
  DocumentFormat,
  FileSignature,
} from '../../shared/contracts';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_CHARACTERS,
} from '../../shared/contracts';

export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const TRANSACTION_SUFFIX = '.markdown-editor-transaction.json';
const MAX_TRANSACTION_HASH_BYTES = MAX_DOCUMENT_BYTES + 1_000_000;
const pathLockTails = new Map<string, Promise<void>>();

function canonicalPathKey(filePath: string): string {
  const absolutePath = normalize(resolve(filePath));
  return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
}

async function withPathLock<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = canonicalPathKey(filePath);
  const previous = pathLockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const tail = previous.then(() => current);
  pathLockTails.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pathLockTails.get(key) === tail) pathLockTails.delete(key);
  }
}

interface AtomicWriteOptions {
  verifyExpected?: boolean;
  expectedSignature?: FileSignature | null;
  beforeTargetMove?: () => Promise<void>;
}

interface WriteTransaction {
  version: 1;
  targetName: string;
  tempName: string;
  backupName: string;
  newSha256: string;
  expectedSha256: string | null;
  verifyExpected: boolean;
}

export class FileChangedDuringWriteError extends Error {
  constructor(message = 'The file changed during the final write step. Saving was stopped to prevent overwriting it.') {
    super(message);
    this.name = 'FileChangedDuringWriteError';
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeLineEndings(
  content: string,
  eol: '\n' | '\r\n',
): string {
  return content.replace(/\r\n|\r|\n/g, eol);
}

export function detectDocumentFormat(text: string, bom: boolean): DocumentFormat {
  const crlfCount = (text.match(/\r\n/g) ?? []).length;
  const lfCount = (text.match(/(?<!\r)\n/g) ?? []).length;
  const loneCrCount = (text.match(/\r(?!\n)/g) ?? []).length;

  return {
    encoding: 'utf8',
    bom,
    eol: crlfCount > lfCount ? '\r\n' : '\n',
    mixedEol: loneCrCount > 0 || (crlfCount > 0 && lfCount > 0),
  };
}

export function decodeUtf8Document(bytes: Buffer): {
  content: string;
  format: DocumentFormat;
} {
  const bom = bytes.subarray(0, 3).equals(UTF8_BOM);
  const payload = bom ? bytes.subarray(3) : bytes;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const content = decoder.decode(payload);
  return { content, format: detectDocumentFormat(content, bom) };
}

export function encodeUtf8Document(
  content: string,
  format: DocumentFormat,
): Buffer {
  const payload = Buffer.from(content, 'utf8');
  return format.bom ? Buffer.concat([UTF8_BOM, payload]) : payload;
}

async function signatureFromBytes(
  filePath: string,
  bytes: Buffer,
): Promise<FileSignature> {
  const metadata = await stat(filePath);
  return {
    mtimeMs: metadata.mtimeMs,
    size: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  };
}

async function readDiskDocumentUnlocked(filePath: string): Promise<{
  content: string;
  format: DocumentFormat;
  signature: FileSignature;
}> {
  await recoverInterruptedWriteUnlocked(filePath);
  const linkMetadata = await lstat(filePath);
  if (linkMetadata.isSymbolicLink()) {
    throw new Error('To preserve symbolic link behavior, open the linked target file directly.');
  }
  const metadata = await stat(filePath);
  if (metadata.nlink > 1) {
    throw new Error('To preserve hard link behavior, copy this file to a regular file before editing it.');
  }
  if (metadata.size > MAX_DOCUMENT_BYTES) {
    throw new Error('This document is too large to open.');
  }
  const bytes = await readFile(filePath);
  const decoded = decodeUtf8Document(bytes);
  if (decoded.content.length > MAX_DOCUMENT_CHARACTERS) {
    throw new Error('This document exceeds the character limit.');
  }
  return {
    ...decoded,
    signature: await signatureFromBytes(filePath, bytes),
  };
}

export async function readDiskDocument(filePath: string): Promise<{
  content: string;
  format: DocumentFormat;
  signature: FileSignature;
}> {
  return withPathLock(filePath, () => readDiskDocumentUnlocked(filePath));
}

export async function safeDiskState(filePath: string): Promise<{
  signature: FileSignature | null;
  content: string | null;
}> {
  try {
    const disk = await readDiskDocument(filePath);
    return { signature: disk.signature, content: disk.content };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { signature: null, content: null };
    throw error;
  }
}

function transactionPathFor(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}${TRANSACTION_SUFFIX}`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const metadata = await stat(filePath);
  if (metadata.size > MAX_TRANSACTION_HASH_BYTES) {
    throw new FileChangedDuringWriteError('The file grew unexpectedly while saving. Saving was stopped to prevent overwriting it.');
  }
  return sha256Bytes(await readFile(filePath));
}

async function syncDirectory(folder: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directoryHandle = await open(folder, 'r');
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function writeTransaction(
  markerPath: string,
  transaction: WriteTransaction,
): Promise<void> {
  const handle = await open(markerPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(transaction), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function restoreBackupWithoutOverwrite(
  backupPath: string,
  targetPath: string,
): Promise<boolean> {
  try {
    await copyWithoutOverwrite(backupPath, targetPath);
    return true;
  } catch (error) {
    if (['EEXIST', 'EPERM', 'EACCES', 'ENOENT'].includes(
      (error as NodeJS.ErrnoException).code ?? '',
    )) return false;
    throw error;
  }
}

async function copyWithoutOverwrite(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
  const targetHandle = await open(targetPath, 'r+');
  try {
    await targetHandle.sync();
  } finally {
    await targetHandle.close();
  }
  await rm(sourcePath, { force: true });
}

async function preserveBackup(
  backupPath: string,
  targetPath: string,
): Promise<void> {
  if (!(await pathExists(backupPath))) return;
  const rescued = `${targetPath}.markdown-editor-recovered-${Date.now()}-${randomUUID()}.backup`;
  await rename(backupPath, rescued).catch(() => undefined);
}

function validTransaction(
  value: unknown,
  targetName: string,
): value is WriteTransaction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WriteTransaction>;
  const escapedTargetName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uuidV4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const tempName = new RegExp(`^\\.${escapedTargetName}\\.[1-9][0-9]*\\.${uuidV4}\\.tmp$`);
  const backupName = new RegExp(`^\\.${escapedTargetName}\\.${uuidV4}\\.markdown-editor-backup$`);
  const generatedArtifactNamesAreValid =
    typeof item.tempName === 'string' &&
    typeof item.backupName === 'string' &&
    item.tempName !== item.backupName &&
    tempName.test(item.tempName) &&
    backupName.test(item.backupName);
  return item.version === 1 &&
    item.targetName === targetName &&
    generatedArtifactNamesAreValid &&
    typeof item.newSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(item.newSha256) &&
    (item.expectedSha256 === null || (
      typeof item.expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(item.expectedSha256)
    )) &&
    typeof item.verifyExpected === 'boolean';
}

async function recoverInterruptedWriteUnlocked(targetPath: string): Promise<void> {
  const markerPath = transactionPathFor(targetPath);
  let transaction: WriteTransaction;
  try {
    const markerMetadata = await stat(markerPath);
    if (markerMetadata.size > 64 * 1024) throw new Error('Oversized write transaction marker.');
    const parsed: unknown = JSON.parse(await readFile(markerPath, 'utf8'));
    if (!validTransaction(parsed, basename(targetPath))) {
      throw new Error('Invalid write transaction.');
    }
    transaction = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    await rename(markerPath, `${markerPath}.corrupt-${Date.now()}`).catch(() => undefined);
    return;
  }

  const folder = dirname(targetPath);
  const tempPath = join(folder, transaction.tempName);
  const backupPath = join(folder, transaction.backupName);
  const targetPresent = await pathExists(targetPath);
  const backupPresent = await pathExists(backupPath);
  const tempPresent = await pathExists(tempPath);
  const recoveryConflict = (detail: string): never => {
    throw new FileChangedDuringWriteError(
      `Interrupted write conflicts with the current disk state (${detail}); recovery evidence was preserved.`,
    );
  };

  if (targetPresent && await hashFile(targetPath) === transaction.newSha256) {
    await rm(backupPath, { force: true });
    await rm(tempPath, { force: true });
    await rm(markerPath, { force: true });
    await syncDirectory(folder);
    return;
  }

  // A crash while installing the new content leaves the target as a byte
  // prefix of the new file (the install copies sequentially), with the intact
  // temporary file and a backup matching the expected version alongside. In
  // exactly that situation every byte of evidence needed for a safe repair
  // exists, so skip the conflict checks and let the recovery branches below
  // install the verified new content; the partial target bytes are still
  // rescued to a timestamped backup first. Any other divergent target keeps
  // the conservative conflict behavior.
  const interruptedInstallEvidence = async (): Promise<boolean> => {
    if (!backupPresent || !tempPresent) return false;
    if ((await hashFile(tempPath)) !== transaction.newSha256) return false;
    if (
      transaction.expectedSha256 === null ||
      (await hashFile(backupPath)) !== transaction.expectedSha256
    ) return false;
    if (!targetPresent) return true;
    const targetMetadata = await stat(targetPath);
    if (targetMetadata.size > MAX_TRANSACTION_HASH_BYTES) return false;
    const targetBytes = await readFile(targetPath);
    const newBytes = await readFile(tempPath);
    return targetBytes.byteLength < newBytes.byteLength &&
      newBytes.subarray(0, targetBytes.byteLength).equals(targetBytes);
  };

  if (transaction.verifyExpected && !(await interruptedInstallEvidence())) {
    if (targetPresent) {
      if (
        transaction.expectedSha256 === null ||
        await hashFile(targetPath) !== transaction.expectedSha256
      ) {
        recoveryConflict('target does not match the expected version');
      }
    } else if (backupPresent) {
      if (
        transaction.expectedSha256 === null ||
        await hashFile(backupPath) !== transaction.expectedSha256
      ) {
        recoveryConflict('backup does not match the expected version');
      }
    } else if (transaction.expectedSha256 !== null) {
      recoveryConflict('the expected version is missing');
    }
    if (
      backupPresent &&
      (
        transaction.expectedSha256 === null ||
        await hashFile(backupPath) !== transaction.expectedSha256
      )
    ) {
      recoveryConflict('backup does not match the expected version');
    }
  }

  if (!targetPresent && backupPresent) {
    if (tempPresent && await hashFile(tempPath) === transaction.newSha256) {
      await copyWithoutOverwrite(tempPath, targetPath);
      await rm(backupPath, { force: true });
      await rm(markerPath, { force: true });
      await syncDirectory(folder);
      return;
    }
    if (!(await restoreBackupWithoutOverwrite(backupPath, targetPath))) {
      throw new Error(`An incomplete write was detected. A recovery backup remains at ${backupPath}`);
    }
    await rm(tempPath, { force: true });
    await rm(markerPath, { force: true });
    await syncDirectory(folder);
    return;
  }

  if (!targetPresent && !backupPresent && tempPresent) {
    if (await hashFile(tempPath) !== transaction.newSha256) {
      throw new Error(`Validation failed for an incomplete temporary write: ${tempPath}`);
    }
    await copyWithoutOverwrite(tempPath, targetPath);
    await rm(markerPath, { force: true });
    await syncDirectory(folder);
    return;
  }

  if (targetPresent && !backupPresent && tempPresent) {
    if (await hashFile(tempPath) !== transaction.newSha256) {
      throw new Error(`Validation failed for an incomplete temporary write: ${tempPath}`);
    }
    await rename(targetPath, backupPath);
    await copyWithoutOverwrite(tempPath, targetPath);
    await rm(backupPath, { force: true });
    await rm(markerPath, { force: true });
    await syncDirectory(folder);
    return;
  }

  if (targetPresent && backupPresent) {
    if (tempPresent && await hashFile(tempPath) === transaction.newSha256) {
      await preserveBackup(targetPath, targetPath);
      await copyWithoutOverwrite(tempPath, targetPath);
      if (await hashFile(targetPath) !== transaction.newSha256) {
        throw new Error(`Validation failed after recovering an interrupted write: ${targetPath}`);
      }
      await rm(backupPath, { force: true });
      await rm(markerPath, { force: true });
      await syncDirectory(folder);
      return;
    }
    await preserveBackup(targetPath, targetPath);
    if (!(await restoreBackupWithoutOverwrite(backupPath, targetPath))) {
      throw new Error(`An incomplete write was detected. A recovery backup remains at ${backupPath}`);
    }
  }
  await rm(tempPath, { force: true });
  await rm(markerPath, { force: true });
  await syncDirectory(folder);
}

export async function recoverInterruptedWrite(targetPath: string): Promise<void> {
  return withPathLock(targetPath, () => recoverInterruptedWriteUnlocked(targetPath));
}

export async function recoverInterruptedWritesInFolder(folder: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const prefix = '.';
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(TRANSACTION_SUFFIX)) continue;
    const targetName = entry.name.slice(1, -TRANSACTION_SUFFIX.length);
    if (!targetName || basename(targetName) !== targetName) continue;
    await recoverInterruptedWrite(join(folder, targetName)).catch((error) =>
      console.error('Interrupted write could not be repaired yet', error),
    );
  }
}

async function writeFileAtomicallyUnlocked(
  targetPath: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const folder = dirname(targetPath);
  const tempPath = join(
    folder,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const backupPath = join(
    folder,
    `.${basename(targetPath)}.${randomUUID()}.markdown-editor-backup`,
  );
  const markerPath = transactionPathFor(targetPath);
  const newSha256 = sha256Bytes(bytes);

  await mkdir(folder, { recursive: true });
  await recoverInterruptedWriteUnlocked(targetPath);

  try {
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    const targetPresent = await pathExists(targetPath);
    if (!targetPresent) {
      if (options.verifyExpected && options.expectedSignature !== null) {
        throw new FileChangedDuringWriteError();
      }
      try {
        const transaction: WriteTransaction = {
          version: 1,
          targetName: basename(targetPath),
          tempName: basename(tempPath),
          backupName: basename(backupPath),
          newSha256,
          expectedSha256: null,
          verifyExpected: options.verifyExpected ?? false,
        };
        await writeTransaction(markerPath, transaction);
        await syncDirectory(folder);
        try {
          await copyWithoutOverwrite(tempPath, targetPath);
          if (await hashFile(targetPath) !== newSha256) {
            throw new Error('Validation failed after writing the new file.');
          }
          await rm(markerPath, { force: true });
          await syncDirectory(folder);
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            await rm(markerPath, { force: true });
            throw new FileChangedDuringWriteError();
          }
          await rm(targetPath, { force: true }).catch(() => undefined);
          await rm(markerPath, { force: true });
          throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (options.verifyExpected) throw new FileChangedDuringWriteError();
      }
    }

    if (options.verifyExpected && options.expectedSignature === null) {
      throw new FileChangedDuringWriteError();
    }

    const transaction: WriteTransaction = {
      version: 1,
      targetName: basename(targetPath),
      tempName: basename(tempPath),
      backupName: basename(backupPath),
      newSha256,
      expectedSha256: options.expectedSignature?.sha256 ?? null,
      verifyExpected: options.verifyExpected ?? false,
    };
    await writeTransaction(markerPath, transaction);
    await syncDirectory(folder);
    await options.beforeTargetMove?.();

    await rename(targetPath, backupPath).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileChangedDuringWriteError();
      }
      throw error;
    });

    try {
      const replacedSha256 = await hashFile(backupPath);
      if (
        options.verifyExpected &&
        replacedSha256 !== options.expectedSignature?.sha256
      ) {
        throw new FileChangedDuringWriteError();
      }

      await copyWithoutOverwrite(tempPath, targetPath).catch((error) => {
        if (['EEXIST', 'EPERM', 'EACCES'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )) {
          throw new FileChangedDuringWriteError();
        }
        throw error;
      });
      if (await hashFile(targetPath) !== newSha256) {
        throw new Error('Validation failed after the atomic write.');
      }
      await rm(backupPath, { force: true });
      await rm(markerPath, { force: true });
      await syncDirectory(folder);
    } catch (error) {
      if (!(await pathExists(targetPath))) {
        const restored = await restoreBackupWithoutOverwrite(backupPath, targetPath);
        if (!restored) {
          throw new Error(`The write failed. A recovery backup remains at ${backupPath}`, { cause: error });
        }
      } else if (await pathExists(backupPath)) {
        const targetHash = await hashFile(targetPath).catch(() => null);
        if (targetHash === newSha256) {
          await rm(backupPath, { force: true });
        } else if (error instanceof FileChangedDuringWriteError) {
          await preserveBackup(backupPath, targetPath);
        } else {
          await preserveBackup(targetPath, targetPath);
          if (!(await restoreBackupWithoutOverwrite(backupPath, targetPath))) {
            throw new Error(`The write failed. A recovery backup remains at ${backupPath}`, { cause: error });
          }
        }
      }
      await rm(markerPath, { force: true });
      await syncDirectory(folder);
      throw error;
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function writeFileAtomically(
  targetPath: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  return withPathLock(targetPath, () =>
    writeFileAtomicallyUnlocked(targetPath, bytes, options),
  );
}

export function signaturesMatch(
  left: FileSignature | null,
  right: FileSignature | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.sha256 === right.sha256 && left.size === right.size;
}

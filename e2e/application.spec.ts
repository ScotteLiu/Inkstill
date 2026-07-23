import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, chromium, expect, test } from '@playwright/test';

import { serializeRecovery } from '../src/main/recovery/recoveryPrimitives';

function testEnvironment(userData: string): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return {
    ...inherited,
    PLAYWRIGHT_TEST: '1',
    MARKDOWN_EDITOR_USER_DATA_DIR: userData,
  };
}

async function exitAbruptly(
  electronApp: Awaited<ReturnType<typeof electron.launch>>,
): Promise<void> {
  const process = electronApp.process();
  const exited = process.exitCode === null
    ? new Promise<void>((resolve) => process.once('exit', () => resolve()))
    : Promise.resolve();
  await electronApp.evaluate(({ app }) => app.exit(0));
  await exited;
}

async function removeUserData(userData: string): Promise<void> {
  await rm(userData, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a CDP port.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForCdp(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged application exited before CDP was ready (${child.exitCode}).`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Packaged application did not expose its local CDP endpoint.');
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
  } else {
    child.kill('SIGTERM');
  }
}

test('launches a sandboxed editor and keeps Markdown editable', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'markdown-editor-e2e-'));
  const electronApp = await electron.launch({
    args: ['.'],
    env: testEnvironment(userData),
  });

  try {
    const page = await electronApp.firstWindow();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // A clean CI runner may still be warming the Electron binary on the first launch.
    await expect(page.getByText('Inkstill')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cm-placeholder')).toContainText('Start writing…');
    await expect(page.getByRole('textbox', { name: /Markdown editor: Untitled\.md/ }))
      .toHaveAttribute('aria-readonly', 'false');

    await electronApp.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0];
      current.setSize(760, 560);
      current.webContents.setZoomFactor(2);
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(620);
    const compactLayout = await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>('.workspace')!.getBoundingClientRect();
      const controls = [...document.querySelectorAll<HTMLElement>('.topbar button')]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => ({
          name: element.getAttribute('aria-label') ?? element.textContent ?? '',
          bounds: element.getBoundingClientRect().toJSON(),
        }));
      return {
        controls,
        workspace: workspace.toJSON(),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(compactLayout.documentWidth).toBeLessThanOrEqual(compactLayout.viewportWidth);
    for (const control of compactLayout.controls) {
      expect(control.bounds.left, `${control.name} left edge`).toBeGreaterThanOrEqual(
        compactLayout.workspace.left - 1,
      );
      expect(control.bounds.right, `${control.name} right edge`).toBeLessThanOrEqual(
        compactLayout.workspace.right + 1,
      );
    }
    await page.getByRole('button', { name: 'Aa' }).click();
    const writingTools = page.getByRole('dialog', { name: 'Writing tools' });
    await expect(writingTools).toBeVisible();
    const writingToolsBounds = await writingTools.boundingBox();
    const compactViewport = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
    expect(writingToolsBounds).not.toBeNull();
    expect(writingToolsBounds!.x).toBeGreaterThanOrEqual(0);
    expect(writingToolsBounds!.x + writingToolsBounds!.width).toBeLessThanOrEqual(compactViewport.width);
    expect(writingToolsBounds!.y + writingToolsBounds!.height).toBeLessThanOrEqual(compactViewport.height);
    await writingTools.getByRole('button', { name: 'Close writing tools' }).click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0];
      current.webContents.setZoomFactor(1);
      current.setSize(1240, 820);
    });

    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.type('**Markdown**\n\n文字');
    await expect(content).not.toContainText('**Markdown**');
    await content.dispatchEvent('compositionstart', { data: '' });
    await expect(content).toContainText('**Markdown**');
    await content.dispatchEvent('compositionend', { data: '' });
    await page.waitForTimeout(90);
    await expect(content).not.toContainText('**Markdown**');

    const rendererGlobals = await page.evaluate(() => ({
      nodeRequire: typeof (globalThis as { require?: unknown }).require,
      nodeProcess: typeof (globalThis as { process?: unknown }).process,
      desktopMethods: Object.keys(window.desktop).sort(),
    }));
    expect(rendererGlobals.nodeRequire).toBe('undefined');
    expect(rendererGlobals.nodeProcess).toBe('undefined');
    expect(rendererGlobals.desktopMethods).toEqual([
      'closeDocument',
      'completeDiscardClose',
      'confirmUnsavedChanges',
      'copyHtml',
      'createDocument',
      'discardRecovery',
      'exportHtml',
      'exportPdf',
      'importImage',
      'inspectConflict',
      'listRecoveries',
      'markEdited',
      'onExternalChange',
      'onMenuCommand',
      'openDocument',
      'openExternal',
      'openWorkspace',
      'openWorkspaceFile',
      'pasteImage',
      'readLocalAsset',
      'refreshWorkspace',
      'reloadDocument',
      'restoreRecovery',
      'restoreSession',
      'saveDocument',
      'saveDocumentAs',
      'searchWorkspace',
      'workspaceMentions',
      'writeRecovery',
    ]);

    await content.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n**smoke test**');
    await page.keyboard.type('\n\nshortcut');
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await page.keyboard.press('Control+b');
    await expect(page.locator('.document-title')).toContainText('Untitled.md');
    await expect(page.locator('.document-title')).toContainText('Unsaved');

    const sourceToggle = page.getByRole('button', { name: 'Source mode' });
    await expect(sourceToggle).toHaveAttribute('aria-pressed', 'false');
    await sourceToggle.click();
    await expect(sourceToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(content).toBeFocused();
    await expect(content).toContainText('**smoke test**');
    await expect(content).toContainText('**shortcut**');
    await page.keyboard.press('Control+z');
    await expect(content).not.toContainText('**shortcut**');
    await expect(content).toContainText('shortcut');
    await page.keyboard.press('Control+y');
    await expect(content).toContainText('**shortcut**');

    expect(pageErrors).toEqual([]);
  } finally {
    await exitAbruptly(electronApp);
    await removeUserData(userData);
  }
});

test('renders rich Markdown, searches commands, and preserves multiple tabs', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'markdown-editor-features-e2e-'));
  const electronApp = await electron.launch({
    args: ['.'],
    env: testEnvironment(userData),
  });

  try {
    const page = await electronApp.firstWindow();
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.insertText([
      '---',
      'title: Preview',
      '---',
      '',
      '[toc]',
      '',
      '# Preview',
      '',
      '> [!TIP]',
      '> Keep the source portable.',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '$E=mc^2$',
      '',
      'Water is H~2~O :rocket:',
      '',
      '<script>alert(1)</script>',
    ].join('\n'));

    await page.getByRole('button', { name: 'Split' }).click();
    const preview = page.locator('.markdown-preview');
    await expect(preview.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(preview.locator('table')).toContainText('A');
    await expect(preview.locator('.katex')).toBeVisible();
    await expect(preview.locator('.table-of-contents')).toContainText('Preview');
    await expect(preview.locator('.front-matter')).toContainText('title');
    await expect(preview.locator('.markdown-alert')).toContainText('Keep the source portable.');
    await expect(preview.locator('sub')).toHaveText('2');
    await expect(preview.locator('.emoji')).toHaveText('🚀');
    await expect(preview.locator('script')).toHaveCount(0);
    await expect(preview.locator('.raw-html')).toContainText('<script>');

    await page.keyboard.press('Control+p');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('searchbox', { name: 'Search commands' }).fill('cheat');
    await expect(palette.getByRole('option', { name: /Markdown cheat sheet/ })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+t');
    const tableBuilder = page.getByRole('dialog', { name: 'Build a table' });
    await expect(tableBuilder).toBeVisible();
    await tableBuilder.getByLabel('Columns').fill('2');
    await tableBuilder.getByLabel('Body rows').fill('1');
    await tableBuilder.getByLabel('Header 1').fill('Feature');
    await tableBuilder.getByLabel('Header 2').fill('Status');
    await tableBuilder.getByRole('button', { name: 'Insert table' }).click();
    await expect(content).toContainText('| Feature | Status |');

    await page.keyboard.press('Control+n');
    await expect(page.locator('.document-tab')).toHaveCount(2);
    await content.click();
    await page.keyboard.insertText('Second tab');
    await page.locator('.document-tab').nth(0).getByRole('tab').click();
    await expect(content).toContainText('Preview');
    await page.locator('.document-tab').nth(1).getByRole('tab').click();
    await expect(content).toContainText('Second tab');
  } finally {
    await exitAbruptly(electronApp);
    await removeUserData(userData);
  }
});

test('restores the latest journal after an abrupt exit', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'markdown-editor-recovery-e2e-'));
  const env = testEnvironment(userData);
  const marker = `crash-recovery-${Date.now()}`;
  const firstApp = await electron.launch({ args: ['.'], env });

  try {
    const firstPage = await firstApp.firstWindow();
    const content = firstPage.locator('.cm-content');
    await content.click();
    await firstPage.keyboard.press('Control+End');
    await firstPage.keyboard.type(`\n\n${marker}`);
    await expect(firstPage.locator('.document-title')).toContainText('Unsaved');
    // Debounced Recovery should protect ordinary typing well before the 1.5 s fallback.
    await firstPage.waitForTimeout(900);
  } finally {
    await exitAbruptly(firstApp);
  }

  const secondApp = await electron.launch({ args: ['.'], env });
  try {
    const secondPage = await secondApp.firstWindow();
    await secondApp.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0];
      current.setSize(760, 560);
      current.webContents.setZoomFactor(2);
    });
    await expect(secondPage.getByRole('heading', { name: 'Unsaved drafts' })).toBeVisible();
    const recoveryFooter = secondPage.getByRole('button', { name: 'Later' });
    await expect(recoveryFooter).toBeVisible();
    const footerBounds = await recoveryFooter.boundingBox();
    const viewportHeight = await secondPage.evaluate(() => document.documentElement.clientHeight);
    expect(footerBounds).not.toBeNull();
    expect(footerBounds!.y + footerBounds!.height).toBeLessThanOrEqual(viewportHeight);
    await secondPage.getByRole('button', { name: 'Restore' }).click();
    await expect(secondPage.locator('.document-title')).toContainText('Recovered');
    await expect(secondPage.locator('.statusbar')).toContainText('Draft restored');

    const restoredContent = secondPage.locator('.cm-content');
    await restoredContent.click();
    await secondPage.keyboard.press('Control+End');
    await expect(restoredContent).toContainText(marker);
  } finally {
    await exitAbruptly(secondApp);
    await removeUserData(userData);
  }
});

test('requires an explicit EOL choice before editing a mixed-EOL recovery', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'markdown-editor-eol-e2e-'));
  const recoveryFolder = join(userData, 'recovery');
  const documentId = randomUUID();
  await mkdir(recoveryFolder, { recursive: true });
  await writeFile(
    join(recoveryFolder, `${documentId}.json`),
    serializeRecovery({
      documentId,
      sourcePath: null,
      sourceHash: null,
      format: { encoding: 'utf8', bom: false, eol: '\n', mixedEol: true },
      content: '第一行\r\n第二行\n第三行',
      revision: 4,
      updatedAt: '2026-07-14T12:00:00.000Z',
    }),
  );

  const electronApp = await electron.launch({
    args: ['.'],
    env: testEnvironment(userData),
  });
  try {
    const page = await electronApp.firstWindow();
    await page.getByRole('button', { name: 'Restore' }).click();
    const eolGate = page.getByRole('region', { name: 'Choose line endings' });
    await expect(eolGate).toBeVisible();
    await expect(eolGate).toBeFocused();
    await expect(page.locator('.cm-editor')).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit with LF' }).click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.locator('.statusbar')).toContainText('Line endings: LF');
    await expect(page.locator('.statusbar')).toContainText('LF');
    await expect(page.locator('.document-title i')).toBeVisible();
  } finally {
    await exitAbruptly(electronApp);
    await removeUserData(userData);
  }
});

test('launches the real packaged application with production isolation', async () => {
  test.skip(process.platform !== 'win32', 'The packaged Windows binary is built only on Windows.');
  test.setTimeout(45_000);

  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
    productName: string;
  };
  const userData = await mkdtemp(join(tmpdir(), 'markdown-editor-packaged-e2e-'));
  const executablePath = process.env.MARKDOWN_EDITOR_PACKAGED_EXE ?? join(
    process.cwd(),
    'out',
    `${packageJson.productName}-win32-${process.arch}`,
    `${packageJson.productName}.exe`,
  );
  const cdpPort = await availablePort();
  const packagedProcess = spawn(executablePath, [
    `--user-data-dir=${userData}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`,
  ], { stdio: 'ignore', windowsHide: true });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

  try {
    await waitForCdp(packagedProcess, cdpPort);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Packaged application exposed no browser context.');
    await expect.poll(() => context.pages().length).toBeGreaterThan(0);
    const page = context.pages()[0];
    await expect(page.locator('.cm-editor')).toBeVisible();

    const rendererGlobals = await page.evaluate(() => ({
      nodeRequire: typeof (globalThis as { require?: unknown }).require,
      nodeProcess: typeof (globalThis as { process?: unknown }).process,
      desktopAvailable: typeof window.desktop,
    }));
    expect(rendererGlobals).toEqual({
      nodeRequire: 'undefined',
      nodeProcess: 'undefined',
      desktopAvailable: 'object',
    });

    const marker = `packaged-smoke-${Date.now()}`;
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n\n${marker}`);
    await expect(content).toContainText(marker);
  } finally {
    await browser?.close();
    await terminateChild(packagedProcess);
    await removeUserData(userData);
  }
});

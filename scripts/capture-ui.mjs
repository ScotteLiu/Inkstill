import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { _electron as electron } from '@playwright/test';

const outputArgument = process.argv.slice(2).find((argument) => argument !== '--');
const outputDirectory = resolve(outputArgument ?? 'test-results/ui-preview');
const userData = await mkdtemp(join(tmpdir(), 'markdown-editor-visual-'));
await mkdir(outputDirectory, { recursive: true });

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);

const application = await electron.launch({
  args: ['.'],
  env: {
    ...inheritedEnvironment,
    PLAYWRIGHT_TEST: '1',
    MARKDOWN_EDITOR_USER_DATA_DIR: userData,
  },
});

try {
  const page = await application.firstWindow();
  await page.locator('.app-shell').waitFor({ state: 'visible' });

  const scenarios = [
    { name: 'desktop-light', width: 1240, height: 820, zoomFactor: 1, colorScheme: 'light' },
    { name: 'compact-light', width: 760, height: 560, zoomFactor: 1, colorScheme: 'light' },
    { name: 'compact-zoom-200', width: 760, height: 560, zoomFactor: 2, colorScheme: 'light' },
    { name: 'desktop-dark', width: 1240, height: 820, zoomFactor: 1, colorScheme: 'dark' },
  ];
  const report = [];

  for (const scenario of scenarios) {
    await application.evaluate(({ BrowserWindow }, dimensions) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(dimensions.width, dimensions.height);
      window.webContents.setZoomFactor(dimensions.zoomFactor);
      window.center();
    }, scenario);
    await page.emulateMedia({ colorScheme: scenario.colorScheme });
    await page.waitForTimeout(120);

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell');
      const toolbar = document.querySelector('.format-tools');
      const statusbar = document.querySelector('.statusbar');
      const editorSurface = document.querySelector('.editor-surface');
      const editor = document.querySelector('.cm-editor');
      const content = document.querySelector('.cm-content');
      const workspace = document.querySelector('.workspace');
      const root = document.documentElement;
      const workspaceRect = workspace?.getBoundingClientRect() ?? null;
      const topbarButtonRects = Array.from(document.querySelectorAll('.topbar button'))
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => button.getBoundingClientRect());
      return {
        viewport: { width: root.clientWidth, height: root.clientHeight },
        documentOverflowX: root.scrollWidth - root.clientWidth,
        shellOverflowX: shell ? shell.scrollWidth - shell.clientWidth : null,
        toolbarOverflowX: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : null,
        statusbarOverflowX: statusbar ? statusbar.scrollWidth - statusbar.clientWidth : null,
        editorStatusOverlap: editor && statusbar
          ? Math.max(0, editor.getBoundingClientRect().bottom - statusbar.getBoundingClientRect().top)
          : null,
        editorSurfaceStatusOverlap: editorSurface && statusbar
          ? Math.max(0, editorSurface.getBoundingClientRect().bottom - statusbar.getBoundingClientRect().top)
          : null,
        editorFontSize: content ? getComputedStyle(content).fontSize : null,
        topbarButtonsInsideWorkspace: workspaceRect === null
          ? null
          : topbarButtonRects.every((rect) =>
            rect.left >= workspaceRect.left - 1 && rect.right <= workspaceRect.right + 1 &&
            rect.top >= workspaceRect.top - 1 && rect.bottom <= workspaceRect.bottom + 1),
        visibleButtons: Array.from(document.querySelectorAll('button'))
          .filter((button) => button.getClientRects().length > 0)
          .length,
      };
    });

    const screenshotPath = join(outputDirectory, `${scenario.name}.png`);
    if (scenario.zoomFactor === 1) {
      await page.screenshot({
        path: screenshotPath,
        animations: 'disabled',
      });
    } else {
      const screenshotBase64 = await application.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return (await window.webContents.capturePage()).toPNG().toString('base64');
      });
      await writeFile(screenshotPath, screenshotBase64, 'base64');
    }
    report.push({ ...scenario, ...metrics });
  }

  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1240, 820);
    window.webContents.setZoomFactor(1);
    window.center();
  });
  await page.emulateMedia({ colorScheme: 'light' });
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.insertText([
    '---',
    'title: Product note',
    'status: draft',
    '---',
    '',
    '[toc]',
    '',
    '# Product note',
    '',
    'Inkstill keeps **Markdown** readable while you write.',
    '',
    '> [!TIP]',
    '> A quiet space for connected ideas.',
    '',
    '- [x] Safe live preview',
    '- [ ] Publish the next draft',
    '',
    '| Mode | Shortcut |',
    '| --- | --- |',
    '| Split | Ctrl+2 |',
    '| Read | Ctrl+3 |',
    '',
    '$$E = mc^2$$',
    '',
    String.raw`[ M_z(y,x)=\operatorname{median}_{(u,v)\in 3\times3} I_z(y+v,x+u) ]`,
    '',
    '```python',
    'def median(values):',
    '    return sorted(values)[len(values) // 2]',
    '```',
    '',
    'Water is H~2~O :sparkles:',
    '',
    '```mermaid',
    'graph LR',
    '    Draft --> Review --> Publish',
    '```',
  ].join('\n'));
  await page.keyboard.press('Control+Home');
  await page.getByRole('button', { name: 'Split' }).click();
  await page.locator('.markdown-preview h1').waitFor({ state: 'visible' });
  await page.locator('.markdown-preview .code-block .hljs').waitFor({ state: 'visible' });
  await page.locator('.markdown-preview .math-block').nth(1).waitFor({ state: 'visible' });
  await page.locator('.markdown-preview .mermaid svg').waitFor({ state: 'visible' });
  await page.waitForTimeout(650);
  await page.screenshot({ path: join(outputDirectory, 'feature-split-light.png'), animations: 'disabled' });
  await page.locator('.markdown-preview .code-block').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outputDirectory, 'feature-code-math-light.png'), animations: 'disabled' });

  await page.keyboard.press('Control+t');
  await page.getByRole('dialog', { name: 'Build a table' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(outputDirectory, 'table-builder-light.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close table builder' }).click();

  await page.getByRole('button', { name: 'Aa' }).click();
  await page.getByRole('dialog', { name: 'Writing tools' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(outputDirectory, 'writing-tools-light.png'), animations: 'disabled' });
  await page.getByRole('dialog', { name: 'Writing tools' }).getByRole('button').click();

  await page.keyboard.press('Control+p');
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(outputDirectory, 'command-palette-light.png'), animations: 'disabled' });

  await writeFile(
    join(outputDirectory, 'layout-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
} finally {
  await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await application.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

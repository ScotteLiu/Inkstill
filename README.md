<p align="center">
  <img src="assets/icon.png" width="96" height="96" alt="Inkstill icon">
</p>

<h1 align="center">Inkstill</h1>

<p align="center"><strong>Write quietly. Keep your files yours.</strong></p>

<p align="center">
  A calm, local-first Markdown workspace for Windows.<br>
  Beautiful writing, connected notes, and ordinary Markdown files—without an account.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/ScotteLiu/Inkstill/actions/workflows/windows-candidate.yml"><img src="https://github.com/ScotteLiu/Inkstill/actions/workflows/windows-candidate.yml/badge.svg" alt="Windows CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-d7a83e.svg" alt="MIT License"></a>
  <a href="https://github.com/ScotteLiu/Inkstill/releases"><img src="https://img.shields.io/github/v/release/ScotteLiu/Inkstill?include_prereleases&label=preview&color=1f6f5f" alt="Latest preview"></a>
</p>

<p align="center">
  <a href="https://github.com/ScotteLiu/Inkstill/releases"><img src="https://img.shields.io/badge/Download-Windows_x64-1f6f5f?style=for-the-badge&logo=windows" alt="Download Inkstill for Windows"></a>
</p>

![Inkstill split editor and rendered Markdown preview](docs/images/inkstill-split-preview.png)

## A writing space that stays out of your way

Inkstill keeps Markdown readable while you type, then gives you a polished preview
when you want it. Open a file and write, or open a folder and turn a collection of
notes into a navigable workspace.

| Focused writing | Connected notes | Your files |
| --- | --- | --- |
| Edit, Split, and Read views with focus and typewriter modes. | Outline, full-text search, Wiki links, backlinks, and unlinked mentions. | Standard Markdown on disk, portable image paths, no required cloud account. |

## See it in action

<table>
  <tr>
    <td width="50%">
      <img src="docs/images/inkstill-command-palette.png" alt="Inkstill command palette">
      <br><strong>Everything a shortcut away</strong><br>
      Search commands, formatting, views, exports, and workspace actions from one keyboard-first palette.
    </td>
    <td width="50%">
      <img src="docs/images/inkstill-writing-tools.png" alt="Inkstill writing tools">
      <br><strong>Shape the space around your words</strong><br>
      Choose a theme and reading width, then enable focus, typewriter, Hemingway, spellcheck, or a writing goal.
    </td>
  </tr>
</table>

## Highlights

- Rich, source-faithful Markdown with GFM tables and tasks, footnotes, highlighted
  code, KaTeX math, Mermaid diagrams, Wiki links, table of contents, YAML metadata,
  alerts, emoji, and sub/superscript.
- Multiple tabs, last-session restoration, per-document recovery journals, external
  change warnings, and explicit conflict review.
- Folder workspaces with file navigation, full-text search, quick open, searchable
  outline, backlinks, and unlinked mentions.
- Command palette, graphical Table Builder, Markdown cheat sheet, find and replace,
  bracket pairing, indentation tools, and keyboard-first formatting.
- Light, dark, and system themes; focus, typewriter, and Hemingway modes; spellcheck,
  line numbers, reading time, selection statistics, and word goals.
- Local image import and clipboard image paste, plus Copy as HTML and standalone
  HTML/PDF export.

## Download

The [Releases page](https://github.com/ScotteLiu/Inkstill/releases) provides:

- `Inkstill-1.1.0 Setup.exe` — per-user Windows x64 installer.
- `Inkstill-win32-x64-1.1.0.zip` — portable build; extract and run `Inkstill.exe`.
- `SHA256SUMS.txt` — checksums for verifying both downloads.

> **Preview notice:** Current binaries are not yet Authenticode-signed, so Windows
> may show a SmartScreen warning. Source, locked dependencies, SBOM, third-party
> licenses, build manifest, and checksums are published for inspection.

## File safety, privacy, and performance

- The editor runs in a sandboxed renderer with context isolation, restrictive CSP,
  secure Electron fuses, and narrow typed IPC.
- Markdown stays in files you choose and local recovery data. Inkstill has no
  required account, telemetry service, or document upload path.
- Saves and recovery writes are serialized; external modifications are never
  silently overwritten.
- UTF-8 BOM and LF/CRLF are preserved, with an explicit choice for mixed line endings.
- Large-file safeguards and bounded workspace caches prevent expensive background
  work from growing without limits.
- Runtime budgets continuously check startup, idle CPU, memory, process count, and
  package size. See [Performance policy](docs/PERFORMANCE.md).

## Build from source

Use Node 24.14.0 and pnpm 11.9.0:

```powershell
pnpm install --frozen-lockfile
pnpm start
```

Run all source, security, packaged-app, and runtime checks:

```powershell
pnpm verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Report security issues
privately according to [SECURITY.md](SECURITY.md), not in a public issue.

## Current scope

Inkstill is a Windows x64 preview. macOS and Linux builds need their own packaging,
IME, lifecycle, signing, and hardware validation. Cloud sync, real-time
collaboration, hosted publishing, and online AI accounts are not represented as
features of this local editor.

## License and credits

Inkstill is open source under the [MIT License](LICENSE).

Copyright © 2026 Scotte Liu.

- **Scotte Liu** — Creator, copyright holder, and lead developer
- **OpenAI Codex** — Development assistance

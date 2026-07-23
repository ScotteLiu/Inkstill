# Inkstill

[English](README.md) · [繁體中文](README.zh-TW.md)

[![Windows CI](https://github.com/ScotteLiu/Inkstill/actions/workflows/windows-candidate.yml/badge.svg)](https://github.com/ScotteLiu/Inkstill/actions/workflows/windows-candidate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A calm, local-first Markdown workspace for Windows. Inkstill combines a focused writing surface with workspace navigation and knowledge links, while keeping ordinary Markdown files as the source of truth.

Inkstill 是一款安靜、以本機檔案為核心的 Windows Markdown 工作空間。它結合專注寫作介面、資料夾管理與知識連結，並始終以標準 Markdown 檔案作為唯一資料來源。

> Inkstill is currently a Windows x64 preview. Public installers remain unsigned until a trusted Authenticode publishing identity is configured. Build from source or use preview binaries only if you understand the Windows SmartScreen warning.

## Download

Each GitHub preview release provides two Windows x64 downloads:

- `Inkstill-1.1.0 Setup.exe` — complete per-user installer.
- `Inkstill-win32-x64-1.1.0.zip` — portable version; extract it and run `Inkstill.exe` without installation.

Verify downloads against `SHA256SUMS.txt`. Preview binaries are not yet Authenticode-signed, so Windows may display a SmartScreen warning.

## Features

- Edit, synchronized split, and reading views with GFM tables, tasks, footnotes, syntax-highlighted code, KaTeX math, Mermaid diagrams, Wiki links, `[toc]`, YAML metadata, alerts, emoji, sub/superscript, and safe local-image previews.
- Multiple tabs with unsaved indicators, per-tab recovery, external-change warnings, and automatic restoration of the last file session.
- Folder workspaces with a file browser, full-text search, quick open from the command palette, document outline, backlinks, and unlinked mentions.
- Keyboard-first command palette, graphical Table Builder, searchable active-section outline, Markdown cheat sheet, expanded formatting commands, find and replace, bracket pairing, and line indentation.
- Focus, typewriter, and Hemingway modes; spellcheck, line numbers, light/dark/system themes, three reading widths, selection statistics, reading time, and word goals.
- Local image import and clipboard-image paste using portable relative paths, plus Copy as HTML and standalone HTML/PDF export.

## File integrity and privacy

- Sandboxed Electron renderer, context isolation, restrictive CSP, verified fuses, and narrow typed IPC.
- CodeMirror text is the canonical Markdown source; Lezer derives visual decorations without reserializing the document.
- Monotonic edit/saved revisions, serialized save/recovery queues, and a canonical per-path file mutex.
- Startup Recovery validates checksums, prioritizes the newest journals, and never treats file-write transaction markers as editor snapshots.
- External changes stop the write and open a bounded three-way preview instead of silently replacing either version.
- Recoverable write transactions validate the expected pre-write hash and preserve evidence when an interrupted write meets a new external version.
- UTF-8 BOM and LF/CRLF preservation; mixed or lone-CR line endings require an explicit choice before editing.
- Large-file fallback disables rich reveal, wrapping, and whole-document outline analysis above the tested threshold.
- IME composition blocks save/reload/document switching/close-flush; Recovery resumes immediately after composition ends.

## Development

Use the Node version in `.node-version` (24.14.0) and pnpm 11.9.0.

```powershell
pnpm install --frozen-lockfile
pnpm start
```

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should be reported according to [SECURITY.md](SECURITY.md), not through a public issue.

Full verification:

```powershell
pnpm verify
```

Windows final candidate:

```powershell
pnpm release:candidate
```

The candidate command first removes stale outputs, then performs a frozen install, TypeScript and Vitest checks, low-severity dependency audit, registry-signature verification, one Squirrel/ZIP build, source and packaged-app Electron E2E against that same build, SBOM and full third-party-license generation, fuse/ASAR inspection, and SHA-256 generation.

## Validation

- Vitest covers source fidelity, safe rendering, workspace indexing, CJK-aware statistics, atomic-write recovery, Recovery indexing, document sessions, conflict payloads, editor policies, and performance guards.
- Electron E2E covers sandbox/editing, rich preview, command search, multiple tabs, fast crash Recovery, mixed-EOL choice, source/visual history, and the real packaged executable.
- Full dependency audit and registry package-signature verification are required by the release command.
- Windows x64 ASAR package, secure Electron fuses, CycloneDX SBOM, full third-party license bundle, and SHA-256 evidence are automated.
- Disposable-runner Squirrel install/launch/uninstall smoke is part of Windows CI; an actual old-version-to-new-version update matrix is not yet claimed.

## Deliberate limits

- Raw HTML is displayed as source in Preview instead of executed. This keeps preview content from becoming an application script surface.
- Conflict review is a bounded preview and does not auto-merge.
- Cloud sync, real-time collaboration, hosted publishing, AI-provider accounts, and a third-party plugin marketplace are separate online services and are not presented as local editor features.
- Real Microsoft Zhuyin/Pinyin/Cangjie dogfood remains required; synthetic composition events are not a substitute.
- Windows writes use a recoverable transaction journal, but native `ReplaceFileW` metadata/ACL parity remains a public-release gate.
- This candidate is Windows x64 only. macOS/Linux packaging, IME, close lifecycle, signing, and notarization require their own runners and hardware.

## Release status

`pnpm release:candidate` produces a candidate whose evidence records whether signatures are present; signatures are not required at this stage. Inputs are hashed and traceable, but bit-for-bit reproducibility is not claimed. `pnpm release:public` is intentionally fail-closed until a clean Git build has a trusted, timestamped Authenticode identity. Native file metadata/ACL validation, installer-upgrade evidence, and real Windows IME dogfooding are also required before Inkstill is described as a stable public release. See `release/README.md` for exact gates.

## License

Inkstill is open source under the [MIT License](LICENSE).

Copyright © 2026 Scotte Liu.

## Credits

- **Scotte Liu** — Creator, copyright holder, and lead developer
- **OpenAI Codex** — Development assistance

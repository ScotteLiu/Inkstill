# Inkstill editor design review

Review date: 2026-07-23

This document records Inkstill's product decisions against common expectations for modern Markdown editors. It does not claim affiliation with, endorsement by, or compatibility certification from any other product.

## Product assessment

| Area | Inkstill 1.1 | Assessment |
| --- | --- | --- |
| Core editing | Source-faithful visual editor with Edit, Split, and Read views | Keeps the Markdown source explicit and portable |
| Tables | Graphical Table Builder for size, headers, rows, and alignment | Strong table creation; existing tables remain source-editable |
| Markdown extensions | GFM, KaTeX, Mermaid, footnotes, `[toc]`, safe YAML metadata, alerts, emoji completion, sub/superscript, and highlight | Covers practical document syntax while preserving plain-text files |
| Outline | Filter, active heading, hierarchy, and navigation | Supports long-document navigation |
| File workflow | Folder browser, full-text search, workspace quick open, persistent tabs, and session restore | Designed for simultaneous multi-document work |
| Knowledge workflow | Wiki links, backlinks, and unlinked mentions | Supports connected local notes without a proprietary database |
| Images | Local file selection or clipboard paste, relative asset folders, and safe preview | Portable by default and does not require upload credentials |
| Export | Styled HTML, PDF, and Copy as HTML | Covers dependable built-in formats without an external conversion runtime |
| Themes | System, light, dark, and three reading widths | Keeps a deliberately small, tested visual surface |
| Focus tools | Focus, typewriter, and Hemingway modes, spellcheck, goals, and CJK-aware statistics | Provides drafting controls without changing Markdown source |
| Recovery and conflicts | Atomic writes, per-tab recovery journals, mixed-EOL gate, external-change detection, and bounded conflict review | Prioritizes file integrity |
| Raw HTML | Displays raw HTML as inert source in Preview | Prevents untrusted Markdown from becoming an active script surface |
| Runtime | Electron with diagrams loaded only when a document uses them | Balances cross-platform foundations with deferred heavy features |
| Licensing | MIT License with no activation or device limit | Open source and locally usable |

## Implemented improvements

- Graphical Table Builder with row, column, header, and alignment choices
- `[toc]` generation with in-preview navigation
- Safe, collapsible YAML front matter metadata
- Note, Tip, Important, Warning, and Caution alert blocks
- Emoji shortcode rendering and editor autocomplete
- Subscript and superscript rendering
- Outline filtering and active-section highlighting
- Proportional Editor-to-Preview scroll synchronization in Split view
- Clipboard-image paste into the document's relative asset folder
- Lazy-loaded diagrams to reduce ordinary startup work
- Persistent tabs, backlinks, crash recovery, atomic saves, conflict detection, and raw-HTML isolation

## Deliberate boundaries

Arbitrary CSS is not loaded into the renderer because it expands the UI and security test surface. Cloud image upload is not built in because it requires credentials and provider-specific behavior. Additional document export formats remain separate integrations until their conversion runtimes can be shipped and tested. A native non-Electron rewrite would be an independent product effort rather than a safe incremental change.

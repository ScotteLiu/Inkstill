# Inkstill feature benchmark

Research date: 2026-07-23

Inkstill started with a strong safety foundation: source-faithful UTF-8 handling, atomic writes, external-change detection, crash recovery, mixed-EOL protection, large-file safeguards, a clean outline, source/visual editing, and accessible light/dark UI. The comparison below records the capabilities selected for Inkstill 1.0 from established Markdown tools and user feedback.

## Evidence

- Established Markdown editors: live preview, images, tables, math, diagrams, tasks, code highlighting, file organization, export, word count, focus/typewriter modes, and auto-pairing.
- [Obsidian Backlinks](https://obsidian.md/help/plugins/backlinks): linked and unlinked mentions for the active note.
- [Obsidian Command palette](https://obsidian.md/help/plugins/command-palette): keyboard-first fuzzy command search.
- [Zettlr feature comparison](https://www.zettlr.com/features): projects, full-text search, split view, document statistics, and broad export.
- [iA Writer features](https://ia.net/writer/support/basics/features): focus mode, local images, dynamic outline, writing goals, live preview, and PDF export.
- [ghostwriter features](https://ghostwriter.kde.org/): focus and Hemingway modes, live preview, document statistics, export, and a built-in cheat sheet.
- [Markdown editor user discussion](https://www.reddit.com/r/Markdown/comments/1t4wvn8/which_markdown_editor_is_better_or_an_equal_to/): multiple tabs are a recurring reason users move away from otherwise-liked editors.
- [Markdown tool user discussion](https://www.reddit.com/r/Markdown/comments/1su1vib/best_markdown_tools_everyone_needs_to_know_about/): users call out persistent tabs, Mermaid, table UI, and code-block tooling.

## Implementation set

| Area | Inkstill 1.0 result | Status |
| --- | --- | --- |
| Preview | Safe live preview, split and reading views, GFM tables/tasks, footnotes, KaTeX, Mermaid | Complete |
| Documents | Multiple tabs, close workflow, per-tab drafts, recent file session | Complete |
| Workspace | Open folder, Markdown file browser, palette quick open, full-text search | Complete |
| Knowledge links | Wikilinks, link navigation, backlinks and unlinked mentions | Complete |
| Keyboard workflow | Fuzzy command palette, expanded shortcuts, Markdown cheat sheet | Complete |
| Content tools | H1-H6, lists, tasks, quotes, code fences, strike, highlight, tables, footnotes, images, rules | Complete |
| Writing focus | Focus mode, typewriter scrolling, Hemingway mode | Complete |
| Writing feedback | CJK-aware words, reading time, selection statistics, writing goal | Complete |
| Editor preferences | System/light/dark themes, three readable widths, line numbers, spellcheck | Complete |
| Assets | Local image import with relative paths and safe preview support | Complete |
| Output | Copy HTML, standalone HTML, print-ready PDF | Complete |
| Safety | Existing atomic-save, recovery, conflict, EOL, large-file, and sandbox guarantees retained | Complete |

## Deliberate infrastructure exclusions

Cloud sync, real-time collaboration, hosted publishing, AI-provider integrations, and a third-party plugin marketplace require accounts, servers, credentials, moderation, or a stable public extension API. They are separate products rather than local editor features, so they are not represented as completed desktop functionality in this implementation.

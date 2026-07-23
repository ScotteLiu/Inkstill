# Performance policy

Inkstill uses Electron so that its editor, preview, export, and desktop integrations
share one cross-platform codebase. The packaged application therefore includes a
Chromium runtime and normally uses separate main, renderer, GPU, and utility
processes. Process isolation is retained because collapsing or disabling these
processes would trade away security and rendering stability for a misleadingly
smaller process count.

## Windows runtime budgets

`pnpm test:runtime` starts the packaged x64 application, waits for the main window,
samples it at idle, and fails when any of these guardrails are exceeded:

| Metric | Candidate budget |
| --- | ---: |
| Window startup | 5,000 ms |
| Inkstill processes | 5 |
| Total private memory | 450 MB |
| Normalized idle CPU | 2% |
| Unpacked application | 380 MB |
| Application code (`app.asar`) | 12 MB |

The script writes its machine-readable result to
`test-results/runtime-budget.json`. These are regression budgets rather than
claims that every computer will produce identical numbers; cold disks, antivirus,
drivers, and virtualized CI runners affect the measurements.

## Scaling controls

- Editor-only mode does not update or parse the hidden preview on every keystroke.
- Visible preview updates are coalesced for 80 ms, or 180 ms for documents of at
  least 500,000 characters.
- Preview, outline analysis, and other expensive features are limited in large-file
  mode.
- Draft recovery timers exist only while unsaved content is waiting to be journaled;
  a clean, idle renderer has no permanent recovery polling interval.
- Workspace file scans are reused for three seconds and are capped at 5,000 files.
- Recently searched workspace content uses a three-second LRU cache with a hard
  16 MB limit.
- Mermaid remains a lazy-loaded renderer and is absent from the initial execution
  path until a document contains a diagram.

Run the complete local gate with:

```powershell
pnpm verify
```

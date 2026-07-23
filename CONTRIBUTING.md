# Contributing to Inkstill

Thank you for helping improve Inkstill.

## Before opening a change

- Search existing issues before filing a new one.
- Use a focused issue for reproducible bugs or a concrete feature proposal.
- Do not disclose security vulnerabilities in public issues; follow `SECURITY.md`.
- Keep Inkstill source-faithful, local-first, and safe for untrusted Markdown files.

## Development setup

Inkstill targets Windows x64, macOS Intel/Apple silicon, and Linux x64. Use
Node 24.14.0 and pnpm 11.9.0.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Before submitting a pull request:

```sh
pnpm verify:source
```

For changes that affect packaged Electron behavior:

```sh
pnpm verify
```

## Pull requests

- Keep changes scoped and explain the user-facing result.
- Add or update tests for behavior changes.
- Preserve Markdown source exactly unless the user explicitly invokes a formatting command.
- Do not weaken the Electron sandbox, content security policy, safe preview pipeline, recovery guarantees, or release gates.
- Do not commit generated output, credentials, certificates, local recovery data, or private sample documents.

By contributing, you agree that your contribution is licensed under the MIT License.

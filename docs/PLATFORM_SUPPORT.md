# Platform support

Inkstill uses one source tree and platform-native Electron Forge packages. Every
supported target keeps the same sandbox, typed IPC boundary, recovery behavior,
Markdown rendering, and on-disk file format.

| Platform | Architectures | Packages | Validation status |
| --- | --- | --- | --- |
| Windows 10/11 | x64 | Squirrel installer, portable ZIP | Public preview |
| macOS | Intel x64, Apple silicon arm64 | DMG, ZIP | Native CI candidate |
| Linux | x64 | DEB, RPM, portable ZIP | Native CI candidate |

## Native behavior

- macOS uses the standard application and Window menus, keeps the application
  available after the last window closes, and accepts files opened from Finder.
- Windows and Linux keep a single application instance and forward Markdown or
  text files opened by the desktop environment to that instance.
- Command shortcuts use Command on macOS and Control on Windows/Linux.
- `.md`, `.markdown`, and `.txt` files can be opened from the operating system.

## Candidate policy

The `cross-platform-candidate.yml` workflow runs source checks once, exercises the
application on native macOS and Linux runners, builds each package format, checks
the macOS bundle metadata, validates artifact structure and size, and uploads the
results as GitHub Actions artifacts.

Candidate packages are intentionally not presented as public signed releases yet.
macOS distribution still needs Developer ID signing and notarization; broad Linux
desktop testing remains necessary because distributions and display stacks vary.
These limitations affect installation trust prompts, not document portability.

## Local build commands

Run these on the corresponding host operating system:

```sh
pnpm install --frozen-lockfile
pnpm verify:source
pnpm make
```

Use an explicit target when preparing a CI-style candidate:

```sh
pnpm make --platform=darwin --arch=arm64
pnpm make --platform=linux --arch=x64
```

# Release gates

`release/` contains generated evidence. Do not edit generated JSON, license bundles, or checksum files by hand.

## Windows final candidate

```powershell
pnpm release:candidate
```

This performs the complete clean, frozen, single-build verification pipeline. The local command does not install Squirrel. `.github/workflows/windows-candidate.yml` performs install/launch/uninstall testing only on a disposable Windows runner; it does not claim an old-version-to-new-version upgrade test.

The candidate gate does not require a signature and is not, by itself, eligibility for public distribution. Evidence records the actual signature state. Build inputs are SHA-256 traceable; bit-for-bit reproducibility is not claimed.

## Public release

```powershell
$env:WINDOWS_CERTIFICATE_FILE = 'C:\secure\publisher.pfx'
$env:WINDOWS_CERTIFICATE_PASSWORD = '<secret supplied by protected CI>'
$env:WINDOWS_EXPECTED_SIGNER_THUMBPRINT = '<exact publisher certificate thumbprint>'
pnpm release:public
```

Run the public command only in a disposable Windows CI user/VM. The password must come from protected CI secrets and must never be committed or printed. The public gate validates the actual packaged executable and Setup signature, trusted timestamp, exact certificate thumbprint, project identity/license, clean provenance, and dependency-source policy; the command then performs signed install/launch/uninstall smoke.

The public release remains blocked until all owner, engineering, and external gates are complete:

- choose and add the project LICENSE or EULA;
- build from a Git checkout with recorded commit provenance;
- supply a real Authenticode certificate and timestamped signatures;
- complete real Windows CJK IME, native Windows file-replacement metadata/ACL, installer upgrade, and macOS validation gates.

`pnpm test:installer` refuses to run unless `-DisposableEnvironment` is explicitly supplied because Squirrel changes LocalAppData, shortcuts, and per-user installation state.

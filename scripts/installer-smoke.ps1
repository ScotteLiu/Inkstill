param(
  [switch]$DisposableEnvironment,
  [switch]$RequireSignature
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $DisposableEnvironment) {
  throw 'Installer smoke changes LocalAppData, shortcuts, and Squirrel state. Run only in a disposable Windows user/VM with -DisposableEnvironment.'
}

$Root = Split-Path -Parent $PSScriptRoot
$Package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$MakeRoot = Join-Path $Root 'out\make'
$ExpectedSquirrelRoot = Join-Path $MakeRoot 'squirrel.windows\x64'
$ExpectedSetupName = '{0}-{1} Setup.exe' -f $Package.productName, $Package.version
$ExpectedPackageId = ([string]$Package.name).Replace('-', '_')
$ExpectedNupkgName = '{0}-{1}-full.nupkg' -f $ExpectedPackageId, $Package.version
$Setups = @(Get-ChildItem -LiteralPath $MakeRoot -Filter '*Setup.exe' -File -Recurse)
$Nupkgs = @(Get-ChildItem -LiteralPath $MakeRoot -Filter '*-full.nupkg' -File -Recurse)
if ($Setups.Count -ne 1 -or $Setups[0].FullName -ne (Join-Path $ExpectedSquirrelRoot $ExpectedSetupName)) {
  throw "Expected exactly $ExpectedSetupName in the x64 Squirrel folder; found $($Setups.Count)."
}
if ($Nupkgs.Count -ne 1 -or $Nupkgs[0].FullName -ne (Join-Path $ExpectedSquirrelRoot $ExpectedNupkgName)) {
  throw "Expected exactly $ExpectedNupkgName in the x64 Squirrel folder; found $($Nupkgs.Count)."
}
$Setup = $Setups[0]
$Nupkg = $Nupkgs[0]
$ExpectedSignerThumbprint = if ($env:WINDOWS_EXPECTED_SIGNER_THUMBPRINT) {
  ([string]$env:WINDOWS_EXPECTED_SIGNER_THUMBPRINT).Replace(' ', '').ToUpperInvariant()
} else {
  $null
}
if ($RequireSignature -and $ExpectedSignerThumbprint -notmatch '^[0-9A-F]{40}$') {
  throw 'WINDOWS_EXPECTED_SIGNER_THUMBPRINT must be the exact 40-character hexadecimal certificate thumbprint.'
}

$VersionSuffix = '-' + [regex]::Escape([string]$Package.version) + '-full$'
$PackageId = [IO.Path]::GetFileNameWithoutExtension($Nupkg.Name) -replace $VersionSuffix, ''
$InstallRoot = Join-Path $env:LOCALAPPDATA $PackageId
$InstalledExe = Join-Path $InstallRoot ("app-{0}\{1}.exe" -f $Package.version, $Package.productName)
$UpdateExe = Join-Path $InstallRoot 'Update.exe'
$ShortcutRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('StartMenu')
) | Where-Object { $_ }

if (Test-Path -LiteralPath $InstallRoot) {
  throw "Refusing to overwrite an existing Squirrel installation: $InstallRoot"
}

function Wait-ForPath([string]$Path, [bool]$ShouldExist, [int]$Seconds = 60) {
  $Deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    if ((Test-Path -LiteralPath $Path) -eq $ShouldExist) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $Deadline)
  throw "Timed out waiting for path state ($ShouldExist): $Path"
}

function Assert-ValidSignature([string]$Path, [string]$ExpectedThumbprint) {
  $Signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($Signature.Status -ne 'Valid') { throw "Authenticode is $($Signature.Status): $Path" }
  if (-not $Signature.TimeStamperCertificate) { throw "Authenticode timestamp is missing: $Path" }
  $ActualThumbprint = if ($Signature.SignerCertificate) {
    ([string]$Signature.SignerCertificate.Thumbprint).Replace(' ', '').ToUpperInvariant()
  } else {
    $null
  }
  if ($ActualThumbprint -ne $ExpectedThumbprint) {
    throw "Authenticode signer thumbprint is outside the configured allowlist: $Path"
  }
}

function Find-ProductShortcuts {
  @($ShortcutRoots | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.BaseName -eq [string]$Package.productName }
  })
}

function Wait-ForShortcuts([bool]$ShouldExist, [int]$Seconds = 60) {
  $Deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $Found = @(Find-ProductShortcuts)
    if (($Found.Count -gt 0) -eq $ShouldExist) { return $Found }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $Deadline)
  throw "Timed out waiting for product shortcut state ($ShouldExist)."
}

if (@(Find-ProductShortcuts).Count -gt 0) {
  throw "Refusing to overwrite existing $($Package.productName) shortcuts."
}

try {
  $Install = Start-Process -FilePath $Setup.FullName -ArgumentList '--silent' -Wait -PassThru
  if ($Install.ExitCode -ne 0) { throw "Squirrel installer exited with $($Install.ExitCode)." }
  Wait-ForPath -Path $InstalledExe -ShouldExist $true
  Wait-ForPath -Path $UpdateExe -ShouldExist $true
  $null = Wait-ForShortcuts -ShouldExist $true

  $VersionInfo = (Get-Item -LiteralPath $InstalledExe).VersionInfo
  if (-not ([string]$VersionInfo.ProductVersion).StartsWith([string]$Package.version)) {
    throw "Installed ProductVersion '$($VersionInfo.ProductVersion)' does not match $($Package.version)."
  }
  if ($RequireSignature) {
    Assert-ValidSignature -Path $Setup.FullName -ExpectedThumbprint $ExpectedSignerThumbprint
    Assert-ValidSignature -Path $InstalledExe -ExpectedThumbprint $ExpectedSignerThumbprint
  }

  $env:MARKDOWN_EDITOR_PACKAGED_EXE = $InstalledExe
  try {
    & pnpm exec playwright test e2e/application.spec.ts --grep 'real packaged application'
    if ($LASTEXITCODE -ne 0) { throw "Installed application Playwright smoke failed with $LASTEXITCODE." }
  } finally {
    Remove-Item Env:MARKDOWN_EDITOR_PACKAGED_EXE -ErrorAction SilentlyContinue
  }
} finally {
  if (Test-Path -LiteralPath $UpdateExe) {
    $Uninstall = Start-Process -FilePath $UpdateExe -ArgumentList '--uninstall', '-s' -Wait -PassThru
    if ($Uninstall.ExitCode -ne 0) {
      Write-Error "Squirrel uninstaller exited with $($Uninstall.ExitCode)."
    }
    Wait-ForPath -Path $InstalledExe -ShouldExist $false
    $null = Wait-ForShortcuts -ShouldExist $false
  }
}

if (Test-Path -LiteralPath $InstalledExe) {
  throw "Installed executable remains after uninstall: $InstalledExe"
}
Write-Host 'Disposable Squirrel install/launch/uninstall smoke passed.'

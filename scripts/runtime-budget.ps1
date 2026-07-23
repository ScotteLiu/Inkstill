param(
  [string]$ExecutablePath = "",
  [int]$StartupBudgetMs = 5000,
  [double]$PrivateMemoryBudgetMb = 450,
  [double]$IdleCpuBudgetPercent = 2,
  [int]$ProcessBudget = 5,
  [double]$PackageSizeBudgetMb = 380,
  [double]$AsarSizeBudgetMb = 12
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ExecutablePath) {
  $ExecutablePath = Join-Path $projectRoot "out\Inkstill-win32-x64\Inkstill.exe"
}
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$packageRoot = Split-Path -Parent $executable
$asarPath = Join-Path $packageRoot "resources\app.asar"
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$runtimeUserData = Join-Path $tempRoot ("inkstill-runtime-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $runtimeUserData -Force | Out-Null
$existingIds = @(
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -eq $executable } |
    ForEach-Object { [int]$_.ProcessId }
)
$startedIds = @()
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

try {
  $rootProcess = Start-Process `
    -FilePath $executable `
    -ArgumentList "--user-data-dir=$runtimeUserData" `
    -PassThru
  $startupMs = $null
  while ($stopwatch.ElapsedMilliseconds -lt 10000) {
    Start-Sleep -Milliseconds 50
    $rootProcess.Refresh()
    if ($rootProcess.HasExited) {
      throw "Inkstill exited before its window became ready."
    }
    if ($rootProcess.MainWindowHandle -ne 0) {
      $startupMs = [int]$stopwatch.ElapsedMilliseconds
      break
    }
  }
  if ($null -eq $startupMs) {
    throw "Inkstill did not show a window within 10 seconds."
  }

  Start-Sleep -Milliseconds 1000
  $startedIds = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ExecutablePath -eq $executable -and
        $existingIds -notcontains [int]$_.ProcessId
      } |
      ForEach-Object { [int]$_.ProcessId }
  )
  $before = @(Get-Process -Id $startedIds -ErrorAction SilentlyContinue)
  $cpuBefore = ($before | Measure-Object -Property CPU -Sum).Sum
  $sample = [System.Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Milliseconds 2000
  $after = @(Get-Process -Id $startedIds -ErrorAction SilentlyContinue)
  $sample.Stop()
  $cpuAfter = ($after | Measure-Object -Property CPU -Sum).Sum
  $logicalProcessors = [Math]::Max(1, [Environment]::ProcessorCount)
  $idleCpuPercent = (($cpuAfter - $cpuBefore) / $sample.Elapsed.TotalSeconds / $logicalProcessors) * 100
  $privateMemoryMb = (($after | Measure-Object -Property PrivateMemorySize64 -Sum).Sum / 1MB)
  $workingSetMb = (($after | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB)
  $packageSizeMb = ((
    Get-ChildItem -LiteralPath $packageRoot -File -Recurse |
      Measure-Object -Property Length -Sum
  ).Sum / 1MB)
  $asarSizeMb = (Get-Item -LiteralPath $asarPath).Length / 1MB

  $result = [ordered]@{
    startupMs = $startupMs
    processCount = $after.Count
    privateMemoryMb = [Math]::Round($privateMemoryMb, 1)
    workingSetMb = [Math]::Round($workingSetMb, 1)
    idleCpuPercent = [Math]::Round($idleCpuPercent, 2)
    packageSizeMb = [Math]::Round($packageSizeMb, 1)
    asarSizeMb = [Math]::Round($asarSizeMb, 2)
    budgets = [ordered]@{
      startupMs = $StartupBudgetMs
      processCount = $ProcessBudget
      privateMemoryMb = $PrivateMemoryBudgetMb
      idleCpuPercent = $IdleCpuBudgetPercent
      packageSizeMb = $PackageSizeBudgetMb
      asarSizeMb = $AsarSizeBudgetMb
    }
  }

  $testResults = Join-Path $projectRoot "test-results"
  New-Item -ItemType Directory -Path $testResults -Force | Out-Null
  $result | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $testResults "runtime-budget.json") -Encoding utf8
  $result | ConvertTo-Json -Depth 4

  $failures = @()
  if ($startupMs -gt $StartupBudgetMs) { $failures += "startup ${startupMs}ms > ${StartupBudgetMs}ms" }
  if ($after.Count -gt $ProcessBudget) { $failures += "process count $($after.Count) > $ProcessBudget" }
  if ($privateMemoryMb -gt $PrivateMemoryBudgetMb) { $failures += "private memory $([Math]::Round($privateMemoryMb, 1))MB > ${PrivateMemoryBudgetMb}MB" }
  if ($idleCpuPercent -gt $IdleCpuBudgetPercent) { $failures += "idle CPU $([Math]::Round($idleCpuPercent, 2))% > ${IdleCpuBudgetPercent}%" }
  if ($packageSizeMb -gt $PackageSizeBudgetMb) { $failures += "package size $([Math]::Round($packageSizeMb, 1))MB > ${PackageSizeBudgetMb}MB" }
  if ($asarSizeMb -gt $AsarSizeBudgetMb) { $failures += "app.asar size $([Math]::Round($asarSizeMb, 2))MB > ${AsarSizeBudgetMb}MB" }
  if ($failures.Count -gt 0) {
    throw "Runtime budget failed: $($failures -join '; ')"
  }
} finally {
  if ($startedIds.Count -eq 0) {
    $startedIds = @(
      Get-CimInstance Win32_Process |
        Where-Object {
          $_.ExecutablePath -eq $executable -and
          $existingIds -notcontains [int]$_.ProcessId
        } |
        ForEach-Object { [int]$_.ProcessId }
    )
  }
  if ($startedIds.Count -gt 0) {
    Stop-Process -Id $startedIds -Force -ErrorAction SilentlyContinue
  }
  $resolvedRuntimeUserData = [IO.Path]::GetFullPath($runtimeUserData)
  if ($resolvedRuntimeUserData.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedRuntimeUserData -Recurse -Force -ErrorAction SilentlyContinue
  }
}

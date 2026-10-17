# Validates and packages only the two pack directories. Tests/tools stay outside.
param([string]$OutputPath = (Join-Path $PSScriptRoot 'WaypointMonuments.mcaddon'))
$ErrorActionPreference = 'Stop'

& node (Join-Path $PSScriptRoot 'tools/validate-addon.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Add-on validation failed.' }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$temporaryOutput = "$resolvedOutput.building"
$stream = [System.IO.File]::Open($temporaryOutput, [System.IO.FileMode]::Create)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    foreach ($pack in @('WaypointMonuments_BP', 'WaypointMonuments_RP')) {
      $packPath = Join-Path $PSScriptRoot $pack
      foreach ($file in (Get-ChildItem -LiteralPath $packPath -File -Recurse | Sort-Object FullName)) {
        $relative = $file.FullName.Substring($PSScriptRoot.Length).TrimStart([char[]]'\/').Replace('\', '/')
        $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
        $inputStream = [System.IO.File]::OpenRead($file.FullName)
        $entryStream = $entry.Open()
        try { $inputStream.CopyTo($entryStream) }
        finally { $entryStream.Dispose(); $inputStream.Dispose() }
      }
    }
  }
  finally { $archive.Dispose() }
}
finally { $stream.Dispose() }

# Verify every archived file against the source before replacing the deliverable.
$verify = [System.IO.Compression.ZipFile]::OpenRead($temporaryOutput)
try {
  $expected = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'WaypointMonuments_BP'), (Join-Path $PSScriptRoot 'WaypointMonuments_RP') -File -Recurse).Count
  if ($verify.Entries.Count -ne $expected) { throw 'Archive entry count mismatch.' }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    foreach ($entry in $verify.Entries) {
      $entryStream = $entry.Open()
      $inputStream = [System.IO.File]::OpenRead((Join-Path $PSScriptRoot $entry.FullName))
      try {
        $archivedHash = [BitConverter]::ToString($sha.ComputeHash($entryStream))
        $sourceHash = [BitConverter]::ToString($sha.ComputeHash($inputStream))
        if ($archivedHash -ne $sourceHash) { throw "Archive content mismatch: $($entry.FullName)" }
      }
      finally { $entryStream.Dispose(); $inputStream.Dispose() }
    }
  }
  finally { $sha.Dispose() }
}
finally { $verify.Dispose() }
Move-Item -LiteralPath $temporaryOutput -Destination $resolvedOutput -Force
Write-Output "Built and verified: $resolvedOutput ($expected files)"

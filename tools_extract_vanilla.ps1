# Extracts files from the installed game's packed vanilla packs.
#   .\tools_extract_vanilla.ps1 -Names pillager.png,pillager.geo.json [-Kind resource|behavior] [-OutDir path]
# Layout of a .brarchive: 16-byte header (u32 entry count at +8), then one
# 256-byte entry per file (name length + name at +0, data offset at +248,
# size at +252), then the raw payloads.
param(
  [string[]]$Names,
  [ValidateSet("resource", "behavior")][string]$Kind = "resource",
  [string]$OutDir = (Join-Path $PSScriptRoot "tools_vanilla\rp")
)
$ErrorActionPreference = "Stop"
# The package folder carries the game version, so resolve the newest one rather
# than hard-coding it (the WindowsApps root itself cannot be listed, but a
# direct path into a package can be read).
$installs = @()
try {
  $installs = Get-AppxPackage -Name Microsoft.MinecraftUWP | Select-Object -ExpandProperty InstallLocation
} catch {}
$root = $null
foreach ($i in $installs) {
  $d = Join-Path $i "data"
  if (Test-Path (Join-Path $d "resource_packs")) { $root = $d; break }
}
if (-not $root) { throw "Minecraft install not found - is the UWP version installed?" }
$base = Join-Path $root ($(if ($Kind -eq "resource") { "resource_packs" } else { "behavior_packs" }))
New-Item -ItemType Directory -Force $OutDir | Out-Null

function Read-BrArchive($path) {
  $b = [System.IO.File]::ReadAllBytes($path)
  if ($b.Length -lt 16) { return @() }
  $count = [BitConverter]::ToUInt32($b, 8)
  $dataStart = 16 + $count * 256
  $entries = @()
  for ($i = 0; $i -lt $count; $i++) {
    $e = 16 + $i * 256
    $len = $b[$e]
    $name = [System.Text.Encoding]::UTF8.GetString($b, $e + 1, $len)
    $off = [BitConverter]::ToUInt32($b, $e + 248)
    $size = [BitConverter]::ToUInt32($b, $e + 252)
    $entries += [pscustomobject]@{ name = $name; offset = [int]$dataStart + [int]$off; size = [int]$size; archive = $path }
  }
  return $entries
}
function Version-Of($n) {
  $v = $n -replace '^vanilla_?', ''
  if ($v -eq '') { return [version]'0.0.0' }
  while (($v.Split('.').Count) -lt 3) { $v += '.0' }
  try { return [version]$v } catch { return [version]'0.0.0' }
}

foreach ($name in $Names) {
  $hits = @()
  foreach ($pack in (Get-ChildItem $base -Directory | Where-Object { $_.Name -like "vanilla*" })) {
    $arcDir = Join-Path $pack.FullName "__brarchive"
    if (-not (Test-Path $arcDir)) { continue }
    foreach ($arc in (Get-ChildItem $arcDir -Recurse -Filter "*.brarchive" -ErrorAction SilentlyContinue)) {
      foreach ($e in (Read-BrArchive $arc.FullName)) {
        if ($e.name -eq $name) { $hits += [pscustomobject]@{ pack = $pack.Name; ver = (Version-Of $pack.Name); entry = $e } }
      }
    }
  }
  if ($hits.Count -eq 0) { "MISSING: $name"; continue }
  $best = $hits | Sort-Object ver | Select-Object -Last 1
  $bytes = [System.IO.File]::ReadAllBytes($best.entry.archive)
  $seg = [byte[]]::new($best.entry.size)
  [Array]::Copy($bytes, $best.entry.offset, $seg, 0, $best.entry.size)
  $dest = Join-Path $OutDir $name
  [System.IO.File]::WriteAllBytes($dest, $seg)
  "$name <- $($best.pack) ($($best.entry.size) B)"
}

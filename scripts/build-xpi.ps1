param(
    [string]$Source = "firefox",
    [string]$Output = "firefox-extension.xpi"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$sourcePath = Join-Path $repoRoot $Source
$outputPath = Join-Path $repoRoot $Output

if (-not (Test-Path -Path $sourcePath -PathType Container)) {
    throw "Source folder '$sourcePath' was not found."
}

if (Test-Path -Path $outputPath -PathType Leaf) {
    Remove-Item -Path $outputPath -Force
}

Compress-Archive -Path (Join-Path $sourcePath "*") -DestinationPath $outputPath -Force

Write-Host "Created XPI at $outputPath"

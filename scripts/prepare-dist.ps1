param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

Push-Location $Root
try {
  & npm run build
  & npm run dist:onnx-daemon
  & npx electron-builder --win nsis portable
} finally {
  Pop-Location
}

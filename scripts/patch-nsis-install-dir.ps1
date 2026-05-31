param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$template = Join-Path $Root "node_modules\app-builder-lib\templates\nsis\assistedInstaller.nsh"
if (-not (Test-Path -LiteralPath $template)) {
  throw "NSIS assisted installer template not found: $template"
}

$sectionTemplate = Join-Path $Root "node_modules\app-builder-lib\templates\nsis\installSection.nsh"
if (-not (Test-Path -LiteralPath $sectionTemplate)) {
  throw "NSIS install section template not found: $sectionTemplate"
}

$content = Get-Content -LiteralPath $template -Raw

$old = @'
    !include StrContains.nsh

    !insertmacro skipPageIfUpdated
    !insertmacro MUI_PAGE_DIRECTORY

    # pageDirectory leave doesn't work (it seems because $INSTDIR is set after custom leave function)
    # so, we use instfiles pre
    !define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre

    # sanitize the MUI_PAGE_DIRECTORY result to make sure it has a application name sub-folder
    Function instFilesPre
      ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
      ${If} $0 == ""
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${endIf}
    FunctionEnd
'@

$new = @'
    !insertmacro skipPageIfUpdated
    !insertmacro MUI_PAGE_DIRECTORY

    # pageDirectory leave doesn't work (it seems because $INSTDIR is set after custom leave function)
    # so, we use instfiles pre
    !define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre

    # sanitize the MUI_PAGE_DIRECTORY result to make sure the last path segment is exactly the app name
    Function instFilesPre
      StrCpy $0 "$INSTDIR" "" -1
      ${If} $0 == "\"
        StrCpy $INSTDIR "$INSTDIR" -1
      ${EndIf}

      ${StdUtils.GetFileNamePart} $0 "$INSTDIR"
      ${If} $0 != "${APP_FILENAME}"
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${endIf}
    FunctionEnd
'@

if ($content.Contains($new)) {
  Write-Host "NSIS install directory template already patched."
} elseif (-not $content.Contains($old)) {
  throw "NSIS install directory template did not match the expected electron-builder layout."
} else {
  Set-Content -LiteralPath $template -Value $content.Replace($old, $new) -Encoding UTF8
  Write-Host "Patched NSIS assisted installer directory template."
}

$sectionContent = Get-Content -LiteralPath $sectionTemplate -Raw

$sectionOld = @'
InitPluginsDir

${IfNot} ${Silent}
'@

$sectionNew = @'
InitPluginsDir

# Silent installs with /D= skip the directory page, so enforce the same final
# install directory rule immediately before files, shortcuts, and registry writes.
StrCpy $0 "$INSTDIR" "" -1
${If} $0 == "\"
  StrCpy $INSTDIR "$INSTDIR" -1
${EndIf}

${StdUtils.GetFileNamePart} $0 "$INSTDIR"
${If} $0 != "${APP_FILENAME}"
  StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
${endIf}

${IfNot} ${Silent}
'@

if ($sectionContent.Contains($sectionNew)) {
  Write-Host "NSIS install section template already patched."
  exit 0
}

if (-not $sectionContent.Contains($sectionOld)) {
  throw "NSIS install section template did not match the expected electron-builder layout."
}

Set-Content -LiteralPath $sectionTemplate -Value $sectionContent.Replace($sectionOld, $sectionNew) -Encoding UTF8
Write-Host "Patched NSIS install section directory guard."

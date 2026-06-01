param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$assistedTemplate = Join-Path $Root "node_modules\app-builder-lib\templates\nsis\assistedInstaller.nsh"
if (Test-Path -LiteralPath $assistedTemplate) {
  $assistedContent = Get-Content -LiteralPath $assistedTemplate -Raw
  $forcedAssistedDirectory = @'
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
  $defaultAssistedDirectory = @'
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

  if ($assistedContent.Contains($forcedAssistedDirectory)) {
    Set-Content -LiteralPath $assistedTemplate -Value $assistedContent.Replace($forcedAssistedDirectory, $defaultAssistedDirectory) -Encoding UTF8
    Write-Host "Restored NSIS assisted installer directory behavior."
  }
}

$sectionTemplate = Join-Path $Root "node_modules\app-builder-lib\templates\nsis\installSection.nsh"
if (-not (Test-Path -LiteralPath $sectionTemplate)) {
  throw "NSIS install section template not found: $sectionTemplate"
}

$sectionContent = Get-Content -LiteralPath $sectionTemplate -Raw
$forcedInstallDirectory = @'
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
$defaultInstallDirectory = @'
InitPluginsDir

${IfNot} ${Silent}
'@

if ($sectionContent.Contains($forcedInstallDirectory)) {
  $sectionContent = $sectionContent.Replace($forcedInstallDirectory, $defaultInstallDirectory)
  Write-Host "Removed NSIS install section directory guard."
}

$beforeUninstallOld = @'
# must be called before uninstallOldVersion
!insertmacro setLinkVars

!ifdef ONE_CLICK
'@

$beforeUninstallNew = @'
# must be called before uninstallOldVersion
!insertmacro setLinkVars

!ifmacrodef customBeforeUninstallOldVersion
  !insertmacro customBeforeUninstallOldVersion
!endif

!ifdef ONE_CLICK
'@

if ($sectionContent.Contains($beforeUninstallNew)) {
  Write-Host "NSIS install section pre-uninstall hook already patched."
} elseif ($sectionContent.Contains($beforeUninstallOld)) {
  $sectionContent = $sectionContent.Replace($beforeUninstallOld, $beforeUninstallNew)
  Write-Host "Patched NSIS install section pre-uninstall hook."
} else {
  throw "NSIS install section did not contain the expected setLinkVars block."
}

Set-Content -LiteralPath $sectionTemplate -Value $sectionContent -Encoding UTF8
Write-Host "Patched NSIS install section runtime data hook."

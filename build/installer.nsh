!macro moveRuntimeDir dirName
  ${If} ${FileExists} "$INSTDIR\${dirName}\*.*"
    ${IfNot} ${FileExists} "$1\${dirName}\*.*"
      Rename "$INSTDIR\${dirName}" "$1\${dirName}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customBeforeUninstallOldVersion
  Push $0
  Push $1

  ${StdUtils.GetParentPath} $0 "$INSTDIR"
  StrCpy $1 "$0\${APP_FILENAME}Data"
  CreateDirectory "$1"

  !insertmacro moveRuntimeDir "data"
  !insertmacro moveRuntimeDir "models"
  !insertmacro moveRuntimeDir "logs"
  !insertmacro moveRuntimeDir "cache"
  !insertmacro moveRuntimeDir "tmp"

  Pop $1
  Pop $0
!macroend

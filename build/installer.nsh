!macro preInit
  Push $0
  Push $1

  StrCpy $0 "$INSTDIR" "" -1
  ${If} $0 == "\"
    StrCpy $INSTDIR "$INSTDIR" -1
  ${EndIf}

  ${StdUtils.GetFileNamePart} $1 "$INSTDIR"
  ${If} $1 != "${APP_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}

  Pop $1
  Pop $0
!macroend

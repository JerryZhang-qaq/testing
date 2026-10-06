; Electron bundles the runtime. Do not modify system Node.js or PATH.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装岚读"
  !define MUI_WELCOMEPAGE_TEXT "岚读是本地 EPUB 阅读器。$\r$\n$\r$\n安装包已内置完整运行环境，无需另行安装 Node.js 24，也不会修改系统 Node.js 或 PATH。$\r$\n$\r$\n适用于 Windows 10 / 11（64 位）。安装程序会自动检查系统版本。$\r$\n$\r$\n升级旧版时，可以指定旧版岚读所在目录。书库、阅读记录、书签和个性化设置都会保留。$\r$\n$\r$\n单击“下一步”开始安装。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "岚读需要 64 位 Windows 10 / 11。"
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "岚读需要 Windows 10 或更新版本。"
    Abort
  ${EndIf}
!macroend

; Keep the existing application identity and never enable deleteAppDataOnUninstall.
; Application data lives in %APPDATA%\lanread, outside the installation directory.
!macro customPageAfterChangeDir
  !include nsDialogs.nsh
  Var LanReadUpgradeCheck
  Var LanReadUpgradeInput
  Var LanReadUpgradeBrowse
  Var LanReadUpgradeEnabled
  Var LanReadUpgradePath

  ; electron-builder normally appends an app-name subdirectory. An explicitly
  ; selected old installation must instead be updated at the exact same path.
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE LanReadBeforeInstall
  Page custom LanReadUpgradePage LanReadUpgradeLeave

  Function LanReadUpgradePage
    !insertmacro MUI_HEADER_TEXT "升级与数据保留" "选择旧版岚读目录，只更新应用，保留本地书库。"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 36u "书籍、阅读记录、书签备注和个性化设置保存在独立的数据目录。安装和升级不会删除这些数据。$\r$\n请先关闭正在运行的岚读，再继续。"
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 14u "更新已有岚读（选择含有岚读.exe 的旧版文件夹）"
    Pop $LanReadUpgradeCheck
    ${NSD_OnClick} $LanReadUpgradeCheck LanReadUpgradeToggle
    ${NSD_CreateDirRequest} 0 67u 78% 14u "$INSTDIR"
    Pop $LanReadUpgradeInput
    ${NSD_CreateBrowseButton} 81% 67u 19% 14u "浏览…"
    Pop $LanReadUpgradeBrowse
    ${NSD_OnClick} $LanReadUpgradeBrowse LanReadUpgradeSelect
    ${NSD_CreateLabel} 0 93u 100% 52u "安装版：会自动识别登记的旧版目录，也可以手动指定。$\r$\nZIP 版：请选择解压后含有岚读.exe 的文件夹。$\r$\n当前 Windows 用户的书库会继续使用；无需重新导入。"
    Pop $0
    ${If} $LanReadUpgradePath != ""
      ${NSD_SetText} $LanReadUpgradeInput $LanReadUpgradePath
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${NSD_Check} $LanReadUpgradeCheck
    ${ElseIf} $LanReadUpgradeEnabled == ${BST_CHECKED}
      ${NSD_Check} $LanReadUpgradeCheck
    ${EndIf}
    Call LanReadUpgradeToggle
    nsDialogs::Show
  FunctionEnd

  Function LanReadUpgradeToggle
    ${NSD_GetState} $LanReadUpgradeCheck $LanReadUpgradeEnabled
    ${If} $LanReadUpgradeEnabled == ${BST_CHECKED}
      EnableWindow $LanReadUpgradeInput 1
      EnableWindow $LanReadUpgradeBrowse 1
    ${Else}
      EnableWindow $LanReadUpgradeInput 0
      EnableWindow $LanReadUpgradeBrowse 0
    ${EndIf}
  FunctionEnd

  Function LanReadUpgradeSelect
    ${NSD_GetText} $LanReadUpgradeInput $0
    nsDialogs::SelectFolderDialog "选择旧版岚读所在文件夹" "$0"
    Pop $0
    ${If} $0 != error
      ${NSD_SetText} $LanReadUpgradeInput $0
    ${EndIf}
  FunctionEnd

  Function LanReadUpgradeLeave
    ${NSD_GetState} $LanReadUpgradeCheck $LanReadUpgradeEnabled
    ${If} $LanReadUpgradeEnabled == ${BST_CHECKED}
      ${NSD_GetText} $LanReadUpgradeInput $LanReadUpgradePath
      ${IfNot} ${FileExists} "$LanReadUpgradePath\${APP_EXECUTABLE_FILENAME}"
      ${OrIfNot} ${FileExists} "$LanReadUpgradePath\resources\app.asar"
        MessageBox MB_OK|MB_ICONSTOP "没有找到完整的旧版岚读。请选择包含岚读.exe 和 resources 文件夹的目录。"
        Abort
      ${EndIf}
    ${Else}
      StrCpy $LanReadUpgradePath ""
    ${EndIf}
  FunctionEnd

  Function LanReadBeforeInstall
    ${If} $LanReadUpgradeEnabled == ${BST_CHECKED}
      StrCpy $INSTDIR $LanReadUpgradePath
    ${Else}
      ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
      ${If} $0 == ""
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
    ${EndIf}
  FunctionEnd
!macroend

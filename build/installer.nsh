; Electron bundles the runtime. Do not modify system Node.js or PATH.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装岚读"
  !define MUI_WELCOMEPAGE_TEXT "岚读是本地 EPUB 阅读器。$\r$\n$\r$\n安装包已内置完整运行环境，无需另行安装 Node.js 24，也不会修改系统 Node.js 或 PATH。$\r$\n$\r$\n适用于 Windows 10 / 11（64 位）。安装程序会自动检查系统版本。$\r$\n$\r$\n单击“下一步”开始安装。"
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

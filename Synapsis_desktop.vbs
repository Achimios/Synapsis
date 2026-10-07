' Synapsis desktop (tray app). Keep this file pure ASCII.
' Double-click: tray icon + launcher window (recent workspaces, open folder). Running it again just shows the launcher.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
home = fso.GetParentFolderName(WScript.ScriptFullName)
exe = home & "\app\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Electron not installed. In " & home & "\app run:" & vbCrLf & "npm install" & vbCrLf & "(set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ if the download fails)", 48, "Synapsis"
  WScript.Quit
End If
sh.Run """" & exe & """ """ & home & "\app\electron\main.mjs""", 1, False

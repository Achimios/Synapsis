' Synapsis init. Keep this file pure ASCII.
' Double-click: a folder picker opens (Explorer style, remembers the last place) -> the chosen project gets
'   __synapsis\, .synapsis\ and a Synapsis.vbs launcher.
' Or drag a project folder onto this file to skip the picker. Safe to run again (existing files are kept).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.GetParentFolderName(WScript.ScriptFullName) & "\core\tools\init_picker.ps1"
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
If WScript.Arguments.Count > 0 Then cmd = cmd & " -Dir """ & WScript.Arguments(0) & """"
sh.Run cmd, 0, False

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName) & "\spikes"
sh.CurrentDirectory = dir
If Not fso.FolderExists(dir & "\node_modules") Then sh.Run "cmd /c npm install", 0, True
' Start dev server hidden (no console window). Auto-exits ~3 min after all pages close.
' If it is already running, the second server just fails on the busy port; the browser still opens.
sh.Run "cmd /c npm run dev", 0, False
WScript.Sleep 2000
sh.Run "http://localhost:5410"

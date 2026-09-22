' Launches the dashboard server with no console window.
'
' Run by the "Cormac's Hub Dashboard" scheduled task at logon (see
' knowledge/build/tooling-choices.md). It waits for node rather than firing and
' forgetting, so if the server crashes this script exits with node's exit code and
' Task Scheduler's restart-on-failure can bring it back.
'
' Paths are derived from this script's own location, so moving the folder won't
' break it.

Dim fso, shell, scriptDir, nodeExe, exitCode

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"

If Not fso.FileExists(nodeExe) Then
  nodeExe = "node"
End If

shell.CurrentDirectory = scriptDir
exitCode = shell.Run("""" & nodeExe & """ """ & scriptDir & "\server.js""", 0, True)

WScript.Quit exitCode

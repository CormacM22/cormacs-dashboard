' Opens the dashboard in a clean app window (no tabs, no address bar).
'
' The scheduled task keeps the SERVER running, but a background server has nothing to
' click — this is the thing you actually launch. If the server happens to be down (just
' after a reboot, or between keep-alive ticks) this starts it and waits, rather than
' showing you a connection error.
'
' Normally run from the "Cormac's Hub" shortcut on the Desktop.

Option Explicit

Dim URL, TASK_NAME
URL = "http://localhost:4173"
TASK_NAME = "cormacs-hub-dashboard"

Dim shell, fso, i, serverUp, browser
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' ---- make sure the server is actually up ----
'
' Node can take a good ten to twenty seconds to start responding from cold on this
' machine, so wait up to 60s. An impatient launcher is worse than a slow one: it pops
' an error dialog for a server that was about to come up anyway.
serverUp = False
For i = 1 To 120
  If ServerResponds(URL) Then
    serverUp = True
    Exit For
  End If

  ' First miss: nudge the scheduled task. It's a no-op if the task is already running.
  If i = 1 Then shell.Run "schtasks /run /tn """ & TASK_NAME & """", 0, True
  WScript.Sleep 500
Next

If Not serverUp Then
  MsgBox "Cormac's Hub couldn't start." & vbCrLf & vbCrLf & _
         "The server isn't responding on " & URL & "." & vbCrLf & vbCrLf & _
         "Try: open Task Scheduler and run the task """ & TASK_NAME & """, " & _
         "or run 'npm start' in the dashboard folder to see the error.", _
         vbExclamation, "Cormac's Hub"
  WScript.Quit 1
End If

' ---- open it in app mode, falling back through what's installed ----
browser = FirstExisting(Array( _
  shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
  shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe" _
))

If browser = "" Then
  ' No Chrome or Edge: just hand it to whatever the default browser is.
  shell.Run URL, 1, False
Else
  shell.Run """" & browser & """ --app=" & URL, 1, False
End If

' ---- helpers ----

Function ServerResponds(address)
  Dim http
  ServerResponds = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", address, False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerResponds = True
  End If
  On Error GoTo 0
End Function

Function FirstExisting(paths)
  Dim p
  FirstExisting = ""
  For Each p In paths
    If fso.FileExists(p) Then
      FirstExisting = p
      Exit Function
    End If
  Next
End Function

Set WshShell = CreateObject("WScript.Shell")
' Run the batch file in hidden mode (0 = Hidden, True = Wait for completion)
WshShell.Run "cmd.exe /c start-hfit.bat", 0, True

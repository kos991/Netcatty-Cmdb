$action = New-ScheduledTaskAction -Execute 'C:\Users\Administrator\AppData\Local\Programs\Netcatty\Netcatty.exe' -WorkingDirectory 'C:\Users\Administrator\AppData\Local\Programs\Netcatty'
Register-ScheduledTask -TaskName 'RunNetcatty' -Action $action -Force
Start-ScheduledTask -TaskName 'RunNetcatty'

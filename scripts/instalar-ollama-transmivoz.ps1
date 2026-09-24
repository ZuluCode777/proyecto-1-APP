# Crea (o reemplaza) la tarea programada que arranca el Ollama de TransMiVoz
# al iniciar sesión, y la arranca ahora. No necesita permisos de administrador:
# la tarea corre como el usuario actual, en su sesión.
#
# Uso, desde la carpeta del repositorio:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-ollama-transmivoz.ps1

$ErrorActionPreference = 'Stop'
$taskName = 'TransMiVoz Ollama'
$scriptPath = Join-Path $PSScriptRoot 'ollama-transmivoz.ps1'
# No se usa $env:USERDOMAIN: por SSH vale "WORKGROUP" y el registro falla.
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description 'Ollama de TransMiVoz en 127.0.0.1:11435' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

for ($i = 0; $i -lt 30; $i++) {
  try {
    Invoke-RestMethod http://127.0.0.1:11435/api/version -TimeoutSec 2 | Out-Null
    "Ollama de TransMiVoz escuchando en 127.0.0.1:11435."
    exit 0
  } catch { Start-Sleep -Seconds 1 }
}
"La tarea se creó, pero Ollama no respondió en 127.0.0.1:11435."
exit 1

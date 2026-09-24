# Crea (o reemplaza) las dos tareas programadas de TransMiVoz y las arranca:
#
# - "TransMiVoz Ollama": el Ollama propio de la app en 127.0.0.1:11435,
#   separado del Ollama de uso personal (11434).
# - "TransMiVoz App": la app compilada (`next start`) en 127.0.0.1:3000.
#
# Las dos corren como el usuario actual, en su sesión, al iniciar sesión. No
# necesita permisos de administrador.
#
# Uso, desde la carpeta del repositorio, después de `pnpm build`:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-servicios-transmivoz.ps1

$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
# No se usa $env:USERDOMAIN: por SSH vale "WORKGROUP" y el registro falla.
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath (Join-Path $repoDir '.next\BUILD_ID'))) {
  throw "No hay compilación en $repoDir. Corre 'pnpm build' primero."
}

function Register-TransMiVozTask($taskName, $description, $action) {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description $description -Force | Out-Null
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $taskName
}

function Wait-Url($url) {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null
      return $true
    } catch { Start-Sleep -Seconds 1 }
  }
  return $false
}

$ollamaScript = Join-Path $PSScriptRoot 'ollama-transmivoz.ps1'
Register-TransMiVozTask 'TransMiVoz Ollama' 'Ollama de TransMiVoz en 127.0.0.1:11435' `
  (New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ollamaScript`"")
if (Wait-Url 'http://127.0.0.1:11435/api/version') { 'Ollama de TransMiVoz escuchando en 127.0.0.1:11435.' }
else { 'La tarea de Ollama se creó, pero no respondió en 127.0.0.1:11435.'; exit 1 }

$nodeExe = (Get-Command node -ErrorAction Stop).Source
Register-TransMiVozTask 'TransMiVoz App' 'App TransMiVoz en 127.0.0.1:3000' `
  (New-ScheduledTaskAction -Execute $nodeExe -WorkingDirectory $repoDir `
    -Argument 'node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3000')
if (Wait-Url 'http://127.0.0.1:3000/') { 'App TransMiVoz escuchando en 127.0.0.1:3000.' }
else { 'La tarea de la app se creó, pero no respondió en 127.0.0.1:3000.'; exit 1 }

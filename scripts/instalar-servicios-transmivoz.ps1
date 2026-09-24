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
  # Se detiene antes de reemplazarla: si se reemplaza mientras corre, el proceso
  # anterior queda huérfano ocupando el puerto y la tarea nueva no arranca.
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 2
  }
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description $description -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
}

function Wait-Url($url, [switch]$aceptar401) {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      # La app protegida ya escucha cuando pide la clave. Ollama exige 200.
      if ($aceptar401 -and $_.Exception.Response.StatusCode -eq 401) { return $true }
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

# Cualquier respuesta HTTP, aunque sea un error, significa que algo escucha.
function Test-PuertoOcupado($url) {
  try {
    Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return [bool]$_.Exception.Response
  }
}

. (Join-Path $PSScriptRoot 'detener-ollama.ps1')

# Detiene el Ollama que arrancó esta misma tarea antes, y sus hijos, por su PID
# y su hora de inicio. No toca el Ollama de uso personal ni ningún otro proceso
# llamado ollama. Hace falta porque detener la tarea solo detiene el script que
# arrancó a Ollama. Si ese Ollama ya terminó mientras la tarea corría, la tarea
# ya detuvo a sus hijos.
#
# Un archivo sin hora de inicio (de una versión anterior) o ilegible no detiene
# nada, porque no se sabe si el PID sigue siendo de ese Ollama.
function Stop-TransMiVozOllama {
  $pidFile = Join-Path $repoDir '.ollama-transmivoz.pid'
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return }
  $lineas = @(Get-Content -LiteralPath $pidFile)
  $idGuardado = $lineas[0] -as [int]
  $ticks = $(if ($lineas.Count -ge 2) { $lineas[1] -as [long] })
  if ($idGuardado -and $ticks -gt 0 -and $ticks -le [datetime]::MaxValue.Ticks) {
    Stop-OllamaConHijos $idGuardado ([datetime]::new($ticks))
  }
  Remove-Item -LiteralPath $pidFile -Force
}

$ollamaScript = Join-Path $PSScriptRoot 'ollama-transmivoz.ps1'
Stop-ScheduledTask -TaskName 'TransMiVoz Ollama' -ErrorAction SilentlyContinue
Stop-TransMiVozOllama
# Si algo sigue escuchando en el 11435, el Ollama nuevo no podría usar el
# puerto y la espera de abajo daría por bueno a ese otro proceso.
if (Test-PuertoOcupado 'http://127.0.0.1:11435/api/version') {
  'Algo sigue escuchando en 127.0.0.1:11435 después de detener el Ollama de TransMiVoz. Detén ese proceso por su PID y vuelve a correr el instalador.'
  exit 1
}
Register-TransMiVozTask 'TransMiVoz Ollama' 'Ollama de TransMiVoz en 127.0.0.1:11435' `
  (New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ollamaScript`"")
if (Wait-Url 'http://127.0.0.1:11435/api/version') { 'Ollama de TransMiVoz escuchando en 127.0.0.1:11435.' }
else { 'La tarea de Ollama se creó, pero no respondió en 127.0.0.1:11435.'; exit 1 }

$nodeExe = (Get-Command node -ErrorAction Stop).Source
Register-TransMiVozTask 'TransMiVoz App' 'App TransMiVoz en 127.0.0.1:3000' `
  (New-ScheduledTaskAction -Execute $nodeExe -WorkingDirectory $repoDir `
    -Argument 'node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3000')
if (Wait-Url 'http://127.0.0.1:3000/' -aceptar401) { 'App TransMiVoz escuchando en 127.0.0.1:3000.' }
else { 'La tarea de la app se creó, pero no respondió en 127.0.0.1:3000.'; exit 1 }

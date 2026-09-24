# Ollama propio de TransMiVoz, separado del Ollama de uso personal.
#
# Escucha en 127.0.0.1:11435 para no chocar con el Ollama normal, que usa el
# 11434. Comparte la carpeta de modelos, así que no descarga nada de nuevo.
# La app lo usa con OLLAMA_BASE_URL=http://127.0.0.1:11435 en .env.local.
#
# Se arranca solo al iniciar sesión con la tarea programada que crea
# scripts/instalar-servicios-transmivoz.ps1.
#
# Guarda el PID de Ollama y su hora de inicio en .ollama-transmivoz.pid:
# detener la tarea programada solo detiene este script, no a Ollama, así que el
# instalador usa esos datos para detener exactamente este proceso y no otro.
#
# Si Ollama termina mientras este script espera (una falla, o alguien lo
# detuvo a mano), el script detiene los procesos que cargaban sus modelos. Los
# avisos quedan en .ollama-transmivoz.log, porque la tarea no tiene ventana.

. (Join-Path $PSScriptRoot 'detener-ollama.ps1')

$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
if (-not (Test-Path -LiteralPath $ollamaExe)) {
  $ollamaExe = (Get-Command ollama -ErrorAction Stop).Source
}
$repoDir = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $repoDir '.ollama-transmivoz.pid'
$logFile = Join-Path $repoDir '.ollama-transmivoz.log'

$env:OLLAMA_HOST = '127.0.0.1:11435'
$env:OLLAMA_KEEP_ALIVE = '1h'
$ollamaProc = Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -PassThru -WindowStyle Hidden
$inicio = $ollamaProc.StartTime
Set-Content -LiteralPath $pidFile -Value $ollamaProc.Id, $inicio.Ticks -Encoding ascii
Wait-Process -Id $ollamaProc.Id
Stop-OllamaConHijos $ollamaProc.Id $inicio (Get-Date) 3>> $logFile

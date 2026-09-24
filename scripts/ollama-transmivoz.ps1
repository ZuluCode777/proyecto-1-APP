# Ollama propio de TransMiVoz, separado del Ollama de uso personal.
#
# Escucha en 127.0.0.1:11435 para no chocar con el Ollama normal, que usa el
# 11434. Comparte la carpeta de modelos, así que no descarga nada de nuevo.
# La app lo usa con OLLAMA_BASE_URL=http://127.0.0.1:11435 en .env.local.
#
# Se arranca solo al iniciar sesión con la tarea programada que crea
# scripts/instalar-servicios-transmivoz.ps1.
#
# Guarda el PID de Ollama en .ollama-transmivoz.pid: detener la tarea programada
# solo detiene este script, no a Ollama, así que el instalador usa ese PID para
# detener exactamente este proceso y no otro.

$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
if (-not (Test-Path -LiteralPath $ollamaExe)) {
  $ollamaExe = (Get-Command ollama -ErrorAction Stop).Source
}
$pidFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.ollama-transmivoz.pid'

$env:OLLAMA_HOST = '127.0.0.1:11435'
$env:OLLAMA_KEEP_ALIVE = '1h'
$ollamaProc = Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $pidFile -Value $ollamaProc.Id -Encoding ascii
Wait-Process -Id $ollamaProc.Id

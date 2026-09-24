# Ollama propio de TransMiVoz, separado del Ollama de uso personal.
#
# Escucha en 127.0.0.1:11435 para no chocar con el Ollama normal, que usa el
# 11434. Comparte la carpeta de modelos, así que no descarga nada de nuevo.
# La app lo usa con OLLAMA_BASE_URL=http://127.0.0.1:11435 en .env.local.
#
# Se arranca solo al iniciar sesión con la tarea programada que crea
# scripts/instalar-servicios-transmivoz.ps1.

$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
if (-not (Test-Path -LiteralPath $ollamaExe)) {
  $ollamaExe = (Get-Command ollama -ErrorAction Stop).Source
}

$env:OLLAMA_HOST = '127.0.0.1:11435'
$env:OLLAMA_KEEP_ALIVE = '1h'
& $ollamaExe serve

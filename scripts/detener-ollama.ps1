# Detiene el Ollama de TransMiVoz y los procesos que cargan sus modelos.
# Lo usan scripts/ollama-transmivoz.ps1 y scripts/instalar-servicios-transmivoz.ps1.
#
# Ollama carga cada modelo en un proceso hijo: llama-server.exe en la versión
# 0.34, ollama.exe en otras. Windows no detiene los hijos junto con el padre, y
# un hijo huérfano sigue ocupando la memoria de la GPU.
#
# $Id y $Inicio son el PID y la hora de inicio del `ollama serve` que arrancó
# TransMiVoz. Cuando ese proceso termina, Windows puede dar el mismo PID a
# otro, incluso al Ollama de uso personal. Por eso:
# - El proceso con ese PID se detiene solo si empezó exactamente en $Inicio.
#   Si no se puede leer su hora de inicio, no se detiene.
# - Un hijo se detiene solo si se creó mientras ese Ollama corría. Si sigue
#   vivo, vale cualquier hijo creado desde $Inicio. Si ya terminó, solo los
#   creados entre $Inicio y $Fin, un momento en que ya había terminado. Si
#   otro proceso ya tiene el PID, el límite es la hora en que ese empezó.
# - Si el proceso ya terminó y no hay $Fin, no se detiene nada, porque no se
#   sabe desde cuándo el PID puede ser de otro.
function Stop-OllamaConHijos([int]$Id, [datetime]$Inicio, [Nullable[datetime]]$Fin) {
  $detener = { param($idProceso)
    try {
      Stop-Process -Id $idProceso -ErrorAction Stop
      $true
    } catch {
      if (Get-Process -Id $idProceso -ErrorAction SilentlyContinue) {
        Write-Warning "No se pudo detener el proceso $idProceso de Ollama; sigue ocupando memoria: $_"
      }
      $false
    }
  }
  $detenidos = 0
  $proceso = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if ($proceso -and $proceso.StartTime -eq $Inicio) {
    $Fin = [datetime]::MaxValue
    if (& $detener $Id) { $detenidos++ }
  } elseif (-not $Fin -or ($proceso -and -not $proceso.StartTime)) {
    return
  } elseif ($proceso -and $proceso.StartTime -lt $Fin) {
    $Fin = $proceso.StartTime
  }
  # Los hijos se buscan después de detener al padre, para no dejar afuera un
  # modelo que se cargue mientras tanto.
  $hijos = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ParentProcessId -eq $Id -and $_.Name -like '*llama*' -and
      $_.CreationDate -ge $Inicio -and $_.CreationDate -le $Fin
  })
  foreach ($hijo in $hijos) {
    if (& $detener $hijo.ProcessId) { $detenidos++ }
  }
  if ($detenidos) { Start-Sleep -Seconds 2 }
}

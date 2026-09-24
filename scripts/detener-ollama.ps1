# Detiene el Ollama de TransMiVoz y los procesos que cargan sus modelos.
# Lo usan scripts/ollama-transmivoz.ps1 y scripts/instalar-servicios-transmivoz.ps1.
#
# Ollama carga cada modelo en un proceso hijo: llama-server.exe en la versión
# 0.34, ollama.exe en otras. Windows no detiene los hijos junto con el padre, y
# un hijo huérfano sigue ocupando la memoria de la GPU.
#
# $Id es el PID del `ollama serve` que arrancó TransMiVoz. $Desde es un momento
# en que ese proceso ya corría: su hora de inicio o la de guardar su PID.
# Cuando el proceso termina, Windows puede dar el mismo PID a otro, incluso al
# Ollama de uso personal. Por eso solo se detiene:
# - el proceso con ese PID, si empezó antes de $Desde (si no, es otro);
# - sus hijos creados desde $Desde, y, si el PID ya es de otro proceso, antes
#   de que ese otro empezara.
function Stop-OllamaConHijos([int]$Id, [datetime]$Desde) {
  $hasta = [datetime]::MaxValue
  $detenidos = 0
  $proceso = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if ($proceso -and $proceso.StartTime -gt $Desde) {
    $hasta = $proceso.StartTime
  } elseif ($proceso -and $proceso.ProcessName -eq 'ollama') {
    Stop-Process -Id $Id
    $detenidos++
  }
  # Se buscan después de detener al padre: así no queda afuera un modelo que
  # se cargue mientras tanto.
  $hijos = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ParentProcessId -eq $Id -and $_.Name -like '*llama*' -and
      $_.CreationDate -ge $Desde -and $_.CreationDate -lt $hasta
  })
  foreach ($hijo in $hijos) {
    try {
      Stop-Process -Id $hijo.ProcessId -ErrorAction Stop
      $detenidos++
    } catch {
      if (Get-Process -Id $hijo.ProcessId -ErrorAction SilentlyContinue) {
        Write-Warning "No se pudo detener el proceso $($hijo.ProcessId) de Ollama; sigue ocupando memoria: $_"
      }
    }
  }
  if ($detenidos) { Start-Sleep -Seconds 2 }
}

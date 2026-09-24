# Ollama propio de TransMiVoz, separado del Ollama de uso personal.
#
# Escucha en 127.0.0.1:11435 para no chocar con el Ollama normal, que usa el
# 11434. Comparte la carpeta de modelos, así que no descarga nada de nuevo.
# La app lo usa con OLLAMA_BASE_URL=http://127.0.0.1:11435 en .env.local.
#
# Se arranca solo al iniciar sesión con la tarea programada que crea
# scripts/instalar-servicios-transmivoz.ps1.
#
# Ollama queda dentro de un objeto de trabajo de Windows que se cierra cuando
# termina este script, de cualquier forma: al detener la tarea, al terminarla
# a mano desde el Programador de tareas o al cerrar la sesión. Al cerrarse,
# Windows detiene todos sus procesos: Ollama y los procesos hijo que cargan
# los modelos (llama-server.exe), que heredan el trabajo. Sin esto, Ollama
# seguiría vivo al detener la tarea, porque detenerla solo detiene este script.
#
# Guarda además el PID de Ollama y su hora de inicio en .ollama-transmivoz.pid.
# El instalador los usa para detener exactamente este proceso y no otro si,
# por ejemplo, no se pudo meter a Ollama en el trabajo.
#
# Si Ollama termina mientras este script espera (una falla, o alguien lo
# detuvo a mano), el script detiene los procesos que cargaban sus modelos con
# Stop-OllamaConHijos y, al terminar, el trabajo detiene lo que quede. Así se
# limpian también si Ollama no entró en el trabajo. Los avisos y errores quedan
# en .ollama-transmivoz.log, porque la tarea no tiene ventana.

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
$trabajoCs = @'
using System;
using System.Runtime.InteropServices;

public static class TrabajoTransMiVoz {
  [StructLayout(LayoutKind.Sequential)]
  struct LimitesBasicos {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct LimitesExtendidos {
    public LimitesBasicos Basicos;
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr atributos, string nombre);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr trabajo, int clase, ref LimitesExtendidos info, uint largo);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr trabajo, IntPtr proceso);

  const int JobObjectExtendedLimitInformation = 9;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

  // Crea un trabajo que detiene todos sus procesos cuando se cierra y mete en
  // él al proceso. El identificador del trabajo nunca se cierra a propósito:
  // Windows lo cierra cuando termina este script, y cerrarlo antes detendría a
  // Ollama.
  public static void Meter(IntPtr proceso) {
    IntPtr trabajo = CreateJobObject(IntPtr.Zero, null);
    if (trabajo == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    LimitesExtendidos info = new LimitesExtendidos();
    info.Basicos.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(trabajo, JobObjectExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(info)))
      throw new System.ComponentModel.Win32Exception();
    if (!AssignProcessToJobObject(trabajo, proceso))
      throw new System.ComponentModel.Win32Exception();
  }
}
'@

$ollamaProc = Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -PassThru -WindowStyle Hidden
$inicio = $ollamaProc.StartTime
# Ollama entra al trabajo unos milisegundos después de arrancar. Los modelos
# se cargan después, cuando la app los pide, así que sus procesos ya nacen
# dentro del trabajo.
try {
  Add-Type -TypeDefinition $trabajoCs -ErrorAction Stop
  [TrabajoTransMiVoz]::Meter($ollamaProc.Handle)
} catch {
  "$(Get-Date -Format s) No se pudo meter a Ollama en un objeto de trabajo; al detener la tarea, Ollama seguirá vivo: $_" |
    Add-Content -LiteralPath $logFile
}
Set-Content -LiteralPath $pidFile -Value $ollamaProc.Id, $inicio.Ticks -Encoding ascii
Wait-Process -Id $ollamaProc.Id
Stop-OllamaConHijos $ollamaProc.Id $inicio (Get-Date) *>> $logFile

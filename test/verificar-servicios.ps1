# Prueba la espera del instalador, su control del puerto de Ollama, el mensaje
# cuando el puerto esta ocupado y como se detiene el Ollama de TransMiVoz, sin
# modificar tareas ni detener procesos de verdad.
$ErrorActionPreference = 'Stop'
$archivo = Join-Path $PSScriptRoot '../scripts/instalar-servicios-transmivoz.ps1'
$arbol = [System.Management.Automation.Language.Parser]::ParseFile($archivo, [ref]$null, [ref]$null)
foreach ($nombre in 'Wait-Url', 'Test-PuertoOcupado', 'Get-OcupantesPuerto', 'Stop-TransMiVozOllama') {
  $funcion = $arbol.Find({ param($nodo)
    $nodo -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $nodo.Name -eq $nombre
  }, $true)
  Invoke-Expression $funcion.Extent.Text
}

function Start-Sleep { param($Seconds) }
function Invoke-WebRequest {
  param($Uri, [switch]$UseBasicParsing, $TimeoutSec)
  if ($script:estado -eq 200) { return }
  $excepcion = [System.Exception]::new('Respuesta simulada')
  if ($script:estado) {
    $excepcion | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{ StatusCode = $script:estado })
  }
  throw $excepcion
}

foreach ($script:estado in @(200, 401, 500, 0)) {
  foreach ($aceptar in @($false, $true)) {
    $esperado = $script:estado -eq 200 -or ($aceptar -and $script:estado -eq 401)
    if ((Wait-Url 'http://localhost/' -aceptar401:$aceptar) -ne $esperado) {
      throw "Espera incorrecta: estado=$script:estado, aceptar401=$aceptar"
    }
  }
  # Cualquier respuesta, aunque sea un error, ocupa el puerto; sin respuesta, no.
  if ((Test-PuertoOcupado 'http://localhost/') -ne ($script:estado -ne 0)) {
    throw "Puerto mal evaluado: estado=$script:estado"
  }
}
'Correcto: espera con y sin clave, y control del puerto, con 200, 401, 500 y fallo de conexion.'

# Stop-OllamaConHijos y Stop-TransMiVozOllama: detienen el Ollama de TransMiVoz
# y sus hijos, y nada mas, tampoco si Windows dio el PID a otro proceso. Los
# procesos son simulados.
. (Join-Path $PSScriptRoot '../scripts/detener-ollama.ps1')

$inicio = [datetime]'2026-09-24 12:00'
function Get-CimInstance {
  $hijo = { param($id, $padre, $nombre, $minutos)
    [pscustomobject]@{ ProcessId = $id; ParentProcessId = $padre; Name = $nombre; CreationDate = $inicio.AddMinutes($minutos) } }
  & $hijo 201 100 'llama-server.exe' 2   # del Ollama de TransMiVoz
  & $hijo 202 100 'llama-server.exe' (-2) # de un proceso anterior con ese PID
  & $hijo 203 100 'conhost.exe' 2        # no carga modelos
  & $hijo 204 999 'llama-server.exe' 2   # de otro padre
  & $hijo 205 100 'llama-server.exe' 6   # del Ollama de TransMiVoz si sigue vivo; si no, de otro
}
function Get-Process { param($Id, $ErrorAction) $script:vivos[$Id] }
function Stop-Process {
  param($Id, $ErrorAction)
  if ($script:fallan -contains $Id) { throw 'Acceso denegado' }
  $script:stopProcess += $Id
}
function Proceso($minutos) { [pscustomobject]@{ StartTime = $(if ($null -ne $minutos) { $inicio.AddMinutes($minutos) }) } }

$casos = @(
  @{ Nombre = 'Ollama vivo'; Vivos = @{ 100 = (Proceso 0) }; Esperados = '100,201,205' }
  @{ Nombre = 'Ollama terminado a las 12:05'; Vivos = @{}; Fin = $inicio.AddMinutes(5); Esperados = '201' }
  @{ Nombre = 'Ollama terminado sin hora'; Vivos = @{}; Esperados = '' }
  @{ Nombre = 'PID de otro Ollama'; Vivos = @{ 100 = (Proceso 5) }; Esperados = '' }
  @{ Nombre = 'PID de otro Ollama desde las 12:05, visto a las 12:07'; Vivos = @{ 100 = (Proceso 5) }; Fin = $inicio.AddMinutes(7); Esperados = '201' }
  @{ Nombre = 'PID de otro Ollama desde las 12:07, visto a las 12:05'; Vivos = @{ 100 = (Proceso 7) }; Fin = $inicio.AddMinutes(5); Esperados = '201' }
  @{ Nombre = 'PID de otro proceso ilegible, visto a las 12:07'; Vivos = @{ 100 = (Proceso $null) }; Fin = $inicio.AddMinutes(7); Esperados = '' }
  @{ Nombre = 'hora de inicio ilegible'; Vivos = @{ 100 = (Proceso $null) }; Esperados = '' }
  @{ Nombre = 'hijo que no se detiene'; Vivos = @{ 100 = (Proceso 0); 201 = (Proceso 2) }; Fallan = 201; Esperados = '100,205'; Aviso = 201 }
)
foreach ($caso in $casos) {
  $script:vivos = $caso.Vivos
  $script:fallan = @($caso.Fallan)
  $script:stopProcess = @()
  $avisos = @(Stop-OllamaConHijos 100 $inicio $caso.Fin 3>&1)
  if (($script:stopProcess -join ',') -ne $caso.Esperados) {
    throw "Con $($caso.Nombre) detuvo '$($script:stopProcess -join ',')' y debia detener '$($caso.Esperados)'"
  }
  $esperaAviso = [bool]$caso.Aviso
  if ([bool]($avisos -match "proceso $($caso.Aviso) ") -ne $esperaAviso -or ($avisos.Count -gt 0) -ne $esperaAviso) {
    throw "Con $($caso.Nombre) los avisos fueron: $avisos"
  }
}

# El instalador lee el PID y la hora de inicio del archivo, y lo borra. Un
# archivo sin hora de inicio (version anterior) o ilegible no detiene nada.
$repoDir = [System.IO.Path]::GetTempPath()
$pidFile = Join-Path $repoDir '.ollama-transmivoz.pid'
try {
  $archivos = @(
    @{ Contenido = @('100', $inicio.Ticks); Esperados = '100,201,205' }
    @{ Contenido = @('100'); Esperados = '' }
    @{ Contenido = @('basura', 'x'); Esperados = '' }
    @{ Contenido = @('100', '-5'); Esperados = '' }
    @{ Contenido = @('100', [long]::MaxValue); Esperados = '' }
  )
  foreach ($caso in $archivos) {
    $script:vivos = @{ 100 = (Proceso 0) }
    $script:fallan = @()
    $script:stopProcess = @()
    Set-Content -LiteralPath $pidFile -Value $caso.Contenido
    Stop-TransMiVozOllama
    if (($script:stopProcess -join ',') -ne $caso.Esperados) {
      throw "El instalador detuvo '$($script:stopProcess -join ',')' y debia detener '$($caso.Esperados)'"
    }
    if (Test-Path -LiteralPath $pidFile) { throw 'No borro el archivo del PID.' }
  }
} finally {
  if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
}
'Correcto: detiene el Ollama de TransMiVoz y sus hijos, y ningun otro proceso.'

# El mensaje de puerto ocupado dice el PID y el nombre de lo que escucha.
function Get-NetTCPConnection { param($LocalPort, $State, $ErrorAction) $script:conexiones }
$script:vivos = @{ 4242 = [pscustomobject]@{ ProcessName = 'ollama' } }
$script:conexiones = @([pscustomobject]@{ OwningProcess = 4242 }, [pscustomobject]@{ OwningProcess = 4242 })
if ((Get-OcupantesPuerto 11435) -ne 'PID 4242 (ollama)') { throw "Ocupantes mal descritos: $(Get-OcupantesPuerto 11435)" }
$script:conexiones = @()
if ((Get-OcupantesPuerto 11435) -ne 'un proceso que no se pudo identificar') { throw 'Sin conexiones debia decir que no se pudo identificar.' }
'Correcto: el mensaje de puerto ocupado dice que proceso lo ocupa.'

# Prueba la espera del instalador y como se detiene el Ollama de TransMiVoz,
# sin modificar tareas ni detener procesos de verdad.
$ErrorActionPreference = 'Stop'
$archivo = Join-Path $PSScriptRoot '../scripts/instalar-servicios-transmivoz.ps1'
$arbol = [System.Management.Automation.Language.Parser]::ParseFile($archivo, [ref]$null, [ref]$null)
$funcion = $arbol.Find({ param($nodo)
  $nodo -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $nodo.Name -eq 'Wait-Url'
}, $true)
Invoke-Expression $funcion.Extent.Text

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
}
'Correcto: 200, 401, 500 y fallo de conexion, con y sin clave.'

# Stop-OllamaConHijos: detiene el Ollama de TransMiVoz y sus hijos, aunque el
# padre ya no exista, y nada mas; tampoco si Windows dio el PID a otro Ollama.
# Los procesos son simulados.
. (Join-Path $PSScriptRoot '../scripts/detener-ollama.ps1')
$desde = [datetime]'2026-09-24 12:00'
function Get-CimInstance {
  $hijo = { param($id, $padre, $nombre, $minutos)
    [pscustomobject]@{ ProcessId = $id; ParentProcessId = $padre; Name = $nombre; CreationDate = $desde.AddMinutes($minutos) } }
  & $hijo 201 100 'llama-server.exe' 2   # hijo del Ollama de TransMiVoz
  & $hijo 202 100 'llama-server.exe' -2  # de un proceso anterior con ese PID
  & $hijo 203 100 'conhost.exe' 2        # no carga modelos
  & $hijo 204 999 'llama-server.exe' 2   # de otro padre
  & $hijo 205 100 'llama-server.exe' 6   # de despues: del padre si sigue vivo, de otro si reutilizo el PID
}
function Get-Process { param($Id, $ErrorAction) if ($Id -eq 100) { $script:padre } }
function Stop-Process { param($Id, $ErrorAction) $script:detenidos += $Id }

$casos = @(
  @{ Nombre = 'padre vivo'; Padre = [pscustomobject]@{ ProcessName = 'ollama'; StartTime = $desde.AddSeconds(-1) }; Esperados = '100,201,205' }
  @{ Nombre = 'padre muerto'; Padre = $null; Esperados = '201,205' }
  @{ Nombre = 'PID reutilizado'; Padre = [pscustomobject]@{ ProcessName = 'ollama'; StartTime = $desde.AddMinutes(5) }; Esperados = '201' }
)
foreach ($caso in $casos) {
  $script:padre = $caso.Padre
  $script:detenidos = @()
  Stop-OllamaConHijos 100 $desde
  if (($script:detenidos -join ',') -ne $caso.Esperados) {
    throw "Con $($caso.Nombre) detuvo $($script:detenidos -join ',') y debia detener $($caso.Esperados)"
  }
}
'Correcto: detiene el Ollama y sus hijos, con el padre vivo, muerto o reemplazado.'

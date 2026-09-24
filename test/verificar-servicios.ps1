# Prueba la espera del instalador y como detiene su Ollama, sin modificar
# tareas ni detener procesos de verdad.
$ErrorActionPreference = 'Stop'
$archivo = Join-Path $PSScriptRoot '../scripts/instalar-servicios-transmivoz.ps1'
$arbol = [System.Management.Automation.Language.Parser]::ParseFile($archivo, [ref]$null, [ref]$null)
foreach ($nombre in 'Wait-Url', 'Stop-TransMiVozOllama') {
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
}
'Correcto: 200, 401, 500 y fallo de conexion, con y sin clave.'

# Stop-TransMiVozOllama: detiene el Ollama guardado y sus hijos llama-server,
# aunque el padre ya no exista, y nada mas. Los procesos son simulados.
$repoDir = [System.IO.Path]::GetTempPath()
$pidFile = Join-Path $repoDir '.ollama-transmivoz.pid'
function Get-CimInstance { $script:procesos }
function Get-Process { param($Id, $ErrorAction) if ($script:padreVivo -and $Id -eq 100) { [pscustomobject]@{ ProcessName = 'ollama' } } }
function Stop-Process { param($Id, $ErrorAction) $script:detenidos += $Id }

try {
  foreach ($script:padreVivo in @($true, $false)) {
    Set-Content -LiteralPath $pidFile -Value 100
    $antes = (Get-Item -LiteralPath $pidFile -Force).LastWriteTime.AddMinutes(-1)
    $despues = $antes.AddMinutes(2)
    $script:procesos = @(
      [pscustomobject]@{ ProcessId = 201; ParentProcessId = 100; Name = 'llama-server.exe'; CreationDate = $despues }
      [pscustomobject]@{ ProcessId = 202; ParentProcessId = 100; Name = 'llama-server.exe'; CreationDate = $antes }
      [pscustomobject]@{ ProcessId = 203; ParentProcessId = 100; Name = 'conhost.exe'; CreationDate = $despues }
      [pscustomobject]@{ ProcessId = 204; ParentProcessId = 999; Name = 'llama-server.exe'; CreationDate = $despues }
    )
    $script:detenidos = @()
    Stop-TransMiVozOllama
    $esperados = if ($script:padreVivo) { '100,201' } else { '201' }
    if (($script:detenidos -join ',') -ne $esperados) {
      throw "Detuvo $($script:detenidos -join ',') y debia detener $esperados (padre vivo: $script:padreVivo)"
    }
    if (Test-Path -LiteralPath $pidFile) { throw 'No borro el archivo del PID.' }
  }
} finally {
  if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
}
'Correcto: detiene el Ollama guardado y sus hijos, con el padre vivo o muerto.'

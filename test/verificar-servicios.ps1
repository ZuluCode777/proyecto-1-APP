# Prueba la espera del instalador sin modificar tareas ni arrancar servicios.
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

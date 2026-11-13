#!/usr/bin/env bash
# Autocomprobación de comprobar-ios.sh: lo que no necesita Xcode. Corre en Linux y
# en macOS (bash 3.2). Comprueba que el script no borra nada, que nunca pisa
# evidencia previa y que, sin herramientas de Apple, falla en vez de aprobar.
#
# Uso:  ios/scripts/probar-comprobar-ios.sh
#
# Crea una carpeta temporal con `mktemp -d` y NO la borra (esta autocomprobación
# tampoco borra nada): el sistema limpia el directorio temporal.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$AQUI/comprobar-ios.sh"
RAIZ="$(cd "$AQUI/../.." && pwd)"
TEMPORAL="$(mktemp -d)"
fallos=0
total=0

comprobar() { # descripción, y luego el comando que debe salir con 0
  local descripcion="$1"; shift
  total=$((total + 1))
  if "$@" >/dev/null 2>&1; then echo "ok    $descripcion"; else echo "FALLA $descripcion" >&2; fallos=$((fallos + 1)); fi
}
debe_fallar() { # descripción, y luego el comando que debe salir distinto de 0
  local descripcion="$1"; shift
  total=$((total + 1))
  if "$@" >/dev/null 2>&1; then echo "FALLA $descripcion (salió con 0)" >&2; fallos=$((fallos + 1)); else echo "ok    $descripcion"; fi
}

sin_borrados() { ! grep -nE '(^|[;&|(` ])(rm|unlink|rmdir|shred)( |$)|find .*-delete' "$SCRIPT"; }
comprobar "el script no contiene ningún borrado (rm, unlink, rmdir, shred, find -delete)" sin_borrados

# Con `source` solo quedan definidas las funciones: no se ejecuta ningún paso.
cargar() { env SALIDA="$TEMPORAL/fija" bash -c 'source "$1" && declare -F sin_pisar >/dev/null' _ "$SCRIPT"; }
comprobar "cargar con source solo define funciones" cargar

sin_pisar_en() { env SALIDA="$TEMPORAL/fija" bash -c 'source "$1" && sin_pisar "$2"' _ "$SCRIPT" "$1"; }
debe_fallar "sin_pisar falla si la ruta ya existe" sin_pisar_en "$SCRIPT"
comprobar "sin_pisar acepta una ruta que no existe" sin_pisar_en "$TEMPORAL/no-existe"

salida_por_defecto() { env -u SALIDA bash -c 'source "$1" && echo "$SALIDA"' _ "$SCRIPT"; }
primera="$(salida_por_defecto)"; segunda="$(salida_por_defecto)"
total=$((total + 1))
if [ "$primera" != "$segunda" ] && [ "${primera#"$RAIZ/ios/salida/"}" != "$primera" ]; then
  echo "ok    la salida por defecto es una carpeta nueva por ejecución ($primera)"
else
  echo "FALLA la salida por defecto no es única: «$primera» / «$segunda»" >&2; fallos=$((fallos + 1))
fi

usar_salida_fija() { [ "$(env SALIDA="$TEMPORAL/fija" bash -c 'source "$1" && echo "$SALIDA"' _ "$SCRIPT")" = "$TEMPORAL/fija" ]; }
comprobar "una SALIDA explícita se respeta" usar_salida_fija

# OMITIR_PRUEBAS: en la CI omite solo las dos auditorías lentas del accesorio; en local, nada;
# definida y vacía, nada también en la CI.
omitidas_con() { env -u OMITIR_PRUEBAS "$@" bash -c 'source "$1" && printf %s "$OMITIR_PRUEBAS"' _ "$SCRIPT"; }
lentas="TransMiVozUITests/TransMiVozAccesorioTextoGrandeUITests/testAuditoriaConTextoMuyGrande TransMiVozUITests/TransMiVozAccesorioTextoGrandeUITests/testAuditoriaPermisoDenegadoConTextoMuyGrande"
omite_lentas_en_ci() { [ "$(omitidas_con CI=true SALIDA="$TEMPORAL/fija")" = "$lentas" ]; }
comprobar "en la CI se omiten solo las dos auditorías lentas del accesorio" omite_lentas_en_ci
no_omite_en_local() { [ -z "$(omitidas_con -u CI SALIDA="$TEMPORAL/fija")" ]; }
comprobar "en local no se omite ninguna prueba" no_omite_en_local
vacia_no_omite() { [ -z "$(env CI=true OMITIR_PRUEBAS= SALIDA="$TEMPORAL/fija" bash -c 'source "$1" && printf %s "$OMITIR_PRUEBAS"' _ "$SCRIPT")" ]; }
comprobar "OMITIR_PRUEBAS vacía no omite nada en la CI" vacia_no_omite

# El uso (sin argumentos) sale con 2 y no crea carpetas.
env SALIDA="$TEMPORAL/uso" "$SCRIPT" >/dev/null 2>&1; codigo=$?
total=$((total + 1))
if [ "$codigo" = 2 ] && [ ! -e "$TEMPORAL/uso" ]; then echo "ok    sin argumentos: uso, código 2 y sin crear carpeta"; else echo "FALLA sin argumentos (código $codigo)" >&2; fallos=$((fallos + 1)); fi

# Evidencia previa: el paso falla ANTES de ejecutar herramientas y no la toca.
mkdir -p "$TEMPORAL/previa"
echo "evidencia previa" > "$TEMPORAL/previa/herramientas.txt"
env SALIDA="$TEMPORAL/previa" "$SCRIPT" herramientas >"$TEMPORAL/previa.log" 2>&1; codigo=$?
total=$((total + 1))
if [ "$codigo" != 0 ] && grep -q "Ya existe" "$TEMPORAL/previa.log" && [ "$(cat "$TEMPORAL/previa/herramientas.txt")" = "evidencia previa" ]; then
  echo "ok    un resultado previo hace fallar el paso y queda intacto"
else
  echo "FALLA el paso no protegió la evidencia previa (código $codigo)" >&2; fallos=$((fallos + 1))
fi

# Sin herramientas de Apple (Linux) los pasos deben FALLAR, no aprobar.
if ! command -v xcodebuild >/dev/null 2>&1; then
  for paso in herramientas compilar-simulador pruebas-simulador compilar-dispositivo; do
    debe_fallar "sin Xcode el paso «$paso» falla" env SALIDA="$TEMPORAL/sin-xcode" "$SCRIPT" "$paso"
  done
fi

echo "$((total - fallos)) de $total comprobaciones correctas (temporal: $TEMPORAL)"
[ "$fallos" = 0 ]

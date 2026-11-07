#!/usr/bin/env bash
# Comprobaciones del cliente iOS. Las usa la integración continua
# (.github/workflows/ios.yml) y la guía local (ios/README.md): mismos comandos.
#
# Uso:  ios/scripts/comprobar-ios.sh <paso>
#   herramientas        registra y valida Xcode, SDK y runtimes del Simulator
#   compilar-simulador  compila la app para iOS Simulator
#   pruebas-simulador   XCTest de lógica/HTTP/BLE + pruebas de interfaz + auditoría de accesibilidad
#   compilar-dispositivo compila para iPhone genérico SIN firma (no produce una app instalable)
#   todo                los cuatro anteriores, en ese orden, sin ocultar ningún fallo
#
# Variables (todas opcionales):
#   SALIDA                 carpeta de logs y .xcresult. Por defecto una carpeta NUEVA por
#                          ejecución: ios/salida/<fecha UTC>-<pid>. Se imprime al empezar.
#   XCODE_VERSION_EXACTA   p. ej. 26.6; si se define, Xcode debe coincidir exactamente
#   XCODE_BUILD_EXACTO     p. ej. 17F113; si se define, el build de Xcode debe coincidir
#   IOS_MAYOR_ESPERADO     versión mayor del runtime de iOS del Simulator (por defecto 26)
#   SIMULADOR_NOMBRE       modelo de iPhone del Simulator (por defecto «iPhone 17»)
#   PRUEBAS_MINIMAS        mínimo de pruebas que deben ejecutarse (por defecto 50)
#
# Nunca se sustituye en silencio una herramienta o un destino por otro: si no
# coincide con lo pedido, el script falla y dice qué encontró.
#
# Nunca se borra ni se pisa evidencia: el script no ejecuta ningún borrado. Si un
# log, un resumen o un .xcresult de un paso ya existe en SALIDA, el paso FALLA
# antes de empezar y dice qué ruta chocó. En la CI cada paso usa su propio nombre
# dentro de la misma SALIDA (carpeta nueva del runner); en local, relanzar crea
# otra carpeta, o fija SALIDA a una ruta nueva. Para limpiar resultados viejos,
# hazlo tú, a mano y a conciencia.
#
# Puede cargarse con `source` (p. ej. ios/scripts/probar-comprobar-ios.sh): en ese
# caso solo define las funciones y no ejecuta ningún paso.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROYECTO="$RAIZ/ios/TransMiVoz.xcodeproj"
ESQUEMA="TransMiVoz"
# Carpeta nueva por ejecución. Se exporta para que los pasos que `todo` lanza
# como procesos hijos escriban en la MISMA carpeta.
SALIDA="${SALIDA:-$RAIZ/ios/salida/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export SALIDA
IOS_MAYOR_ESPERADO="${IOS_MAYOR_ESPERADO:-26}"
SIMULADOR_NOMBRE="${SIMULADOR_NOMBRE:-iPhone 17}"
PRUEBAS_MINIMAS="${PRUEBAS_MINIMAS:-50}"

falla() { echo "ERROR: $*" >&2; exit 1; }

preparar_salida() {
  mkdir -p "$SALIDA"
  echo "Resultados en: $SALIDA" >&2
}

# Falla si alguna ruta ya existe (también un enlace roto): no se pisa evidencia.
sin_pisar() {
  local ruta
  for ruta in "$@"; do
    if [ -e "$ruta" ] || [ -L "$ruta" ]; then
      falla "Ya existe $ruta. No se sobrescribe ni se borra evidencia previa: usa otra SALIDA (p. ej. SALIDA=ios/salida/otra) o muévela tú."
    fi
  done
}

comprobar_proyecto() {
  [ -f "$PROYECTO/project.pbxproj" ] || falla "No existe $PROYECTO/project.pbxproj. No se compila nada sin proyecto."
  [ -f "$PROYECTO/xcshareddata/xcschemes/$ESQUEMA.xcscheme" ] || falla "Falta el esquema compartido $ESQUEMA."
  [ -f "$RAIZ/contratos/ble/vectores.txt" ] && [ -f "$RAIZ/contratos/ble/sesiones.txt" ] \
    || falla "Faltan los vectores compartidos en contratos/ble/. Sin ellos las pruebas del contrato BLE no valen."
}

paso_herramientas() {
  preparar_salida
  sin_pisar "$SALIDA/herramientas.txt"
  {
    echo "== Fecha (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "== SHA: ${GITHUB_SHA:-$(git -C "$RAIZ" rev-parse HEAD 2>/dev/null || echo desconocido)}"
    echo "== macOS"; sw_vers
    echo "== DEVELOPER_DIR=${DEVELOPER_DIR:-<sin definir>}"; xcode-select -p
    echo "== Xcode"; xcodebuild -version
    echo "== Swift"; xcrun swift --version 2>&1
    echo "== SDK"; xcodebuild -showsdks
    echo "== Runtimes del Simulator"; xcrun simctl list runtimes
    echo "== Simuladores disponibles"; xcrun simctl list devices available
  } 2>&1 | tee "$SALIDA/herramientas.txt"

  local version build
  version="$(xcodebuild -version | sed -n 's/^Xcode \(.*\)$/\1/p' | head -1)"
  build="$(xcodebuild -version | sed -n 's/^Build version \(.*\)$/\1/p' | head -1)"
  [ -n "$version" ] || falla "No se pudo leer la versión de Xcode."
  if [ -n "${XCODE_VERSION_EXACTA:-}" ] && [ "$version" != "$XCODE_VERSION_EXACTA" ]; then
    falla "Xcode $version no es el esperado ($XCODE_VERSION_EXACTA). No se sustituye por otra versión."
  fi
  if [ -n "${XCODE_BUILD_EXACTO:-}" ] && [ "$build" != "$XCODE_BUILD_EXACTO" ]; then
    falla "Build de Xcode $build no es el esperado ($XCODE_BUILD_EXACTO)."
  fi
  # El proyecto usa grupos sincronizados (objectVersion 77): exige Xcode 16 o superior.
  [ "${version%%.*}" -ge 16 ] || falla "Xcode $version es anterior a 16; el proyecto no se abre."
  echo "OK: Xcode $version (build $build)"
}

# Imprime el UDID del simulador elegido. Regla fija, sin sustituciones: runtime
# de iOS con versión mayor IOS_MAYOR_ESPERADO (el más nuevo de esa mayor) y el
# modelo exacto SIMULADOR_NOMBRE.
elegir_simulador() {
  xcrun simctl list devices available --json | IOS_MAYOR="$IOS_MAYOR_ESPERADO" NOMBRE="$SIMULADOR_NOMBRE" python3 -c '
import json, os, re, sys
datos = json.load(sys.stdin)["devices"]
mayor, nombre = os.environ["IOS_MAYOR"], os.environ["NOMBRE"]
candidatos = []
for runtime, dispositivos in datos.items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m or m.group(1) != mayor:
        continue
    for d in dispositivos:
        if d.get("isAvailable", True) and d["name"] == nombre:
            candidatos.append((int(m.group(2)), runtime, d["udid"]))
if not candidatos:
    sys.stderr.write("ERROR: no hay un simulador «%s» con runtime iOS %s.x. Disponibles:\n" % (nombre, mayor))
    for runtime, dispositivos in sorted(datos.items()):
        for d in dispositivos:
            sys.stderr.write("  %s  %s\n" % (runtime, d["name"]))
    sys.exit(1)
candidatos.sort()
print(candidatos[-1][2])
'
}

preparar_simulador() {
  local udid etiqueta="$1"
  udid="$(elegir_simulador)" || exit 1
  echo "Simulador elegido: $udid" >&2
  xcrun simctl list devices | grep "$udid" >&2 || true
  xcrun simctl boot "$udid" 2>/dev/null || true   # ya arrancado no es error
  xcrun simctl bootstatus "$udid" -b >&2
  echo "$udid" > "$SALIDA/simulador-udid-$etiqueta.txt"
  echo "$udid"
}

# Resumen legible de un .xcresult; falla si no hay pruebas ejecutadas o hay fallos u omitidas.
verificar_resultado() {
  local bundle="$1" etiqueta="$2"
  sin_pisar "$SALIDA/$etiqueta-resumen.json"
  xcrun xcresulttool get test-results summary --path "$bundle" > "$SALIDA/$etiqueta-resumen.json" \
    || falla "No se pudo leer $bundle con xcresulttool."
  python3 - "$SALIDA/$etiqueta-resumen.json" "$PRUEBAS_MINIMAS" <<'PY'
import json, sys
resumen = json.load(open(sys.argv[1]))
minimas = int(sys.argv[2])
total = resumen.get("totalTestCount")
fallidas = resumen.get("failedTests")
omitidas = resumen.get("skippedTests", 0)
pasadas = resumen.get("passedTests")
print("Pruebas: total=%s pasadas=%s fallidas=%s omitidas=%s resultado=%s" % (total, pasadas, fallidas, omitidas, resumen.get("result")))
if total is None or fallidas is None:
    sys.exit("ERROR: el resumen del .xcresult no trae totalTestCount/failedTests; no se puede afirmar que pasó.")
if total < minimas:
    sys.exit("ERROR: solo se ejecutaron %d pruebas (mínimo %d)." % (total, minimas))
if fallidas or omitidas:
    sys.exit("ERROR: %d fallidas y %d omitidas." % (fallidas, omitidas))
PY
}

paso_compilar_simulador() {
  comprobar_proyecto
  preparar_salida
  sin_pisar "$SALIDA/compilar-simulador.xcresult" "$SALIDA/xcodebuild-compilar-simulador.log" "$SALIDA/simulador-udid-compilar-simulador.txt"
  local udid; udid="$(preparar_simulador compilar-simulador)"
  xcodebuild build \
    -project "$PROYECTO" -scheme "$ESQUEMA" -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$SALIDA/DerivedData" \
    -resultBundlePath "$SALIDA/compilar-simulador.xcresult" \
    2>&1 | tee "$SALIDA/xcodebuild-compilar-simulador.log"
}

paso_pruebas_simulador() {
  comprobar_proyecto
  preparar_salida
  sin_pisar "$SALIDA/pruebas-simulador.xcresult" "$SALIDA/xcodebuild-pruebas-simulador.log" \
    "$SALIDA/simulador-udid-pruebas-simulador.txt" "$SALIDA/pruebas-simulador-resumen.json"
  local udid; udid="$(preparar_simulador pruebas-simulador)"
  # Si xcodebuild falla, el script termina aquí (pipefail): no se oculta ninguna prueba ni auditoría.
  xcodebuild test \
    -project "$PROYECTO" -scheme "$ESQUEMA" -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$SALIDA/DerivedData" \
    -resultBundlePath "$SALIDA/pruebas-simulador.xcresult" \
    2>&1 | tee "$SALIDA/xcodebuild-pruebas-simulador.log"
  verificar_resultado "$SALIDA/pruebas-simulador.xcresult" pruebas-simulador
}

paso_compilar_dispositivo() {
  comprobar_proyecto
  preparar_salida
  sin_pisar "$SALIDA/compilar-dispositivo.xcresult" "$SALIDA/xcodebuild-compilar-dispositivo.log"
  # Sin firma, sin cuenta, sin certificados: solo comprueba que el código compila para iPhone.
  xcodebuild build \
    -project "$PROYECTO" -scheme "$ESQUEMA" -configuration Release \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$SALIDA/DerivedDataDispositivo" \
    -resultBundlePath "$SALIDA/compilar-dispositivo.xcresult" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM="" \
    2>&1 | tee "$SALIDA/xcodebuild-compilar-dispositivo.log"
}

# Solo se ejecuta como script; con `source` únicamente quedan definidas las funciones.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    herramientas) paso_herramientas ;;
    compilar-simulador) paso_compilar_simulador ;;
    pruebas-simulador) paso_pruebas_simulador ;;
    compilar-dispositivo) paso_compilar_dispositivo ;;
    todo)
      # Se ejecutan todos aunque uno falle; el código de salida refleja el primer fallo.
      estado=0
      for paso in herramientas compilar-simulador pruebas-simulador compilar-dispositivo; do
        echo "=== $paso ==="
        "${BASH_SOURCE[0]}" "$paso" || { echo "FALLÓ: $paso" >&2; estado=1; }
      done
      exit "$estado"
      ;;
    *) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d'; exit 2 ;;
  esac
fi

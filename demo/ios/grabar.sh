#!/usr/bin/env bash
# Graba en el iOS Simulator los recorridos de `demo/ios/DemoVideosUITests.swift`.
#
# 1. Elige el Simulator (nombre y versión mayor de iOS, como ios/scripts/comprobar-ios.sh), lo arranca y, si se da
#    DEMO_CA, instala esa autoridad para que la app confíe en el HTTPS del backend de grabación.
# 2. Copia la clase de demostración a ios/TransMiVozUITests/ (solo en esta copia de trabajo) y compila para pruebas.
# 3. Por cada recorrido: empieza a grabar la pantalla, lo ejecuta con `test-without-building` y deja de grabar.
#
# Por cada recorrido deja en $DEMO_SALIDA (por defecto demo/salida/crudo-iphone):
#   <id>.mov             la grabación de la pantalla, sin sonido
#   <id>.eventos.jsonl   los subtítulos que anotó el recorrido, con la hora de reloj
#   <id>.json            hora de inicio de la grabación y estado de xcodebuild (lo lee demo/componer.py)
#   <id>.xcodebuild.log  la salida de xcodebuild
# Termina con código 1 si algún recorrido falló; los demás se graban igual.
#
# Variables: SIMULADOR_NOMBRE (iPhone 17), IOS_MAYOR_ESPERADO (26), DEMO_ORIGEN, DEMO_CLAVE, DEMO_CA, DEMO_SOLO.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/../.." && pwd)"
salida="${DEMO_SALIDA:-$raiz/demo/salida/crudo-iphone}"
derivados="${DEMO_DERIVADOS:-${RUNNER_TEMP:-/tmp}/demo-derivados}"
nombre="${SIMULADOR_NOMBRE:-iPhone 17}"
mayor="${IOS_MAYOR_ESPERADO:-26}"
origen="${DEMO_ORIGEN:-https://localhost:8443}"
clave="${DEMO_CLAVE:-}"
mkdir -p "$salida"

udid="$(xcrun simctl list devices available --json | python3 -c '
import json, re, sys
nombre, mayor = sys.argv[1], sys.argv[2]
mejor = None
for runtime, equipos in json.load(sys.stdin)["devices"].items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m or m.group(1) != mayor:
        continue
    for equipo in equipos:
        if equipo["name"] == nombre and equipo.get("isAvailable", True):
            clave = (int(m.group(2)), equipo["udid"])
            mejor = max(mejor, clave) if mejor else clave
if not mejor:
    sys.exit(f"No hay un Simulator «{nombre}» con iOS {mayor}.")
print(mejor[1])
' "$nombre" "$mayor")"
echo "Simulator: $nombre ($udid)"

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b
xcrun simctl ui "$udid" appearance light || true
xcrun simctl status_bar "$udid" override --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4 || true
if [ -n "${DEMO_CA:-}" ]; then
  xcrun simctl keychain "$udid" add-root-cert "$DEMO_CA"
  echo "Autoridad de grabación instalada en el Simulator."
fi

copia="$raiz/ios/TransMiVozUITests/DemoVideosUITests.swift"
cp "$raiz/demo/ios/DemoVideosUITests.swift" "$copia"
# La copia solo hace falta para compilar; no se deja en la carpeta de pruebas del proyecto.
trap 'rm -f "$copia"' EXIT
destino="platform=iOS Simulator,id=$udid"
comunes=(-project "$raiz/ios/TransMiVoz.xcodeproj" -scheme TransMiVoz -configuration Debug -destination "$destino" -derivedDataPath "$derivados")

echo "Compilando para pruebas…"
if ! xcodebuild build-for-testing "${comunes[@]}" > "$salida/compilar.log" 2>&1; then
  grep -E "error:|\*\* BUILD" "$salida/compilar.log" | head -40 || true
  echo "La compilación falló: ver compilar.log"
  exit 1
fi
grep -E "\*\* TEST BUILD" "$salida/compilar.log" || true

fallos=()
grabar() {
  local id="$1" prueba="$2"
  if [ -n "${DEMO_SOLO:-}" ] && [[ ",$DEMO_SOLO," != *",$id,"* ]]; then return 0; fi
  local video="$salida/$id.mov" eventos="$salida/$id.eventos.jsonl" registro="$salida/$id.grabacion.log"
  rm -f "$eventos" "$video"
  rm -rf "$salida/$id.xcresult"
  echo "▶ $id ($prueba)"
  local antes
  antes="$(python3 -c 'import time; print(time.time())')"
  xcrun simctl io "$udid" recordVideo --codec=h264 --force "$video" > "$registro" 2>&1 &
  local pid=$!
  # La hora de inicio alinea los subtítulos: es cuando simctl avisa que empezó a grabar.
  local inicio=""
  for _ in $(seq 1 100); do
    if grep -q "Recording started" "$registro" 2>/dev/null; then
      inicio="$(python3 -c 'import time; print(time.time())')"
      break
    fi
    sleep 0.1
  done
  if [ -z "$inicio" ]; then
    echo "  (simctl no avisó del inicio; se estima un segundo después de lanzarlo)"
    inicio="$(python3 -c "print($antes + 1.0)")"
  fi
  local estado=0
  TEST_RUNNER_DEMO_EVENTOS="$eventos" TEST_RUNNER_DEMO_ORIGEN="$origen" TEST_RUNNER_DEMO_CLAVE="$clave" \
    xcodebuild test-without-building "${comunes[@]}" -parallel-testing-enabled NO \
      -only-testing:"TransMiVozUITests/DemoVideosUITests/$prueba" \
      -resultBundlePath "$salida/$id.xcresult" > "$salida/$id.xcodebuild.log" 2>&1 || estado=$?
  sleep 1
  kill -INT "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  # Si el Simulator no dejó escribir el archivo, los eventos están también en el registro de xcodebuild.
  if [ ! -s "$eventos" ]; then
    grep -o 'DEMO_EVENTO {.*}' "$salida/$id.xcodebuild.log" | sed 's/^DEMO_EVENTO //' | awk '!visto[$0]++' > "$eventos" || true
  fi
  python3 - "$salida/$id.json" "$id" "$inicio" "$estado" <<'EOF'
import json, sys
ruta, ident, inicio, estado = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
from datetime import datetime, timedelta, timezone
# Hora de Bogotá (UTC-5, sin horario de verano): de ella dependen el horario y el calendario que da el servidor.
bogota = timezone(timedelta(hours=-5))
json.dump({
    "id": ident, "plataforma": "iphone", "video": f"{ident}.mov", "eventos": f"{ident}.eventos.jsonl",
    "grabacion_epoch": inicio, "estado": estado,
    "grabado": datetime.fromtimestamp(inicio, bogota).isoformat(timespec="seconds"),
}, open(ruta, "w"), ensure_ascii=False, indent=2)
EOF
  if [ "$estado" -ne 0 ]; then
    fallos+=("$id")
    echo "  ✗ $id: xcodebuild terminó con $estado"
    grep -E "error:|failed|Fallo|XCTAssert" "$salida/$id.xcodebuild.log" | head -20 || true
  else
    echo "  ✓ $id ($(wc -l < "$eventos" | tr -d ' ') eventos)"
  fi
}

grabar iphone-01-consulta testDemo01ConsultaServidorReal
grabar iphone-02-metro testDemo02MetroFuturo
grabar iphone-03-sesion-accesorio testDemo03SesionConAccesorio
grabar iphone-04-lupa testDemo04Lupa
grabar iphone-05-ajustes testDemo05Ajustes

if [ "${#fallos[@]}" -gt 0 ]; then
  echo "Fallaron: ${fallos[*]}"
  exit 1
fi
echo "Todos los recorridos del iPhone se grabaron."

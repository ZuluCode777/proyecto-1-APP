#!/usr/bin/env bash
# Pruebas portátiles del enlace del accesorio (EA-12). No necesita placa ni Arduino.
# Uso (desde cualquier carpeta): bash firmware/pruebas/probar_enlace.sh
# CXX cambia el compilador; la salida va a firmware/build/ (ignorada por Git).
#
# Ejecuta, en este orden:
#   1. pruebas_enlace              sesión, ventana, botón, ritmo, pines, seguridad
#   2. pruebas_puerta_ble          política de GAP/GATT con el intérprete real del radar
#   3. pruebas_radar_integracion   desborde de la UART y recuperación del radar
#   4. guardia del sketch          lo que accesorio.ino NO puede volver a usar
set -euo pipefail

aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
firmware="$(dirname "$aqui")"
salida="$firmware/build"
mkdir -p "$salida"

compilar_y_correr() { # nombre fuentes...
  local nombre="$1"
  shift
  echo "== $nombre"
  "${CXX:-g++}" -std=c++17 -Wall -Wextra -Werror -pedantic -O1 \
    -I"$firmware/accesorio" \
    -o "$salida/$nombre" \
    "$firmware/pruebas/$nombre.cpp" \
    "$@"
  "$salida/$nombre"
}

a="$firmware/accesorio"
base=("$a/sen0395.cpp" "$a/emisor_sintetico.cpp" "$a/trama_ble.cpp")

compilar_y_correr pruebas_enlace "$a/enlace_accesorio.cpp" "${base[@]}"
compilar_y_correr pruebas_puerta_ble "$a/puerta_ble.cpp" "$a/enlace_accesorio.cpp" "${base[@]}"
compilar_y_correr pruebas_radar_integracion "$a/enlace_radar.cpp" "${base[@]}"

# Guardia del sketch. La biblioteca BLE de Arduino solo arranca el stack: el GAP,
# el GATT y el almacén de vínculos son nativos de NimBLE (puerta_ble.h decide). Si
# alguien reintroduce el envoltorio, esta guardia falla antes de compilar nada
# para el ESP32 (el job `sketch` de CI lo vuelve a comprobar en el binario).
echo "== guardia de accesorio.ino"
ino="$a/accesorio.ino"
sin_comentarios="$(sed 's|//.*||' "$ino")"
fallo=0
for prohibido in BLEServer BLESecurity BLECharacteristic BLEService BLEAdvertising createServer \
                 setSecurityCallbacks onPassKeyNotify setPassKey 'setValue(' 'notify()'; do
  if grep -qF -- "$prohibido" <<<"$sin_comentarios"; then
    echo "FALLO: accesorio.ino usa '$prohibido' (envoltorio de Arduino); ver ea-12-ble.md" >&2
    fallo=1
  fi
done
for requerido in ble_gatts_notify_custom BLE_GATT_CHR_F_READ_AUTHEN BLE_GATT_CHR_F_NOTIFY_INDICATE_AUTHEN \
                 store_write_cb BLE_GAP_EVENT_PASSKEY_ACTION BLE_GAP_EVENT_REPEAT_PAIRING sm_oob_data_flag \
                 al_pedir_clave leer_medicion atender_notificacion atender_borrado persistir_vinculo \
                 nimble_port_get_dflt_eventq ble_npl_eventq_put atender_uart; do
  if ! grep -qF -- "$requerido" <<<"$sin_comentarios"; then
    echo "FALLO: accesorio.ino ya no usa '$requerido'" >&2
    fallo=1
  fi
done
# La clave de enlace nunca sale por el puerto serie.
if grep -E 'Serial[0-9]?\.print[^;]*(kClave|VISIONARIA_CLAVE_ENLACE|clave\))' <<<"$sin_comentarios" >/dev/null; then
  echo "FALLO: accesorio.ino imprime la clave de enlace" >&2
  fallo=1
fi
[ "$fallo" -eq 0 ] || exit 1
echo "guardia: 0 fallos"

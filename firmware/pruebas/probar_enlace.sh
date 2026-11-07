#!/usr/bin/env bash
# Pruebas portátiles de enlace_accesorio (EA-12). No necesita placa ni Arduino.
# Uso (desde cualquier carpeta): bash firmware/pruebas/probar_enlace.sh
# CXX cambia el compilador; la salida va a firmware/build/ (ignorada por Git).
set -euo pipefail

aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
firmware="$(dirname "$aqui")"
salida="$firmware/build"
mkdir -p "$salida"

"${CXX:-g++}" -std=c++17 -Wall -Wextra -Werror -pedantic -O1 \
  -I"$firmware/accesorio" \
  -o "$salida/pruebas_enlace" \
  "$firmware/pruebas/pruebas_enlace.cpp" \
  "$firmware/accesorio/enlace_accesorio.cpp" \
  "$firmware/accesorio/sen0395.cpp" \
  "$firmware/accesorio/emisor_sintetico.cpp" \
  "$firmware/accesorio/trama_ble.cpp"

"$salida/pruebas_enlace"

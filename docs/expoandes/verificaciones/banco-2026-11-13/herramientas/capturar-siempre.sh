#!/bin/bash
# Captura continua: vuelve a abrir el puerto USB tras cada reinicio de la placa. Uso: capturar-siempre.sh SALIDA SEGUNDOS
fin=$(( $(date +%s) + $2 ))
while [ $(date +%s) -lt $fin ]; do
  p=$(ls /dev/ttyACM* 2>/dev/null | head -1)
  [ -n "$p" ] && python3 -I "$(dirname "$0")/capturar_serie.py" "$1" $(( fin - $(date +%s) )) "$p"
  sleep 1
done

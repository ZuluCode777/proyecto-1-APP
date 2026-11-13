#!/usr/bin/env bash
# Genera la imagen de prueba que Chrome usa como cámara en el video de la Lupa:
# un letrero de estación inventado para la demostración, con un leve vaivén
# para que parezca una cámara en la mano. Chrome la lee con
# `--use-file-for-fake-video-capture` (formato MJPEG) y la repite en bucle.
#
# Uso: demo/web/camara-letrero.sh <salida.mjpeg>
# Necesita ffmpeg con drawtext (libfreetype) y la fuente DejaVu.
set -euo pipefail

salida="${1:?Uso: camara-letrero.sh <salida.mjpeg>}"
fuente="${DEMO_FUENTE:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"
fuente_normal="${DEMO_FUENTE_NORMAL:-/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf '%s' "ESTACIÓN" > "$tmp/t1.txt"
printf '%s' "RICAURTE" > "$tmp/t2.txt"
printf '%s' "Troncal NQS · Calle 13" > "$tmp/t3.txt"
printf '%s' "B23   H54   M83   A52" > "$tmp/t4.txt"
printf '%s' "Vagón 2  ·  Salida Cra. 27" > "$tmp/t5.txt"
printf '%s' "Imagen de prueba para la demostración" > "$tmp/t6.txt"

# Un cuadro de 1100 × 860 con el letrero; luego se recorta a 960 × 720 con un
# desplazamiento que se repite cada 8 s, para que el bucle no salte.
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=0x3b3f45:s=1100x860:d=1" -frames:v 1 \
  -vf "drawbox=x=120:y=150:w=860:h=470:color=0xc62828:t=fill,\
drawbox=x=120:y=150:w=860:h=470:color=0xffffff:t=10,\
drawtext=fontfile=${fuente_normal}:textfile=$tmp/t1.txt:fontcolor=white:fontsize=44:x=(w-text_w)/2:y=190,\
drawtext=fontfile=${fuente}:textfile=$tmp/t2.txt:fontcolor=white:fontsize=120:x=(w-text_w)/2:y=250,\
drawtext=fontfile=${fuente_normal}:textfile=$tmp/t3.txt:fontcolor=white:fontsize=44:x=(w-text_w)/2:y=400,\
drawbox=x=170:y=480:w=760:h=100:color=0xffffff:t=fill,\
drawtext=fontfile=${fuente}:textfile=$tmp/t4.txt:fontcolor=0x111111:fontsize=56:x=(w-text_w)/2:y=500,\
drawtext=fontfile=${fuente_normal}:textfile=$tmp/t5.txt:fontcolor=0xe0e0e0:fontsize=40:x=(w-text_w)/2:y=660,\
drawtext=fontfile=${fuente_normal}:textfile=$tmp/t6.txt:fontcolor=0x9aa0a6:fontsize=26:x=(w-text_w)/2:y=780" \
  "$tmp/letrero.png"

ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$tmp/letrero.png" -t 8 -r 15 \
  -vf "crop=960:720:'70+28*sin(2*PI*t/8)':'70+16*sin(2*PI*t/4)',format=yuvj420p" \
  -q:v 3 -f mjpeg "$salida"

echo "Cámara de prueba: $salida ($(du -h "$salida" | cut -f1))"

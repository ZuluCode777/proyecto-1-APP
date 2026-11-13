#!/usr/bin/env python3
"""Captura el puerto serie con marca de tiempo. Uso: capturar_serie.py SALIDA SEGUNDOS [PUERTO]
Sustituye la clave de enlace por «CLAVE» si apareciera, sin mostrarla nunca (la lee de configuracion_local.h).
Con REINICIAR=1 reinicia la placa (pulso de RTS) con el puerto ya abierto, para ver el arranque."""
import os, re, sys, termios, time, select, fcntl, struct
salida, segundos = sys.argv[1], float(sys.argv[2])
puerto = sys.argv[3] if len(sys.argv) > 3 else "/dev/ttyACM0"
# La clave se lee de configuracion_local.h (o de VISIONARIA_CABECERA) solo para ocultarla; nunca se imprime.
cabecera = os.environ.get("VISIONARIA_CABECERA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), *[".."] * 5, "firmware", "accesorio", "configuracion_local.h")
try:
    m = re.search(rb"VISIONARIA_CLAVE_ENLACE\s+(\d{6})\b", open(cabecera, "rb").read())
except OSError:
    m = None
clave = m.group(1) if m else None
if clave is None:
    print("AVISO: sin configuracion_local.h; la captura no oculta ninguna clave.", file=sys.stderr)
fd = os.open(puerto, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
a = termios.tcgetattr(fd)
a[0] = 0; a[1] = 0; a[3] = 0
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
a[4] = a[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, a)
if os.environ.get("REINICIAR"):
    fcntl.ioctl(fd, termios.TIOCMBIC, struct.pack("I", termios.TIOCM_DTR))
    fcntl.ioctl(fd, termios.TIOCMBIS, struct.pack("I", termios.TIOCM_RTS)); time.sleep(0.1)
    fcntl.ioctl(fd, termios.TIOCMBIC, struct.pack("I", termios.TIOCM_RTS))
fin, t0, resto = time.time() + segundos, time.time(), b""
with open(salida, "a", encoding="utf-8") as f:
    f.write(f"# captura iniciada {time.strftime('%Y-%m-%d %H:%M:%S')} en {puerto}\n")
    while time.time() < fin:
        if not select.select([fd], [], [], 0.5)[0]:
            if not os.path.exists(puerto):  # la placa se reinició y el USB cambió de nombre
                f.write("# puerto perdido\n"); break
            continue
        try:
            dato = os.read(fd, 4096)
        except OSError:
            f.write("# puerto perdido\n"); break
        if not dato:  # fin de archivo: el USB desapareció
            f.write("# puerto perdido\n"); break
        resto += dato
        *lineas, resto = resto.split(b"\n")
        for l in lineas:
            if clave: l = l.replace(clave, "«CLAVE»".encode())
            f.write(f"{time.strftime('%H:%M:%S')} {time.time()-t0:8.2f} {l.decode('utf-8','replace').rstrip()}\n"); f.flush()

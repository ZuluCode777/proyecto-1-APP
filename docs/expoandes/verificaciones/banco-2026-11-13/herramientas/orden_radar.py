#!/usr/bin/env python3
"""Envía órdenes al SEN0395 a través del puente USB y registra la respuesta. Uso: radar.py LOG ORDEN [ORDEN...]
Cada orden se envía con \\r\\n y se esperan 1,5 s. 'LEER:N' solo escucha N segundos."""
import os, sys, termios, time, select
log, ordenes = sys.argv[1], sys.argv[2:]
p = sorted(x for x in os.listdir("/dev") if x.startswith("ttyACM"))[0]
fd = os.open("/dev/" + p, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
a = termios.tcgetattr(fd); a[0] = a[1] = a[3] = 0; a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL; a[4] = a[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, a)
def escuchar(s):
    fin, b = time.time() + s, b""
    while time.time() < fin:
        if select.select([fd], [], [], 0.2)[0]:
            b += os.read(fd, 4096)
    return b.decode("ascii", "replace")
escuchar(0.3)
with open(log, "a") as f:
    for o in ordenes:
        if o.startswith("LEER:"):
            r = escuchar(float(o[5:])); etiqueta = o
        else:
            os.write(fd, (o + "\r\n").encode()); etiqueta = "> " + o
            if os.environ.get("RAPIDO"):  # como el firmware: la siguiente orden en cuanto llega Done o Error
                r, fin = "", time.time() + 2
                while time.time() < fin and "Done" not in r and "Error" not in r:
                    r += escuchar(0.05)
            else:
                r = escuchar(1.5)
        lineas = [l.strip() for l in r.replace("\r", "\n").split("\n") if l.strip()]
        f.write(f"{time.strftime('%H:%M:%S')} {etiqueta}\n" + "".join(f"    {l}\n" for l in lineas))
        print(etiqueta); [print("   ", l) for l in lineas]

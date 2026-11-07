#!/usr/bin/env python3
"""Analiza una captura de Medición del accesorio BLE (contrato v1.0, EA-12).

Entrada: un CSV con una fila por notificación o lectura recibida, sin cabecera
ni datos personales:

    t_host_ms,hex_de_20_bytes

`t_host_ms` es el reloj monotónico del equipo que captura, en milisegundos
(puede ser decimal). La captura puede salir de nRF Connect (exportando el
registro), de `bluetoothctl` o de un script propio; esta herramienta no abre
el enlace BLE ni añade dependencias. Solo biblioteca estándar.

Salida: frecuencia, pérdida por huecos de secuencia, intervalos, deriva entre
el reloj del accesorio y el del equipo, y el reparto de salud y de banderas.
Una captura propia NO prueba nada por sí sola: el resultado va a la bitácora de
banco junto con el montaje (firmware/README.md y docs/expoandes/ea-12-ble.md).

Uso:
    python3 firmware/herramientas/analizar_captura.py captura.csv
    python3 firmware/herramientas/analizar_captura.py --autoprueba
"""
import math
import statistics
import struct
import sys
from collections import Counter

SALUD = {0: "sin fallo", 1: "iniciando", 2: "radar sin datos", 3: "trama inválida",
         4: "fallo del radar", 5: "alimentación", 6: "montaje no validado"}


def decodificar(datos):
    """Devuelve un diccionario con los campos de una Medición, o lanza ValueError."""
    if len(datos) != 20:
        raise ValueError(f"longitud {len(datos)} distinta de 20")
    version, banderas, secuencia, arranque, instante, distancia, azimut, edad, bateria, salud = \
        struct.unpack("<BBHIIHhHBB", datos)
    if version != 1:
        raise ValueError(f"versión mayor {version}")
    if banderas & 0xC0:
        raise ValueError("bits reservados de banderas")
    if salud > 6:
        raise ValueError(f"salud {salud}")
    return {"banderas": banderas, "secuencia": secuencia, "arranque": arranque,
            "instante": instante, "distancia": distancia, "azimut": azimut,
            "edad": edad, "bateria": bateria, "salud": salud}


def leer(lineas):
    """Devuelve (filas, invalidas). Descarta tiempos no finitos o menores que el
    de la última fila aceptada (iguales sí valen)."""
    filas, invalidas = [], []
    for n, linea in enumerate(lineas, 1):
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        try:
            t, hexa = linea.split(",", 1)
            t = float(t)
            if not math.isfinite(t):
                raise ValueError(f"t_host_ms no finito ({t})")
            if filas and t < filas[-1][0]:
                raise ValueError(f"t_host_ms retrocede ({t} < {filas[-1][0]})")
            filas.append((t, decodificar(bytes.fromhex(hexa.strip().replace(" ", "")))))
        except ValueError as e:
            invalidas.append((n, str(e)))
    return filas, invalidas


def percentil(valores, p):
    valores = sorted(valores)
    return valores[min(len(valores) - 1, int(round(p / 100 * (len(valores) - 1))))]


def analizar(filas):
    """Devuelve las líneas del informe."""
    if len(filas) < 2:
        return ["Muy pocas filas para analizar."]
    tiempos = [f[0] for f in filas]
    if not all(math.isfinite(t) for t in tiempos) or any(b < a for a, b in zip(tiempos, tiempos[1:])):
        raise ValueError("t_host_ms debe ser finito y no decreciente")
    out = []
    duracion = (filas[-1][0] - filas[0][0]) / 1000
    if duracion > 0:
        out.append(f"filas: {len(filas)} en {duracion:.1f} s ({(len(filas) - 1) / duracion:.2f} por segundo)")
    else:
        out.append(f"filas: {len(filas)} en 0.0 s (frecuencia no calculable: mismo t_host_ms)")

    # Un arranque distinto parte la captura: la secuencia y el reloj vuelven a empezar.
    tramos, actual = [], [filas[0]]
    for f in filas[1:]:
        if f[1]["arranque"] != actual[-1][1]["arranque"]:
            tramos.append(actual)
            actual = []
        actual.append(f)
    tramos.append(actual)
    out.append(f"identificadores de arranque: {len(tramos)} tramo(s) "
               + ", ".join(f"{t[0][1]['arranque']:08x}" for t in tramos))

    perdidas = repetidas = anteriores = 0
    for tramo in tramos:
        for a, b in zip(tramo, tramo[1:]):
            d = (b[1]["secuencia"] - a[1]["secuencia"]) & 0xFFFF
            if d == 0:
                repetidas += 1
            elif d > 0x7FFF:
                anteriores += 1
            else:
                perdidas += d - 1
    esperadas = len(filas) + perdidas
    out.append(f"secuencia: perdidas {perdidas} ({100 * perdidas / esperadas:.1f} %), "
               f"repetidas {repetidas}, anteriores {anteriores}")

    dts = [b[0] - a[0] for a, b in zip(filas, filas[1:]) if b[1]["arranque"] == a[1]["arranque"]]
    if dts:
        out.append("intervalo entre tramas (ms): "
                   f"mediana {statistics.median(dts):.0f}, p95 {percentil(dts, 95):.0f}, máximo {max(dts):.0f}")

    for i, tramo in enumerate(tramos):
        if len(tramo) < 2:
            continue
        host = tramo[-1][0] - tramo[0][0]
        acc = (tramo[-1][1]["instante"] - tramo[0][1]["instante"]) & 0xFFFFFFFF
        out.append(f"tramo {i + 1}: reloj del accesorio {acc} ms frente a {host:.0f} ms del equipo "
                   f"(diferencia {acc - host:+.0f} ms; incluye retraso variable del enlace)")

    salud = Counter(f[1]["salud"] for f in filas)
    out.append("salud: " + ", ".join(f"{k} {SALUD.get(k, '?')} = {v}" for k, v in sorted(salud.items())))
    vigentes = sum(1 for f in filas if f[1]["banderas"] & 1)
    presencia = sum(1 for f in filas if f[1]["banderas"] & 2)
    simuladas = sum(1 for f in filas if f[1]["banderas"] & 32)
    out.append(f"con resultado vigente: {vigentes}; con presencia: {presencia}; simuladas (bit 5): {simuladas}")
    if simuladas and simuladas != len(filas):
        out.append("ATENCIÓN: mezcla de tramas simuladas y reales en una misma captura.")
    edades = [f[1]["edad"] for f in filas if f[1]["edad"] != 0xFFFF]
    if edades:
        out.append(f"edad del resultado (ms): mediana {statistics.median(edades):.0f}, máximo {max(edades)}")
    if any(f[1]["distancia"] != 0xFFFF or f[1]["azimut"] != -32768 for f in filas):
        out.append("ATENCIÓN: hay distancia o azimut en una captura del SEN0395, que no los entrega.")
    return out


def autoprueba():
    def trama(sec, instante, banderas=3, edad=20, salud=0, arranque=0xA1B2C3D4):
        return struct.pack("<BBHIIHhHBB", 1, banderas, sec, arranque, instante, 0xFFFF, -32768, edad, 255, salud)

    filas = [(i * 100.0, decodificar(trama(i if i < 5 else i + 2, 1000 + i * 100))) for i in range(10)]
    texto = "\n".join(analizar(filas))
    assert "perdidas 2" in texto, texto
    assert "identificadores de arranque: 1 tramo" in texto, texto
    try:
        decodificar(b"\x01" * 19)
    except ValueError:
        pass
    else:
        raise AssertionError("debía rechazar 19 bytes")
    _, malas = leer(["0,zz", "1," + trama(1, 1).hex()])
    assert len(malas) == 1

    # Mismo t_host_ms en todas las filas: informe sin frecuencia ni ZeroDivisionError.
    mismas = [(5.0, decodificar(trama(i, 1000 + i * 100))) for i in range(2)]
    texto = "\n".join(analizar(mismas))
    assert "frecuencia no calculable" in texto and "por segundo" not in texto, texto
    # nan, inf y retroceso: leer los descarta; analizar los rechaza.
    t0, t1 = trama(1, 1000).hex(), trama(2, 1100).hex()
    for malo in ("nan", "inf", "-inf"):
        filas_, malas = leer([f"0,{t0}", f"{malo},{t1}"])
        assert len(filas_) == 1 and len(malas) == 1, (malo, malas)
        try:
            analizar([(0.0, decodificar(trama(1, 1000))), (float(malo), decodificar(trama(2, 1100)))])
        except ValueError:
            pass
        else:
            raise AssertionError(f"analizar debía rechazar {malo}")
    filas_, malas = leer([f"100,{t0}", f"50,{t1}", f"100,{t1}"])
    assert len(filas_) == 2 and len(malas) == 1 and malas[0][0] == 2, (filas_, malas)
    try:
        analizar([(100.0, decodificar(trama(1, 1000))), (50.0, decodificar(trama(2, 1100)))])
    except ValueError:
        pass
    else:
        raise AssertionError("analizar debía rechazar un retroceso")
    # Captura válida: frecuencia calculada.
    valida = [(i * 100.0, decodificar(trama(i, 1000 + i * 100))) for i in range(5)]
    assert "5 en 0.4 s (10.00 por segundo)" in "\n".join(analizar(valida))
    assert "2 en 0.1 s (10.00 por segundo)" in "\n".join(analizar(valida[:2]))
    print("autoprueba: ok")


def main(argv):
    if argv[1:] == ["--autoprueba"]:
        autoprueba()
        return 0
    if len(argv) != 2:
        print(__doc__)
        return 2
    try:
        with open(argv[1], encoding="utf-8") as f:
            filas, malas = leer(f)
        for n, motivo in malas:
            print(f"línea {n}: descartada ({motivo})")
        print("\n".join(analizar(filas)))
    except (OSError, UnicodeDecodeError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

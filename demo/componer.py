#!/usr/bin/env python3
"""Convierte las grabaciones crudas en videos MP4 con subtítulos.

Lee cada `<id>.json` de las carpetas de entrada (las escriben
`demo/web/grabar.mjs` y `demo/ios/grabar.sh`), recorta la grabación al
recorrido y la coloca en un lienzo horizontal de 1920 × 1080: la pantalla del
teléfono a la izquierda, sin tapar nada, y a la derecha un panel con:

  - el título del video y la plataforma;
  - lo que se hace («Toca…», «Escribe…»), en amarillo;
  - una aclaración (qué es simulado, qué se ve), en gris;
  - lo que la app dice en voz alta (web), lo que muestra en pantalla (iPhone) o
    la frase simulada de la persona (Ceguera total).

Escribe también una hoja de miniaturas por video (`<id>.jpg`), para revisarlo
sin abrirlo, e `indice.md` con la lista.

Uso: python3 demo/componer.py <salida> <entrada> [<entrada> ...]
Necesita ffmpeg y ffprobe con libass, y la fuente DejaVu Sans.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

LIENZO_ANCHO, LIENZO_ALTO = 1920, 1080
PANTALLA_ALTO = 1000
PANTALLA_X, PANTALLA_Y = 120, 40
PANEL_X, PANEL_MARGEN_DERECHO = 720, 80
FUENTE = "DejaVu Sans"
CARACTERES_POR_SEGUNDO = 14
MAXIMO_POR_TROZO = 230

PLATAFORMAS = {"web": "TransMiVoz web (Chrome, celular)", "iphone": "TransMiVoz iPhone (iOS Simulator)"}


def segundos_ass(s: float) -> str:
    s = max(0.0, s)
    h = int(s // 3600)
    m = int(s % 3600 // 60)
    return f"{h}:{m:02d}:{s % 60:05.2f}"


def escapar(texto: str) -> str:
    texto = texto.replace("\\", "/").replace("{", "(").replace("}", ")")
    return re.sub(r"\s+", " ", texto).strip()


def trozos(texto: str) -> list[str]:
    """Parte un texto largo en trozos de frases enteras, para que quepan en el panel."""
    # Corta tras un punto final, pero no en abreviaturas: «p. m.», «C.C. Nuestro», «S. Tomás».
    frases = re.split(r"(?<=[.!?…])(?<![A-Z]\.)\s+(?![a-zñáéíóú\-–])", texto.strip())
    piezas: list[str] = []
    for frase in frases:
        if len(frase) <= MAXIMO_POR_TROZO:
            piezas.append(frase)
            continue
        # Frase larga: se corta por palabras, sin pasar del máximo.
        actual = ""
        for palabra in frase.split():
            if actual and len(actual) + 1 + len(palabra) > MAXIMO_POR_TROZO:
                piezas.append(actual)
                actual = palabra
            else:
                actual = f"{actual} {palabra}".strip()
        if actual:
            piezas.append(actual)
    # Junta las frases cortas seguidas mientras quepan.
    juntas: list[str] = []
    for pieza in filter(None, piezas):
        if juntas and len(juntas[-1]) + len(pieza) + 1 <= MAXIMO_POR_TROZO:
            juntas[-1] = f"{juntas[-1]} {pieza}"
        else:
            juntas.append(pieza)
    return juntas or [texto]


def leer_iphone(datos: dict, carpeta: Path) -> dict:
    """Pasa los eventos del iPhone (hora de reloj) a segundos desde el inicio de la grabación."""
    origen = float(datos["grabacion_epoch"])
    eventos, titulo, inicio, fin = [], datos.get("titulo", ""), None, None
    archivo = carpeta / datos["eventos"]
    lineas = archivo.read_text(encoding="utf-8").splitlines() if archivo.exists() else []
    for linea in lineas:
        linea = linea.strip()
        if not linea:
            continue
        try:
            e = json.loads(linea)
        except json.JSONDecodeError:
            continue
        t = float(e["epoch"]) - origen
        tipo = e.get("tipo")
        if tipo == "titulo":
            titulo = e.get("texto", titulo)
        elif tipo == "inicio":
            inicio = t
        elif tipo == "fin":
            fin = t
        else:
            eventos.append({"tipo": tipo, "t": t, "texto": e.get("texto", "")})
    datos = dict(datos)
    datos.update(titulo=titulo, eventos=eventos, inicio=max(0.0, (inicio or 0.0) - 0.4))
    datos["fin"] = fin if fin is not None else (eventos[-1]["t"] + 4 if eventos else None)
    return datos


def sondear(video: Path, entradas: str, flujo: bool) -> str:
    orden = ["ffprobe", "-v", "error"]
    if flujo:
        orden += ["-select_streams", "v:0"]
    orden += ["-show_entries", entradas, "-of", "csv=p=0", str(video)]
    return subprocess.run(orden, capture_output=True, text=True, check=True).stdout.strip()


def subtitulos(datos: dict, total: float) -> str:
    inicio = float(datos.get("inicio") or 0.0)
    eventos = sorted(datos.get("eventos", []), key=lambda e: e["t"])
    plataforma = PLATAFORMAS.get(datos.get("plataforma", ""), "TransMiVoz")
    grabado = datos.get("grabado") or ""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", grabado)
    fecha = f" · {m[3]}/{m[2]}/{m[1]} {m[4]}:{m[5]}, hora de Bogotá" if m else ""

    def estilo(nombre: str, tamano: int, color: str, y: int, negrita: bool = False, cursiva: bool = False) -> str:
        return (
            f"Style: {nombre},{FUENTE},{tamano},{color},&H00FFFFFF,&H00000000,&H00000000,"
            f"{-1 if negrita else 0},{-1 if cursiva else 0},0,0,100,100,0,0,1,0,0,7,"
            f"{PANEL_X},{PANEL_MARGEN_DERECHO},{y},1\n"
        )

    lineas = [
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {LIENZO_ANCHO}\nPlayResY: {LIENZO_ALTO}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding\n",
        # Posiciones (desde arriba): la plataforma, el título (hasta dos líneas), la acción (hasta dos),
        # la nota (hasta tres) y la voz o la pantalla (hasta seis), sin pisarse.
        estilo("Plataforma", 27, "&H00A0A0A0", 60),
        estilo("Titulo", 46, "&H00FFFFFF", 104, negrita=True),
        estilo("Accion", 42, "&H004DE1FF", 262, negrita=True),
        estilo("Persona", 42, "&H00FFD38F", 262, negrita=True),
        estilo("Nota", 33, "&H00C8C8C8", 390, cursiva=True),
        estilo("Voz", 42, "&H00FFFFFF", 560),
        "\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    ]

    def dialogo(desde: float, hasta: float, estilo_: str, texto: str) -> None:
        desde, hasta = desde - inicio, min(hasta - inicio, total)
        if hasta <= 0 or hasta - desde < 0.15:
            return
        lineas.append(f"Dialogue: 0,{segundos_ass(desde)},{segundos_ass(hasta)},{estilo_},,0,0,0,,{texto}\n")

    fijo = inicio  # el título y la plataforma se ven todo el video
    dialogo(fijo, fijo + total, "Titulo", escapar(datos.get("titulo", "")))
    dialogo(fijo, fijo + total, "Plataforma", escapar(f"{plataforma}{fecha}"))

    def franja(tipos: tuple[str, ...], maximo: float) -> None:
        """Una línea a la vez: cada una dura hasta la siguiente de la misma franja o `maximo` segundos."""
        propios = [e for e in eventos if e["tipo"] in tipos]
        for i, e in enumerate(propios):
            hasta = e["t"] + maximo
            if i + 1 < len(propios):
                hasta = min(hasta, propios[i + 1]["t"])
            if e["tipo"] == "persona":
                # Lo que «dice» la persona en Ceguera total va donde va lo que se hace, y se queda mientras la app responde.
                texto = "{\\fs28\\c&HA0A0A0&\\i1\\b0}La persona dice (voz simulada en la grabación):{\\r}\\N«" + escapar(e["texto"]) + "»"
                dialogo(e["t"], hasta, "Persona", texto)
            else:
                dialogo(e["t"], hasta, "Accion" if e["tipo"] == "accion" else "Nota", escapar(e["texto"]))

    franja(("accion", "persona"), 8.0)
    franja(("nota",), 14.0)

    # Lo que dice o muestra la app; la última manda.
    abajo = [e for e in eventos if e["tipo"] in ("voz", "pantalla") and e.get("texto", "").strip()]
    rotulos = {"voz": "La app dice en voz alta:", "pantalla": "En pantalla:"}
    for i, e in enumerate(abajo):
        texto = e["texto"].strip()
        estimado = max(2.0, len(texto) / CARACTERES_POR_SEGUNDO)
        fin = e.get("fin")
        hasta = float(fin) if fin is not None else e["t"] + (estimado if e["tipo"] != "pantalla" else 10.0)
        hasta = max(hasta, e["t"] + 1.8)
        if i + 1 < len(abajo):
            hasta = min(hasta, abajo[i + 1]["t"])
        estilo_ = "Voz"
        partes = trozos(texto)
        largo = sum(len(p) for p in partes) or 1
        desde = e["t"]
        for parte in partes:
            paso = (hasta - e["t"]) * len(parte) / largo
            rotulo = "{\\fs28\\c&HA0A0A0&\\i1}" + rotulos[e["tipo"]] + "{\\r}\\N"
            cita = f"«{escapar(parte)}»" if e["tipo"] == "voz" else escapar(parte)
            dialogo(desde, desde + paso, estilo_, rotulo + cita)
            desde += paso
    return "".join(lineas)


def componer(json_path: Path, salida: Path) -> dict:
    datos = json.loads(json_path.read_text(encoding="utf-8"))
    carpeta = json_path.parent
    if datos.get("plataforma") == "iphone":
        datos = leer_iphone(datos, carpeta)
    video = carpeta / datos["video"]
    if not video.exists():
        raise FileNotFoundError(f"No existe {video}")
    ancho, alto = (int(x) for x in sondear(video, "stream=width,height", True).split(",")[:2])
    pantalla_ancho = int(round(ancho * PANTALLA_ALTO / alto / 2)) * 2
    largo = float(sondear(video, "format=duration", False))
    inicio = min(float(datos.get("inicio") or 0.0), max(0.0, largo - 1))
    fin = datos.get("fin")
    fin = min(float(fin) + 0.8, largo) if fin else largo
    total = max(1.0, fin - inicio)
    datos["inicio"] = inicio

    ass = salida / f"{datos['id']}.ass"
    ass.write_text(subtitulos(datos, total), encoding="utf-8")
    mp4 = salida / f"{datos['id']}.mp4"
    filtro = (
        f"scale={pantalla_ancho}:{PANTALLA_ALTO}:flags=lanczos,"
        f"pad={LIENZO_ANCHO}:{LIENZO_ALTO}:{PANTALLA_X}:{PANTALLA_Y}:color=0x141414,"
        f"drawbox=x={PANTALLA_X - 5}:y={PANTALLA_Y - 5}:w={pantalla_ancho + 10}:h={PANTALLA_ALTO + 10}:color=0x3c3c3c:t=5,"
        f"subtitles=filename={ass.as_posix()}"
    )
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{inicio:.2f}", "-t", f"{total:.2f}", "-i", str(video),
            "-vf", filtro, "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(mp4),
        ],
        check=True,
    )
    # Hoja de miniaturas: 8 cuadros repartidos en el video, para revisarlo sin abrirlo.
    cuadros = 8
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp4),
            "-vf", f"fps={cuadros}/{total:.2f},scale=640:-2,tile=2x{cuadros // 2}:padding=6:color=white",
            "-frames:v", "1", "-q:v", "4", str(salida / f"{datos['id']}.jpg"),
        ],
        check=True,
    )
    error = datos.get("error")
    if not error and datos.get("estado"):
        error = f"xcodebuild terminó con {datos['estado']}"
    return {
        "id": datos["id"],
        "plataforma": datos.get("plataforma"),
        "titulo": datos.get("titulo", ""),
        "segundos": round(total, 1),
        "error": error,
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    salida = Path(sys.argv[1])
    salida.mkdir(parents=True, exist_ok=True)
    resultados, fallos = [], []
    for entrada in sys.argv[2:]:
        for json_path in sorted(Path(entrada).glob("*.json")):
            try:
                datos = json.loads(json_path.read_text(encoding="utf-8"))
                if "video" not in datos:
                    continue
                resultados.append(componer(json_path, salida))
                print(f"✓ {json_path.stem}")
            except Exception as error:  # noqa: BLE001 - se informa y se sigue con los demás
                fallos.append(f"{json_path}: {error}")
                print(f"✗ {json_path}: {error}")
    resultados.sort(key=lambda r: (r["plataforma"] != "web", r["id"]))
    with (salida / "indice.md").open("w", encoding="utf-8") as indice:
        indice.write("# Videos de demostración de TransMiVoz\n\n")
        indice.write("| Archivo | Plataforma | Qué muestra | Duración | Nota |\n| --- | --- | --- | --- | --- |\n")
        for r in resultados:
            nota = "Recorrido incompleto: ver el registro de la grabación" if r["error"] else ""
            plataforma = "Web" if r["plataforma"] == "web" else "iPhone"
            indice.write(f"| `{r['id']}.mp4` | {plataforma} | {r['titulo']} | {r['segundos']} s | {nota} |\n")
    (salida / "indice.json").write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8")
    for fallo in fallos:
        print(f"✗ {fallo}")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())

# iPhone: base visual de la web (Inicio, paleta, letra y componentes)

Issue [#51](https://github.com/ZuluCode777/proyecto-1-APP/issues/51), parte de la renovación visual del iPhone: la app SwiftUI debe parecerse lo más posible a la web de Render, con sus colores. Esta entrega es **la base**; otras tareas llevan después cada pantalla y cada función que le falta al iPhone, apoyadas en lo de aquí.

Todo lo de este documento es **software sin compilar donde se escribió** (no había Xcode): el código SwiftUI y UIKit lo compila por primera vez la CI de macOS. Lo que sí se ejecutó en Linux: la lógica sin SwiftUI (`ModoApp`, `TextoInicio`, 12 pruebas en `swift:6.2` con `-swift-version 5`) y la conversión de colores. **Nada se vio en un simulador ni en un iPhone.**

## Paleta

`ios/TransMiVoz/Vistas/Tema.swift`, `enum Paleta`. Un `Color` por token de `app/globals.css`, con el mismo nombre en camelCase (`--brand-soft` es `Paleta.brandSoft`), dinámico: claro es `:root`; oscuro es `.fluor` (el «Alto contraste» de la web: negro con neón). **La web elige `.fluor` con un interruptor; el iPhone sigue la apariencia del sistema** (decisión del encargo). Los tokens que `.fluor` no cambia valen lo mismo en oscuro, como en la web.

Los valores `oklch` se pasaron a sRGB con la reducción de croma de CSS Color 4 (JND 0,02). Con esos hex se midieron los contrastes que declara el CSS: 17,9:1 negro sobre lima, de 7,96 a 19,6:1 sobre los neones, 7,5:1 sobre el rojo de Emergencia, 7,2:1 el blanco sobre el rojo oscuro. `PaletaTests` los vuelve a medir en la CI. En un iPhone, Safari pinta en Display P3 los `oklch` que salen de sRGB (más saturados); aquí quedan recortados a sRGB, algo menos saturados (diferencia visual no medida).

| Token web | Swift | Claro | Oscuro (`.fluor`) |
| --- | --- | --- | --- |
| `--background` | `Paleta.background` | `#FFFFFF` | `#000000` (`oklch(0 0 0)`) |
| `--foreground` | `Paleta.foreground` | `#000000` | `#FBF400` (`oklch(0.94 0.22 108)`) |
| `--card` | `Paleta.card` | `#CCFF00` | `#010101` (`oklch(0.06 0 0)`) |
| `--card-foreground` | `Paleta.cardForeground` | `#000000` | `#FBF400` (`oklch(0.94 0.22 108)`) |
| `--popover` | `Paleta.popover` | `#FFFFFF` (`oklch(1 0 0)`) | `#FFFFFF` = claro |
| `--popover-foreground` | `Paleta.popoverForeground` | `#0A0A0A` (`oklch(0.145 0 0)`) | `#0A0A0A` = claro |
| `--muted` | `Paleta.muted` | `#F2F2F2` | `#030303` (`oklch(0.1 0 0)`) |
| `--muted-foreground` | `Paleta.mutedForeground` | `#000000` | `#CAE412` (`oklch(0.87 0.2 118)`) |
| `--bar` | `Paleta.bar` | `#CCFF00` | `#010101` (`oklch(0.06 0 0)`) |
| `--brand` | `Paleta.brand` | `#FF6EFF` | `#36F555` (`oklch(0.85 0.25 145)`) |
| `--brand-foreground` | `Paleta.brandForeground` | `#000000` | `#000000` (`oklch(0 0 0)`) |
| `--brand-soft` | `Paleta.brandSoft` | `#FFFFFF` | `#001400` (`oklch(0.16 0.09 145)`) |
| `--brand-ink` | `Paleta.brandInk` | `#000000` | `#36F555` (`oklch(0.85 0.25 145)`) |
| `--fill-switch` | `Paleta.fillSwitch` | `#00FFFF` | `#010101` (`oklch(0.06 0 0)`) |
| `--fill-agent` | `Paleta.fillAgent` | `#FF6EFF` | `#010101` (`oklch(0.06 0 0)`) |
| `--fill-routes` | `Paleta.fillRoutes` | `#FFFF00` | `#010101` (`oklch(0.06 0 0)`) |
| `--fill-map` | `Paleta.fillMap` | `#D07BFF` | `#010101` (`oklch(0.06 0 0)`) |
| `--fill-lens` | `Paleta.fillLens` | `#39FF14` | `#010101` (`oklch(0.06 0 0)`) |
| `--sos` | `Paleta.sos` | `#FF6B5A` | `#B3000D` (`oklch(0.48 0.2 27)`) |
| `--sos-foreground` | `Paleta.sosForeground` | `#000000` | `#FFFFFF` (`oklch(1 0 0)`) |
| `--sos-border` | `Paleta.sosBorder` | `#000000` | `#B3000D` (`oklch(0.48 0.2 27)`) |
| `--ok` | `Paleta.ok` | `#005E26` (`oklch(0.42 0.12 150)`) | `#36F555` (`oklch(0.85 0.25 145)`) |
| `--fail` | `Paleta.fail` | `#A9000D` (`oklch(0.46 0.19 27)`) | `#FF7B74` (`oklch(0.75 0.2 25)`) |
| `--destructive` | `Paleta.destructive` | `#E7000B` (`oklch(0.577 0.245 27.325)`) | `#E7000B` = claro |
| `--border` | `Paleta.border` | `#000000` | `#FBF400` (`oklch(0.94 0.22 108)`) |
| `--input` | `Paleta.input` | `#000000` | `#FBF400` (`oklch(0.94 0.22 108)`) |
| `--ring` | `Paleta.ring` | `#000000` | `#A7FB0F` (`oklch(0.9 0.24 130)`) |
| `--primary` | `Paleta.primary` | `#171717` (`oklch(0.205 0 0)`) | `#171717` = claro |
| `--primary-foreground` | `Paleta.primaryForeground` | `#FAFAFA` (`oklch(0.985 0 0)`) | `#FAFAFA` = claro |
| `--secondary` | `Paleta.secondary` | `#F5F5F5` (`oklch(0.97 0 0)`) | `#F5F5F5` = claro |
| `--secondary-foreground` | `Paleta.secondaryForeground` | `#171717` (`oklch(0.205 0 0)`) | `#171717` = claro |
| `--accent` | `Paleta.accent` | `#F2F2F2` | `#F2F2F2` = claro |
| `--accent-foreground` | `Paleta.accentForeground` | `#000000` | `#000000` = claro |
| `--chart-1` | `Paleta.chart1` | `#D4D4D4` (`oklch(0.87 0 0)`) | `#D4D4D4` = claro |
| `--chart-2` | `Paleta.chart2` | `#737373` (`oklch(0.556 0 0)`) | `#737373` = claro |
| `--chart-3` | `Paleta.chart3` | `#525252` (`oklch(0.439 0 0)`) | `#525252` = claro |
| `--chart-4` | `Paleta.chart4` | `#404040` (`oklch(0.371 0 0)`) | `#404040` = claro |
| `--chart-5` | `Paleta.chart5` | `#262626` (`oklch(0.269 0 0)`) | `#262626` = claro |
| `--sidebar` | `Paleta.sidebar` | `#FAFAFA` (`oklch(0.985 0 0)`) | `#FAFAFA` = claro |
| `--sidebar-foreground` | `Paleta.sidebarForeground` | `#0A0A0A` (`oklch(0.145 0 0)`) | `#0A0A0A` = claro |
| `--sidebar-primary` | `Paleta.sidebarPrimary` | `#171717` (`oklch(0.205 0 0)`) | `#171717` = claro |
| `--sidebar-primary-foreground` | `Paleta.sidebarPrimaryForeground` | `#FAFAFA` (`oklch(0.985 0 0)`) | `#FAFAFA` = claro |
| `--sidebar-accent` | `Paleta.sidebarAccent` | `#F5F5F5` (`oklch(0.97 0 0)`) | `#F5F5F5` = claro |
| `--sidebar-accent-foreground` | `Paleta.sidebarAccentForeground` | `#171717` (`oklch(0.205 0 0)`) | `#171717` = claro |
| `--sidebar-border` | `Paleta.sidebarBorder` | `#E5E5E5` (`oklch(0.922 0 0)`) | `#E5E5E5` = claro |
| `--sidebar-ring` | `Paleta.sidebarRing` | `#A1A1A1` (`oklch(0.708 0 0)`) | `#A1A1A1` = claro |

Medidas (`enum Tema`): `radio` 10 (`--radius`), `radioXL` 14, `radio2XL` 18 (tarjetas, botones, baldosas), `radio3XL` 22, `borde` 3 (`border-3`), `bordeEmergencia` 5 (`border-5`), `objetivoMinimo` 44.

Lo que **no** cambia: `AccentColor` del catálogo de recursos y los colores del sistema que usan las pantallas existentes (`.borderedProminent`, `textoSecundario`, `rojoAccesible`…). Cada pantalla pasa a la paleta cuando su tarea la restile; `EstilosAccesiblesTests` sigue midiendo `AccentColor`.

## Letra

`Vistas/Tipografia.swift`. Plus Jakarta Sans, como la web, en cuatro pesos estáticos (regular, semibold, bold, extrabold: los que usa la web) en `TransMiVoz/Fuentes/`, con su licencia SIL OFL 1.1 (`OFL.txt`, copiada del repositorio original `tokotype/PlusJakartaSans`). Se registran en `Info-TransMiVoz.plist` (`UIAppFonts`) y, como respaldo, con `Tipografia.registrar()` al arrancar (`TransMiVozApp.init`): así no depende de cómo Xcode copie las fuentes al paquete. Si ninguna funciona, `Font.custom` cae en la letra del sistema y la app sigue legible.

Uso: `.font(.jakarta(.bold, .lg))` es `font-bold text-lg`. Tamaños `sm 14, base 16, lg 18, xl 20, xl2 24, xl3 30` (los de Tailwind), cada uno ligado a un estilo de Dynamic Type (`relativeTo`), así que escalan hasta el texto más grande. Las barras del sistema (navegación y pestañas) **no** usan esta letra a propósito: sus textos escalan por su cuenta y una letra propia los estropea.

## Componentes (`Vistas/ComponentesWeb.swift`)

| Web | Swift | Notas |
| --- | --- | --- |
| `AppHeader` | `EncabezadoApp` (`ToolbarContent`) | `.toolbar { EncabezadoApp(alAbrirMenu:, alAbrirAvisos:) }` en la raíz de una pestaña. Menú de modo a la izquierda, «TransMiVoz» con su ficha del bus al centro, campana a la derecha. Hoy solo la usa Inicio. |
| `ScreenHeader` | `EncabezadoPantalla(titulo:, subtitulo:, simbolo:, alVolver:)` | La banda con ficha, título y subtítulo, al principio del contenido. `alVolver` solo para donde no hay barra de navegación (hojas); en una pantalla empujada el botón «atrás» del sistema hace de «Volver». |
| Tarjeta (`rounded-2xl border-3 bg-card p-4`) | `.tarjetaWeb(relleno:, tinta:)` | Modificador de vista. |
| Botón principal / secundario | `.buttonStyle(EstiloBotonPrimario())` / `EstiloBotonSecundario()` | `font-bold text-lg`, 3 pt, mínimo 56 pt. No disponible: borde discontinuo y colores de `EstilosAccesibles` (contraste ≥ 4,5:1, no solo tono). |
| Píldora «Volver» | `EstiloBotonPildora` | Usada por `EncabezadoPantalla`. |
| Baldosa de `PartialHome` | `BaldosaWeb(titulo:, pista:, simbolo:, relleno:, tinta:, colorBorde:, anchoBorde:, identificador:, accion:)` | Botón de 72 pt como mínimo; VoiceOver lee el título y, tras una pausa, la pista. Con el texto más grande pierde el ícono y la flecha (decorativos) para que quepa entera. |
| `ModeMenu` | `MenuModoVista` | Hoja que abre `RaizVista`. |

Íconos (lucide a SF Symbols): Menu `line.3.horizontal`, Bell `bell`, Bus `bus`, Bot `bubble.left.and.text.bubble.right` (el de la pestaña Consulta), Map `map`, TrainFront `tram`, ScanText `text.viewfinder`, PhoneCall `phone.fill`, ShieldAlert `exclamationmark.shield`, ChevronRight `chevron.right`, ArrowLeft `arrow.left`, Eye `eye`, EyeOff `eye.slash`, Check `checkmark`.

## Estructura de la app

Cinco pestañas, en este orden (`RaizVista`, `PestanaRaiz`): **Inicio** (la de partida), Sesión, Consulta, Avisos, Ajustes. La lupa ya no tiene pestaña.

- **Inicio** (`InicioVista`, `NavigationStack` propia): `EncabezadoApp` en la barra de navegación, la banda «¿Qué necesitas?» y las seis baldosas de `OpcionInicio`, en el orden de la web: Asistente, Rutas, Mapa y GPS, Metro de Bogotá, Lupa y Emergencia al final (contorno de 5 pt, rojo, letra negra en claro y blanca en oscuro).
- Qué abre cada baldosa: **Asistente** cambia a la pestaña Consulta; **Rutas** empuja `RutasVista`; **Lupa** empuja `LupaVista` (sin su propia `NavigationStack`: la lupa conserva el ciclo de vida de la cámara, se suelta al salir o al cambiar de pestaña); **Mapa y GPS**, **Metro de Bogotá** y **Emergencia** empujan `GpsAuditivoVista`, `MetroVista` y `EmergenciaVista`.
- **La campana** de la cabecera abre la pestaña Avisos. **El menú** (botón de la izquierda) abre `MenuModoVista`.
- **Modo** (`ModoApp`, `ModoAppModelo`, `EntornoApp.modo`): Baja visión (`parcial`) o Ceguera total (`total`), guardado en `UserDefaults` con la clave y los valores de la web (`transmivoz-mode` = `parcial` | `total`). Elegir un modo cierra el menú, vuelve a Inicio y lo anuncia («Modo baja visión activado.»). Hoy solo cambia el Inicio: Baja visión muestra las baldosas y Ceguera total muestra `AgenteTotalVista`. **Ese es el gancho del Inicio de voz.** En las pruebas de interfaz el modo parte siempre de Baja visión y no persiste.
- **Barras**: `AparienciaApp.aplicar()` (UIKit, al arrancar) pinta las barras de navegación y de pestañas con `bar`, la letra y los íconos con `foreground` y el filo con `border`. El contorno de las barras es el filo de 1 px del sistema, no los 3 px de la web.
- **Cabecera en el resto de pantallas**: la web la muestra siempre. Hoy solo Inicio la lleva; las demás pestañas conservan su barra de navegación con título (solo pintada con la paleta). Añadirla a una pantalla es un `.toolbar { EncabezadoApp(…) }`, pero choca con el botón «atrás» del sistema en las pantallas empujadas: decidirlo por pantalla.

## Para las tareas que siguen

- **Mapa y GPS, Metro, Emergencia, Ceguera total**: reemplazan **el archivo entero** (`GpsAuditivoVista`, `MetroVista`, `EmergenciaVista`, `AgenteTotalVista`). Cada uno trae una sola línea provisional en `textoProvisional` que **no debe llegar a `main`**. Conserven el título de navegación (las pruebas de Inicio abren cada pantalla por él: «Mapa y GPS», «Metro de Bogotá», «Emergencia»).
- **Cablear una pantalla nueva**: en `InicioVista.pantalla(_:)` (un caso más en `DestinoInicio`), o con `pestana = …` si es una pestaña.
- **Restilar una pantalla existente**: pasar sus colores a `Paleta`, su letra a `.jakarta(...)`, y armarla con `EncabezadoPantalla`, `.tarjetaWeb()` y los estilos de botón. Mantener los `accessibilityIdentifier`.
- **No cambiar** los ayudantes, tolerancias ni grupos de auditoría de `TransMiVozUITests.swift`.

## Pruebas

- `PaletaTests` (CI): los contrastes de cada par letra/fondo en claro y oscuro (≥ 7:1), el contorno y el foco (≥ 3:1) y algunos hex.
- `ModoAppModeloTests`, `TextoInicioTests`: lógica sin SwiftUI (también corren en Linux).
- `TransMiVozInicioUITests`: pestañas (cinco, Inicio primera y seleccionada, sin Lupa), cabecera, seis baldosas (orden, título, 44 pt, tocables), cada baldosa abre lo suyo, el menú de modo (cambia el Inicio, marca el activo, se cierra), la campana, y la auditoría de accesibilidad de Inicio y del menú. `TransMiVozInicioTextoGrandeUITests`: Inicio con `AccessibilityXXXL`, cada baldosa entera a la vista y auditada.
- Pruebas existentes cambiadas por la navegación (sin tocar ayudantes, tolerancias ni grupos de auditoría): las del accesorio abren primero la pestaña Sesión (antes era la primera) con el nuevo `abrirSesion`; las de la lupa la abren desde la baldosa de Inicio y «volver a la lupa» es volver a la pestaña Inicio.

## Sin verificar

Todo SwiftUI y UIKit de esta entrega hasta que corra la CI de macOS y, después, un iPhone: la compilación, la letra registrada (`UIAppFonts` con `INFOPLIST_FILE` mezclado con las claves generadas, y su respaldo), el aspecto de las barras con Liquid Glass de iOS 26, el título central de la barra con el texto más grande, el ciclo de vida de la cámara de la lupa al cambiar de pestaña con la lupa empujada, y las auditorías de accesibilidad nuevas. VoiceOver real no se probó.

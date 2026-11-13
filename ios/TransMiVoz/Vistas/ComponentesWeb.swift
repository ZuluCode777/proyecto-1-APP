import SwiftUI

// Componentes compartidos que repiten los de la web (`components/`), con la paleta de `Tema.swift` y la letra de
// `Tipografia.swift`. Las pantallas nuevas se arman con estas piezas; no se copian colores ni medidas a mano.
//
// Íconos: la web usa lucide; aquí, el SF Symbol más cercano.
//   Menu → line.3.horizontal · Bell → bell · Bus → bus · Bot → bubble.left.and.text.bubble.right (el de la pestaña Consulta)
//   Map → map · TrainFront → tram · ScanText → text.viewfinder · PhoneCall → phone.fill · ShieldAlert → exclamationmark.shield
//   ChevronRight → chevron.right · ArrowLeft → arrow.left · Eye → eye · EyeOff → eye.slash · Check → checkmark · X → xmark

// MARK: Cabecera de la app (components/app-header.tsx)

/// Cabecera de la web puesta en la barra de navegación: el menú de modo a la izquierda, «TransMiVoz» al centro y la campana
/// de avisos a la derecha. Se usa en la raíz de una pestaña: `.toolbar { EncabezadoApp(alAbrirMenu: …, alAbrirAvisos: …) }`.
/// En las pantallas empujadas queda el botón «atrás» del sistema, que hace lo del «Volver» de la web.
struct EncabezadoApp: ToolbarContent {
    let alAbrirMenu: () -> Void
    let alAbrirAvisos: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(action: alAbrirMenu) {
                Image(systemName: "line.3.horizontal").foregroundStyle(Paleta.foreground)
            }
            .accessibilityLabel(TextoInicio.abrirMenu)
            .accessibilityIdentifier("boton-menu-modo")
        }
        ToolbarItem(placement: .principal) { TituloApp() }
        ToolbarItem(placement: .topBarTrailing) {
            Button(action: alAbrirAvisos) {
                Image(systemName: "bell").foregroundStyle(Paleta.foreground)
            }
            .accessibilityLabel(TextoInicio.abrirAvisos)
            .accessibilityIdentifier("boton-avisos-campana")
        }
    }
}

/// El nombre de la app con su ficha del bus. Con el texto más grande se queda solo el nombre y se encoge antes de cortarse.
private struct TituloApp: View {
    @Environment(\.dynamicTypeSize) private var tamanoTexto

    var body: some View {
        HStack(spacing: 10) {
            if !tamanoTexto.isAccessibilitySize {
                Image(systemName: "bus")
                    .font(.subheadline.weight(.bold))
                    .frame(width: 32, height: 32)
                    .overlay(RoundedRectangle(cornerRadius: Tema.radioXL).strokeBorder(Paleta.border, lineWidth: Tema.borde))
                    .accessibilityHidden(true)
            }
            Text(TextoInicio.nombreApp)
                .font(.jakarta(.extrabold, .xl2))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .foregroundStyle(Paleta.foreground)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("titulo-app")
    }
}

// MARK: Cabecera de pantalla (components/screen-header.tsx)

/// Banda de título de una pantalla: ficha con el ícono, título y subtítulo, sobre la cabecera lima. Va al principio del
/// contenido. `alVolver` solo hace falta donde no hay barra de navegación (una hoja): en una pantalla empujada el botón
/// «atrás» de la barra ya hace de «Volver» y no se repite.
struct EncabezadoPantalla: View {
    let titulo: String
    var subtitulo: String?
    /// Nombre de un SF Symbol (ver la tabla de íconos arriba).
    var simbolo: String?
    var alVolver: (() -> Void)?

    @ScaledMetric(relativeTo: .title2) private var ladoFicha: CGFloat = 48

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let alVolver {
                Button(action: alVolver) {
                    Label("Volver", systemImage: "arrow.left")
                }
                .buttonStyle(EstiloBotonPildora())
                .accessibilityIdentifier("boton-volver")
            }
            HStack(alignment: .center, spacing: 12) {
                if let simbolo {
                    Image(systemName: simbolo)
                        .font(.title3)
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        .foregroundStyle(Paleta.brandInk)
                        .frame(width: ladoFicha, height: ladoFicha)
                        .background(Paleta.card, in: RoundedRectangle(cornerRadius: Tema.radio2XL))
                        .overlay(RoundedRectangle(cornerRadius: Tema.radio2XL).strokeBorder(Paleta.border, lineWidth: Tema.borde))
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(titulo)
                        .font(.jakarta(.extrabold, .xl2))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let subtitulo {
                        Text(subtitulo)
                            .font(.jakarta(.semibold, .base))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(Paleta.foreground)
            .padding(12)
            .background(Paleta.bar, in: RoundedRectangle(cornerRadius: Tema.radio2XL))
            .overlay(RoundedRectangle(cornerRadius: Tema.radio2XL).strokeBorder(Paleta.border, lineWidth: Tema.borde))
        }
    }
}

// MARK: Tarjetas

extension View {
    /// Tarjeta de la web: `rounded-2xl border-3 border-border bg-card p-4`. La letra va en `cardForeground`; con otro
    /// relleno hay que pasar la letra que le toca (por ejemplo `brand` con `brandForeground`).
    func tarjetaWeb(relleno: Color = Paleta.card, tinta: Color = Paleta.cardForeground) -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(tinta)
            .background(relleno, in: RoundedRectangle(cornerRadius: Tema.radio2XL))
            .overlay(RoundedRectangle(cornerRadius: Tema.radio2XL).strokeBorder(Paleta.border, lineWidth: Tema.borde))
    }
}

// MARK: Botones

/// Cuerpo común de los botones de la web: relleno, letra `font-bold text-lg`, contorno de 3 pt, radio 2xl, al menos 56 pt de
/// alto. Un botón no disponible se distingue por la forma (borde discontinuo) y no solo por el tono, y conserva el contraste.
private struct CuerpoBotonWeb: View {
    let configuracion: ButtonStyleConfiguration
    let relleno: Color
    let tinta: Color
    @Environment(\.isEnabled) private var disponible

    var body: some View {
        configuracion.label
            .font(.jakarta(.bold, .lg))
            .multilineTextAlignment(.center)
            .foregroundStyle(disponible ? tinta : Color.textoAccionInhabilitada)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(disponible ? relleno : Color.fondoAccionInhabilitada, in: RoundedRectangle(cornerRadius: Tema.radio2XL))
            .overlay(
                RoundedRectangle(cornerRadius: Tema.radio2XL).strokeBorder(
                    disponible ? Paleta.border : Color.textoAccionInhabilitada,
                    style: StrokeStyle(lineWidth: Tema.borde, dash: disponible ? [] : [6, 4])))
            .contentShape(RoundedRectangle(cornerRadius: Tema.radio2XL))
            .scaleEffect(configuracion.isPressed && disponible ? 0.98 : 1)
    }
}

/// Botón principal de la web: `bg-brand text-brand-foreground`.
struct EstiloBotonPrimario: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        CuerpoBotonWeb(configuracion: configuration, relleno: Paleta.brand, tinta: Paleta.brandForeground)
    }
}

/// Botón secundario de la web: `bg-card text-card-foreground`.
struct EstiloBotonSecundario: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        CuerpoBotonWeb(configuracion: configuration, relleno: Paleta.card, tinta: Paleta.cardForeground)
    }
}

/// Píldora del «Volver» de la web: `rounded-full border-3 bg-card px-4 py-2.5 font-semibold`.
struct EstiloBotonPildora: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.jakarta(.semibold, .base))
            .foregroundStyle(Paleta.cardForeground)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: Tema.objetivoMinimo)
            .background(Paleta.card, in: Capsule())
            .overlay(Capsule().strokeBorder(Paleta.border, lineWidth: Tema.borde))
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
    }
}

/// Solo el apretón al pulsar (`active:scale-95` de la web), sin tocar el aspecto de lo que envuelve.
struct EstiloApreton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

// MARK: Baldosas del Inicio (components/partial-home.tsx)

/// Una opción grande del Inicio: ícono, título, pista y flecha, a todo el ancho y de al menos 72 pt. Es un botón: VoiceOver
/// lee el título y, tras una pausa, la pista. Con el texto más grande se quitan el ícono y la flecha (son decorativos) para
/// que el texto use todo el ancho y la baldosa entera quepa en la pantalla.
struct BaldosaWeb: View {
    let titulo: String
    let pista: String
    /// Nombre de un SF Symbol.
    let simbolo: String
    var relleno: Color = Paleta.card
    var tinta: Color = Paleta.foreground
    var colorBorde: Color = Paleta.border
    var anchoBorde: CGFloat = Tema.borde
    var identificador: String?
    let accion: () -> Void

    @Environment(\.dynamicTypeSize) private var tamanoTexto

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 16) {
                if !tamanoTexto.isAccessibilitySize {
                    Image(systemName: simbolo)
                        .font(.title)
                        .frame(width: 40)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(titulo).font(.jakarta(.extrabold, .xl2))
                    Text(pista).font(.jakarta(.semibold, .lg))
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                if !tamanoTexto.isAccessibilitySize {
                    Image(systemName: "chevron.right")
                        .font(.title2.weight(.semibold))
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(tinta)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .background(relleno, in: RoundedRectangle(cornerRadius: Tema.radio2XL))
            .overlay(RoundedRectangle(cornerRadius: Tema.radio2XL).strokeBorder(colorBorde, lineWidth: anchoBorde))
            .contentShape(RoundedRectangle(cornerRadius: Tema.radio2XL))
        }
        .buttonStyle(EstiloApreton())
        .accessibilityLabel(titulo)
        .accessibilityHint(pista)
        .accessibilityIdentifier(identificador ?? "baldosa-\(titulo)")
    }
}

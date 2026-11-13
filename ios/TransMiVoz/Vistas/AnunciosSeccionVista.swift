import SwiftUI

/// Contenido de la sección «Anuncios oficiales» de la pestaña Avisos (EA-26, #52). Es autónoma: sin `NavigationStack` ni
/// `ScrollView` propios, y sin encabezado (lo pone quien la monta). Pide los anuncios al aparecer y con el botón; muestra
/// siempre el estado de la fuente, con texto y no solo con icono o color. Sin fuente, con la fuente caída o sin anuncios vigentes nunca dice
/// que no haya incidentes: dice que la app no puede saberlo. No toca la sesión con el accesorio ni sus avisos.
struct AnunciosSeccionVista: View {
    let modelo: AnunciosModelo

    /// Solo se anuncia el resultado de una consulta si la sección está a la vista: salir de la pestaña la cancela y
    /// VoiceOver no debe hablar de lo que ya no se ve.
    @State private var visible = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TarjetaFuenteAnuncios(modelo: modelo)

            ForEach(modelo.anuncios) { anuncio in
                TarjetaAnuncio(anuncio: anuncio)
            }

            Text(TextoAnuncios.independencia)
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("anuncios-independencia")
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task { await modelo.actualizar() }
        .onChange(of: modelo.consultando) { anterior, actual in
            guard anterior, !actual, visible else { return }
            AccessibilityNotification.Announcement(
                TextoAnuncios.resultado(estado: modelo.estadoFuente, cantidad: modelo.anuncios.count, fallo: modelo.fallo != nil)
            ).post()
        }
    }
}

/// Estado de la fuente: etiqueta, frases, confianza, las dos fechas que conserva y el botón para volver a pedir.
private struct TarjetaFuenteAnuncios: View {
    let modelo: AnunciosModelo

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Icono dentro del texto (no un `Label`): así es un solo elemento, con un solo identificador.
            Text("\(Image(systemName: icono)) \(TextoAnuncios.etiqueta(modelo.estadoFuente))")
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(TextoAnuncios.etiqueta(modelo.estadoFuente))
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("anuncios-estado")

            ForEach(Array(TextoAnuncios.mensaje(respuesta: modelo.respuesta, fallo: modelo.fallo).enumerated()), id: \.offset) { indice, frase in
                Text(frase)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("anuncios-mensaje-\(indice)")
            }

            Text(TextoAnuncios.etiqueta(modelo.confianza))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("anuncios-confianza")

            ForEach(Array(TextoAnuncios.lineasDeFuente(modelo.respuesta?.fuente).enumerated()), id: \.offset) { indice, linea in
                Text(linea)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("anuncios-fuente-\(indice)")
            }

            if modelo.consultando {
                ProgressView(TextoAnuncios.consultando)
                    .accessibilityIdentifier("anuncios-progreso")
            }

            Button(modelo.fallo == nil ? "Actualizar" : "Reintentar") {
                Task { await modelo.actualizar() }
            }
            .accion(prominente: false, disponible: !modelo.consultando)
            .controlSize(.large)
            .frame(minHeight: 44)
            .accessibilityIdentifier("boton-actualizar-anuncios")
        }
    }

    /// El icono repite lo que dice la etiqueta; el estado nunca depende solo de él.
    private var icono: String {
        switch modelo.estadoFuente {
        case .activa: return "checkmark.circle"
        case .degradada: return "exclamationmark.triangle"
        case .sinFuente: return "questionmark.circle"
        }
    }
}

/// Un anuncio: origen con su marca, título, descripción, afectación, fecha, vigencia e identificador. Una frase por
/// `Text`, para que con el texto más grande ninguno quede cortado.
private struct TarjetaAnuncio: View {
    let anuncio: Anuncio

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(Image(systemName: anuncio.origen == .simulado ? "testtube.2" : "building.columns")) \(TextoAnuncios.marca(anuncio))")
                .font(.subheadline.bold())
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(TextoAnuncios.marcaAccesible(anuncio))
                .accessibilityIdentifier(identificador("marca"))
            if anuncio.origen == .simulado {
                linea(TextoAnuncios.origenSimulado(anuncio), "origen")
            }
            Text(anuncio.titulo)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(identificador("titulo"))
            if let descripcion = TextoAnuncios.descripcionUtil(anuncio) {
                linea(descripcion, "descripcion")
            }
            linea(TextoAnuncios.afectacion(anuncio), "afectacion")
            if let servicios = TextoAnuncios.servicios(anuncio) {
                linea(servicios, "servicios")
            }
            linea(TextoAnuncios.fechaDeInicio(anuncio), "fecha")
            linea(TextoAnuncios.vigencia(anuncio), "vigencia")
            linea(TextoAnuncios.identificador(anuncio), "identificador")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func identificador(_ campo: String) -> String { "anuncio-\(anuncio.identificador)-\(campo)" }

    private func linea(_ texto: String, _ campo: String) -> some View {
        Text(texto)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(identificador(campo))
    }
}

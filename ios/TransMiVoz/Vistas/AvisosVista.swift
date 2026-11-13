import SwiftUI

/// Pestaña Avisos (EA-20, #46): lo que la app avisó por su cuenta, para leerlo, repetirlo y silenciar su voz según severidad.
/// Tres orígenes que no se mezclan, cada uno en su sección: anuncios OFICIALES del operador, avisos PROPIOS de la app y el
/// escenario SIMULADO. Sin una fuente de anuncios conectada nunca dice que no hay incidentes: dice que no puede saberlo.
/// Funciona sin red ni servidor. Un aviso de esta lista no es una notificación del sistema ni un push remoto.
struct AvisosVista: View {
    let centro: CentroAvisos
    /// Anuncios oficiales del servidor (EA-26): su sección va dentro de «Anuncios oficiales».
    let anuncios: AnunciosModelo

    /// Lleva el foco de VoiceOver al resultado de «Repetir»: es el único canal, `CentroAvisos` no lo anuncia además.
    @AccessibilityFocusState private var enResultado: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                // Pila ansiosa, como las demás pantallas: todos los elementos existen siempre, con su marco real.
                VStack(alignment: .leading, spacing: 16) {
                    if centro.origen == .simulado {
                        Label(TextoAvisos.avisoModoPruebas, systemImage: "testtube.2")
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("aviso-avisos-simulados")
                    }
                    seccionOficiales
                    seccionPropios
                    seccionVoz
                    seccionSimulado
                }
                .padding(16)
            }
            .navigationTitle(TextoAvisos.titulo)
            .navigationBarTitleDisplayMode(.inline)
            .bordeInferiorLegible()
            .onChange(of: centro.repeticiones) { _, _ in enResultado = true }
        }
    }

    // MARK: Secciones

    /// Los anuncios del servidor (EA-26) con el estado de su fuente. Sin fuente conectada o con la consulta caída dicen que
    /// la app no puede saber si hay incidentes; nunca que no los haya.
    private var seccionOficiales: some View {
        seccion(TextoAvisos.encabezadoOficiales, id: "encabezado-anuncios-oficiales") {
            AnunciosSeccionVista(modelo: anuncios)
        }
    }

    private var seccionPropios: some View {
        let avisos = centro.avisos
        return seccion(TextoAvisos.encabezadoPropios, id: "encabezado-avisos-propios") {
            if avisos.isEmpty {
                parrafos(TextoAvisos.sinAvisosPropios, id: "avisos-propios-vacio")
            } else {
                // Cada segundo se vuelve a leer si un aviso sigue vigente: caduca aunque nada más cambie.
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(avisos) { aviso in fila(aviso) }
                    }
                }
                if let resultado = centro.resultadoRepeticion {
                    Text(resultado)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityFocused($enResultado)
                        .accessibilityIdentifier("resultado-repetir")
                }
            }
        }
    }

    private var seccionVoz: some View {
        seccion(TextoAvisos.encabezadoVoz, id: "encabezado-voz-avisos") {
            interruptorAdvertencias
            notas(TextoAvisos.notaSilencio, id: "nota-silencio-avisos")
        }
    }

    private var seccionSimulado: some View {
        seccion(TextoAvisos.encabezadoSimulado, id: "encabezado-escenario-simulado") {
            parrafos(TextoAvisos.escenarioSimulado, id: "escenario-simulado")
        }
    }

    // MARK: Piezas

    private func seccion<Contenido: View>(
        _ titulo: String, id: String, @ViewBuilder contenido: () -> Contenido
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(titulo)
                .font(.title3.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(id)
            contenido()
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(uiColor: .separator), lineWidth: 1.5))
        .accessibilityElement(children: .contain)
    }

    /// Un `Text` por frase: con el texto más grande cada una cabe entera en el área visible. La primera conserva `id`; las
    /// demás le añaden su posición.
    private func parrafos(_ frases: [String], id: String) -> some View {
        ForEach(Array(frases.enumerated()), id: \.offset) { posicion, frase in
            Text(frase)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(posicion == 0 ? id : "\(id)-\(posicion)")
        }
    }

    private func notas(_ frases: [String], id: String) -> some View {
        ForEach(Array(frases.enumerated()), id: \.offset) { posicion, frase in
            Text(frase)
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(posicion == 0 ? id : "\(id)-\(posicion)")
        }
    }

    /// Solo hay interruptor para las advertencias: lo urgente no se silencia. El rótulo es un `Text` explícito con
    /// identificador propio, como los demás interruptores: la auditoría de contraste reporta ese texto y no el interruptor.
    private var interruptorAdvertencias: some View {
        Toggle(isOn: Binding(
            get: { centro.advertenciasSilenciadas },
            set: { centro.silenciarAdvertencias($0) })) {
                Text(TextoAvisos.silenciarAdvertencias)
                    .accessibilityIdentifier("etiqueta-silenciar-advertencias")
            }
            .frame(minHeight: 44)
            .accessibilityIdentifier("interruptor-silenciar-advertencias")
    }

    /// Un aviso: clase, texto, una línea con severidad, origen y vigencia (nada depende solo del color) y, si el enlace con el
    /// accesorio no es autenticado, esa reserva. «Repetir» solo si sigue vigente: repetir lo caducado diría como actual algo
    /// que ya no lo es.
    private func fila(_ aviso: Aviso) -> some View {
        let id = "aviso-\(aviso.tipo.rawValue)"
        let titulo = TextoAvisos.tituloDe(aviso.tipo)
        let vigente = centro.vigente(aviso)
        return VStack(alignment: .leading, spacing: 8) {
            Text(titulo)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("\(id)-titulo")
            Text(aviso.texto)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("\(id)-texto")
            Text(TextoAvisos.detalle(aviso, vigente: vigente))
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("\(id)-detalle")
            if aviso.enlaceSinAutenticar {
                Text(TextoAvisos.enlaceSinAutenticar)
                    .font(.footnote)
                    .foregroundStyle(.textoSecundario)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("\(id)-enlace")
            }
            if vigente {
                Button("Repetir") { centro.repetir(aviso.tipo) }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Repetir el aviso: \(titulo)")
                    .accessibilityIdentifier("\(id)-repetir")
            }
        }
        .accessibilityElement(children: .contain)
    }
}

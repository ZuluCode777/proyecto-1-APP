import Foundation

/// Textos de las pantallas Preferencias, Favoritas y Ayuda, en un solo sitio para probarlos.
/// Ayuda y Favoritas dicen lo que la app hace HOY: si cambian las pestañas o llega la pantalla de rutas, se actualizan aquí.
enum TextoPreferencias {
    static let tituloVoz = "Voz de la app"
    static let notaVoz = "Es el mismo interruptor de la pestaña Sesión. Con VoiceOver activo empieza apagada para no hablar dos veces. Vuelve a su valor inicial al cerrar la app."
    static let sinAccesorio = "La voz de la app no está disponible en este modo."
    static let tituloSistema = "Texto, contraste y VoiceOver"
    static let notaSistema = "El tamaño del texto, el contraste, el movimiento reducido y VoiceOver se toman de los ajustes de iOS. Esta app no tiene un modo de alto contraste propio como la web."
}

enum TextoFavoritas {
    static let vacio = "Aún no tienes rutas favoritas."
    static let comoSeAgregan = "Las rutas se guardan desde el detalle de cada ruta, con el botón «Guardar». En el iPhone esa pantalla todavía no está disponible, así que por ahora esta lista seguirá vacía."
    static let dondeSeGuardan = "Las favoritas se guardan solo en este iPhone: no se envían al servidor ni se comparten con la web."

    static func resumen(_ cantidad: Int) -> String {
        cantidad == 1 ? "1 ruta favorita" : "\(cantidad) rutas favoritas"
    }

    static func etiquetaQuitar(_ codigo: String) -> String { "Quitar la ruta \(codigo) de favoritas" }

    /// Anuncio de accesibilidad tras quitar una ruta (el foco se pierde con la fila).
    static func quitada(_ codigo: String, quedan: Int) -> String {
        let resto: String
        switch quedan {
        case 0: resto = "No quedan rutas favoritas."
        case 1: resto = "Queda 1 ruta favorita."
        default: resto = "Quedan \(quedan) rutas favoritas."
        }
        return "Quité la ruta \(codigo) de tus favoritas. \(resto)"
    }
}

struct SeccionAyuda: Equatable {
    let titulo: String
    let parrafos: [String]
}

enum TextoAyuda {
    static let secciones: [SeccionAyuda] = [
        SeccionAyuda(titulo: "Qué hace la app", parrafos: [
            "TransMiVoz te orienta con el transporte público de Bogotá. En el iPhone tiene tres partes: Sesión, Consulta y Ajustes.",
        ]),
        SeccionAyuda(titulo: "Cómo usarla", parrafos: [
            "Ajustes: escribe la dirección del servidor y, si te la dieron, la clave. Sin servidor, la Consulta no responde.",
            "Consulta: escribe tu pregunta, por ejemplo una ruta o una estación, y toca Enviar. Necesita conexión a internet y no envía tu ubicación.",
            "Sesión: es para el accesorio de proximidad por Bluetooth. Busca y elige el accesorio, toca Iniciar sesión y usa auriculares para oír los avisos.",
        ]),
        SeccionAyuda(titulo: "Límites de la Consulta", parrafos: [
            "Las respuestas son orientación, no una guía para abordar: la app no te dice en qué parada subir ni bajar. Confirma la ruta, la parada y el sentido en la señalización y con el personal de TransMilenio.",
            "Los datos vienen del servidor y pueden estar desactualizados.",
        ]),
        SeccionAyuda(titulo: "Metro de Bogotá", parrafos: [
            "El Metro de Bogotá es un proyecto futuro: la Línea 1 está en construcción y no presta servicio. La app para iPhone no consulta ni planea viajes en Metro.",
        ]),
        SeccionAyuda(titulo: "Accesorio de proximidad", parrafos: TextoAccesorio.parrafosAvisoEnlace + [
            "Esto no es una detección ni significa camino libre. Los avisos hablados solo salen por auriculares.",
        ]),
        SeccionAyuda(titulo: "Emergencias", parrafos: [
            "En una emergencia llama al 123. Policía de TransMilenio: 156. Atención al usuario de TransMilenio: 195.",
            "Esta app no hace llamadas: márcalas desde la app Teléfono.",
        ]),
    ]
}

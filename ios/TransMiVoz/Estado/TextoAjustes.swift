import Foundation

/// Textos de las pantallas Preferencias, Favoritas y Ayuda, en un solo sitio para probarlos.
/// Ayuda y Favoritas dicen lo que la app hace HOY: si cambian las pestañas o llega la pantalla de rutas, se actualizan aquí.
enum TextoPreferencias {
    static let tituloVoz = "Voz de la app"
    static let notaVoz = "Es el mismo interruptor de la pestaña Sesión. Controla si la app dice en voz alta el estado del accesorio, y solo por una salida de audio privada (auriculares con cable o Bluetooth). Hoy el accesorio está bloqueado porque no se puede verificar el enlace, así que no hay avisos del sensor. Con VoiceOver activo empieza apagada para no hablar dos veces. Vuelve a su valor inicial al cerrar la app."
    static let sinAccesorio = "La voz de la app no está disponible en este modo."
    static let tituloSistema = "Texto, contraste y VoiceOver"
    static let notaSistema = "El tamaño del texto sigue el ajuste de iOS. Los controles estándar siguen el contraste y el movimiento que elijas en iOS, pero algunos textos secundarios no cambian con «Aumentar contraste». Esta app no tiene un modo de alto contraste propio como la web. VoiceOver se activa en los ajustes de accesibilidad de iOS."
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

struct LlamadaAyuda: Equatable {
    let nombre: String
    let numero: String

    var url: URL? { URL(string: "tel:\(numero)") }
}

struct SeccionAyuda: Equatable {
    let titulo: String
    let parrafos: [String]
    var llamadas: [LlamadaAyuda] = []
}

enum TextoAyuda {
    static let secciones: [SeccionAyuda] = [
        SeccionAyuda(titulo: "Qué hace la app", parrafos: [
            "TransMiVoz te orienta con el transporte público de Bogotá. En el iPhone tiene tres partes: Sesión, Consulta y Ajustes.",
        ]),
        SeccionAyuda(titulo: "Cómo usarla", parrafos: [
            "Ajustes: escribe la dirección del servidor y, si te la dieron, la clave. Sin servidor, la Consulta no responde. En el menú «Más ajustes», arriba a la derecha, están Preferencias, Favoritas y esta Ayuda.",
            "Consulta: escribe tu pregunta, por ejemplo una ruta o una estación, y toca Enviar. Necesita conexión a internet y no envía tu ubicación.",
            "Sesión: es para el accesorio de proximidad por Bluetooth. Puedes buscarlo, elegirlo e iniciar la sesión, pero hoy esta versión bloquea las medidas y los avisos del sensor porque no puede verificar el enlace con el accesorio (más abajo, «Accesorio de proximidad»).",
        ]),
        SeccionAyuda(titulo: "Límites de la Consulta", parrafos: [
            "Las respuestas son orientación, no una guía para abordar: la app no te dice en qué parada subir ni bajar. Confirma la ruta, la parada y el sentido en la señalización y con el personal de TransMilenio.",
            "Los datos vienen del servidor y pueden estar desactualizados.",
        ]),
        SeccionAyuda(titulo: "Metro de Bogotá", parrafos: [
            "El Metro de Bogotá es un proyecto futuro: la Línea 1 está en construcción y no presta servicio. La app para iPhone no tiene pantalla de Metro ni planea viajes en Metro. Si preguntas por el Metro en Consulta, el servidor responde solo con información.",
        ]),
        // Se reutiliza el texto del accesorio, no una copia: si cambia allí, cambia aquí. El aviso va en un solo párrafo
        // (en la pantalla de Sesión se parte por el tamaño del texto) para que VoiceOver no se detenga a media frase.
        SeccionAyuda(titulo: "Accesorio de proximidad", parrafos: [
            TextoAccesorio.parrafosAvisoEnlace.joined(separator: " "),
            TextoAccesorio.parrafos(.enlaceNoVerificado).suffix(2).joined(separator: " "),
            "Cuando los avisos no estén bloqueados, se dicen solo por una salida de audio privada (auriculares con cable o Bluetooth). El iPhone no distingue unos auriculares de un altavoz Bluetooth: comprueba que sean auriculares.",
            "Es un prototipo experimental: no reemplaza el bastón ni el perro guía.",
        ]),
        SeccionAyuda(titulo: "Emergencias", parrafos: [
            "En una emergencia llama al 123. Los otros números son de TransMilenio. Cada botón abre el marcador del iPhone con el número escrito; tú decides si llamas.",
        ], llamadas: [
            LlamadaAyuda(nombre: "Línea de emergencias", numero: "123"),
            LlamadaAyuda(nombre: "Policía de TransMilenio", numero: "156"),
            LlamadaAyuda(nombre: "Atención al usuario de TransMilenio", numero: "195"),
        ]),
    ]
}

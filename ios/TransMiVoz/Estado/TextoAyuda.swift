import Foundation

/// Texto estático de la pantalla Ayuda. Dice lo que la app hace HOY: al cambiar las pestañas o llegar rutas y lupa, se actualiza aquí.
struct LlamadaAyuda: Equatable, Sendable {
    let nombre: String
    let numero: String
    let url: URL

    init(nombre: String, numero: String) {
        self.nombre = nombre
        self.numero = numero
        // Los números son constantes del código, solo dígitos: `tel:` siempre forma una URL válida.
        url = URL(string: "tel:\(numero)")!
    }
}

struct SeccionAyuda: Equatable, Sendable {
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
            "\(TextoAccesorio.sinMedidaPorEnlace) \(TextoAccesorio.noEsDeteccionNiCaminoLibre)",
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

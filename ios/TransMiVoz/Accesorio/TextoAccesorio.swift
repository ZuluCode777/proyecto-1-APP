import ContratoBLE
import Foundation

/// Estado que ve y oye la persona. Une el estado del transporte con el de la
/// sesión del contrato. Cinco estados distintos de base: conectado, calibrando,
/// sin detección, fallo y desconectado.
enum EstadoAccesorio: Equatable {
    case sinAccesorio
    case detenido
    case bluetoothNoDisponible(DisponibilidadBluetooth)
    case conectando
    case conectado
    case calibrando
    /// La seguridad del enlace no se puede verificar: ninguna medida cuenta.
    case enlaceNoVerificado
    case rechazado(MotivoRechazo)
    case falla(MotivoFalla)
    case desconectado
    case sinDeteccion
    case presencia
    case objetivo(distanciaMm: Int, azimutCentesimas: Int?)
    case sinDatos(MotivoSinDatos)
    case radarNoDisponible(SaludRadar)
}

/// Lo que se dice en voz alta. El texto es también la clave para no repetir.
struct Locucion: Equatable {
    let texto: String
}

/// Textos en español. Nunca dicen «camino libre» ni «sin obstáculos» como hecho.
enum TextoAccesorio {
    static func bluetooth(_ d: DisponibilidadBluetooth) -> String {
        switch d {
        case .desconocida: return "Bluetooth: sin consultar todavía."
        case .disponible: return "Bluetooth: disponible."
        case .apagado: return "Bluetooth apagado. Enciéndelo en Ajustes o en el Centro de control."
        case .sinPermiso: return "Sin permiso de Bluetooth. Actívalo en Ajustes, en TransMiVoz."
        case .restringido: return "Bluetooth restringido en este iPhone."
        case .noSoportado: return "Este dispositivo no admite Bluetooth de baja energía."
        }
    }

    static func titulo(_ e: EstadoAccesorio) -> String {
        switch e {
        case .sinAccesorio: return "Sin accesorio"
        case .detenido: return "Detenido"
        case .bluetoothNoDisponible: return "Bluetooth no disponible"
        case .conectando: return "Conectando"
        case .conectado: return "Conectado"
        case .calibrando: return "Calibrando"
        case .enlaceNoVerificado: return "Bloqueado: enlace no verificado"
        case .rechazado: return "Accesorio rechazado"
        case .falla: return "Fallo"
        case .desconectado: return "Desconectado"
        case .sinDeteccion: return "Sin detección"
        case .presencia: return "Presencia"
        case .objetivo: return "Objeto detectado"
        case .sinDatos: return "Sin datos"
        case .radarNoDisponible: return "Radar no disponible"
        }
    }

    static func icono(_ e: EstadoAccesorio) -> String {
        switch e {
        case .sinAccesorio, .detenido: return "pause.circle"
        case .bluetoothNoDisponible, .desconectado: return "wifi.slash"
        case .conectando, .conectado: return "dot.radiowaves.left.and.right"
        case .calibrando: return "slider.horizontal.3"
        case .enlaceNoVerificado, .rechazado, .falla, .radarNoDisponible: return "exclamationmark.triangle"
        case .sinDeteccion, .sinDatos: return "questionmark.circle"
        case .presencia, .objetivo: return "figure.walk"
        }
    }

    static func descripcion(_ e: EstadoAccesorio) -> String {
        switch e {
        case .sinAccesorio:
            return "Ningún accesorio elegido. Busca y elige uno para empezar. No se está midiendo nada."
        case .detenido:
            return "Sesión detenida. No se está midiendo nada."
        case .bluetoothNoDisponible(let d):
            return "\(bluetooth(d)) No hay medidas."
        case .conectando:
            return "Conectando con el accesorio elegido. No hay medidas."
        case .conectado:
            return "Accesorio conectado. Leyendo su información. Aún no hay medidas."
        case .calibrando:
            return "Calibrando: sincronizando el reloj con el accesorio. Aún no hay avisos."
        case .enlaceNoVerificado:
            return frasesEnlaceNoVerificado.joined(separator: " ")
        case .rechazado(let motivo):
            return "Accesorio rechazado (\(motivo.etiqueta)). Sus datos no se usan y esto no es una detección."
        case .falla(let motivo):
            return "\(fallo(motivo)) No hay medidas. Usa Reconectar. \(recuperacionRepetida)"
        case .desconectado:
            return "Accesorio desconectado. Se intenta reconectar. No hay medidas."
        case .sinDeteccion:
            return TextoEstadoSesion.descripcion(.sinBlanco)
        case .presencia:
            return TextoEstadoSesion.descripcion(.presencia)
        case .objetivo(let distanciaMm, let azimut):
            return TextoEstadoSesion.descripcion(.objetivo(distanciaMm: distanciaMm, azimutCentesimas: azimut))
        case .sinDatos(.sinResultado):
            return "El radar todavía no entrega un resultado vigente. No hay medidas."
        case .sinDatos(let motivo):
            return TextoEstadoSesion.descripcion(.sinDatos(motivo))
        case .radarNoDisponible(let salud):
            return TextoEstadoSesion.descripcion(.radarNoDisponible(salud))
        }
    }

    /// Las frases del bloqueo, en orden y en un solo sitio: `descripcion` las une con un espacio y la pantalla pinta una por párrafo.
    private static let frasesEnlaceNoVerificado = [
        "Avisos bloqueados: esta versión no puede verificar que el enlace con el accesorio sea cifrado y autenticado.",
        sinMedidaPorEnlace,
        noEsDeteccionNiCaminoLibre,
    ]

    /// Las dos últimas frases del bloqueo con nombre propio: la Ayuda las repite y no depende de su orden en la lista.
    static let sinMedidaPorEnlace = "No se usa ninguna medida."
    static let noEsDeteccionNiCaminoLibre = "Esto no es una detección ni significa camino libre."

    /// La descripción repartida en párrafos para la pantalla. Solo el bloqueo lleva más de uno: con el texto más grande
    /// de accesibilidad su descripción en un solo bloque medía 869 pt, más que el área visible (659 pt), y no había
    /// posición que la mostrara entera. Los demás estados conservan su descripción tal cual, en un único párrafo.
    static func parrafos(_ e: EstadoAccesorio) -> [String] {
        e == .enlaceNoVerificado ? frasesEnlaceNoVerificado : [descripcion(e)]
    }

    /// El aviso fijo de la pantalla mientras el enlace no se puede verificar, repartido en párrafos. Con el texto más grande
    /// de accesibilidad el aviso en un solo bloque medía 869 pt, más que el área visible (659 pt), y no había posición que
    /// lo mostrara entero. Se corta donde acaba la afirmación; la aclaración entre paréntesis queda con la frase que le sigue.
    /// Unidos con un espacio dan exactamente el texto de siempre: las dos frases, en su orden y con su puntuación.
    static let parrafosAvisoEnlace = [
        "Esta versión todavía no puede verificar que el enlace sea cifrado y autenticado",
        "(falta la prueba con la placa). Por eso bloquea las medidas y los avisos del sensor.",
    ]

    /// Estado del audio para la pantalla. El sistema no distingue unos auriculares Bluetooth de un
    /// altavoz Bluetooth: «privada» no promete auriculares, y el texto lo dice.
    static func audio(ruta: RutaAudio, interrumpido: Bool, audioNoDisponible: Bool = false, vozPropia: Bool = true) -> String {
        if !vozPropia { return "Voz de la app apagada (con VoiceOver activo empieza apagada para no hablar dos veces). Los avisos quedan en pantalla." }
        if interrumpido { return "Audio: interrumpido (llamada u otra app). No se habla." }
        if audioNoDisponible { return "Audio no disponible: el sistema no dejó activar el audio (llamada u otra app en curso). No se habla; el estado queda en pantalla." }
        switch ruta {
        case .privada: return "Audio: salida privada (auriculares con cable o Bluetooth). El iPhone no distingue unos auriculares de un altavoz Bluetooth: comprueba que sean auriculares. Los avisos se dicen en voz alta."
        case .noPrivada: return "Audio: sin auriculares con cable ni Bluetooth. No se habla en voz alta para no sonar en el altavoz; el estado se lee en pantalla."
        case .desconocida: return "Audio: ruta desconocida. No se habla."
        }
    }

    /// Salida si Reconectar no basta: si el sistema nunca avisa del cierre de una conexión cancelada, reconectar
    /// con ese accesorio no puede tener éxito hasta reiniciar el Bluetooth o la app (límite sin probar con hardware).
    static let recuperacionRepetida = "Si vuelve a fallar, apaga y enciende el Bluetooth del iPhone o cierra y abre la app."

    static let audioNoDisponibleAviso = "Audio no disponible: no se pueden decir avisos en voz alta. El estado queda en pantalla."
    static let audioSinAuriculares = "Se perdió la salida privada de audio. Los avisos no se dicen por el altavoz; el estado queda en pantalla."

    /// Anuncio de accesibilidad (VoiceOver, sin mover el foco) de un estado que NO es una medida: bloqueo,
    /// fallo, desconexión, rechazo y Bluetooth. Las medidas y las alertas del sensor (objeto, presencia,
    /// sin detección, sin datos, radar) no se anuncian así: por VoiceOver el sonido puede salir por el
    /// altavoz; esas solo se dicen por la ruta privada de la voz propia y quedan en pantalla.
    static func anuncioAccesible(_ e: EstadoAccesorio) -> String? {
        switch e {
        case .enlaceNoVerificado:
            return "Avisos bloqueados: no se puede verificar la seguridad del enlace. Esto no es una detección."
        case .rechazado:
            return "Accesorio rechazado. Sin avisos."
        case .falla(let motivo):
            return "\(fallo(motivo)) Sin avisos. Usa Reconectar. \(recuperacionRepetida)"
        case .desconectado:
            return "Accesorio desconectado. Se intenta reconectar."
        case .bluetoothNoDisponible(let d):
            return bluetooth(d)
        default:
            return nil
        }
    }

    // MARK: Permiso de Bluetooth (se explica antes del aviso del sistema, EA-02 §8)

    static let permisoBluetoothTitulo = "Permiso de Bluetooth"
    static let permisoBluetoothExplicacion = "TransMiVoz usa Bluetooth para buscar y conectarse al accesorio de proximidad que tú elijas. No lo usa para nada más. A continuación iOS te pedirá permiso."
    static let permisoBluetoothAlternativa = "Si prefieres no darlo, toca «Ahora no»: la consulta y los ajustes del servidor siguen funcionando. Puedes cambiarlo después en Ajustes, en TransMiVoz."

    // MARK: Búsqueda

    static let busquedaPendiente = "La búsqueda sigue pedida. Empieza cuando el Bluetooth esté disponible y la app esté en primer plano."

    private static func fallo(_ m: MotivoFalla) -> String {
        switch m {
        case .conexionFallida: return "No se pudo conectar con el accesorio."
        case .servicioNoEncontrado: return "El accesorio no ofrece el servicio esperado."
        case .errorDeLectura: return "Falló la lectura de datos del accesorio."
        case .errorDeSuscripcion: return "Falló la suscripción a las medidas."
        case .tiempoAgotado: return "El accesorio no respondió a tiempo."
        case .referenciaNoValida: return "No se logró sincronizar con el accesorio."
        }
    }

    /// Texto hablado de cada estado, o nil si no se dice nada. La distancia se redondea
    /// a medio metro y el lado a tres sectores: la exactitud del radar no está
    /// certificada y una cifra más fina sería falsa precisión.
    static func locucion(_ e: EstadoAccesorio) -> Locucion? {
        switch e {
        case .sinAccesorio, .detenido, .conectado: return nil
        case .bluetoothNoDisponible: return Locucion(texto: "Bluetooth no disponible. Sin avisos.")
        case .conectando: return Locucion(texto: "Conectando con el accesorio.")
        case .calibrando: return Locucion(texto: "Accesorio conectado. Calibrando. Aún sin avisos.")
        case .enlaceNoVerificado: return Locucion(texto: "Avisos bloqueados. No se puede verificar la seguridad del enlace.")
        case .rechazado: return Locucion(texto: "Accesorio rechazado. Sin avisos.")
        case .falla: return Locucion(texto: "Fallo del accesorio. Sin avisos.")
        case .desconectado: return Locucion(texto: "Accesorio desconectado.")
        case .sinDeteccion: return Locucion(texto: "Sin detección en este momento.")
        case .presencia: return Locucion(texto: "Presencia detectada.")
        case .sinDatos: return Locucion(texto: "Sin datos del sensor.")
        case .radarNoDisponible: return Locucion(texto: "Radar no disponible.")
        case .objetivo(let distanciaMm, let azimut):
            return Locucion(texto: "Objeto a \(distanciaHablada(distanciaMm))\(ladoHablado(azimut)).")
        }
    }

    static func distanciaHablada(_ distanciaMm: Int) -> String {
        let medios = (distanciaMm + 250) / 500
        if medios == 0 { return "menos de medio metro" }
        let enteros = medios / 2
        if medios % 2 == 1 { return "\(enteros),5 metros" }
        return enteros == 1 ? "1 metro" : "\(enteros) metros"
    }

    private static func ladoHablado(_ azimut: Int?) -> String {
        guard let azimut else { return "" }
        if abs(azimut) < 500 { return ", al frente" }
        return azimut < 0 ? ", a la izquierda" : ", a la derecha"
    }
}

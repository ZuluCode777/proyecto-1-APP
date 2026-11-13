import Foundation

/// Textos en español de los avisos locales (EA-20, #46). La voz, la lista y las pruebas dicen lo mismo. Nunca dicen «sin
/// incidentes»: sin fuente conectada la app no puede saberlo.
enum TextoAvisos {
    // MARK: Avisos de la consulta y de la ubicación (los de la sesión salen de `TextoAccesorio`)

    // Una oración corta cada una: es lo que se dice y lo que se lista, y con el texto más grande debe caber entera en pantalla.
    static let redCaida = "No hay conexión con el servidor."
    static let datosViejos = "Los datos de TransMilenio no están actualizados."
    static let gpsImpreciso = "Tu ubicación es imprecisa."

    // MARK: Lista

    static let titulo = "Avisos"
    static let encabezadoOficiales = "Anuncios oficiales"
    static let encabezadoPropios = "Avisos propios"
    static let encabezadoVoz = "Voz de los avisos"
    static let encabezadoSimulado = "Escenario simulado"

    /// Una frase por párrafo: con el texto más grande cada una cabe entera en el área visible.
    /// Los anuncios oficiales tienen sus textos en `TextoAnuncios` (EA-26).
    static let sinAvisosPropios = [
        "La app no tiene avisos propios ahora.",
        "Esto no es un anuncio oficial ni significa que no haya incidentes.",
    ]
    static let escenarioSimulado = [
        "El Metro es un escenario educativo de infraestructura futura.",
        "No tiene servicio comercial ni genera anuncios.",
        "No es un viaje ni una ruta disponible.",
    ]
    static let avisoModoPruebas = "Modo de pruebas: los avisos de esta pantalla nacen de entradas simuladas."

    /// Solo las advertencias se pueden silenciar: la voz de lo urgente (accesorio, sensor, proximidad) nunca, porque no hay otra
    /// forma no visual de enterarse.
    static let silenciarAdvertencias = "Silenciar avisos de advertencia"
    static let notaSilencio = [
        "Silenciar apaga solo la voz de la red caída, los datos viejos y el GPS impreciso.",
        "Los avisos urgentes (accesorio, sensor y proximidad) no se pueden silenciar.",
        "Los avisos siguen en esta lista y Repetir siempre intenta decirlos en voz alta.",
    ]
    /// La declaración de EA-15 en una oración: la fila de un aviso de la sesión la lleva mientras el enlace no es autenticado.
    static let enlaceSinAutenticar = TextoAccesorio.declaracionEnlaceSinAutenticar

    static let repitiendo = "Repitiendo el aviso."
    static let yaNoVigente = "Ese aviso ya no está vigente, así que no se repite."

    static func tituloDe(_ tipo: TipoAviso) -> String {
        switch tipo {
        case .accesorioPerdido: return "Pérdida del accesorio"
        case .datoVencido: return "Dato vencido"
        case .gpsImpreciso: return "GPS impreciso"
        case .datosViejos: return "Datos viejos"
        case .redCaida: return "Red caída"
        case .proximidad: return "Proximidad"
        }
    }

    static func severidad(_ severidad: PrioridadVoz) -> String {
        switch severidad {
        case .urgente: return "Urgente"
        case .advertencia: return "Advertencia"
        case .rutina: return "Informativo"
        }
    }

    static func origen(_ origen: OrigenAviso) -> String {
        switch origen {
        case .propio: return "Aviso propio"
        case .simulado: return "Escenario simulado"
        }
    }

    /// Una línea con todo lo que no es el texto: severidad, origen y vigencia. Nada depende solo del color.
    static func detalle(_ aviso: Aviso, vigente: Bool) -> String {
        "\(severidad(aviso.tipo.severidad)) · \(origen(aviso.origen)) · \(vigente ? "Vigente" : "Ya no vigente")"
    }

    /// Por qué «Repetir» no se oyó. Una oración corta: el aviso sigue en la lista, que es donde se lee.
    static func noSeDijo(_ motivo: MotivoSilencio) -> String {
        switch motivo {
        case .rutaNoPrivada: return "No se dijo en voz alta: no hay salida privada de audio."
        case .interrumpido: return "No se dijo en voz alta: hay una llamada u otra interrupción."
        case .audioNoDisponible: return "No se dijo en voz alta: el sistema no dejó activar el audio."
        case .vozApagada: return "No se dijo en voz alta: la voz de la app está apagada."
        case .cedeAUnAviso: return "No se dijo en voz alta: suena otro aviso más importante."
        case .severidadSilenciada: return "No se dijo en voz alta: la voz de las advertencias está silenciada."
        }
    }
}

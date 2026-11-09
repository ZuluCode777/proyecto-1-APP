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
            return "Avisos bloqueados: esta versión no puede verificar que el enlace con el accesorio sea cifrado y autenticado. No se usa ninguna medida. Esto no es una detección ni significa camino libre."
        case .rechazado(let motivo):
            return "Accesorio rechazado (\(motivo.etiqueta)). Sus datos no se usan y esto no es una detección."
        case .falla(let motivo):
            return "\(fallo(motivo)) No hay medidas. Usa Reconectar."
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

    static func audio(ruta: RutaAudio, interrumpido: Bool) -> String {
        if interrumpido { return "Audio: interrumpido (llamada u otra app). No se habla." }
        switch ruta {
        case .privada: return "Audio: auriculares. Los avisos se dicen en voz alta."
        case .noPrivada: return "Audio: sin auriculares. No se habla en voz alta para no sonar en el altavoz; el estado se lee en pantalla."
        case .desconocida: return "Audio: ruta desconocida. No se habla."
        }
    }

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

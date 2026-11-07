import Foundation

/// Motivo por el que el texto de la persona no se envía.
enum MotivoEntradaInvalida: Equatable, Sendable {
    case vacia
    case demasiadoLarga(maximo: Int)
}

/// Errores de una consulta al backend, ya clasificados para mostrar y anunciar.
/// Cada caso trae un mensaje claro y una acción de recuperación; nunca el texto
/// crudo del servidor ni ningún dato de credenciales.
enum ErrorConsulta: Error, Equatable, Sendable {
    case entradaInvalida(MotivoEntradaInvalida)
    case servidorNoConfigurado
    /// 401: falta la clave o es incorrecta.
    case noAutorizado
    /// 503: el servidor está cerrado porque no tiene clave configurada.
    case servicioNoDisponible
    /// 429: demasiadas peticiones; `Retry-After` en segundos si vino.
    case demasiadasPeticiones(reintentarEnSegundos: Int?)
    /// 413: el servidor rechazó el mensaje por largo.
    case mensajeRechazadoPorLargo
    /// 400: el servidor no pudo leer la petición.
    case peticionRechazada
    /// Sin conexión: red caída, host inalcanzable o sin datos móviles.
    case sinConexion
    case tiempoAgotado
    /// Falla de TLS: certificado no confiable o conexión no segura.
    case conexionNoSegura
    case redireccionNoPermitida
    case errorDelServidor(estado: Int)
    case respuestaIncompatible
    case cancelada

    /// Mensaje corto para mostrar y anunciar.
    var mensaje: String {
        switch self {
        case .entradaInvalida(.vacia):
            return "Escribe una pregunta antes de enviar."
        case .entradaInvalida(.demasiadoLarga(let maximo)):
            return "La pregunta supera \(maximo) caracteres. Acórtala para enviarla."
        case .servidorNoConfigurado:
            return "Falta la dirección del servidor."
        case .noAutorizado:
            return "El servidor rechazó la clave (401)."
        case .servicioNoDisponible:
            return "El servidor no está disponible: no tiene clave de acceso configurada (503)."
        case .demasiadasPeticiones(let segundos):
            if let segundos {
                return "Demasiadas peticiones seguidas (429). Espera \(segundos) s antes de reintentar."
            }
            return "Demasiadas peticiones seguidas (429). Espera un momento antes de reintentar."
        case .mensajeRechazadoPorLargo:
            return "El servidor rechazó el mensaje por largo (413)."
        case .peticionRechazada:
            return "El servidor no pudo leer la petición (400)."
        case .sinConexion:
            return "No hay conexión con el servidor."
        case .tiempoAgotado:
            return "El servidor no respondió a tiempo."
        case .conexionNoSegura:
            return "No se pudo establecer una conexión segura con el servidor."
        case .redireccionNoPermitida:
            return "El servidor redirigió la petición. Por seguridad la app no la sigue."
        case .errorDelServidor(let estado):
            return "El servidor falló (código \(estado))."
        case .respuestaIncompatible:
            return "La respuesta del servidor no tiene el formato esperado."
        case .cancelada:
            return "Consulta cancelada."
        }
    }

    /// Qué puede hacer la persona para recuperarse.
    var recuperacion: String {
        switch self {
        case .entradaInvalida:
            return "Corrige el texto y vuelve a enviar."
        case .servidorNoConfigurado:
            return "Abre la pestaña Servidor y escribe la dirección HTTPS."
        case .noAutorizado:
            return "Abre la pestaña Servidor y escribe la clave correcta."
        case .servicioNoDisponible:
            return "Avisa a quien administra el servidor. La sesión local sigue disponible."
        case .demasiadasPeticiones:
            return "Espera y pulsa Reintentar."
        case .mensajeRechazadoPorLargo, .peticionRechazada:
            return "Acorta la pregunta y vuelve a enviar."
        case .sinConexion:
            return "Revisa Wi-Fi o datos móviles y pulsa Reintentar. La sesión local sigue disponible."
        case .tiempoAgotado:
            return "Pulsa Reintentar. Si se repite, revisa la conexión."
        case .conexionNoSegura:
            return "Revisa la dirección del servidor y la fecha del iPhone."
        case .redireccionNoPermitida:
            return "Corrige la dirección en la pestaña Servidor."
        case .errorDelServidor, .respuestaIncompatible:
            return "Pulsa Reintentar más tarde."
        case .cancelada:
            return "Puedes volver a enviar la pregunta."
        }
    }

    /// ¿Tiene sentido ofrecer «Reintentar» con el mismo texto?
    var admiteReintento: Bool {
        switch self {
        case .demasiadasPeticiones, .sinConexion, .tiempoAgotado, .errorDelServidor,
             .respuestaIncompatible, .cancelada, .servicioNoDisponible:
            return true
        case .entradaInvalida, .servidorNoConfigurado, .noAutorizado, .mensajeRechazadoPorLargo,
             .peticionRechazada, .conexionNoSegura, .redireccionNoPermitida:
            return false
        }
    }
}

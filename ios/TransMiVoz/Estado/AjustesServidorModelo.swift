import Foundation
import Observation

/// Mensaje de resultado de los ajustes, listo para mostrar y anunciar.
struct MensajeAjustes: Equatable {
    let texto: String
    let esError: Bool
}

/// Origen HTTPS y clave del backend. El origen se recuerda en `UserDefaults`
/// (no es secreto); la clave solo se guarda en el Llavero si la persona lo pide,
/// y siempre asociada a ese origen.
@MainActor
@Observable
final class AjustesServidorModelo {
    static let claveOrigenGuardado = "origenServidor"

    var origenTexto = ""
    var claveTexto = ""
    var recordarClave = false
    private(set) var mensaje: MensajeAjustes?
    private(set) var configuracion: ConfiguracionServidor?

    @ObservationIgnored private let almacen: AlmacenClave
    @ObservationIgnored private let preferencias: UserDefaults

    init(almacen: AlmacenClave, preferencias: UserDefaults = .standard) {
        self.almacen = almacen
        self.preferencias = preferencias
        cargarGuardado()
    }

    /// Solo hay configuración si hay un origen válido aplicado.
    var tieneServidor: Bool { configuracion != nil }

    var resumen: String {
        guard let configuracion else { return "Servidor sin configurar." }
        let clave = configuracion.clave == nil ? "sin clave" : "con clave"
        return "Servidor: \(configuracion.origen.esquemaYAutoridad), \(clave)."
    }

    private func cargarGuardado() {
        guard let guardado = preferencias.string(forKey: Self.claveOrigenGuardado),
              case .success(let origen) = OrigenServidor.analizar(guardado) else { return }
        origenTexto = origen.esquemaYAutoridad
        let clave = (try? almacen.leer(origen: origen)) ?? nil
        recordarClave = clave != nil
        configuracion = ConfiguracionServidor(origen: origen, clave: clave)
    }

    func aplicar() {
        let origen: OrigenServidor
        switch OrigenServidor.analizar(origenTexto) {
        case .failure(let error):
            mensaje = MensajeAjustes(texto: error.mensaje, esError: true)
            return
        case .success(let valido):
            origen = valido
        }

        // Clave nueva escrita; si el campo está vacío se conserva la del mismo origen.
        var clave: ClaveAcceso?
        if !claveTexto.isEmpty {
            clave = ClaveAcceso(valor: claveTexto)
        } else if configuracion?.origen == origen {
            clave = configuracion?.clave
        } else {
            clave = (try? almacen.leer(origen: origen)) ?? nil
        }

        var aviso = ""
        var borradoFallido = false
        do {
            if recordarClave, let clave {
                try almacen.guardar(clave, origen: origen)
            } else if !recordarClave {
                try almacen.borrar(origen: origen)
            }
        } catch {
            if recordarClave {
                aviso = " No se pudo guardar la clave en el Llavero; solo vale hasta cerrar la app."
                recordarClave = false
            } else {
                // El borrado falló: si había una clave guardada SIGUE en el Llavero y se
                // volverá a cargar al abrir la app. No se dice que sea transitoria ni se
                // pierde el reintento: el interruptor queda apagado, así que «Aplicar»
                // otra vez, o «Olvidar clave», vuelven a intentar el borrado.
                borradoFallido = true
                aviso = " No se pudo borrar del Llavero la clave guardada, si había una: seguirá guardada y se volverá a cargar al abrir la app. Pulsa «Aplicar» u «Olvidar clave» para reintentar."
            }
        }

        configuracion = ConfiguracionServidor(origen: origen, clave: clave)
        origenTexto = origen.esquemaYAutoridad
        claveTexto = ""
        preferencias.set(origen.esquemaYAutoridad, forKey: Self.claveOrigenGuardado)

        let estadoClave: String
        if clave == nil { estadoClave = "sin clave" }
        else if borradoFallido { estadoClave = "clave en uso en esta sesión" }
        else if recordarClave { estadoClave = "clave guardada en el Llavero" }
        else { estadoClave = "clave solo en memoria" }
        mensaje = MensajeAjustes(texto: "Servidor aplicado: \(origen.esquemaYAutoridad), \(estadoClave).\(aviso)", esError: !aviso.isEmpty)
    }

    func olvidarClave() {
        guard let configuracion else {
            claveTexto = ""
            mensaje = MensajeAjustes(texto: "No hay clave que olvidar.", esError: false)
            return
        }
        do {
            try almacen.borrar(origen: configuracion.origen)
            self.configuracion = ConfiguracionServidor(origen: configuracion.origen, clave: nil)
            claveTexto = ""
            recordarClave = false
            mensaje = MensajeAjustes(texto: "Clave olvidada.", esError: false)
        } catch {
            mensaje = MensajeAjustes(texto: "No se pudo borrar la clave del Llavero.", esError: true)
        }
    }
}

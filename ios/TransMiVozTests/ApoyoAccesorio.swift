import ContratoBLE
import Foundation
import XCTest
@testable import TransMiVoz

extension RelojFalso {
    /// Fija el reloj a un instante de un escenario de `contratos/ble/sesiones.txt`.
    func fijar(_ instante: Milisegundos) { avanzar(instante - ahora) }
}

/// Doble del transporte: anota las llamadas y deja que la prueba emita eventos con cualquier token.
/// Permite recorrer también la ruta AUTENTICADA, que el transporte real no puede afirmar todavía.
@MainActor
final class TransporteFalso: TransporteAccesorio {
    var receptor: (@MainActor (EventoTransporte, Int) -> Void)?
    var nivelEnlace: NivelEnlace
    private(set) var llamadas: [String] = []
    private(set) var tokenVigente = 0

    init(nivel: NivelEnlace) { nivelEnlace = nivel }

    func buscar() { llamadas.append("buscar") }
    func dejarDeBuscar() { llamadas.append("dejarDeBuscar") }
    func conectar(id: String, token: Int) { llamadas.append("conectar:\(id)"); tokenVigente = token }
    func leerInformacion(token: Int) { llamadas.append("leerInformacion") }
    func fijarNotificaciones(_ activas: Bool, token: Int) { llamadas.append("notificaciones:\(activas)") }
    func leerMedicion(token: Int) { llamadas.append("leerMedicion") }
    func desconectar() { llamadas.append("desconectar") }

    func emitir(_ evento: EventoTransporte, token: Int? = nil) { receptor?(evento, token ?? tokenVigente) }
    func veces(_ llamada: String) -> Int { llamadas.filter { $0 == llamada }.count }
}

@MainActor
final class SalidaVozFalsa: SalidaVoz {
    private(set) var llamadas: [String] = []
    var dicho: [String] { llamadas.compactMap { $0.hasPrefix("hablar:") ? String($0.dropFirst(7)) : nil } }
    var cortes: Int { llamadas.filter { $0 == "detener" }.count }
    func hablar(_ texto: String) { llamadas.append("hablar:\(texto)") }
    func detener() { llamadas.append("detener") }
}

final class RutaFalsa: @unchecked Sendable {
    var valor: RutaAudio
    init(_ valor: RutaAudio) { self.valor = valor }
}

/// Tramas de un escenario de `contratos/ble/sesiones.txt` (los mismos bytes que ejecutan Swift
/// y C++). La prueba solo decide CUÁNDO llegan; qué vale lo decide el contrato.
struct EscenarioBLE {
    enum Accion {
        case info(Data)
        case referencia(inicio: Milisegundos, fin: Milisegundos, Data)
        case entrega(instante: Milisegundos, Data)
    }

    let acciones: [Accion]

    var informaciones: [Data] { acciones.compactMap { if case .info(let d) = $0 { return d } else { return nil } } }
    var referencias: [(inicio: Milisegundos, fin: Milisegundos, datos: Data)] {
        acciones.compactMap { if case .referencia(let i, let f, let d) = $0 { return (i, f, d) } else { return nil } }
    }
    var entregas: [(instante: Milisegundos, datos: Data)] {
        acciones.compactMap { if case .entrega(let t, let d) = $0 { return (t, d) } else { return nil } }
    }

    static func cargar(_ id: String, archivo: String = #filePath) throws -> EscenarioBLE {
        var directorio = URL(fileURLWithPath: archivo)
        for _ in 0..<3 { directorio.deleteLastPathComponent() }
        directorio = directorio.appendingPathComponent("contratos/ble", isDirectory: true)
        if let forzado = ProcessInfo.processInfo.environment["CONTRATOS_BLE_DIR"], !forzado.isEmpty {
            directorio = URL(fileURLWithPath: forzado, isDirectory: true)
        }
        let texto = try String(contentsOf: directorio.appendingPathComponent("sesiones.txt"), encoding: .utf8)
        var dentro = false
        var acciones: [Accion] = []
        for linea in texto.split(separator: "\n", omittingEmptySubsequences: true) {
            let t = linea.split(separator: " ").map(String.init)
            if t.first == "escenario" { dentro = t.count > 1 && t[1] == id; continue }
            guard dentro, t.count >= 3 else { continue }
            switch t[0] {
            case "info": acciones.append(.info(GuionSimulado.datos(t[2])))
            case "referencia": acciones.append(.referencia(inicio: Int64(t[1])!, fin: Int64(t[2])!, GuionSimulado.datos(t[3])))
            case "entrega": acciones.append(.entrega(instante: Int64(t[1])!, GuionSimulado.datos(t[2])))
            default: break
            }
        }
        guard !acciones.isEmpty else { throw NSError(domain: "EscenarioBLE", code: 1, userInfo: [NSLocalizedDescriptionKey: "No se encontró el escenario \(id) en sesiones.txt"]) }
        return EscenarioBLE(acciones: acciones)
    }
}

/// Todo lo que una prueba de la sesión con el accesorio necesita, con relojes y salida de voz falsos.
@MainActor
struct BancoAccesorio {
    let modelo: SesionAccesorioModelo
    let transporte: TransporteFalso
    let salida: SalidaVozFalsa
    let ruta: RutaFalsa
    let reloj: RelojFalso
    let accesorio = AccesorioDetectado(id: "acc-1", nombre: "Visionaria")

    init(nivel: NivelEnlace = .cifradoAutenticado, ruta rutaInicial: RutaAudio = .privada) {
        transporte = TransporteFalso(nivel: nivel)
        salida = SalidaVozFalsa()
        ruta = RutaFalsa(rutaInicial)
        reloj = RelojFalso()
        let rutaCapturada = ruta
        let voz = ControlVoz(salida: salida, consultarRuta: { rutaCapturada.valor })
        let relojCapturado = reloj
        // La pausa del temporizador no vuelve nunca: las pruebas llaman `evaluar()` a mano.
        modelo = SesionAccesorioModelo(
            transporte: transporte, voz: voz, reloj: { relojCapturado.ahora },
            pausa: { _ in try? await Task.sleep(nanoseconds: 3_600_000_000_000) })
        transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
    }

    /// Elige el accesorio e inicia la sesión. Deja la conexión pedida y sin responder.
    func iniciar() {
        modelo.elegir(accesorio)
        modelo.iniciar()
    }

    /// Recorre la sincronización completa con las tramas de un escenario hasta dejar las
    /// notificaciones encendidas.
    func sincronizar(_ escenario: EscenarioBLE, referencia indice: Int = 0) {
        let referencia = escenario.referencias[indice]
        transporte.emitir(.conectado(id: accesorio.id))
        transporte.emitir(.informacion(escenario.informaciones[0]))
        reloj.fijar(referencia.inicio)
        transporte.emitir(.notificacionesFijadas(false))
        reloj.fijar(referencia.fin)
        transporte.emitir(.respuestaMedicion(referencia.datos))
        transporte.emitir(.notificacionesFijadas(true))
    }

    func entregar(_ entrega: (instante: Milisegundos, datos: Data)) {
        reloj.fijar(entrega.instante)
        transporte.emitir(.notificacionMedicion(entrega.datos))
    }
}

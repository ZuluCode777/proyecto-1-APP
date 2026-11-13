#if DEBUG
import Foundation

/// Cliente SIMULADO de anuncios para las pruebas de interfaz: no hace ninguna petición de red ni usa credenciales. Solo
/// existe en compilaciones de depuración. Todo su contenido es inventado y lleva el origen `simulado`: no es un anuncio del
/// operador ni describe ningún cierre, desvío o demora reales.
struct ClienteAnunciosSimulado: ClienteAnuncios {
    enum Escenario: Equatable, Sendable {
        /// Dos anuncios vigentes más uno vencido y uno repetido, que la app debe descartar.
        case lista
        /// La fuente no está conectada y no hay lista.
        case sinFuente
        /// La primera consulta trae la lista; las siguientes fallan sin conexión.
        case caidaTrasExito
    }

    private let escenario: Escenario
    private let contador = ContadorDeConsultas()

    init(escenario: Escenario = .lista) {
        self.escenario = escenario
    }

    func consultar() async throws -> AnunciosRespuesta {
        switch escenario {
        case .lista: return Self.lista
        case .sinFuente: return Self.sinFuente
        case .caidaTrasExito:
            if contador.siguiente() > 1 { throw ErrorConsulta.sinConexion }
            return Self.lista
        }
    }

    private static let entidad = "Simulación de la app"
    private static let consulta = Date(timeIntervalSince1970: 1_794_495_600) // 12/11/2026 10:00 en Bogotá
    private static let publicacion = Date(timeIntervalSince1970: 1_794_495_570)

    private static func fuente(estado: EstadoFuente, confianza: ConfianzaFuente, mensaje: String, conConsulta: Bool) -> FuenteAnuncios {
        FuenteAnuncios(
            estado: estado, confianza: confianza, entidad: entidad, nombre: "Anuncios simulados",
            url: "https://servidor.ejemplo/anuncios-simulados",
            consultadoEn: conConsulta ? consulta : nil, publicadoEn: conConsulta ? publicacion : nil, mensaje: mensaje)
    }

    private static func anuncio(
        _ identificador: String, _ titulo: String, _ descripcion: String, fecha: Date?, hasta: Date?,
        efecto: EfectoAnuncio, rutas: [String]
    ) -> Anuncio {
        Anuncio(
            origen: .simulado, entidad: entidad, identificador: identificador, titulo: titulo, descripcion: descripcion,
            fecha: fecha, vigenciaHasta: hasta, afectacion: AfectacionAnuncio(efecto: efecto, rutas: rutas))
    }

    static let lista: AnunciosRespuesta = {
        let desvio = anuncio(
            "SIM-001", "Desvío de prueba en la ruta Z99", "Anuncio inventado para probar la pantalla.",
            fecha: Date(timeIntervalSince1970: 1_794_488_400), hasta: nil, efecto: .desvio, rutas: ["Z99"])
        return AnunciosRespuesta(
            fuente: fuente(
                estado: .activa, confianza: .media,
                mensaje: "[SIMULADO] Hay 2 anuncios vigentes de demostración. Ninguno viene de un operador real.", conConsulta: true),
            anuncios: [
                desvio,
                anuncio(
                    "SIM-002", "Demoras de prueba en la ruta Z98", "Otro anuncio inventado, con fin de vigencia.",
                    fecha: nil, hasta: Date(timeIntervalSince1970: 4_102_444_740), efecto: .demoras, rutas: []),
                // El servidor no los enviaría: prueban que la app no muestra vencidos ni repetidos.
                anuncio(
                    "SIM-VENCIDO", "Anuncio vencido de prueba", "Ya no está vigente.",
                    fecha: nil, hasta: Date(timeIntervalSince1970: 1_577_836_800), efecto: .sinServicio, rutas: ["Z97"]),
                desvio,
            ])
    }()

    static let sinFuente = AnunciosRespuesta(
        fuente: fuente(
            estado: .sinFuente, confianza: .ninguna,
            mensaje: "[SIMULADO] No hay una fuente de anuncios conectada. \(TextoAnuncios.avisoSinGarantia)", conConsulta: false),
        anuncios: [])
}

/// Cuenta las consultas del cliente simulado (el cliente es un valor, así que el contador vive aparte).
private final class ContadorDeConsultas: @unchecked Sendable {
    private let candado = NSLock()
    private var total = 0

    func siguiente() -> Int {
        candado.lock()
        defer { candado.unlock() }
        total += 1
        return total
    }
}
#endif

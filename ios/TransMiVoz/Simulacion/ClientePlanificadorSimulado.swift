#if DEBUG
import Foundation

/// Planificador SIMULADO para las pruebas de interfaz: no hace ninguna petición de red ni usa credenciales. Solo
/// existe en compilaciones de depuración, activado con `-PRUEBAS_UI_SIMULADAS` (y la variante del accesorio). Los
/// datos son inventados (estaciones «Ejemplo», rutas Z99 y Z98, coordenadas cercanas a ninguna ruta real). Las
/// palabras clave de la búsqueda provocan los errores y el caso vacío; los lugares elegidos, cada estado del viaje.
struct ClientePlanificadorSimulado: ClientePlanificador {
    static let norte = "Estación Ejemplo Norte"
    static let centro = "Estación Ejemplo Centro"
    static let sur = "Estación Ejemplo Sur"

    private static let catalogo = ProcedenciaCatalogo(procedencia: "[SIMULADO] Datos de prueba.", antiguo: false)

    private static let puntoNorte = Coordenada(latitud: 4.7000, longitud: -74.0800)
    private static let puntoCentro = Coordenada(latitud: 4.6500, longitud: -74.0850)
    private static let puntoSur = Coordenada(latitud: 4.6000, longitud: -74.0900)

    func buscarRutas(consulta: String) async throws -> ResultadoBusquedaRutas {
        switch consulta.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "error401": throw ErrorConsulta.noAutorizado
        case "sinred": throw ErrorConsulta.sinConexion
        case "vacio":
            return ResultadoBusquedaRutas(rutas: [], total: 0, catalogo: Self.catalogo)
        default:
            return ResultadoBusquedaRutas(
                rutas: [
                    ResumenRuta(codigo: "Z99", desde: Self.norte, hacia: Self.sur),
                    ResumenRuta(codigo: "Z98", desde: Self.sur, hacia: Self.norte),
                ],
                total: 2, catalogo: Self.catalogo)
        }
    }

    func detalleRuta(codigo: String) async throws -> DetalleRuta {
        switch codigo.uppercased() {
        case "Z99":
            return Self.detalle(codigo: "Z99", sentido: .confirmado, calendario: .opera, verificadas: true)
        case "Z98":
            return Self.detalle(codigo: "Z98", sentido: .sinConfirmar, calendario: .sinVerificar, verificadas: false)
        default:
            throw ErrorConsulta.noEncontrado
        }
    }

    func listarLugares() async throws -> ListaLugares {
        ListaLugares(lugares: [Self.centro, Self.norte, Self.sur], catalogo: Self.catalogo)
    }

    func planearViaje(origen: String, destino: String) async throws -> PlanViaje {
        if origen == destino {
            return PlanViaje(
                origen: origen, destino: destino, resultado: .mismoLugar, tramos: [], rutasPorElTrazado: [],
                catalogo: Self.catalogo)
        }
        if origen == Self.norte && destino == Self.sur {
            let tramo = TramoPlan(
                codigoRuta: "Z99",
                abordaje: ParadaViaje(nombre: Self.norte, coordenada: Self.puntoNorte),
                descenso: ParadaViaje(nombre: Self.sur, coordenada: Self.puntoSur),
                estacionesRecorridas: 3, conteoVerificado: true,
                trazado: [Self.puntoNorte, Self.puntoCentro, Self.puntoSur])
            return PlanViaje(
                origen: origen, destino: destino, resultado: .operativo, tramos: [tramo], rutasPorElTrazado: [],
                catalogo: Self.catalogo)
        }
        if origen == Self.centro && destino == Self.sur {
            // Operación sin confirmar: solo el código de la ruta, sin paradas ni mapa.
            return PlanViaje(
                origen: origen, destino: destino, resultado: .candidato, codigosCandidatos: ["Z99"], catalogo: Self.catalogo)
        }
        return PlanViaje(
            origen: origen, destino: destino, resultado: .recorrido, tramos: [],
            rutasPorElTrazado: [ResumenRuta(codigo: "Z98", desde: Self.sur, hacia: Self.norte)],
            catalogo: Self.catalogo)
    }

    private static func detalle(
        codigo: String, sentido: SentidoRuta, calendario: CalendarioRuta, verificadas: Bool
    ) -> DetalleRuta {
        DetalleRuta(
            codigo: codigo, etiqueta: "[SIMULADO] \(norte) hacia \(sur)", desde: norte, hacia: sur,
            sentido: sentido, calendario: calendario,
            horario: HorarioRuta(entreSemana: "5:00 a. m. - 11:00 p. m.", sabado: "", festivo: ""),
            estaciones: [
                EstacionRuta(nombre: norte, coordenada: puntoNorte, paradaVerificada: verificadas),
                EstacionRuta(nombre: centro, coordenada: puntoCentro, paradaVerificada: verificadas),
                EstacionRuta(nombre: sur, coordenada: puntoSur, paradaVerificada: verificadas),
            ],
            trazado: [puntoNorte, puntoCentro, puntoSur], catalogo: catalogo)
    }
}
#endif

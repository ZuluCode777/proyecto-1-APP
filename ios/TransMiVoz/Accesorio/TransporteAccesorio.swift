import ContratoBLE
import Foundation

/// Estado del Bluetooth del iPhone, ya traducido del sistema. Cada valor tiene
/// un mensaje propio: nunca se confunde «sin permiso» con «apagado».
enum DisponibilidadBluetooth: Equatable {
    /// Todavía no se ha consultado o el sistema está reiniciando el Bluetooth.
    case desconocida
    case disponible
    case apagado
    case sinPermiso
    case restringido
    case noSoportado
}

/// Accesorio visto en el escaneo filtrado por el UUID del servicio. El nombre
/// anunciado y el identificador NO autentican al accesorio (contrato §1).
struct AccesorioDetectado: Equatable, Identifiable {
    /// Identificador del periférico en este iPhone (UUID local, no del accesorio).
    let id: String
    let nombre: String?

    var etiqueta: String {
        "\(nombre ?? "Accesorio sin nombre") (\(id.suffix(4)))"
    }
}

enum MotivoFalla: Equatable {
    case conexionFallida
    case servicioNoEncontrado
    case errorDeLectura
    case errorDeSuscripcion
    case tiempoAgotado
    case referenciaNoValida
    /// La lectura protegida de comprobación no terminó bien: emparejamiento fallido o cancelado, alta
    /// cerrada en el accesorio, corte o tiempo agotado. No se reintenta sola.
    case enlaceSeguroFallido
    /// iOS conserva un vínculo que el accesorio ya no tiene (`CBError.peerRemovedPairingInformation`).
    case vinculoBorradoEnAccesorio
}

/// Lo que el transporte le cuenta a la sesión. Core Bluetooth entrega lecturas y
/// notificaciones por el mismo callback; el transporte ya las distingue
/// (`ClasificadorValores`) y entrega cada una con su evento.
enum EventoTransporte: Equatable {
    case disponibilidad(DisponibilidadBluetooth)
    case encontrado(AccesorioDetectado)
    /// Enlace establecido y servicio con sus dos características descubiertos.
    case conectado(id: String)
    /// Respuesta a `comprobarEnlace`: la lectura protegida de comprobación de esta conexión terminó sin error.
    /// Por sí sola no afirma cifrado ni autenticación: el nivel que permite afirmar lo da `nivelEnlace`.
    case lecturaProtegidaSuperada
    case informacion(Data)
    case notificacionesFijadas(Bool)
    /// Respuesta a `leerMedicion`: la lectura fresca de referencia.
    case respuestaMedicion(Data)
    case notificacionMedicion(Data)
    case desconectado
    case fallo(MotivoFalla)
}

/// Token de los eventos que no pertenecen a una conexión (disponibilidad, escaneo).
let tokenSinConexion = 0

/// Frontera con Core Bluetooth. Todas las llamadas y todos los eventos ocurren en el hilo
/// principal. Cada evento de una conexión lleva el `token` con el que la sesión
/// pidió esa conexión; la sesión descarta los de cualquier otro token. Los eventos
/// de disponibilidad y de escaneo llevan `tokenSinConexion`.
@MainActor
protocol TransporteAccesorio: AnyObject {
    var receptor: (@MainActor (EventoTransporte, Int) -> Void)? { get set }
    /// Nivel de seguridad que el transporte puede AFIRMAR de la conexión vigente. Core Bluetooth no lo expone: el
    /// transporte de producción devuelve `.desconocido` salvo que la lectura protegida de comprobación de ESA
    /// conexión haya terminado sin error, y entonces afirma como mucho `.cifradoSinAutenticar`
    /// (`EvidenciaEnlace`, contrato §6). La sesión lo consulta al recibir `.lecturaProtegidaSuperada`.
    var nivelEnlace: NivelEnlace { get }
    /// El sistema todavía no ha preguntado a la persona por el permiso de Bluetooth. Consultarlo no
    /// lo provoca. La app lo usa para explicar el permiso ANTES de que aparezca el aviso del sistema.
    var permisoPorPreguntar: Bool { get }
    func buscar()
    func dejarDeBuscar()
    /// Pide la conexión. Si el cierre de una anterior con el mismo periférico sigue en curso, espera su
    /// aviso (el plazo lo vigila la sesión). Todo evento de esta conexión lleva este `token`.
    func conectar(id: String, token: Int)
    /// Lectura protegida de comprobación (Información), antes de afirmar ningún nivel. Si el enlace no está
    /// protegido, iOS empareja por su cuenta y puede pedir la clave a la persona. Termina con
    /// `.lecturaProtegidaSuperada` o con `.fallo`; su valor no se entrega.
    func comprobarEnlace(token: Int)
    func leerInformacion(token: Int)
    func fijarNotificaciones(_ activas: Bool, token: Int)
    /// Lectura fresca de Medición. Solo con las notificaciones apagadas.
    func leerMedicion(token: Int)
    func desconectar()
}

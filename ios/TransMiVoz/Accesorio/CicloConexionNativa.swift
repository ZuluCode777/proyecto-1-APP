import Foundation

/// Dueño de «qué conexión nativa vale» y de cuándo se puede abrir otra con el MISMO periférico.
/// No toca Core Bluetooth: solo identificadores (el UUID del periférico en texto) y tokens, para
/// que `TransporteCoreBluetooth` lo use tal cual y las pruebas lo recorran sin fabricar objetos del sistema.
///
/// Por qué existe. `cancelPeripheralConnection(_:)` no es síncrono: la documentación de Apple dice
/// que el periférico se considera desconectado y que el gestor llamará después a
/// `centralManager(_:didDisconnectPeripheral:error:)`, también si la conexión estaba solo pendiente.
/// Core Bluetooth reutiliza el MISMO `CBPeripheral` al volver a conectar. Si se abre una conexión nueva
/// antes de ese aviso, el `didDisconnect` (o `didFailToConnect`) de la conexión vieja llega con el
/// periférico vigente y se confundiría con un corte de la nueva (y se le pondría el token nuevo).
///
/// Reglas:
/// - un cierre pedido sobre un periférico activo queda en `cerrando` hasta que llegue su aviso final;
/// - mientras `cerrando` lo contenga, pedir de nuevo ese periférico NO abre: queda `pendiente` y se abre
///   al llegar el aviso (que se consume, no se reenvía a la sesión);
/// - todo evento de la conexión lleva el token con el que se ABRIÓ, nunca «el vigente de ahora»;
/// - un periférico que no es el vigente, o cuya conexión ya terminó, no cuenta (`vale`).
///
/// La espera no es indefinida: la sesión (`SesionAccesorioModelo`) vigila el plazo de la conexión y, si el
/// sistema no avisara, la persona ve «el accesorio no respondió a tiempo». Si el Bluetooth se apaga,
/// `reiniciar()` olvida todo (el sistema ya cortó todas las conexiones).
struct CicloConexionNativa {
    enum Orden: Equatable {
        case abrir(id: String)
        case cerrar(id: String)
    }

    enum Final: Equatable {
        /// Aviso de un cierre que nosotros pedimos, o de un periférico que no vale: no llega a la sesión.
        case ignorar
        /// La conexión vigente terminó sola: se avisa a la sesión con SU token.
        case avisar(token: Int)
        /// Terminó el cierre pendiente y ahora sí se abre la conexión que esperaba.
        case abrir(id: String, token: Int)
    }

    struct Vigente: Equatable {
        let id: String
        let token: Int
        var terminada = false
    }

    struct Pendiente: Equatable {
        let id: String
        let token: Int
    }

    private(set) var vigente: Vigente?
    private(set) var cerrando: Set<String> = []
    private(set) var pendiente: Pendiente?

    /// Token de la conexión que vale ahora, si la hay.
    var token: Int? { vigente?.terminada == false ? vigente?.token : nil }

    /// Es el periférico de la conexión vigente y esta no ha terminado.
    func vale(_ id: String) -> Bool { vigente?.id == id && vigente?.terminada == false }

    /// Hay una conexión con ese token, abierta o esperando su turno (llamada repetida: idempotente).
    func atiende(token pedido: Int) -> Bool {
        (vigente?.token == pedido && vigente?.terminada == false) || pendiente?.token == pedido
    }

    /// Pide una conexión nueva. El llamador cerró antes la vigente (`cerrar`).
    mutating func pedir(id: String, token: Int) -> [Orden] {
        pendiente = nil
        if cerrando.contains(id) {
            pendiente = Pendiente(id: id, token: token)
            return []
        }
        vigente = Vigente(id: id, token: token)
        return [.abrir(id: id)]
    }

    /// Cierra la conexión vigente. `nativoActivo`: el periférico no está en `.disconnected` (conectado,
    /// conectando o cerrándose); solo entonces el sistema avisará del cierre.
    mutating func cerrar(nativoActivo: Bool) -> [Orden] {
        pendiente = nil
        guard let actual = vigente else { return [] }
        vigente = nil
        guard !actual.terminada, nativoActivo else { return [] }
        cerrando.insert(actual.id)
        return [.cerrar(id: actual.id)]
    }

    /// `didDisconnectPeripheral` o `didFailToConnect` de ese periférico.
    mutating func terminal(_ id: String) -> Final {
        if cerrando.remove(id) != nil {
            guard let espera = pendiente, espera.id == id else { return .ignorar }
            pendiente = nil
            vigente = Vigente(id: espera.id, token: espera.token)
            return .abrir(id: espera.id, token: espera.token)
        }
        guard var actual = vigente, actual.id == id, !actual.terminada else { return .ignorar }
        actual.terminada = true
        vigente = actual
        return .avisar(token: actual.token)
    }

    /// El sistema cortó todo (Bluetooth apagado o reiniciándose).
    mutating func reiniciar() {
        self = CicloConexionNativa()
    }
}

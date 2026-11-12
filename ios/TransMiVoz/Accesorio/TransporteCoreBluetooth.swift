import ContratoBLE
import CoreBluetooth
import Foundation

/// Transporte de producción sobre Core Bluetooth (central). Solo mueve bytes del contrato v1.0
/// con los UUID de `IdentificadoresBLE`; qué trama vale lo decide `SesionProximidad`.
///
/// - El gestor se crea al primer uso (buscar o conectar), no al arrancar la app: así el aviso de
///   permiso de Bluetooth del sistema aparece cuando la persona lo pide.
/// - Solo hay una conexión vigente. Qué conexión vale, con qué token y cuándo se puede abrir otra con el
///   mismo periférico lo decide `CicloConexionNativa` (probado sin Core Bluetooth). Aquí solo se traducen
///   sus órdenes a llamadas del sistema y los avisos del sistema a sus preguntas.
/// - `cancelPeripheralConnection` es asíncrono y Core Bluetooth reutiliza el mismo `CBPeripheral`: una
///   reconexión al mismo periférico espera el aviso de cierre de la anterior, y ese aviso no llega a la sesión.
/// - Un aviso de servicio, característica o valor solo cuenta si es del periférico vigente Y del objeto
///   (servicio y características) que se descubrió en ESTA conexión.
/// - Todos los callbacks llegan en la cola principal.
@MainActor
final class TransporteCoreBluetooth: TransporteAccesorio {
    var receptor: (@MainActor (EventoTransporte, Int) -> Void)?

    /// Core Bluetooth NO expone el nivel de seguridad del enlace, y ni un nombre, un UUID ni una propiedad de la
    /// característica prueban cifrado ni autenticación. La regla está en un solo sitio, `ComprobacionEnlace`:
    /// `.desconocido` salvo que la lectura protegida de comprobación de la conexión vigente haya terminado sin error,
    /// y entonces `.cifradoSinAutenticar`. Nunca `.cifradoAutenticado`: un impostor sin protección también supera la
    /// lectura (riesgo aceptado por A1 el 12/11/2026 para la feria, con la política demo). No hay ajuste, bandera ni
    /// preferencia que lo cambie.
    var nivelEnlace: NivelEnlace { comprobacion.nivel(vigente: ciclo.token) }

    /// Leer la autorización no la provoca (a diferencia de crear el gestor).
    var permisoPorPreguntar: Bool { CBManager.authorization == .notDetermined }

    private let servicio = CBUUID(string: IdentificadoresBLE.servicio)
    private let uuidInformacion = CBUUID(string: IdentificadoresBLE.caracteristicaInformacion)
    private let uuidMedicion = CBUUID(string: IdentificadoresBLE.caracteristicaMedicion)

    private let delegado = DelegadoCoreBluetooth()
    private var gestor: CBCentralManager?
    /// Periféricos vistos o recuperados, por UUID en texto. El sistema no retiene los periféricos.
    private var conocidos: [String: CBPeripheral] = [:]
    private var ciclo = CicloConexionNativa()
    private var servicioVigente: CBService?
    private var informacion: CBCharacteristic?
    private var medicion: CBCharacteristic?
    private var informacionPedida = false
    private var clasificador = ClasificadorValores()
    private var comprobacion = ComprobacionEnlace()

    init() {
        delegado.duenio = self
    }

    // MARK: TransporteAccesorio

    func buscar() {
        guard let gestor = gestorListo() else { return }
        gestor.scanForPeripherals(withServices: [servicio], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func dejarDeBuscar() {
        guard let gestor, gestor.state == .poweredOn else { return }
        gestor.stopScan()
    }

    func conectar(id: String, token nuevo: Int) {
        guard let uuid = UUID(uuidString: id) else {
            receptor?(.fallo(.conexionFallida), nuevo)
            return
        }
        guard let gestor = gestorListo() else { return }
        // Idempotente: la misma conexión pedida otra vez mientras sigue en curso o esperando.
        if ciclo.atiende(token: nuevo) { return }
        cerrarVigente()
        guard let destino = conocidos[id] ?? gestor.retrievePeripherals(withIdentifiers: [uuid]).first else {
            receptor?(.fallo(.conexionFallida), nuevo)
            return
        }
        conocidos[id] = destino
        destino.delegate = delegado
        ejecutar(ciclo.pedir(id: id, token: nuevo))
    }

    func comprobarEnlace(token pedido: Int) {
        guard pedido == ciclo.token, let periferico = perifericoVigente(), let informacion else { return }
        comprobacion.pedir(token: pedido)
        // El firmware genuino rechaza esta lectura sin enlace cifrado y autenticado; iOS empareja y la repite.
        periferico.readValue(for: informacion)
    }

    func leerInformacion(token pedido: Int) {
        guard pedido == ciclo.token, let periferico = perifericoVigente(), let informacion else { return }
        informacionPedida = true
        periferico.readValue(for: informacion)
    }

    func fijarNotificaciones(_ activas: Bool, token pedido: Int) {
        guard pedido == ciclo.token, let periferico = perifericoVigente(), let medicion else { return }
        switch clasificador.pedirNotificaciones(activas, activasEnSistema: medicion.isNotifying) {
        case .pedir:
            periferico.setNotifyValue(activas, for: medicion)
        case .yaEstaba:
            // Sin cambio de estado el sistema puede no avisar. Se confirma con un salto al siguiente turno
            // (como un aviso real) y solo si la conexión sigue siendo la misma.
            Task { @MainActor [weak self] in
                guard let self, pedido == self.ciclo.token else { return }
                self.receptor?(.notificacionesFijadas(activas), pedido)
            }
        }
    }

    func leerMedicion(token pedido: Int) {
        guard pedido == ciclo.token, let periferico = perifericoVigente(), let medicion else { return }
        // Con notificaciones activas no se podría distinguir la respuesta: se rechaza.
        guard clasificador.pedirLectura() else { avisar(.fallo(.errorDeLectura)); return }
        periferico.readValue(for: medicion)
    }

    func desconectar() {
        cerrarVigente()
    }

    // MARK: Gestor

    /// Crea el gestor si hace falta y lo devuelve solo si el Bluetooth está encendido y autorizado.
    /// Si no, la petición se pierde: la sesión la repite al recibir `.disponibilidad(.disponible)`.
    private func gestorListo() -> CBCentralManager? {
        if gestor == nil {
            gestor = CBCentralManager(delegate: delegado, queue: .main)
        }
        return gestor?.state == .poweredOn ? gestor : nil
    }

    private func perifericoVigente() -> CBPeripheral? {
        ciclo.vigente.flatMap { conocidos[$0.id] }
    }

    private func ejecutar(_ ordenes: [CicloConexionNativa.Orden]) {
        for orden in ordenes {
            switch orden {
            case .abrir(let id):
                if let destino = conocidos[id] {
                    destino.delegate = delegado
                    gestor?.connect(destino, options: nil)
                }
            case .cerrar(let id):
                if let destino = conocidos[id] { gestor?.cancelPeripheralConnection(destino) }
            }
        }
    }

    /// Cierra la conexión vigente (si la hay) y olvida lo descubierto en ella. El cierre nativo es
    /// asíncrono: `ciclo` recuerda que el aviso final está pendiente.
    private func cerrarVigente() {
        let destino = perifericoVigente()
        destino?.delegate = nil
        let activo = destino.map { $0.state != .disconnected } ?? false
        let ordenes = ciclo.cerrar(nativoActivo: activo)
        olvidarDescubierto()
        ejecutar(ordenes)
    }

    private func olvidarDescubierto() {
        servicioVigente = nil
        informacion = nil
        medicion = nil
        informacionPedida = false
        clasificador.reiniciar()
        comprobacion.reiniciar()
    }

    /// Los eventos de una conexión llevan SIEMPRE el token con el que se abrió, no el de «ahora».
    private func avisar(_ evento: EventoTransporte) {
        guard let token = ciclo.token else { return }
        receptor?(evento, token)
    }

    // MARK: Callbacks (reenviados desde `DelegadoCoreBluetooth`, ya en el hilo principal)

    fileprivate func cambioDeEstado(_ estado: CBManagerState, restringido: Bool) {
        let disponibilidad: DisponibilidadBluetooth
        switch estado {
        case .poweredOn: disponibilidad = .disponible
        case .poweredOff: disponibilidad = .apagado
        case .unauthorized: disponibilidad = restringido ? .restringido : .sinPermiso
        case .unsupported: disponibilidad = .noSoportado
        default: disponibilidad = .desconocida
        }
        if disponibilidad != .disponible {
            // El sistema corta todas las conexiones: nada de lo anterior sigue vigente ni espera aviso.
            ciclo.reiniciar()
            olvidarDescubierto()
            conocidos = [:]
        }
        receptor?(.disponibilidad(disponibilidad), tokenSinConexion)
    }

    fileprivate func descubierto(_ p: CBPeripheral, nombreAnunciado: String?) {
        conocidos[p.identifier.uuidString] = p
        let accesorio = AccesorioDetectado(id: p.identifier.uuidString, nombre: nombreAnunciado ?? p.name)
        receptor?(.encontrado(accesorio), tokenSinConexion)
    }

    fileprivate func conectado(_ p: CBPeripheral) {
        guard ciclo.vale(p.identifier.uuidString) else { return }
        p.discoverServices([servicio])
    }

    /// Si el sistema dijo que falló el enlace seguro (p. ej. el accesorio borró el vínculo), es un fallo con su
    /// recuperación, no una desconexión que se reintenta sola.
    fileprivate func fallaLaConexion(_ p: CBPeripheral, resultado: ResultadoSistema) {
        finalDeConexion(p, evento: ComprobacionEnlace.eventoDeCorte(motivoEnlace: resultado.motivoEnlace, fallaAlConectar: true))
    }

    fileprivate func desconectado(_ p: CBPeripheral, resultado: ResultadoSistema) {
        finalDeConexion(p, evento: ComprobacionEnlace.eventoDeCorte(motivoEnlace: resultado.motivoEnlace, fallaAlConectar: false))
    }

    /// `didDisconnect` / `didFailToConnect`: o es el aviso del cierre que pedimos (se consume y, si había una
    /// conexión esperando, se abre), o es el final de la conexión vigente (se avisa con su token).
    private func finalDeConexion(_ p: CBPeripheral, evento: EventoTransporte) {
        switch ciclo.terminal(p.identifier.uuidString) {
        case .ignorar:
            break
        case .abrir(let id, _):
            ejecutar([.abrir(id: id)])
        case .avisar(let token):
            olvidarDescubierto()
            receptor?(evento, token)
        }
    }

    fileprivate func serviciosDescubiertos(_ p: CBPeripheral, huboError: Bool) {
        guard ciclo.vale(p.identifier.uuidString) else { return }
        guard !huboError, let encontrado = p.services?.first(where: { $0.uuid == servicio }) else {
            avisar(.fallo(.servicioNoEncontrado))
            return
        }
        servicioVigente = encontrado
        p.discoverCharacteristics([uuidInformacion, uuidMedicion], for: encontrado)
    }

    fileprivate func caracteristicasDescubiertas(_ p: CBPeripheral, de s: CBService, huboError: Bool) {
        guard ciclo.vale(p.identifier.uuidString), s === servicioVigente else { return }
        informacion = s.characteristics?.first { $0.uuid == uuidInformacion }
        medicion = s.characteristics?.first { $0.uuid == uuidMedicion }
        guard !huboError, informacion != nil, medicion != nil else {
            avisar(.fallo(.servicioNoEncontrado))
            return
        }
        avisar(.conectado(id: p.identifier.uuidString))
    }

    fileprivate func valorActualizado(_ p: CBPeripheral, _ c: CBCharacteristic, resultado: ResultadoSistema) {
        guard ciclo.vale(p.identifier.uuidString) else { return }
        let valor = resultado.huboError ? nil : c.value
        // Solo las características descubiertas en esta conexión (no un objeto viejo con el mismo UUID).
        if c === informacion {
            // La lectura de comprobación va primero y su valor se descarta: la sesión lee la Información después.
            if let evento = comprobacion.eventoDeLectura(valor: valor, motivoEnlace: resultado.motivoEnlace, vigente: ciclo.token) {
                avisar(evento)
                return
            }
            guard informacionPedida else { return }
            informacionPedida = false
            if let valor { avisar(.informacion(valor)) } else { avisar(.fallo(resultado.motivo(respaldo: .errorDeLectura))) }
        } else if c === medicion {
            // Lectura y notificación llegan por aquí; el clasificador las separa.
            switch clasificador.recibirValor(conError: valor == nil) {
            case .respuestaLectura: if let valor { avisar(.respuestaMedicion(valor)) }
            case .notificacion: if let valor { avisar(.notificacionMedicion(valor)) }
            case .falloLectura: avisar(.fallo(resultado.motivo(respaldo: .errorDeLectura)))
            case .descartar: break
            }
        }
    }

    fileprivate func notificacionesActualizadas(_ p: CBPeripheral, _ c: CBCharacteristic, resultado: ResultadoSistema) {
        guard ciclo.vale(p.identifier.uuidString), c === medicion else { return }
        if resultado.huboError {
            avisar(.fallo(resultado.motivo(respaldo: .errorDeSuscripcion)))
            return
        }
        clasificador.confirmarNotificaciones(c.isNotifying)
        avisar(.notificacionesFijadas(c.isNotifying))
    }
}

/// Core Bluetooth exige un NSObject no aislado como delegado; reenvía al transporte en el hilo
/// principal (la cola del gestor).
private final class DelegadoCoreBluetooth: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    weak var duenio: TransporteCoreBluetooth?

    private func enPrincipal(_ accion: @MainActor (TransporteCoreBluetooth) -> Void) {
        MainActor.assumeIsolated { if let duenio { accion(duenio) } }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let estado = central.state
        let restringido = CBManager.authorization == .restricted
        enPrincipal { $0.cambioDeEstado(estado, restringido: restringido) }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let nombre = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        enPrincipal { $0.descubierto(peripheral, nombreAnunciado: nombre) }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        enPrincipal { $0.conectado(peripheral) }
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        let resultado = ResultadoSistema(error: error)
        enPrincipal { $0.fallaLaConexion(peripheral, resultado: resultado) }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let resultado = ResultadoSistema(error: error)
        enPrincipal { $0.desconectado(peripheral, resultado: resultado) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        let huboError = error != nil
        enPrincipal { $0.serviciosDescubiertos(peripheral, huboError: huboError) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        let huboError = error != nil
        enPrincipal { $0.caracteristicasDescubiertas(peripheral, de: service, huboError: huboError) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        let resultado = ResultadoSistema(error: error)
        enPrincipal { $0.valorActualizado(peripheral, characteristic, resultado: resultado) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        let resultado = ResultadoSistema(error: error)
        enPrincipal { $0.notificacionesActualizadas(peripheral, characteristic, resultado: resultado) }
    }
}

/// Lo único que el transporte conserva de un `Error?` de Core Bluetooth: si hubo error y, si es del enlace seguro, su
/// motivo (`ComprobacionEnlace.motivo(de:)`). Los avisos del sistema llegan en un hilo y se reenvían al principal ya
/// reducidos a este valor.
struct ResultadoSistema: Equatable {
    let huboError: Bool
    let motivoEnlace: MotivoFalla?

    init(error: Error?) {
        huboError = error != nil
        motivoEnlace = ComprobacionEnlace.motivo(de: error)
    }

    /// El motivo del enlace seguro si lo hay; si no, el que corresponde a la operación que falló.
    func motivo(respaldo: MotivoFalla) -> MotivoFalla { motivoEnlace ?? respaldo }
}

import ContratoBLE
import CoreBluetooth
import Foundation

/// Transporte de producción sobre Core Bluetooth (central). Solo mueve bytes del contrato v1.0
/// con los UUID de `IdentificadoresBLE`; qué trama vale lo decide `SesionProximidad`.
///
/// - El gestor se crea al primer uso (buscar o conectar), no al arrancar la app: así el aviso de
///   permiso de Bluetooth del sistema aparece cuando la persona lo pide.
/// - Solo hay un periférico vigente. Todo callback de otro periférico, o llegado tras
///   `desconectar`, se ignora.
/// - Todos los callbacks llegan en la cola principal.
@MainActor
final class TransporteCoreBluetooth: TransporteAccesorio {
    var receptor: (@MainActor (EventoTransporte, Int) -> Void)?

    /// Core Bluetooth NO expone el nivel de seguridad del enlace, y ni un nombre, un UUID, una
    /// lectura que funcione ni una propiedad de la característica prueban cifrado ni
    /// autenticación. Hasta tener evidencia con la placa y el iPhone (contrato §6, EA-12) este
    /// transporte afirma `.desconocido` y la sesión rechaza el enlace. No hay ajuste que lo cambie.
    var nivelEnlace: NivelEnlace { .desconocido }

    private let servicio = CBUUID(string: IdentificadoresBLE.servicio)
    private let uuidInformacion = CBUUID(string: IdentificadoresBLE.caracteristicaInformacion)
    private let uuidMedicion = CBUUID(string: IdentificadoresBLE.caracteristicaMedicion)

    private let delegado = DelegadoCoreBluetooth()
    private var gestor: CBCentralManager?
    private var descubiertos: [UUID: CBPeripheral] = [:]
    private var periferico: CBPeripheral?
    private var token = tokenSinConexion
    private var informacion: CBCharacteristic?
    private var medicion: CBCharacteristic?
    private var informacionPedida = false
    private var clasificador = ClasificadorValores()

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
        guard let gestor = gestorListo(), let uuid = UUID(uuidString: id) else { return }
        // Idempotente: misma conexión pedida otra vez mientras sigue en curso.
        if nuevo == token, periferico?.identifier == uuid, periferico?.state != CBPeripheralState.disconnected { return }
        olvidarPeriferico()
        guard let destino = descubiertos[uuid] ?? gestor.retrievePeripherals(withIdentifiers: [uuid]).first else {
            token = nuevo
            avisar(.fallo(.conexionFallida))
            return
        }
        token = nuevo
        periferico = destino
        destino.delegate = delegado
        gestor.connect(destino, options: nil)
    }

    func leerInformacion(token pedido: Int) {
        guard pedido == token, let periferico, let informacion else { return }
        informacionPedida = true
        periferico.readValue(for: informacion)
    }

    func fijarNotificaciones(_ activas: Bool, token pedido: Int) {
        guard pedido == token, let periferico, let medicion else { return }
        periferico.setNotifyValue(activas, for: medicion)
    }

    func leerMedicion(token pedido: Int) {
        guard pedido == token, let periferico, let medicion else { return }
        // Con notificaciones activas no se podría distinguir la respuesta: se rechaza.
        guard clasificador.pedirLectura() else { avisar(.fallo(.errorDeLectura)); return }
        periferico.readValue(for: medicion)
    }

    func desconectar() {
        olvidarPeriferico()
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

    private func olvidarPeriferico() {
        if let periferico {
            periferico.delegate = nil
            if let gestor, gestor.state == .poweredOn { gestor.cancelPeripheralConnection(periferico) }
        }
        periferico = nil
        informacion = nil
        medicion = nil
        informacionPedida = false
        clasificador.reiniciar()
    }

    private func avisar(_ evento: EventoTransporte) {
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
            // El sistema corta todas las conexiones: nada de lo anterior sigue vigente.
            olvidarPeriferico()
            descubiertos = [:]
        }
        receptor?(.disponibilidad(disponibilidad), tokenSinConexion)
    }

    fileprivate func descubierto(_ p: CBPeripheral, nombreAnunciado: String?) {
        descubiertos[p.identifier] = p
        let accesorio = AccesorioDetectado(id: p.identifier.uuidString, nombre: nombreAnunciado ?? p.name)
        receptor?(.encontrado(accesorio), tokenSinConexion)
    }

    fileprivate func conectado(_ p: CBPeripheral) {
        guard p === periferico else { return }
        p.discoverServices([servicio])
    }

    fileprivate func fallaLaConexion(_ p: CBPeripheral) {
        guard p === periferico else { return }
        avisar(.fallo(.conexionFallida))
    }

    fileprivate func desconectado(_ p: CBPeripheral) {
        guard p === periferico else { return }
        olvidarPeriferico()
        avisar(.desconectado)
    }

    fileprivate func serviciosDescubiertos(_ p: CBPeripheral, huboError: Bool) {
        guard p === periferico else { return }
        guard !huboError, let encontrado = p.services?.first(where: { $0.uuid == servicio }) else {
            avisar(.fallo(.servicioNoEncontrado))
            return
        }
        p.discoverCharacteristics([uuidInformacion, uuidMedicion], for: encontrado)
    }

    fileprivate func caracteristicasDescubiertas(_ p: CBPeripheral, de s: CBService, huboError: Bool) {
        guard p === periferico, s.uuid == servicio else { return }
        informacion = s.characteristics?.first { $0.uuid == uuidInformacion }
        medicion = s.characteristics?.first { $0.uuid == uuidMedicion }
        guard !huboError, informacion != nil, medicion != nil else {
            avisar(.fallo(.servicioNoEncontrado))
            return
        }
        avisar(.conectado(id: p.identifier.uuidString))
    }

    fileprivate func valorActualizado(_ p: CBPeripheral, _ c: CBCharacteristic, huboError: Bool) {
        guard p === periferico else { return }
        let valor = huboError ? nil : c.value
        if c.uuid == uuidInformacion {
            guard informacionPedida else { return }
            informacionPedida = false
            if let valor { avisar(.informacion(valor)) } else { avisar(.fallo(.errorDeLectura)) }
        } else if c.uuid == uuidMedicion {
            // Lectura y notificación llegan por aquí; el clasificador las separa.
            switch clasificador.recibirValor(conError: valor == nil) {
            case .respuestaLectura: if let valor { avisar(.respuestaMedicion(valor)) }
            case .notificacion: if let valor { avisar(.notificacionMedicion(valor)) }
            case .falloLectura: avisar(.fallo(.errorDeLectura))
            case .descartar: break
            }
        }
    }

    fileprivate func notificacionesActualizadas(_ p: CBPeripheral, _ c: CBCharacteristic, huboError: Bool) {
        guard p === periferico, c.uuid == uuidMedicion else { return }
        if huboError {
            avisar(.fallo(.errorDeSuscripcion))
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
        enPrincipal { $0.fallaLaConexion(peripheral) }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        enPrincipal { $0.desconectado(peripheral) }
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
        let huboError = error != nil
        enPrincipal { $0.valorActualizado(peripheral, characteristic, huboError: huboError) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        let huboError = error != nil
        enPrincipal { $0.notificacionesActualizadas(peripheral, characteristic, huboError: huboError) }
    }
}

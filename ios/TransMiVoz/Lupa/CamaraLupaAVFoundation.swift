import AVFoundation
import CoreImage
import UIKit

/// Cámara real de la lupa: la trasera de ángulo normal, con el aumento del propio dispositivo. Cada imagen se
/// filtra con Core Image y se pinta en `capa`; no se guarda ni se envía. En el Simulator `hayCamara` es falso y
/// no se abre nada.
@MainActor
final class CamaraLupaAVFoundation: CamaraLupa {
    var receptor: (@MainActor (EventoCamara, Int) -> Void)?
    let capa = CALayer()

    private let motor = MotorCaptura()
    /// Token de la captura que puede hablar y pintar; `tokenSinCaptura` si no hay ninguna.
    private var vigente = tokenSinCaptura

    init() {
        capa.contentsGravity = .resizeAspect
        capa.backgroundColor = UIColor.black.cgColor
        motor.alEvento = { [weak self] evento, token in
            Task { @MainActor in self?.recibir(evento, token: token) }
        }
        motor.alPintar = { [weak self] imagen, token in
            Task { @MainActor in self?.pintar(imagen, token: token) }
        }
    }

    deinit { motor.cerrar() }

    var hayCamara: Bool { AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil }

    var permiso: PermisoCamara {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined: return .porPreguntar
        case .authorized: return .concedido
        case .restricted: return .restringido
        case .denied: return .denegado
        @unknown default: return .denegado
        }
    }

    func pedirPermiso() {
        Task { [weak self] in
            _ = await AVCaptureDevice.requestAccess(for: .video)
            self?.receptor?(.permisoRespondido, tokenSinCaptura)
        }
    }

    func iniciar(token: Int) {
        vigente = token
        motor.abrir(token: token)
    }

    func detener() {
        vigente = tokenSinCaptura
        capa.contents = nil
        motor.cerrar()
    }

    func fijarAumento(_ factor: Double) { motor.fijarAumento(factor) }
    func fijarFiltro(_ filtro: FiltroLupa) { motor.fijarFiltro(filtro) }
    func congelar(_ congelada: Bool) { motor.congelar(congelada) }

    private func recibir(_ evento: EventoCamara, token: Int) {
        guard token == vigente else { return }
        receptor?(evento, token)
    }

    private func pintar(_ imagen: CGImage, token: Int) {
        guard token == vigente else { return }
        // Sin la animación implícita de `contents`: cada imagen sustituye a la anterior.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        capa.contents = imagen
        CATransaction.commit()
    }
}

/// Todo lo que toca la sesión de captura y el dispositivo. Corre entero en `cola`, fuera del hilo principal: las
/// llamadas llegan a `cola` en orden, así que un `cerrar` que sigue a un `abrir` siempre espera a que la apertura
/// termine y la deshace; no queda sesión ni dispositivo abiertos.
private final class MotorCaptura: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    /// Se asignan una vez, antes del primer uso, y después solo se leen.
    var alEvento: (@Sendable (EventoCamara, Int) -> Void)?
    var alPintar: (@Sendable (CGImage, Int) -> Void)?

    /// Nombres de las notificaciones de AVFoundation por su valor: el nombre Swift cambia entre SDK.
    private static let errorDeEjecucion = Notification.Name("AVCaptureSessionRuntimeErrorNotification")
    private static let interrupcion = Notification.Name("AVCaptureSessionWasInterruptedNotification")

    private let cola = DispatchQueue(label: "transmivoz.lupa.captura")

    // Desde aquí, solo se tocan en `cola`.
    private var token = tokenSinCaptura
    private var sesion: AVCaptureSession?
    private var salida: AVCaptureVideoDataOutput?
    private var dispositivo: AVCaptureDevice?
    private var rotacion: AVCaptureDevice.RotationCoordinator?
    private var contexto: CIContext?
    private var observadores: [NSObjectProtocol] = []
    private var filtro = FiltroLupa.contraste
    private var aumento = 1.0
    private var congelada = false
    /// Aumento del dispositivo cuando se congeló: el de la imagen fija. El aumento posterior la recorta.
    private var aumentoAlCongelar = 1.0
    private var ultimaImagen: CIImage?

    func abrir(token nuevo: Int) {
        cola.async { [self] in
            cerrarEnCola()
            token = nuevo
            guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
                  let camara = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                  let entrada = try? AVCaptureDeviceInput(device: camara)
            else { return fallar(nuevo) }

            let sesion = AVCaptureSession()
            let salida = AVCaptureVideoDataOutput()
            salida.alwaysDiscardsLateVideoFrames = true
            sesion.beginConfiguration()
            if sesion.canSetSessionPreset(.hd1280x720) { sesion.sessionPreset = .hd1280x720 }
            let cabe = sesion.canAddInput(entrada) && sesion.canAddOutput(salida)
            if cabe {
                sesion.addInput(entrada)
                sesion.addOutput(salida)
            }
            sesion.commitConfiguration()
            guard cabe else { return fallar(nuevo) }

            salida.setSampleBufferDelegate(self, queue: cola)
            self.sesion = sesion
            self.salida = salida
            dispositivo = camara
            contexto = CIContext()
            rotacion = AVCaptureDevice.RotationCoordinator(device: camara, previewLayer: nil)
            // Otra app que toma la cámara o un error del sistema cortan la captura: se avisa y la lupa la suelta.
            observadores = [
                NotificationCenter.default.addObserver(forName: Self.errorDeEjecucion, object: sesion, queue: nil) { [weak self] _ in
                    self?.fallar(nuevo)
                },
                NotificationCenter.default.addObserver(forName: Self.interrupcion, object: sesion, queue: nil) { [weak self] _ in
                    self?.fallar(nuevo)
                },
            ]
            sesion.startRunning()
            guard sesion.isRunning else { return fallar(nuevo) }
            alEvento?(.lista(aumentoMinimo: Double(camara.minAvailableVideoZoomFactor), aumentoMaximo: Double(camara.maxAvailableVideoZoomFactor)), nuevo)
        }
    }

    func cerrar() {
        cola.async { [self] in cerrarEnCola() }
    }

    func fijarAumento(_ factor: Double) {
        cola.async { [self] in
            aumento = factor
            if congelada { repintar() } else { fijarAumentoDelDispositivo(factor) }
        }
    }

    func fijarFiltro(_ nuevo: FiltroLupa) {
        cola.async { [self] in
            filtro = nuevo
            if congelada { repintar() }
        }
    }

    func congelar(_ nueva: Bool) {
        cola.async { [self] in
            guard nueva != congelada else { return }
            congelada = nueva
            if nueva {
                aumentoAlCongelar = aumento
                // Copia propia de la imagen fija: no retiene el búfer de la cámara mientras dure el congelado.
                if let ultima = ultimaImagen, let copia = contexto?.createCGImage(ultima, from: ultima.extent) {
                    ultimaImagen = CIImage(cgImage: copia)
                }
            } else {
                fijarAumentoDelDispositivo(aumento)
            }
        }
    }

    // MARK: En `cola`

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard sesion != nil, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        // Congelada, la imagen fija ya está; solo se admite un primer cuadro si se congeló antes de recibir alguno.
        if congelada && ultimaImagen != nil { return }
        // La imagen sale derecha respecto al horizonte con el iPhone en cualquier orientación.
        if let angulo = rotacion?.videoRotationAngleForHorizonLevelCapture,
           connection.isVideoRotationAngleSupported(angulo), connection.videoRotationAngle != angulo {
            connection.videoRotationAngle = angulo
        }
        let imagen = CIImage(cvPixelBuffer: buffer)
        ultimaImagen = imagen
        pintar(imagen, escala: 1)
    }

    private func fallar(_ delToken: Int) {
        alEvento?(.fallo, delToken)
    }

    private func fijarAumentoDelDispositivo(_ factor: Double) {
        guard let dispositivo, (try? dispositivo.lockForConfiguration()) != nil else { return }
        let minimo = Double(dispositivo.minAvailableVideoZoomFactor)
        let maximo = Double(dispositivo.maxAvailableVideoZoomFactor)
        dispositivo.videoZoomFactor = CGFloat(min(max(factor, minimo), maximo))
        dispositivo.unlockForConfiguration()
    }

    private func repintar() {
        guard let ultimaImagen else { return }
        pintar(ultimaImagen, escala: aumento / aumentoAlCongelar)
    }

    private func pintar(_ imagen: CIImage, escala: Double) {
        guard let contexto else { return }
        let resultado = filtro.aplicar(a: FiltroLupa.recorte(imagen, escala: escala))
        guard let dibujo = contexto.createCGImage(resultado, from: resultado.extent) else { return }
        alPintar?(dibujo, token)
    }

    /// Detiene la captura y suelta la sesión, la salida y el dispositivo. Sin nada abierto no hace nada.
    private func cerrarEnCola() {
        for observador in observadores { NotificationCenter.default.removeObserver(observador) }
        observadores = []
        salida?.setSampleBufferDelegate(nil, queue: nil)
        if let sesion {
            sesion.stopRunning()
            sesion.beginConfiguration()
            for entrada in sesion.inputs { sesion.removeInput(entrada) }
            for destino in sesion.outputs { sesion.removeOutput(destino) }
            sesion.commitConfiguration()
        }
        sesion = nil
        salida = nil
        dispositivo = nil
        rotacion = nil
        contexto = nil
        ultimaImagen = nil
        congelada = false
        token = tokenSinCaptura
    }
}

import AVFoundation
import Speech

/// El servicio dice «no oí voz» (dominio `kAFAssistantErrorDomain`, código 1110): es ruido o silencio, no un fallo del servicio.
/// Función libre y no del tipo (que corre en el hilo principal): la llama el hilo del reconocedor.
private func esErrorSinVoz(_ error: Error?) -> Bool {
    guard let error = error as NSError? else { return false }
    return error.domain == "kAFAssistantErrorDomain" && error.code == 1110
}

/// Reconocimiento real: `SFSpeechRecognizer` con el audio de `AVAudioEngine`. Español de Colombia y, si el sistema no lo
/// ofrece, de España. Con `supportsOnDeviceRecognition` pide reconocimiento en el iPhone; si no, el audio va al servicio de
/// Apple y la pantalla lo dice antes de dictar. No hay prueba con micrófono real ni con acento colombiano.
@MainActor
final class ReconocedorSFSpeech: ReconocedorVoz {
    /// Orden de preferencia; se usa el primero que el sistema conoce.
    private static let idiomas = ["es-CO", "es-ES"]
    var receptor: (@MainActor (EventoDictado, Int) -> Void)?

    private var vigente = tokenSinCaptura
    private var motor: AVAudioEngine?
    private var solicitud: SFSpeechAudioBufferRecognitionRequest?
    private var tarea: SFSpeechRecognitionTask?
    private var reconocedor: SFSpeechRecognizer?
    private var sesionAbierta = false
    private var ultimoParcial = ""

    private static func elegirReconocedor() -> SFSpeechRecognizer? {
        for idioma in idiomas {
            if let reconocedor = SFSpeechRecognizer(locale: Locale(identifier: idioma)) { return reconocedor }
        }
        return nil
    }

    var permiso: PermisoVoz {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .denied: return .denegado
        case .restricted: return .restringido
        case .notDetermined: return .porPreguntar
        case .authorized: break
        @unknown default: return .denegado
        }
        switch AVAudioApplication.shared.recordPermission {
        case .undetermined: return .porPreguntar
        case .denied: return .denegado
        case .granted: return .concedido
        @unknown default: return .denegado
        }
    }

    var capacidad: CapacidadReconocimiento {
        guard let reconocedor = Self.elegirReconocedor(), reconocedor.isAvailable else { return .noDisponible }
        let idioma = reconocedor.locale.identifier(.bcp47)
        return reconocedor.supportsOnDeviceRecognition ? .local(idioma: idioma) : .remoto(idioma: idioma)
    }

    func pedirPermisos() {
        Task { [weak self] in
            let reconocimiento = await withCheckedContinuation { (continuacion: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
                SFSpeechRecognizer.requestAuthorization { continuacion.resume(returning: $0) }
            }
            // El micrófono solo se pide si el reconocimiento se concedió: con él negado no hay dictado.
            if reconocimiento == .authorized { _ = await AVAudioApplication.requestRecordPermission() }
            self?.receptor?(.permisosRespondidos, tokenSinCaptura)
        }
    }

    func iniciar(token: Int) {
        cerrar()
        vigente = token
        guard let reconocedor = Self.elegirReconocedor(), reconocedor.isAvailable else {
            avisar(.fallo(.sinServicio), token: token)
            return
        }
        do {
            try SintetizadorSistema.abrirCaptura()
            sesionAbierta = true
        } catch {
            avisar(.fallo(.audio), token: token)
            return
        }
        let motor = AVAudioEngine()
        let solicitud = SFSpeechAudioBufferRecognitionRequest()
        solicitud.shouldReportPartialResults = true
        solicitud.requiresOnDeviceRecognition = reconocedor.supportsOnDeviceRecognition
        let entrada = motor.inputNode
        let formato = entrada.outputFormat(forBus: 0)
        // Sin micrófono (Simulator sin entrada) el formato llega vacío y `installTap` abortaría la app.
        guard formato.sampleRate > 0, formato.channelCount > 0 else {
            cerrar()
            avisar(.fallo(.audio), token: token)
            return
        }
        entrada.installTap(onBus: 0, bufferSize: 1024, format: formato) { buffer, _ in solicitud.append(buffer) }
        motor.prepare()
        do {
            try motor.start()
        } catch {
            entrada.removeTap(onBus: 0)
            cerrar()
            avisar(.fallo(.audio), token: token)
            return
        }
        self.motor = motor
        self.solicitud = solicitud
        self.reconocedor = reconocedor
        ultimoParcial = ""
        tarea = reconocedor.recognitionTask(with: solicitud) { [weak self] resultado, error in
            let texto = resultado?.bestTranscription.formattedString
            let final = resultado?.isFinal ?? false
            let fallo = error != nil
            let sinVoz = esErrorSinVoz(error)
            Task { @MainActor in self?.recibir(texto: texto, final: final, fallo: fallo, sinVoz: sinVoz, token: token) }
        }
        avisar(.escuchando, token: token)
    }

    func detener() {
        // Cierra el micrófono y la entrada de audio; la tarea sigue viva para entregar el texto final.
        motor?.inputNode.removeTap(onBus: 0)
        motor?.stop()
        solicitud?.endAudio()
    }

    func cancelar() {
        vigente = tokenSinCaptura
        cerrar()
    }

    /// Resultado del reconocedor, ya fuera de su hilo. Solo el de la captura vigente cuenta.
    private func recibir(texto: String?, final: Bool, fallo: Bool, sinVoz: Bool, token: Int) {
        guard token == vigente else { return }
        if let texto, !texto.isEmpty { ultimoParcial = texto }
        guard final || fallo else {
            if let texto { receptor?(.parcial(texto), token) }
            return
        }
        let dicho = texto ?? ultimoParcial
        cerrar()
        // Un error con texto ya reconocido entrega ese texto; «no oí voz» es ruido o silencio; lo demás es un fallo.
        if fallo && dicho.isEmpty && !sinVoz {
            receptor?(.fallo(.sinServicio), token)
        } else {
            receptor?(.terminado(dicho), token)
        }
    }

    /// Suelta micrófono, reconocimiento y sesión de audio. Sin captura abierta no hace nada.
    private func cerrar() {
        tarea?.cancel()
        tarea = nil
        motor?.inputNode.removeTap(onBus: 0)
        motor?.stop()
        motor = nil
        solicitud?.endAudio()
        solicitud = nil
        reconocedor = nil
        if sesionAbierta {
            sesionAbierta = false
            SintetizadorSistema.cerrarCaptura()
        }
    }

    /// Como la cámara real, el evento llega después y no dentro de la propia llamada.
    private func avisar(_ evento: EventoDictado, token: Int) {
        Task { @MainActor [weak self] in
            guard let self, token == vigente else { return }
            receptor?(evento, token)
        }
    }
}

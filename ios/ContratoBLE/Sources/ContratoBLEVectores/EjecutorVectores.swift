import ContratoBLE
import Foundation

/// Resultado de ejecutar los vectores canónicos de `contratos/ble/`.
public struct ResumenVectores {
    /// Comprobaciones realizadas.
    public var casos = 0
    /// Una línea legible por cada incumplimiento. Vacío si todo coincide.
    public var fallos: [String] = []
    /// Códigos de error que los vectores esperan al menos una vez.
    public var erroresCubiertos: Set<ErrorContrato> = []
    /// Etiquetas de estado de sesión que los escenarios comprobaron.
    public var estadosCubiertos: Set<String> = []
}

public enum ErrorVectores: Error, CustomStringConvertible {
    case archivoIlegible(String)
    public var description: String {
        switch self {
        case .archivoIlegible(let ruta): return "No se pudo leer \(ruta)"
        }
    }
}

/// Carpeta `contratos/ble` del repositorio, deducida de la ubicación de este
/// archivo. Sirve para `swift test` y para pruebas de Xcode que usen el paquete
/// por ruta local; en otro caso, pasar la carpeta a `ejecutarVectores`.
public func directorioVectoresPorDefecto(archivo: String = #filePath) -> URL {
    var url = URL(fileURLWithPath: archivo)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    return url.appendingPathComponent("contratos").appendingPathComponent("ble")
}

/// Ejecuta `vectores.txt` y `sesiones.txt` de la carpeta indicada contra el
/// decodificador y la sesión de `ContratoBLE`. Los mismos archivos los usa el C++.
public func ejecutarVectores(directorio: URL = directorioVectoresPorDefecto()) throws -> ResumenVectores {
    var resumen = ResumenVectores()
    try ejecutarTramas(directorio.appendingPathComponent("vectores.txt"), &resumen)
    try ejecutarSesiones(directorio.appendingPathComponent("sesiones.txt"), &resumen)
    return resumen
}

// MARK: Lectura

typealias Lineas = [(numero: Int, tokens: [String])]

private func leerLineas(_ url: URL) throws -> Lineas {
    guard let texto = try? String(contentsOf: url, encoding: .utf8) else {
        throw ErrorVectores.archivoIlegible(url.path)
    }
    var lineas: Lineas = []
    for (i, cruda) in texto.components(separatedBy: "\n").enumerated() {
        let sinComentario = cruda.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
            .first.map(String.init) ?? ""
        let tokens = sinComentario.split(separator: " ").map(String.init)
        if !tokens.isEmpty { lineas.append((i + 1, tokens)) }
    }
    return lineas
}

func datos(hex: String) -> Data? {
    if hex == "-" { return Data() }
    guard hex.count % 2 == 0 else { return nil }
    var d = Data()
    var i = hex.startIndex
    while i < hex.endIndex {
        let j = hex.index(i, offsetBy: 2)
        guard let b = UInt8(hex[i..<j], radix: 16) else { return nil }
        d.append(b)
        i = j
    }
    return d
}

func hexadecimal(_ d: Data) -> String {
    d.isEmpty ? "-" : d.map { String(format: "%02x", $0) }.joined()
}

func claves(_ tokens: [String], desde: Int) -> [String: Int64] {
    var r: [String: Int64] = [:]
    for t in tokens[desde...] {
        let partes = t.split(separator: "=", maxSplits: 1).map(String.init)
        if partes.count == 2, let v = Int64(partes[1]) { r[partes[0]] = v }
    }
    return r
}

extension InformacionAccesorio {
    var campos: [String: Int64] {
        [
            "mayor": Int64(versionMayor), "menor": Int64(versionMenor),
            "capacidades": Int64(capacidades.rawValue), "arranque": Int64(idArranque),
            "fwMayor": Int64(firmwareMayor), "fwMenor": Int64(firmwareMenor),
            "fwRevision": Int64(firmwareRevision), "perfil": Int64(perfil.rawValue),
            "periodoMs": Int64(periodoNominalMs), "caducidadMs": Int64(caducidadMs),
            "distMinMm": Int64(distanciaMinimaMm), "distMaxMm": Int64(distanciaMaximaMm),
        ]
    }
}

extension Medicion {
    var campos: [String: Int64] {
        [
            "mayor": Int64(versionMayor), "banderas": Int64(banderas.rawValue),
            "secuencia": Int64(secuencia), "arranque": Int64(idArranque),
            "emisionMs": Int64(instanteEmisionMs), "distanciaMm": Int64(distanciaMm),
            "azimutCent": Int64(azimutCentesimas), "edadRadarMs": Int64(edadResultadoMs),
            "bateria": Int64(bateriaPorcentaje), "salud": Int64(salud.rawValue),
        ]
    }
}

private func codigo(_ error: Error) -> String {
    (error as? ErrorContrato)?.rawValue ?? "errorInesperado"
}

// MARK: vectores.txt

private func ejecutarTramas(_ url: URL, _ r: inout ResumenVectores) throws {
    let lineas = try leerLineas(url)
    if lineas.isEmpty { r.fallos.append("\(url.lastPathComponent): vacío") }
    var infos: [String: InformacionAccesorio] = [:]

    func fallo(_ n: Int, _ id: String, _ texto: String) {
        r.fallos.append("\(url.lastPathComponent):\(n) \(id): \(texto)")
    }

    for (n, t) in lineas where t[0] == "info" && t.count >= 5 {
        r.casos += 1
        guard let bytes = datos(hex: t[2]) else { fallo(n, t[1], "hex inválido"); continue }
        do {
            let info = try InformacionAccesorio.decodificar(bytes)
            if t[3] != "ok" { fallo(n, t[1], "esperaba error \(t[4]) y decodificó"); continue }
            if info.campos != claves(t, desde: 4) { fallo(n, t[1], "campos distintos: \(info.campos)") }
            infos[t[1]] = info
        } catch {
            if t[3] == "error", t[4] == codigo(error) {
                if let e = error as? ErrorContrato { r.erroresCubiertos.insert(e) }
            } else {
                fallo(n, t[1], "error \(codigo(error)) inesperado; esperaba \(t[3]) \(t.count > 4 ? t[4] : "")")
            }
        }
    }

    for (n, t) in lineas {
        if t[0] == "med", t.count >= 6 {
            r.casos += 1
            guard let info = infos[t[2]] else { fallo(n, t[1], "información \(t[2]) desconocida"); continue }
            guard let bytes = datos(hex: t[3]) else { fallo(n, t[1], "hex inválido"); continue }
            do {
                let m = try Medicion.decodificar(bytes, informacion: info)
                if t[4] != "ok" { fallo(n, t[1], "esperaba error \(t[5]) y decodificó"); continue }
                if m.campos != claves(t, desde: 5) { fallo(n, t[1], "campos distintos: \(m.campos)") }
            } catch {
                if t[4] == "error", t[5] == codigo(error) {
                    if let e = error as? ErrorContrato { r.erroresCubiertos.insert(e) }
                } else {
                    fallo(n, t[1], "error \(codigo(error)) inesperado; esperaba \(t[4]) \(t.count > 5 ? t[5] : "")")
                }
            }
        } else if t[0] == "emision", t.count == 10 {
            r.casos += 1
            verificarEmision(n, t, infos, &r)
        }
    }
}

/// `emision <id> <info_ref> <seq0> <inicioMs> <pasoMs> <edadMs> <estado> <sim> <hex,...>`
/// El C++ regenera estas tramas; aquí se decodifican y se comprueba la receta.
private func verificarEmision(_ n: Int, _ t: [String], _ infos: [String: InformacionAccesorio], _ r: inout ResumenVectores) {
    let id = t[1]
    guard let info = infos[t[2]], let seq0 = UInt16(t[3]), let inicio = UInt32(t[4]),
          let paso = UInt32(t[5]), let edad = UInt16(t[6])
    else { r.fallos.append("vectores.txt:\(n) \(id): formato"); return }
    let simulada = t[8] == "1"
    for (k, hex) in t[9].split(separator: ",").map(String.init).enumerated() {
        guard let bytes = datos(hex: hex), let m = try? Medicion.decodificar(bytes, informacion: info) else {
            r.fallos.append("vectores.txt:\(n) \(id): trama \(k) no decodifica"); continue
        }
        r.casos += 1
        let esperadaSecuencia = seq0 &+ UInt16(k)
        let esperadoInstante = inicio &+ UInt32(k) &* paso
        var problemas: [String] = []
        if m.secuencia != esperadaSecuencia { problemas.append("secuencia \(m.secuencia)") }
        if m.instanteEmisionMs != esperadoInstante { problemas.append("instante \(m.instanteEmisionMs)") }
        if m.idArranque != info.idArranque { problemas.append("arranque") }
        if m.edadResultadoMs != edad { problemas.append("edad") }
        if m.banderas.contains(.simulacion) != simulada { problemas.append("simulación") }
        let partes = t[7].split(separator: ":").map(String.init)
        let vigente = partes[0] != "fallo" && edad != 0xFFFF && edad <= info.caducidadMs
        if m.banderas.contains(.resultadoDisponible) != vigente { problemas.append("vigencia") }
        if partes[0] == "fallo", m.salud.rawValue != UInt8(partes[1]) { problemas.append("salud") }
        if partes[0] != "fallo", m.salud != .sinFallo { problemas.append("salud") }
        if !problemas.isEmpty {
            r.fallos.append("vectores.txt:\(n) \(id) trama \(k): \(problemas.joined(separator: ", "))")
        }
    }
}

// MARK: sesiones.txt

private func ejecutarSesiones(_ url: URL, _ r: inout ResumenVectores) throws {
    let lineas = try leerLineas(url)
    if lineas.isEmpty { r.fallos.append("\(url.lastPathComponent): vacío") }

    var escenario = ""
    var politica = PoliticaAutenticacion.exigirAutenticado
    var modo = ModoSesion.real
    var elegido = ""
    var sesion: SesionProximidad?
    var contexto: InformacionAccesorio?
    var escenarios = 0

    func fallo(_ n: Int, _ texto: String) {
        r.fallos.append("\(url.lastPathComponent):\(n) [\(escenario)]: \(texto)")
    }

    for (n, t) in lineas {
        switch t[0] {
        case "escenario":
            escenario = t[1]
            politica = .exigirAutenticado
            modo = .real
            elegido = ""
            sesion = nil
            contexto = nil
            escenarios += 1
            continue
        case "politica":
            politica = t[1] == "permitirSinMITM" ? .permitirAsociacionSinMITM : .exigirAutenticado
            continue
        case "modo":
            modo = t[1] == "simulada" ? .simulada : .real
            continue
        case "elegido":
            elegido = t[1]
            continue
        default:
            break
        }

        if sesion == nil { sesion = SesionProximidad(accesorioElegido: elegido, politica: politica, modo: modo) }
        var s = sesion!
        defer { sesion = s }

        // Separa "=> resultado" y "decod=...".
        var accion = t
        var esperado: String?
        if let i = t.firstIndex(of: "=>"), i + 1 < t.count {
            esperado = t[i + 1]
            accion = Array(t[..<i])
        }
        let decodEsperado = accion.first(where: { $0.hasPrefix("decod=") }).map { String($0.dropFirst(6)) }
        r.casos += 1

        func comprobarDecod(_ real: String) {
            if let d = decodEsperado, d != real { fallo(n, "decod esperado \(d), obtenido \(real)") }
        }
        func comprobarResultado(_ real: ResultadoEvento) {
            if let e = esperado, e != real.etiqueta { fallo(n, "\(accion[0]): esperaba \(e), obtuvo \(real.etiqueta)") }
        }
        func tiempo(_ i: Int) -> Milisegundos {
            Milisegundos(accion[i]) ?? { fallo(n, "tiempo inválido \(accion[i])"); return 0 }()
        }

        switch accion[0] {
        case "conectar":
            comprobarResultado(s.conectar(accesorio: accion[2], enlace: NivelEnlace(rawValue: accion[3]) ?? .desconocido))
        case "info":
            let bytes = datos(hex: accion[2]) ?? Data()
            do {
                contexto = try InformacionAccesorio.decodificar(bytes)
                comprobarDecod("ok")
            } catch {
                comprobarDecod(codigo(error))
            }
            comprobarResultado(s.registrarInformacion(bytes))
        case "referencia", "entrega":
            let esReferencia = accion[0] == "referencia"
            let bytes = datos(hex: accion[esReferencia ? 3 : 2]) ?? Data()
            if let info = contexto {
                do {
                    _ = try Medicion.decodificar(bytes, informacion: info)
                    comprobarDecod("ok")
                } catch {
                    comprobarDecod(codigo(error))
                }
            } else {
                fallo(n, "trama sin Información válida previa")
            }
            if esReferencia {
                comprobarResultado(s.registrarReferencia(inicioLecturaMs: tiempo(1), finLecturaMs: tiempo(2), datos: bytes))
            } else {
                comprobarResultado(s.recibirNotificacion(bytes, recibidaEnMs: tiempo(1)))
            }
        case "evaluar":
            s.evaluar(ahoraMs: tiempo(1))
        case "reanudar":
            s.reanudar()
        case "desconectar":
            s.desconectar()
        case "estado":
            r.estadosCubiertos.insert(accion[1])
            if s.estado.etiqueta != accion[1] { fallo(n, "estado esperado \(accion[1]), obtenido \(s.estado.etiqueta)") }
        case "perdidas":
            if String(s.tramasPerdidas) != accion[1] { fallo(n, "pérdidas esperadas \(accion[1]), obtenidas \(s.tramasPerdidas)") }
        case "cota":
            if s.ultimaCotaEdadMs.map(String.init) != accion[1] {
                fallo(n, "cota esperada \(accion[1]), obtenida \(s.ultimaCotaEdadMs.map(String.init) ?? "nil")")
            }
        case "autenticado":
            if s.enlaceAutenticado != (accion[1] == "si") { fallo(n, "autenticado esperado \(accion[1])") }
        case "simulada":
            if s.esSimulada != (accion[1] == "si") { fallo(n, "simulada esperada \(accion[1])") }
        case "recalibrar":
            let real = s.necesitaReferencia(ahoraMs: tiempo(1))
            if real != (accion[2] == "si") { fallo(n, "recalibrar \(accion[1]) esperaba \(accion[2])") }
        default:
            fallo(n, "verbo desconocido \(accion[0])")
        }
    }
    if escenarios == 0 { r.fallos.append("sesiones.txt: sin escenarios") }
}

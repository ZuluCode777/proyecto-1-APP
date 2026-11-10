import CoreGraphics
import Foundation

// Lógica pura (sin XCUITest) del libro de contraste diferido de las auditorías de la pantalla del accesorio.
//
// Por qué existe: con la pila ansiosa, los nodos recortados bajo el área desplazable (entre su borde y la barra de
// pestañas) también llegan a la auditoría nativa de contraste, y el sistema los mide recortados. Esos hallazgos no
// se ignoran: se DIFIEREN y quedan en deuda hasta que ese mismo nodo se mida de nuevo, entero a la vista y sin
// filtros, dentro de la misma fase estable. Todo lo demás (contraste de algo visible, elemento desconocido o
// ambiguo, nodo más alto que la vista, cualquier otro tipo de problema) es un fallo inmediato del libro.

/// Identidad estable de un nodo dentro de una fase: identificador y etiqueta. Si cambia la etiqueta (otro estado)
/// es otra clave, así una medición limpia de un estado no salda la deuda de otro.
struct ClaveNodo: Hashable, CustomStringConvertible {
    let identificador: String
    let etiqueta: String
    var description: String { "«\(identificador)» «\(etiqueta)»" }
}

/// Zona realmente visible: entre la barra de navegación y la de pestañas, dentro del área desplazable.
struct VistaAuditada: Equatable {
    /// Holgura de redondeo del sistema al comparar marcos.
    static let tolerancia: CGFloat = 1
    let arriba: CGFloat
    let abajo: CGFloat

    static func marcoValido(_ marco: CGRect) -> Bool {
        [marco.origin.x, marco.origin.y, marco.size.width, marco.size.height].allSatisfy(\.isFinite)
            && marco.size.width > 0 && marco.size.height > 0
    }

    /// El marco, válido y no vacío, queda entero dentro de la vista (con la tolerancia).
    func contiene(_ marco: CGRect) -> Bool {
        Self.marcoValido(marco) && marco.minY >= arriba - Self.tolerancia && marco.maxY <= abajo + Self.tolerancia
    }

    /// El marco cabría entero en la vista si se desplazara hasta ella.
    func cabe(_ marco: CGRect) -> Bool { Self.marcoValido(marco) && marco.height <= abajo - arriba }
}

/// Un problema de la auditoría copiado COMO VALOR dentro del manejador nativo. Nunca se conserva el
/// `XCUIAccessibilityAuditIssue` ni su elemento: más tarde la jerarquía ya es otra.
struct HallazgoAuditoria {
    let tipo: String
    let esContraste: Bool
    let compacta: String
    let detallada: String
    /// `nil` si la auditoría no entregó elemento (hallazgo de elemento desconocido).
    let identificador: String?
    let etiqueta: String?
    let marco: CGRect?

    /// Solo un elemento con identificador permite identificar el nodo sin ambigüedad.
    var clave: ClaveNodo? {
        guard let identificador, !identificador.isEmpty, let etiqueta else { return nil }
        return ClaveNodo(identificador: identificador, etiqueta: etiqueta)
    }

    /// Mismo texto que siempre ha adjuntado la auditoría.
    var descripcion: String {
        "[\(tipo)] \(compacta) | \(detallada) | id=«\(identificador ?? "?")» etiqueta=«\(etiqueta ?? "?")» marco=\(marco.map { "\($0)" } ?? "?")"
    }
}

/// Nodo de la jerarquía nativa (instantánea) con lo necesario para identificarlo y saber si está a la vista.
struct NodoJerarquia {
    let identificador: String
    let etiqueta: String
    let marco: CGRect

    var clave: ClaveNodo? { identificador.isEmpty ? nil : ClaveNodo(identificador: identificador, etiqueta: etiqueta) }
}

/// Lo observado de la jerarquía nativa en un instante: zona visible, nodos del área desplazable y de toda la app.
struct ObservacionContraste {
    /// Deriva máxima (pt) entre dos observaciones para darlas por la misma maquetación.
    static let derivaMaxima: CGFloat = 0.5
    let vista: VistaAuditada
    let zona: [NodoJerarquia]
    let aplicacion: [NodoJerarquia]

    /// Compara lo observado ANTES y DESPUÉS del grupo de contraste de una auditoría. Si algo con identificador cambió de
    /// sitio, de etiqueta, apareció o desapareció, la medición de contraste no corresponde a ninguna de las dos
    /// observaciones y devuelve el motivo: no se acredita ningún nodo como medido limpio. Los nodos sin identificador
    /// (indicadores de desplazamiento, que aparecen y se desvanecen solos) no cuentan.
    static func deriva(antes: ObservacionContraste, despues: ObservacionContraste) -> String? {
        func cercanos(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) <= derivaMaxima }
        guard cercanos(antes.vista.arriba, despues.vista.arriba), cercanos(antes.vista.abajo, despues.vista.abajo) else {
            return "la zona visible cambió: \(antes.vista.arriba)…\(antes.vista.abajo) y luego \(despues.vista.arriba)…\(despues.vista.abajo)"
        }
        for (nombre, a, d) in [("zona desplazable", antes.zona, despues.zona), ("aplicación", antes.aplicacion, despues.aplicacion)] {
            let previos = a.filter { !$0.identificador.isEmpty }, siguientes = d.filter { !$0.identificador.isEmpty }
            guard previos.count == siguientes.count else {
                return "en la \(nombre) cambió el número de nodos con identificador: \(previos.count) y luego \(siguientes.count)"
            }
            for (x, y) in zip(previos, siguientes) {
                let igual = x.identificador == y.identificador && x.etiqueta == y.etiqueta
                    && cercanos(x.marco.minX, y.marco.minX) && cercanos(x.marco.minY, y.marco.minY)
                    && cercanos(x.marco.width, y.marco.width) && cercanos(x.marco.height, y.marco.height)
                guard igual else { return "en la \(nombre) se movió o cambió «\(x.identificador)»: \(x.marco) y luego \(y.marco)" }
            }
        }
        return nil
    }
}

/// Plan de escalas para llegar a un nodo lejano con el tope de gestos de `exponer` por tramo (cuatro). Un destino a
/// más de ~4 pasos del tope no se alcanza de un solo `exponer`; el recorrido sigue el orden de la maquetación: de nodo
/// único con identificador a nodo único con identificador, cada tramo de a lo sumo `alcance`, siempre hacia el destino.
/// El plan supone que cada escala deja su comienzo en `arriba + 40`, pero `exponer(completo: false)` se conforma con
/// cualquier posición del comienzo dentro de la vista: solo la primera escala vale para la instantánea que se midió.
/// Quien recorre el plan lo recalcula con una instantánea nueva tras cada escala (`excluir`: las ya recorridas).
enum PlanRecorrido {
    /// Tramo máximo entre escalas, y de la última al destino, para una vista: TRES pasos de `exponer` (cada uno
    /// `abajo - arriba - 40`). De los cuatro gestos del tope, tres recorren el tramo y el cuarto corrige lo que los gestos
    /// dejan sin recorrer (en la corrida nativa de `8734600`, 609 pt de cada 619 pedidos). Con dos pasos el plan se
    /// quedaba sin ruta: una escala con el comienzo ya a la vista no mueve nada y la siguiente caía 8,3 pt fuera del
    /// alcance, con el destino a 2813 pt, más de lo que recorren los cuatro gestos del `exponer` final.
    static func alcance(arriba: CGFloat, abajo: CGFloat) -> CGFloat { 3 * (abajo - arriba - 40) }

    /// Identificadores intermedios, en orden. Vacío si el destino ya está a `alcance` o no hay ruta (entonces el
    /// `exponer` final, estricto, es quien falla). `zona` y `aplicacion` son de la MISMA instantánea.
    /// `etiqueta`: identidad exacta del destino (identificador Y etiqueta, como `ClaveNodo`). Hace falta cuando varios nodos
    /// comparten el identificador (el icono y el texto de un `Label`): sin ella el destino es el primero, que puede ser otro.
    static func escalas(destino: String, etiqueta: String? = nil, zona: [NodoJerarquia], aplicacion: [NodoJerarquia], arriba: CGFloat, abajo: CGFloat, alcance: CGFloat, excluir: Set<String> = []) -> [String] {
        guard let meta = zona.first(where: { $0.identificador == destino && (etiqueta == nil || $0.etiqueta == etiqueta) && VistaAuditada.marcoValido($0.marco) }) else { return [] }
        let centro = (arriba + abajo) / 2
        let ancla = arriba + 40
        let unicos = Dictionary(grouping: aplicacion.filter { !$0.identificador.isEmpty }, by: \.identificador).filter { $0.value.count == 1 }
        let candidatos = zona.filter { $0.identificador != destino && !excluir.contains($0.identificador) && unicos[$0.identificador] != nil && VistaAuditada.marcoValido($0.marco) }
        // `desplazado`: cuánto se ha desplazado ya el contenido respecto de la instantánea (positivo, hacia delante).
        var desplazado: CGFloat = 0
        var escalas: [String] = []
        while abs(meta.marco.midY - centro - desplazado) > alcance {
            let sentido: CGFloat = meta.marco.midY - centro > desplazado ? 1 : -1
            // Cada escala deja su comienzo cerca del borde de arriba, como `exponer(completo: false)`.
            var siguiente: (identificador: String, tramo: CGFloat)?
            for candidato in candidatos where !escalas.contains(candidato.identificador) {
                let tramo: CGFloat = candidato.marco.minY - ancla
                let avance: CGFloat = sentido * (tramo - desplazado)
                guard avance > 0, avance <= alcance else { continue }
                if let actual = siguiente, sentido * actual.tramo >= sentido * tramo { continue }
                siguiente = (candidato.identificador, tramo)
            }
            guard let siguiente else { return escalas }
            escalas.append(siguiente.identificador)
            desplazado = siguiente.tramo
        }
        return escalas
    }
}

enum Veredicto: Equatable, CustomStringConvertible {
    case fallo(String)
    case diferido(ClaveNodo)

    var description: String {
        switch self {
        case .fallo(let motivo): return "FALLO: \(motivo)"
        case .diferido(let clave): return "DIFERIDO (deuda hasta medirlo entero y a la vista): \(clave)"
        }
    }
}

enum ClasificadorContraste {
    /// `unico`: el nodo se identificó de forma única como descendiente de la primera zona desplazable.
    /// Solo se difiere si TODO se cumple; cualquier duda es un fallo.
    static func clasificar(_ hallazgo: HallazgoAuditoria, vista: VistaAuditada, unico: Bool) -> Veredicto {
        guard hallazgo.esContraste else { return .fallo("no es de contraste: nunca se difiere") }
        guard hallazgo.identificador != nil else { return .fallo("contraste de un elemento desconocido") }
        guard let clave = hallazgo.clave else { return .fallo("contraste de un elemento sin identificador") }
        guard unico else { return .fallo("el nodo no es descendiente único de la zona desplazable") }
        guard let marco = hallazgo.marco, VistaAuditada.marcoValido(marco) else { return .fallo("marco vacío, ausente o no finito") }
        if vista.contiene(marco) { return .fallo("contraste insuficiente con el nodo entero a la vista") }
        guard vista.cabe(marco) else { return .fallo("recortado y más alto que la vista: no hay posición que lo muestre entero") }
        return .diferido(clave)
    }
}

/// Libro de UNA fase estable (mismo estado y mismas etiquetas). Acumula fallos hasta el cierre y exige saldar
/// cada deuda con una medición limpia del mismo nodo, entero a la vista, en esta misma fase.
struct LibroContraste {
    let fase: String
    private(set) var diferidos: [ClaveNodo: HallazgoAuditoria] = [:]
    /// Orden en que se difirió cada clave: el cierre empieza por la más reciente, que queda más cerca de donde está la vista.
    private var orden: [ClaveNodo] = []
    /// Nodos medidos enteros a la vista sin ningún problema de contraste.
    private(set) var limpios: Set<ClaveNodo> = []
    /// Claves ya resueltas como fallo: no quedan en deuda.
    private(set) var resueltosConFallo: Set<ClaveNodo> = []
    private(set) var fallos: [String] = []
    /// Máximo de nodos de la zona desplazable vistos en la fase: acota el trabajo de cierre.
    private(set) var nodosMaximos = 0

    init(fase: String) { self.fase = fase }

    /// Clasifica los hallazgos de UNA auditoría completa y anota los nodos que esa auditoría midió limpios.
    /// `zona`: nodos descendientes de la primera zona desplazable; `aplicacion`: todos los de la aplicación.
    /// Devuelve una línea por hallazgo para adjuntarla.
    @discardableResult
    mutating func registrar(
        contexto: String, hallazgos: [HallazgoAuditoria], zona: [NodoJerarquia], aplicacion: [NodoJerarquia], vista: VistaAuditada
    ) -> [String] {
        nodosMaximos = max(nodosMaximos, zona.count)
        let enZona = Dictionary(zona.compactMap { $0.clave }.map { ($0, 1) }, uniquingKeysWith: +)
        let enAplicacion = Dictionary(aplicacion.compactMap { $0.clave }.map { ($0, 1) }, uniquingKeysWith: +)
        func unico(_ clave: ClaveNodo?) -> Bool { clave.map { enZona[$0] == 1 && enAplicacion[$0] == 1 } ?? false }

        var conContraste: Set<ClaveNodo> = []
        var lineas: [String] = []
        for hallazgo in hallazgos {
            if hallazgo.esContraste, let clave = hallazgo.clave { conContraste.insert(clave) }
            let veredicto = ClasificadorContraste.clasificar(hallazgo, vista: vista, unico: unico(hallazgo.clave))
            lineas.append("[\(contexto)] \(hallazgo.descripcion)\n    => \(veredicto)")
            switch veredicto {
            case .diferido(let clave):
                if diferidos[clave] == nil {
                    diferidos[clave] = hallazgo
                    orden.append(clave)
                }
            case .fallo(let motivo):
                fallos.append("[\(fase)/\(contexto)] \(motivo): \(hallazgo.descripcion)")
                if hallazgo.esContraste, let clave = hallazgo.clave { resueltosConFallo.insert(clave) }
            }
        }
        for nodo in zona {
            if let clave = nodo.clave, unico(clave), vista.contiene(nodo.marco), !conContraste.contains(clave) {
                limpios.insert(clave)
            }
        }
        return lineas
    }

    /// La maquetación cambió mientras se medía el contraste: no se clasifica ni se acredita nada de esa auditoría y la
    /// fase falla. `nodos`: nodos de la zona desplazable vistos, para acotar el trabajo de cierre.
    mutating func registrarDeriva(contexto: String, motivo: String, nodos: Int) {
        nodosMaximos = max(nodosMaximos, nodos)
        fallos.append("[\(fase)/\(contexto)] la maquetación cambió durante la medición de contraste y no se acredita nada de esa auditoría: \(motivo)")
    }

    /// Deudas sin saldar (la más reciente primero): diferidas, sin medición limpia entera a la vista y sin fallo ya registrado.
    var pendientes: [ClaveNodo] {
        orden.reversed().filter { !limpios.contains($0) && !resueltosConFallo.contains($0) }
    }

    /// Una deuda que no se pudo saldar es un fallo y deja de estar pendiente.
    mutating func darPorFallida(_ clave: ClaveNodo, motivo: String) {
        fallos.append("[\(fase)] deuda sin saldar \(clave): \(motivo)")
        resueltosConFallo.insert(clave)
    }

    func informe() -> String {
        var lineas = ["Fase «\(fase)»: \(nodosMaximos) nodo(s) como máximo en la zona desplazable, \(diferidos.count) diferido(s), \(fallos.count) fallo(s)."]
        for clave in orden {
            let estado = limpios.contains(clave) ? "saldado (medido entero a la vista, sin problema)"
                : resueltosConFallo.contains(clave) ? "resuelto como fallo" : "SIN SALDAR"
            lineas.append("  \(clave): \(estado); visto recortado en \(diferidos[clave]?.marco.map { "\($0)" } ?? "?")")
        }
        return lineas.joined(separator: "\n")
    }
}

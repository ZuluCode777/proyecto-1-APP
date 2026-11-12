#if DEBUG
import UIKit

/// Cámara SINTÉTICA, solo en compilaciones de depuración y solo para las pruebas de interfaz
/// (`-PRUEBAS_UI_SIMULADAS`). Permite recorrer la MISMA pantalla y el MISMO modelo de la lupa en el Simulator, que no
/// tiene cámara. La «imagen» es una carta de colores fija; el aumento recorta su centro. No pasa por Core Image ni por
/// los filtros (el filtro elegido se anota en el modelo, pero la carta no cambia de color). Motivo, sin confirmar: en la
/// CI de #86 la app dejó de quedar en reposo (60 s) con la lupa activa, y se sospecha que pintar con Core Image en el
/// hilo principal, en un Simulator sin GPU, era la causa. No prueba la cámara, ni el aumento del dispositivo, ni los
/// filtros, ni el rendimiento.
@MainActor
final class CamaraSintetica: CamaraLupa {
    enum Permiso {
        /// Aún no preguntado; al pedirlo el «sistema» concede.
        case porPreguntar
        /// Aún no preguntado; al pedirlo el «sistema» deniega.
        case porPreguntarYDenegar
        /// Ya concedido: no hay explicación previa.
        case concedido
    }

    var receptor: (@MainActor (EventoCamara, Int) -> Void)?
    let capa = CALayer()
    let hayCamara: Bool
    private(set) var permiso: PermisoCamara

    private let denegar: Bool
    private var token = tokenSinCaptura
    private var aumento = 1.0
    /// Se dibuja al primer uso y no en `init`: esta cámara se crea al arrancar la app, antes de que exista la escena. Se
    /// sospecha que dibujar entonces con `UIGraphicsImageRenderer` (lee la pantalla) dejó a la app sin su color de acento
    /// en la CI de #86 (botones en el azul del sistema); sin confirmar.
    private lazy var carta: CGImage? = CamaraSintetica.dibujarCarta()

    init(permiso: Permiso, hayCamara: Bool = true) {
        self.hayCamara = hayCamara
        self.permiso = permiso == .concedido ? .concedido : .porPreguntar
        denegar = permiso == .porPreguntarYDenegar
        capa.contentsGravity = .resizeAspect
        capa.backgroundColor = UIColor.black.cgColor
    }

    func pedirPermiso() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            permiso = denegar ? .denegado : .concedido
            receptor?(.permisoRespondido, tokenSinCaptura)
        }
    }

    /// Como la cámara real, responde después y no en la propia llamada.
    func iniciar(token nuevo: Int) {
        token = nuevo
        Task { @MainActor [weak self] in
            guard let self, token == nuevo else { return }
            receptor?(.lista(aumentoMinimo: 1, aumentoMaximo: 8), nuevo)
        }
    }

    func detener() {
        token = tokenSinCaptura
        capa.contents = nil
    }

    func fijarAumento(_ factor: Double) {
        aumento = factor
        pintar()
    }

    /// La carta no cambia de color: el filtro solo se ve en el control de la pantalla.
    func fijarFiltro(_ nuevo: FiltroLupa) {}

    /// La carta no cambia: congelar no tiene nada que detener.
    func congelar(_ congelada: Bool) {}

    private func pintar() {
        guard token != tokenSinCaptura else { return }
        // Sin la animación implícita de `contentsRect`. Un aumento de 2 muestra la mitad central, el de 4 la cuarta parte…
        let lado = 1 / max(aumento, 1)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        capa.contents = carta
        capa.contentsRect = CGRect(x: (1 - lado) / 2, y: (1 - lado) / 2, width: lado, height: lado)
        CATransaction.commit()
    }

    private static func dibujarCarta() -> CGImage? {
        let colores: [UIColor] = [.red, .orange, .yellow, .green, .blue, .purple]
        let imagen = UIGraphicsImageRenderer(size: CGSize(width: 480, height: 640)).image { _ in
            for (indice, color) in colores.enumerated() {
                color.setFill()
                UIRectFill(CGRect(x: 0, y: CGFloat(indice) * 640 / CGFloat(colores.count), width: 480, height: 640 / CGFloat(colores.count) + 1))
            }
            ("PRUEBA" as NSString).draw(
                at: CGPoint(x: 60, y: 280),
                withAttributes: [.font: UIFont.boldSystemFont(ofSize: 96), .foregroundColor: UIColor.black])
        }
        return imagen.cgImage
    }
}
#endif

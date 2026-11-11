#if DEBUG
import CoreImage
import UIKit

/// Cámara SINTÉTICA, solo en compilaciones de depuración y solo para las pruebas de interfaz
/// (`-PRUEBAS_UI_LUPA_SINTETICA`). Permite recorrer la MISMA pantalla y el MISMO modelo de la lupa en el
/// Simulator, que no tiene cámara. La «imagen» es una carta de colores fija que pasa por los mismos filtros y el
/// mismo recorte que la real; no prueba la cámara, ni el aumento del dispositivo, ni su rendimiento.
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
    private var filtro = FiltroLupa.contraste
    private var aumento = 1.0
    private let contexto = CIContext()
    private let carta: CIImage

    init(permiso: Permiso, hayCamara: Bool = true) {
        self.hayCamara = hayCamara
        self.permiso = permiso == .concedido ? .concedido : .porPreguntar
        denegar = permiso == .porPreguntarYDenegar
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
        carta = CIImage(cgImage: imagen.cgImage!)
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

    func fijarFiltro(_ nuevo: FiltroLupa) {
        filtro = nuevo
        pintar()
    }

    /// La carta no cambia: congelar no tiene nada que detener.
    func congelar(_ congelada: Bool) {}

    private func pintar() {
        guard token != tokenSinCaptura else { return }
        let resultado = filtro.aplicar(a: FiltroLupa.recorte(carta, escala: aumento))
        capa.contents = contexto.createCGImage(resultado, from: resultado.extent)
    }
}
#endif

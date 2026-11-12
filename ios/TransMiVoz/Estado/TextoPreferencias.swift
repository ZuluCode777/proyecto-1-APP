import Foundation

/// Textos de la pantalla Preferencias. Dicen lo que la app hace HOY.
enum TextoPreferencias {
    static let tituloVoz = "Voz de la app"
    static let etiquetaVoz = "Avisos hablados por la app"
    static let notaVoz = "Es el mismo interruptor de la pestaña Sesión. Controla si la app dice en voz alta las medidas y los avisos del accesorio, y solo por una salida de audio privada (auriculares con cable o Bluetooth). El enlace con el accesorio no está autenticado, así que al empezar cada conexión los avisos llevan la reserva «\(TextoAccesorio.reservaEnlace)»; sin detección no significa camino libre. Con VoiceOver activo empieza apagada para no hablar dos veces. Vuelve a su valor inicial al cerrar la app."
    static let sinAccesorio = "La voz de la app no está disponible en este modo."
    static let tituloSistema = "Texto, contraste y VoiceOver"
    static let notaSistema = "El tamaño del texto sigue el ajuste de iOS. Los controles estándar siguen el contraste y el movimiento que elijas en iOS, pero algunos textos secundarios no cambian con «Aumentar contraste». Esta app no tiene un interruptor propio de colores fluorescentes ni de alto contraste. VoiceOver se activa en los ajustes de accesibilidad de iOS."
}

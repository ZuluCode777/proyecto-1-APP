import CoreImage
import QuartzCore
import UIKit
import XCTest
@testable import TransMiVoz

/// Lupa con cámara falsa: permisos, captura solo con la pantalla a la vista y la escena activa, descarte de lo
/// tardío, aumento, filtro, congelado y liberación de la cámara una sola vez por captura.
@MainActor
final class LupaModeloTests: XCTestCase {
    // MARK: Captura solo a la vista

    func testNoSeAbreNadaSinPantallaYEscenaActivas() {
        let banco = BancoLupa()
        XCTAssertEqual(banco.modelo.estado, .enPausa)
        banco.modelo.pantallaVisible(true)
        XCTAssertEqual(banco.modelo.estado, .enPausa, "a la vista pero con la escena inactiva")
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.modelo.estado, .iniciando)
        XCTAssertEqual(banco.camara.llamadas, ["iniciar"])
    }

    func testListaAplicaFiltroYAumentoYLoAnunciaUnaVez() {
        let banco = BancoLupa()
        banco.abrir(maximo: 8)
        XCTAssertEqual(banco.modelo.estado, .activa)
        XCTAssertEqual(banco.camara.llamadas, ["iniciar", "filtro:contraste", "aumento:1.0", "congelar:false"])
        XCTAssertEqual(banco.avisos.anuncios, ["Lupa lista. Imagen en vivo."])
        banco.modelo.fijarAumento(2)
        banco.modelo.pantallaVisible(true)
        XCTAssertEqual(banco.avisos.anuncios.count, 1, "sin cambio de estado no se repite el anuncio")
    }

    func testSalirDeLaPestanaSueltaLaCamaraUnaSolaVez() {
        let banco = BancoLupa()
        banco.abrir()
        banco.modelo.pantallaVisible(false)
        XCTAssertEqual(banco.modelo.estado, .enPausa)
        XCTAssertEqual(banco.camara.veces("detener"), 1)
        banco.modelo.pantallaVisible(false)
        banco.modelo.escenaActiva(false)
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.camara.veces("detener"), 1, "ya estaba suelta")
        XCTAssertEqual(banco.camara.veces("iniciar"), 1, "fuera de la pestaña no vuelve a abrir")
        banco.modelo.pantallaVisible(true)
        XCTAssertEqual(banco.camara.veces("iniciar"), 2)
        XCTAssertEqual(banco.modelo.estado, .iniciando)
    }

    func testPasarASegundoPlanoSueltaLaCamaraYAlVolverLaReabre() {
        let banco = BancoLupa()
        banco.abrir()
        banco.modelo.escenaActiva(false)
        XCTAssertEqual(banco.modelo.estado, .enPausa)
        XCTAssertEqual(banco.camara.veces("detener"), 1)
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.camara.veces("iniciar"), 2)
        banco.camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: 8))
        XCTAssertEqual(banco.modelo.estado, .activa)
    }

    func testSalirMientrasAbreDescartaLoQueLlegueTarde() {
        let banco = BancoLupa()
        banco.mostrar()
        let primero = banco.camara.tokenVigente
        banco.modelo.pantallaVisible(false)
        XCTAssertEqual(banco.camara.veces("detener"), 1, "la apertura en curso también se cierra")
        banco.camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: 8), token: primero)
        XCTAssertEqual(banco.modelo.estado, .enPausa)
        XCTAssertEqual(banco.modelo.aumentoMaximo, 1, "la cámara tardía no cambia el rango")
        XCTAssertEqual(banco.camara.llamadas, ["iniciar", "detener"], "nada se aplicó a una captura soltada")

        banco.modelo.pantallaVisible(true)
        XCTAssertNotEqual(banco.camara.tokenVigente, primero, "cada captura lleva su token")
        banco.camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: 8), token: primero)
        XCTAssertEqual(banco.modelo.estado, .iniciando, "la lista de la captura anterior no cuenta")
        banco.camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: 8))
        XCTAssertEqual(banco.modelo.estado, .activa)
    }

    // MARK: Permiso

    func testElPermisoSeExplicaAntesDeProvocarElAvisoDelSistema() {
        let banco = BancoLupa(permiso: .porPreguntar)
        banco.mostrar()
        XCTAssertEqual(banco.modelo.estado, .permisoPorPedir)
        XCTAssertEqual(banco.camara.llamadas, [], "mostrar la pantalla no pide permiso ni abre la cámara")
        banco.modelo.continuarTrasExplicacion()
        XCTAssertEqual(banco.modelo.estado, .pidiendoPermiso)
        XCTAssertEqual(banco.camara.llamadas, ["pedirPermiso"])
        banco.modelo.continuarTrasExplicacion()
        XCTAssertEqual(banco.camara.veces("pedirPermiso"), 1, "el aviso no se pide dos veces")
        banco.camara.responder(.concedido)
        XCTAssertEqual(banco.camara.veces("iniciar"), 1)
        XCTAssertEqual(banco.modelo.estado, .iniciando)
    }

    func testAhoraNoNoPideNadaYSePuedeRetomar() {
        let banco = BancoLupa(permiso: .porPreguntar)
        banco.mostrar()
        banco.modelo.posponerPermiso()
        XCTAssertEqual(banco.modelo.estado, .permisoPospuesto)
        banco.modelo.continuarTrasExplicacion()
        XCTAssertEqual(banco.camara.llamadas, [], "«Ahora no» no pide permiso ni abre la cámara")
        banco.modelo.pantallaVisible(false)
        banco.modelo.pantallaVisible(true)
        XCTAssertEqual(banco.modelo.estado, .permisoPospuesto, "no vuelve a explicarlo solo")

        banco.modelo.retomarPermiso()
        XCTAssertEqual(banco.modelo.estado, .permisoPorPedir)
        banco.modelo.continuarTrasExplicacion()
        XCTAssertEqual(banco.camara.llamadas, ["pedirPermiso"])
    }

    func testAhoraNoSoloValeEnLaExplicacion() {
        let banco = BancoLupa()
        banco.abrir()
        banco.modelo.posponerPermiso()
        banco.modelo.retomarPermiso()
        XCTAssertEqual(banco.modelo.estado, .activa, "con la lupa activa no hay nada que posponer")
    }

    func testPermisoQueLlegaTardeConLaPantallaFueraNoArrancaNada() {
        let banco = BancoLupa(permiso: .porPreguntar)
        banco.mostrar()
        banco.modelo.continuarTrasExplicacion()
        banco.modelo.pantallaVisible(false)
        banco.camara.responder(.concedido)
        XCTAssertEqual(banco.camara.veces("iniciar"), 0)
        XCTAssertEqual(banco.modelo.estado, .enPausa)
        banco.modelo.pantallaVisible(true)
        XCTAssertEqual(banco.camara.veces("iniciar"), 1, "al volver, con el permiso ya dado, abre")
    }

    func testElAvisoDePermisoDejaLaEscenaInactivaYNoCancelaLaPeticion() {
        let banco = BancoLupa(permiso: .porPreguntar)
        banco.mostrar()
        banco.modelo.continuarTrasExplicacion()
        banco.modelo.escenaActiva(false)
        XCTAssertEqual(banco.modelo.estado, .pidiendoPermiso)
        banco.camara.responder(.concedido)
        XCTAssertEqual(banco.camara.veces("iniciar"), 0, "la escena sigue inactiva")
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.camara.veces("iniciar"), 1)
    }

    func testPermisoDenegadoORestringidoNoAbreLaCamaraYLoDice() {
        for (permiso, estado) in [(PermisoCamara.denegado, EstadoLupa.permisoDenegado), (.restringido, .permisoRestringido)] {
            let banco = BancoLupa(permiso: permiso)
            banco.mostrar()
            XCTAssertEqual(banco.modelo.estado, estado)
            XCTAssertEqual(banco.camara.llamadas, [])
            XCTAssertEqual(banco.avisos.anuncios, [TextoLupa.descripcion(estado)])
        }
    }

    func testDenegarEnElAvisoDelSistemaMuestraLaAyuda() {
        let banco = BancoLupa(permiso: .porPreguntar)
        banco.mostrar()
        banco.modelo.continuarTrasExplicacion()
        banco.camara.responder(.denegado)
        XCTAssertEqual(banco.modelo.estado, .permisoDenegado)
        XCTAssertEqual(banco.camara.veces("iniciar"), 0)
        XCTAssertEqual(banco.avisos.anuncios, [TextoLupa.descripcion(.permisoDenegado)])
    }

    func testSinCamaraNoPideNiAbreNada() {
        let banco = BancoLupa(permiso: .porPreguntar, hayCamara: false)
        banco.mostrar()
        XCTAssertEqual(banco.modelo.estado, .sinCamara)
        banco.modelo.continuarTrasExplicacion()
        XCTAssertEqual(banco.camara.llamadas, [])
        XCTAssertEqual(banco.avisos.anuncios, [TextoLupa.descripcion(.sinCamara)])
    }

    // MARK: Fallo

    func testElFalloSueltaLaCamaraYReintentarAbreOtraCaptura() {
        let banco = BancoLupa()
        banco.mostrar()
        let primero = banco.camara.tokenVigente
        banco.camara.emitir(.fallo)
        XCTAssertEqual(banco.modelo.estado, .error)
        XCTAssertEqual(banco.camara.veces("detener"), 1)
        XCTAssertEqual(banco.avisos.anuncios(.urgente), [TextoLupa.descripcion(.error)])
        banco.modelo.pantallaVisible(true)
        XCTAssertEqual(banco.camara.veces("iniciar"), 1, "un error no se reintenta solo")

        banco.modelo.reintentar()
        XCTAssertEqual(banco.modelo.estado, .iniciando)
        XCTAssertEqual(banco.camara.veces("iniciar"), 2)
        banco.camara.emitir(.fallo, token: primero)
        XCTAssertEqual(banco.modelo.estado, .iniciando, "el fallo de la captura anterior no cuenta")
        banco.camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: 8))
        XCTAssertEqual(banco.modelo.estado, .activa)
        XCTAssertEqual(banco.camara.veces("detener"), 1)
    }

    func testSalirLimpiaElErrorYAlVolverSeIntentaDeNuevo() {
        let banco = BancoLupa()
        banco.mostrar()
        banco.camara.emitir(.fallo)
        banco.modelo.pantallaVisible(false)
        banco.modelo.pantallaVisible(true)
        XCTAssertEqual(banco.modelo.estado, .iniciando)
        XCTAssertEqual(banco.camara.veces("iniciar"), 2)
        XCTAssertEqual(banco.camara.veces("detener"), 1, "la captura fallida ya se había soltado")
    }

    // MARK: Aumento

    func testElAumentoSeAjustaAlRangoDelDispositivo() {
        let banco = BancoLupa()
        banco.abrir(maximo: 123)
        XCTAssertEqual(banco.modelo.aumentoMaximo, LupaModelo.aumentoMaximoOfrecido, "se limita aunque el dispositivo admita más")
        banco.modelo.fijarAumento(50)
        XCTAssertEqual(banco.modelo.aumento, LupaModelo.aumentoMaximoOfrecido)
        banco.modelo.fijarAumento(0.2)
        XCTAssertEqual(banco.modelo.aumento, 1)
        banco.modelo.fijarAumento(2.5)
        XCTAssertEqual(banco.modelo.aumento, 2.5)
        XCTAssertEqual(Array(banco.camara.llamadas.suffix(3)), ["aumento:10.0", "aumento:1.0", "aumento:2.5"])
    }

    func testUnDispositivoConMenosRangoLimitaElAumento() {
        let banco = BancoLupa()
        banco.abrir(maximo: 4)
        XCTAssertEqual(banco.modelo.aumentoMaximo, 4)
        banco.modelo.fijarAumento(9)
        XCTAssertEqual(banco.modelo.aumento, 4)
        XCTAssertTrue(banco.modelo.puedeAcercar)
    }

    func testSinAumentoDisponibleNoSeOfreceAcercar() {
        let banco = BancoLupa()
        banco.abrir(maximo: 1)
        XCTAssertFalse(banco.modelo.puedeAcercar)
        banco.modelo.fijarAumento(3)
        XCTAssertEqual(banco.modelo.aumento, 1)
    }

    func testAlVolverAAbrirElAumentoElegidoSeAjustaAlRangoNuevo() {
        let banco = BancoLupa()
        banco.abrir(maximo: 8)
        banco.modelo.fijarAumento(6)
        banco.modelo.pantallaVisible(false)
        banco.modelo.pantallaVisible(true)
        banco.camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: 4))
        XCTAssertEqual(banco.modelo.aumento, 4)
        XCTAssertEqual(banco.camara.llamadas.last, "congelar:false")
        XCTAssertTrue(banco.camara.llamadas.contains("aumento:4.0"))
    }

    // MARK: Filtro y congelado

    func testElFiltroSeAplicaYSeAnunciaSoloSiCambia() {
        let banco = BancoLupa()
        banco.modelo.fijarFiltro(.fluorescente)
        XCTAssertEqual(banco.camara.llamadas, [], "sin cámara abierta solo se recuerda")
        banco.abrir()
        XCTAssertTrue(banco.camara.llamadas.contains("filtro:fluorescente"), "se aplica al abrir")
        banco.modelo.fijarFiltro(.invertir)
        banco.modelo.fijarFiltro(.invertir)
        XCTAssertEqual(banco.camara.veces("filtro:invertir"), 1)
        XCTAssertEqual(banco.avisos.anuncios.last, "Filtro: Invertir.")
        XCTAssertEqual(banco.avisos.anuncios.filter { $0.hasPrefix("Filtro") }.count, 1)
    }

    func testCongelarYReanudar() {
        let banco = BancoLupa()
        banco.modelo.alternarCongelada()
        XCTAssertFalse(banco.modelo.congelada, "sin imagen no hay nada que congelar")
        banco.abrir()
        banco.modelo.alternarCongelada()
        XCTAssertTrue(banco.modelo.congelada)
        XCTAssertEqual(banco.camara.llamadas.last, "congelar:true")
        XCTAssertEqual(banco.avisos.anuncios.last, "Imagen congelada.")
        banco.modelo.alternarCongelada()
        XCTAssertFalse(banco.modelo.congelada)
        XCTAssertEqual(banco.camara.llamadas.last, "congelar:false")
        XCTAssertEqual(banco.avisos.anuncios.last, "Imagen en vivo.")
    }

    func testCongeladaNoSeAlejaPorDebajoDelAumentoAlCongelar() {
        let banco = BancoLupa()
        banco.abrir(maximo: 8)
        banco.modelo.fijarAumento(4)
        banco.modelo.alternarCongelada()
        XCTAssertEqual(banco.modelo.aumentoPiso, 4)
        banco.modelo.fijarAumento(2)
        XCTAssertEqual(banco.modelo.aumento, 4, "la imagen fija ya viene con ese aumento: no se puede alejar")
        banco.modelo.fijarAumento(6)
        XCTAssertEqual(banco.modelo.aumento, 6, "acercar más sí")
        banco.modelo.alternarCongelada()
        XCTAssertEqual(banco.modelo.aumentoPiso, 1)
        banco.modelo.fijarAumento(2)
        XCTAssertEqual(banco.modelo.aumento, 2, "en vivo vuelve a poder alejarse")
    }

    func testCongeladaAlMaximoYaNoOfreceAcercar() {
        let banco = BancoLupa()
        banco.abrir(maximo: 8)
        banco.modelo.fijarAumento(8)
        banco.modelo.alternarCongelada()
        XCTAssertFalse(banco.modelo.puedeAcercar)
        banco.modelo.alternarCongelada()
        XCTAssertTrue(banco.modelo.puedeAcercar)
    }

    func testSalirDescongelaYAlVolverLaImagenEsEnVivo() {
        let banco = BancoLupa()
        banco.abrir()
        banco.modelo.alternarCongelada()
        banco.modelo.pantallaVisible(false)
        XCTAssertFalse(banco.modelo.congelada)
        banco.modelo.pantallaVisible(true)
        banco.camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: 8))
        XCTAssertFalse(banco.modelo.congelada)
        XCTAssertEqual(banco.camara.llamadas.last, "congelar:false")
    }

    // MARK: Textos

    func testLosTextosSoloPrometenAmpliarLaImagen() {
        var textos: [String] = []
        for estado in EstadoLupa.allCases {
            textos.append(TextoLupa.descripcion(estado))
            if let anuncio = TextoLupa.anuncio(estado) { textos.append(anuncio) }
        }
        textos += TextoLupa.parrafosPermiso
        textos += FiltroLupa.allCases.map(\.nombre)
        textos += [TextoLupa.visor, TextoLupa.fuenteSintetica, TextoLupa.permisoAlternativa, TextoLupa.imagenEnVivo, TextoLupa.imagenCongelada]
        textos += [TextoLupa.tituloPermiso, TextoLupa.activarLupa, TextoLupa.sinMasAumento, TextoLupa.acercarCongelada]
        let prohibidas = ["ocr", "autobús", "autobus", "obstáculo", "obstaculo", "reconoc", "identific", "detecta", "lee el texto", "lector"]
        for texto in textos {
            for palabra in prohibidas {
                XCTAssertFalse(texto.lowercased().contains(palabra), "«\(texto)» promete «\(palabra)»")
            }
        }
        XCTAssertTrue(TextoLupa.visor.contains("VoiceOver no describe"), "el visor dice que VoiceOver no lo lee")
        XCTAssertTrue(TextoLupa.parrafosPermiso.contains { $0.contains("no se guarda ni se envía") })
    }

    func testLaImagenDeLaLupaNoSeInvierteConInvertirColores() {
        XCTAssertTrue(VistaDeCapa(capa: CALayer()).accessibilityIgnoresInvertColors)
    }

    func testElAumentoSeDiceConComaYEnPlural() {
        XCTAssertEqual(TextoLupa.aumento(1), "1 aumento")
        XCTAssertEqual(TextoLupa.aumento(1.5), "1,5 aumentos")
        XCTAssertEqual(TextoLupa.aumento(8), "8 aumentos")
    }

    func testElRecorteAmpliaElCentroYNoReduceNunca() {
        let base = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5)).cropped(to: CGRect(x: 0, y: 0, width: 100, height: 200))
        XCTAssertEqual(FiltroLupa.recorte(base, escala: 2).extent, CGRect(x: 25, y: 50, width: 50, height: 100))
        XCTAssertEqual(FiltroLupa.recorte(base, escala: 1).extent, base.extent)
        XCTAssertEqual(FiltroLupa.recorte(base, escala: 0.5).extent, base.extent)
        for filtro in FiltroLupa.allCases {
            XCTAssertEqual(filtro.aplicar(a: base).extent, base.extent, "\(filtro.nombre) no cambia el encuadre")
        }
    }
}

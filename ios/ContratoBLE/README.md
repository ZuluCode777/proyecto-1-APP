# ContratoBLE

Paquete Swift (solo Foundation) con el decodificador del contrato BLE v1.0 del accesorio de proximidad y la validación de sesión. Contrato: [docs/expoandes/contrato-ble.md](../../docs/expoandes/contrato-ble.md). Vectores compartidos con el firmware: [contratos/ble/](../../contratos/ble/).

**No incluye Core Bluetooth.** El transporte (EA-11/EA-12) llama a la sesión con eventos y tiempos. Nada aquí prueba radar ni enlace físico.

## Productos

| Producto | Para qué |
| --- | --- |
| `ContratoBLE` | Núcleo. Es lo que enlaza la app. |
| `ContratoBLEVectores` | Ejecutor de `vectores.txt` y `sesiones.txt`. Solo en objetivos de prueba. |

Plataformas: iOS 15, macOS 12. Herramientas Swift 5.9 o posterior.

## API pública (`import ContratoBLE`)

```swift
IdentificadoresBLE.servicio / .caracteristicaInformacion / .caracteristicaMedicion   // String

try InformacionAccesorio.decodificar(_ datos: Data) -> InformacionAccesorio       // throws ErrorContrato
try Medicion.decodificar(_ datos: Data, informacion: InformacionAccesorio) -> Medicion

var sesion = SesionProximidad(accesorioElegido: id, politica: .exigirAutenticado, modo: .real)
sesion.conectar(accesorio: id, enlace: NivelEnlace)                          -> ResultadoEvento
sesion.registrarInformacion(_ datos: Data)                                   -> ResultadoEvento
sesion.registrarReferencia(inicioLecturaMs:, finLecturaMs:, datos:)          -> ResultadoEvento
sesion.recibirNotificacion(_ datos: Data, recibidaEnMs: Milisegundos)        -> ResultadoEvento
sesion.evaluar(ahoraMs: Milisegundos)                                        // al menos cada 100 ms; caduca por silencio (>500 ms) o por cota + transcurrido + 20 > 500
sesion.necesitaReferencia(ahoraMs:) -> Bool                                  // sincronizando o referencia > 30 s
sesion.reanudar()                                                            // al volver del fondo
sesion.desconectar()

sesion.estado: EstadoSesion          // .desconectada .esperandoInformacion .sincronizando
                                     // .rechazada(motivo) .sinDatos(motivo) .radarNoDisponible(salud)
                                     // .sinBlanco .presencia .objetivo(distanciaMm:, azimutCentesimas:)
sesion.enlaceAutenticado, .esSimulada, .tramasPerdidas, .ultimaCotaEdadMs, .informacion
```

- `Milisegundos` es `Int64` de un reloj **monotónico** del iPhone. La sesión no lee ningún reloj.
- Los métodos `mutating` son `@discardableResult`. `etiqueta` de `EstadoSesion` y `ResultadoEvento` da el texto que usan los vectores.
- `NivelEnlace` lo **afirma el transporte**; `.desconocido` y `.sinCifrar` se rechazan con las dos políticas, y `.cifradoSinAutenticar` solo con `permitirAsociacionSinMITM` (demostración: la sesión queda no autenticada). En iOS la app no puede afirmar `.cifradoAutenticado` (no hay evidencia que rechace a un impostor sin protección): ver el [contrato §6](../../docs/expoandes/contrato-ble.md#6-autenticación-y-selección) y «Seguridad del enlace» en [ea-15-ios-ble-audio.md](../../docs/expoandes/ea-15-ios-ble-audio.md); la app de iOS usa la política de demostración desde la decisión de A1 del 12/11/2026, solo para la feria.
- Orden del transporte, reglas de reloj y estados: [secciones 4 a 6 del contrato](../../docs/expoandes/contrato-ble.md#4-qué-significa-cada-estado-para-el-cliente).

## Probar

```bash
swift test --package-path ios/ContratoBLE
```

Ejecuta pruebas directas y los vectores. Se verificó en Linux con Swift 6.2 (`swift:6.2`); la corrida en macOS la hace el job `swift` de [contrato-ble.yml](../../.github/workflows/contrato-ble.yml) y, después, Xcode.

## Usar los mismos vectores desde pruebas de Xcode

```swift
import ContratoBLEVectores

func testVectoresDelContrato() throws {
    // directorio = <raíz del repositorio>/contratos/ble
    let resumen = try ejecutarVectores(directorio: URL(fileURLWithPath: rutaDelRepositorio)
        .appendingPathComponent("contratos/ble"))
    XCTAssertTrue(resumen.fallos.isEmpty, resumen.fallos.joined(separator: "\n"))
}
```

`ejecutarVectores()` sin argumentos deduce la carpeta de la ubicación del archivo fuente del paquete (sirve cuando el paquete se referencia por ruta local, como en `swift test`). No copiar los vectores al objetivo de pruebas de la app: se leen de `contratos/ble/` para que firmware y iPhone no diverjan.

# CI de iOS en runners macOS de GitHub (iOS-CI, #68)

Estado: **código y workflow preparados, sin ejecución real todavía.** Este documento no acredita que la app compile en macOS: eso lo prueba una ejecución aprobada de `.github/workflows/ios.yml`, que el PR debe enlazar con su SHA. Preparado y verificado solo en Linux (ver [Qué se verificó antes de la primera ejecución](#qué-se-verificó-antes-de-la-primera-ejecución)).

## Qué comprueba y qué no

| Comprueba | No comprueba |
| --- | --- |
| Compilación para iOS Simulator | App instalable en un iPhone |
| XCTest: entrada, decodificación del contrato HTTP, cliente HTTP simulado (401, 429, 413, 503, 5xx, red caída, plazo, cancelación, respuesta tardía), Llavero, ajustes, sesión local, vectores BLE compartidos | Firma, cuenta de Apple, certificados |
| Pruebas de interfaz en Simulator y `performAccessibilityAudit()` (tamaño normal y Dynamic Type `AccessibilityXXXL`) | VoiceOver real, háptica, audio, auriculares |
| Compilación `generic/platform=iOS` (Release) sin firma | Enlace BLE/radar real, emparejamiento, latencia |
| Que el proyecto, el esquema y los vectores existen (si faltan, **falla**) | Permisos de Bluetooth, micrófono, ubicación; segundo plano |

Los fixtures BLE (`contratos/ble/`) y los HTTP (`ios/TransMiVozTests/FixturesHTTP.swift`) son **simulaciones**: valores inventados con la forma del contrato. No son mediciones ni respuestas del servidor real. La sesión local de la app está marcada «simulada» y no afirma ningún enlace autenticado.

## Herramientas registradas

| Elemento | Valor | Origen |
| --- | --- | --- |
| Runner | `macos-26` (estándar, gratuito en repositorio público) | [#69](https://github.com/ZuluCode777/proyecto-1-APP/pull/69), ejecución `42335167808` |
| Xcode | **26.6**, build **17F113**, `DEVELOPER_DIR=/Applications/Xcode_26.6.app/Contents/Developer` | #69 informó la versión; la ruta `Xcode_26.6.app` es la convención de las imágenes y se confirma en la primera ejecución (el paso «Herramientas» falla si no coincide) |
| iOS del Simulator | Runtime más nuevo con versión mayor **26** | `IOS_MAYOR_ESPERADO` |
| Dispositivo del Simulator | **iPhone 17** exacto, elegido por UDID | `SIMULADOR_NOMBRE` |
| Destino sin firma | `generic/platform=iOS`, `CODE_SIGNING_ALLOWED=NO` | |
| Mínimo del proyecto | iOS 17.0, Xcode 16+ | `IPHONEOS_DEPLOYMENT_TARGET`, `objectVersion 77` |

Todo está en el bloque `env` del job y se vuelve a registrar en `ios/salida/herramientas.txt` (artefacto). **Nunca se sustituye en silencio:** si Xcode, su build, el runtime de iOS o el modelo de iPhone no coinciden, `comprobar-ios.sh` falla y lista lo que encontró. Para cambiar de versión se edita el `env` en un PR, no se deja al azar de la imagen.

## Qué corre

`.github/workflows/ios.yml`, permisos `contents: read`, sin secretos de Apple, del backend ni del Windows personal. Dispara en PR que toquen `ios/**`, `contratos/**` o el propio workflow, y en cada push a `main` (y manualmente). CI web (`ci.yml`) y `contrato-ble.yml` no se modifican.

0. Autocomprobación del script (`ios/scripts/probar-comprobar-ios.sh`, sin Xcode): el script no contiene borrados, no pisa resultados previos y los pasos fallan sin herramientas de Apple.
1. `herramientas`: registra y valida Xcode/SDK/runtimes.
2. `compilar-simulador`: `xcodebuild build` Debug para el Simulator elegido.
3. `pruebas-simulador`: `xcodebuild test` (unitarias + interfaz). Después `xcresulttool` verifica ≥ 50 pruebas ejecutadas, 0 fallidas y 0 omitidas.
4. `compilar-dispositivo`: `xcodebuild build` Release para iPhone genérico sin firma.

Los pasos 2 a 4 corren aunque uno anterior falle, para no ocultar fallos; el job falla si cualquiera falla. No hay `continue-on-error`, ni captura que sustituya a una prueba.

## Reproducirlo en un Mac

Mismos comandos que la CI (el workflow solo llama a este script):

```bash
export DEVELOPER_DIR=/Applications/Xcode_26.6.app/Contents/Developer   # opcional; el que uses
export XCODE_VERSION_EXACTA=26.6 XCODE_BUILD_EXACTO=17F113              # opcional: exigir lo mismo que la CI
ios/scripts/comprobar-ios.sh todo
```

Los resultados de una ejecución local van a una carpeta nueva `ios/salida/<fecha UTC>-<pid>/` (se imprime al empezar); con `SALIDA=ruta` se fija una carpeta propia, que no debe contener ya los resultados del mismo paso. **El script no borra ni sobrescribe evidencia:** si un log, un resumen o un `.xcresult` del paso ya existe, falla antes de empezar y nombra la ruta. En la CI, `SALIDA=ios/salida` es una carpeta nueva del runner y cada paso escribe archivos con su propio nombre (`herramientas.txt`, `xcodebuild-<paso>.log`, `<paso>.xcresult`, `<paso>-resumen.json`, `simulador-udid-<paso>.txt`).

Comandos que ejecuta, con `SALIDA=ios/salida` como en la CI (`UDID` del paso anterior):

```bash
xcodebuild build -project ios/TransMiVoz.xcodeproj -scheme TransMiVoz -configuration Debug \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath ios/salida/DerivedData \
  -resultBundlePath ios/salida/compilar-simulador.xcresult
xcodebuild test -project ios/TransMiVoz.xcodeproj -scheme TransMiVoz -configuration Debug \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath ios/salida/DerivedData \
  -resultBundlePath ios/salida/pruebas-simulador.xcresult
xcodebuild build -project ios/TransMiVoz.xcodeproj -scheme TransMiVoz -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath ios/salida/DerivedDataDispositivo \
  -resultBundlePath ios/salida/compilar-dispositivo.xcresult \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM=""
```

## Localizar proyecto, esquema y resultados

- Proyecto: `ios/TransMiVoz.xcodeproj`. Esquema compartido: `TransMiVoz` (targets `TransMiVoz`, `TransMiVozTests`, `TransMiVozUITests`).
- Cada ejecución sube el artefacto `ios-resultados-<SHA>` (30 días, también si falló): `herramientas.txt`, `xcodebuild-*.log` crudos, `*-resumen.json` y los `.xcresult`. El resumen del job (`GITHUB_STEP_SUMMARY`) lista SHA, SHA de la rama del PR, URL de la ejecución y versión de Xcode.
- Descargar: pestaña Actions ▸ ejecución ▸ Artifacts, o `gh run download <id> -n ios-resultados-<SHA>`. Abrir un `.xcresult`: doble clic en un Mac con Xcode, o `xcrun xcresulttool get test-results summary --path X.xcresult`.
- No se guarda ninguna app del Simulator como artefacto. Si algún día se guarda, hay que etiquetarla «iOS Simulator, arquitectura arm64/x86_64 del runner», y no se instala en un iPhone.

## Criterios de #68 y estado

| Criterio | Estado |
| --- | --- |
| Proyecto abrible, esquema compartido, pruebas y recursos locales | Hecho en el repositorio; **falta confirmarlo con una apertura real en Xcode** (no hubo Mac para crearlo) |
| Job en macOS para PR del cliente/contratos/workflow y `main` | Escrito; **sin ejecución** |
| Simulator: compilar, XCTest, UI y auditoría; fallo = job rojo | Escrito; **sin ejecución** |
| Compilación iPhone genérico sin firma | Escrita; **sin ejecución** |
| Fixtures HTTP y BLE compartidos, simulación distinguida | Hecho (ver «Límites») |
| CI web intacta, permisos mínimos, sin secretos | Hecho |
| Logs y `.xcresult` ligados al SHA | Escrito; **sin ejecución** |
| Guía local de apertura, firma, instalación, recuperación | Hecha ([ios/README.md](../../ios/README.md)); **falta validarla el 10/11 con otra persona** |
| PR y ejecución real aprobada adjuntos | **Pendiente.** No cerrar #68 solo con el YAML |

## Qué se verificó antes de la primera ejecución

Solo en Linux, sin Xcode: el código sin SwiftUI/Keychain/Simulator (dominio, red, estado, sesión local, ajustes, guardia de contenido) compila y sus 78 pruebas pasan con `swift test` (Swift 6.2.4 en `docker.io/library/swift:6.2`) junto al paquete `ContratoBLE` y los vectores compartidos; los fixtures HTTP válidos pasan `AgentReplySchema` real (zod); `project.pbxproj` y el esquema se leen con un analizador y todos sus identificadores están definidos; el script elige el Simulator correctamente con datos simulados de `simctl`. **No se compiló SwiftUI, no se abrió el proyecto en Xcode y no se ejecutó ninguna prueba de interfaz ni auditoría.** Un fallo en la primera ejecución en `macos-26` es esperable y se corrige con el log del artefacto.

## Pendiente fuera de la CI

Firma, instalación, BLE/radar reales, VoiceOver real, audio, permisos, Developer Mode, caducidad de Personal Team: [ios/README.md](../../ios/README.md#firmar-instalar-y-recuperar-iphone-real) y los issues #35 y #48. La CI no los cierra.

# Compra local: candidatos y comprobaciones previas

Consulta: 2 de noviembre de 2026. ExpoAndes: 17 de noviembre. Equipo: dos personas de app y tres de hardware; Mac/Xcode disponible y ningún componente comprado, según el equipo. Esta es una investigación de compra, no una orden ni una reserva. No se contactó a vendedores ni se compró nada.

**Actualización del 6/11:** el equipo compró una placa ESP32-S3-N16R8 y un radar DFRobot SEN0395. Comercio, precio y cantidades están por registrar en el [plan de firmware](plan-firmware.md), que también explica por qué el SEN0395 da presencia dentro de una ventana y no distancia. El resto de este documento conserva la consulta del 2/11.

## Resultado práctico

Hay placas ESP32-S3 y radares de presencia anunciados por comercios de Bogotá. **No se confirmó inventario local de un kit mmWave que resuelva detección genérica de obstáculos estáticos.** No comprar por la palabra «radar»: presencia, seguimiento humano y medición de reflectores son funciones diferentes. El [informe técnico](investigacion-hardware-ios.md) compara LD2450, XM125 y kits TI y explica sus límites.

La compra debe cerrar tres preguntas: qué mide el módulo exacto, cuándo puede estar físicamente en Bogotá y cómo se comprueba esa medición antes del 17. Una ficha con botón de compra no confirma entrega; un vendedor colombiano con producto importado tampoco prueba inventario en Bogotá.

## Páginas del vendedor abiertas

Todas carecen de fecha editorial comprobada; valores son los publicados al consultarlas, en COP. Stock, impuestos adicionales, entrega y referencia efectiva requieren reconfirmación antes de pagar.

| Comercio / producto | Precio y disponibilidad observados | Encaje y límite |
| --- | --- | --- |
| [Sigma: ESP32-S3-N16R8](https://www.sigmaelectronica.net/producto/esp32-s3-n16r8/) | $35.700; cinco unidades; precio por unidad desde tres: $34.986. | Placa de desarrollo candidata para UART/BLE y para balizas de maqueta. Confirmar revisión, pines soldados y esquema. Dirección publicada: Av. Cra. 24 n.º 61D-65, Bogotá. |
| [Electrosena: ESP32-S3 DevKitC-1 N16R8](https://www.electrosena.com/esp32-s3-devkitc-1-n16r8-240mhz-wifi-24ghz-bt) | $45.000; siete unidades. Página anuncia entrega en Bogotá el mismo día y compra mínima $30.000. | Segunda cotización de placa; plazo es anuncio comercial, no compromiso para este pedido. Confirmar si es placa genérica compatible y conector USB/controlador. |
| [Sigma: Seeed XIAO ESP32-S3 Plus, 102010671](https://www.sigmaelectronica.net/producto/102010671/) | $49.980; ocho unidades. | Alternativa compacta con BLE. Conectores y pads pueden requerir soldadura; no es radar. No hace falta pagar por miniaturización en primer banco. |
| [Electronilab: ESP32-S3 N16R8 DevKitC CH340](https://electronilab.co/tienda/board-esp32-s3-n16r8-devkitc-ch340-wifi-bluetooth-usb-c-dual-sin-soldar/) | $38.900 IVA incluido; **agotado en ficha individual**. | Resultado de búsqueda decía tres unidades, pero página abierta decía agotado. Se conserva discrepancia y prevalece cautela: no se cuenta como disponible. |
| [Sigma: SEN0395, DFRobot 24 GHz](https://www.sigmaelectronica.net/producto/sen0395/) | $179.928; cuatro unidades. | Radar de presencia humana candidato para una demostración de ocupación; **no cierra distancia/dirección a obstáculos**. Su salida y demora deben verificarse en documentación del fabricante y banco. |
| [Sigma: catálogo de presencia](https://www.sigmaelectronica.net/categoria-producto/sensores/movimiento-imu/presencia-humana/) y [catálogo general](https://www.sigmaelectronica.net/catalogo/) | Catálogo muestra 101010001, sensor 24 GHz para XIAO, a $33.677 y seis unidades. Ficha individual no pudo recuperarse. | Candidato de cotización con confianza menor: falta confirmar modelo del radar, magnitudes de salida y compatibilidad. No comprar como LD2450 ni sensor de distancia por inferencia. |
| [Zamux: placa ESP32S3 N16R](https://www.zamux.co/tarjeta-de-desarrollo-esp32s3-n16r) | Ficha y descripción recuperadas; no se verificó precio/stock en el contenido consultado. | Otro comercio local; no entra en una cotización cerrada. Confirmar disponibilidad presencial y referencia exacta. |

Los vendedores son fuentes primarias de su oferta comercial; las especificaciones decisivas deben venir del fabricante. No se adoptan sus afirmaciones genéricas de IA, medicina o seguridad como prueba del proyecto. No se usan publicaciones de marketplace con importación incierta para prometer entrega local.

## Si el radar de presencia no sirve para obstáculos

El [LD2450](investigacion-hardware-ios.md) documenta objetivos móviles; XM125/A121 y kits TI son alternativas técnicas para ensayar reflectores genéricos. En esta búsqueda no se encontró una oferta abierta que acreditara inventario de esos kits en Bogotá. Antes de importar, equipo de hardware debe comprobar préstamo de laboratorio o cotización local con entrega y firmware demostrables. Préstamo es una tarea propuesta, no disponibilidad confirmada.

Una solución complementaria puede usar un sensor de distancia óptico para obstáculos, manteniendo radar para presencia. Eso cambia el origen de la medición y debe explicarse y aprobarse como diseño multimodal; **no se presentará como detección de obstáculos por mmWave**. Se localizó [VL53L1X de Electronilab](https://electronilab.co/tienda/vl53l1x-sensor-de-distancia-tiempo-de-vuelo-30mm-a-4000mm/), $31.900, pero su ficha decía agotado mientras su [categoría](https://electronilab.co/etiqueta-producto/tiempo-de-vuelo/) decía cinco disponibles. No se cuenta como existencias confirmadas. La comparación debe comprobar sensor, placa, tensión lógica, ambiente y materiales; no adoptar afirmaciones comerciales de inmunidad al color o transparencia.

No se recomienda RCWL-0516/HB100 como sustituto económico de radar con distancia: detectar movimiento no entrega distancia y dirección requeridas. Tampoco usar ESP32 sin radar como «radar milimétrico».

## Lista de compra por cerrar, antes de pagar

| Pieza | Cantidad propuesta para cotizar | Condición de compra |
| --- | ---: | --- |
| Placa ESP32 con BLE, USB y UART documentada | Una móvil; dos o tres adicionales solo si se aprueban balizas/repusto | Misma referencia cuando convenga; comprar placa montada, no módulo SMD suelto. Confirmar conexiones y cable USB de datos. |
| Radar y placa de evaluación/adaptación | Una unidad de evaluación primero | Protocolo accesible, SDK/firmware disponible y magnitudes compatibles con los objetivos. Una muestra pasa banco antes de duplicar. |
| Balizas interiores | Dos o tres referencias para maqueta; pueden ser ESP32 adicionales | Identidad y mapa de zonas conocidos; medir cruces de zona con iPhone. No llamarlas sistema de posición métrica. |
| Fuente USB regulada, cables, protoboard, conectores y soporte | Según esquema real | Verificar corriente, lógica de 3,3 V, masa y alimentación del sensor exacto. No alimentar una placa de 5 V desde pin de 3,3 V sin validación. |
| Alimentación portátil | Power bank existente o préstamo, si su salida sostiene carga | Banco USB primero. Verificar apagado automático a baja corriente; evitar diseñar cargador LiPo propio para esta entrega. |
| Adaptador de niveles / regulador | Solo si esquema lo exige | Lo decide interfaz eléctrica real. No asumir tolerancia de 5 V en GPIO ESP32. |

Sin radar seleccionado y sin presupuesto del equipo no existe total de compra válido. Registrar cotización final desglosada, impuestos, transporte, retiro, garantía y plazo antes de aprobar gasto. La investigación no solicita datos de pago ni autoriza compra automática.

## Fechas de decisión propuestas

- **2–3 de noviembre:** definir mediciones, solicitar cotizaciones/préstamo y confirmar inventario real. El equipo hace contactos; no se enviaron mensajes en su nombre.
- **4 de noviembre:** hardware y toolchain en banco o registrar bloqueo real. Conservar prueba de protocolo simulada para que iPhone avance, identificada como simulación.
- **6 de noviembre:** cada objetivo tiene una prueba física inicial y resultado independiente. Si no hay evidencia de obstáculo estático o zona interior, declararlo pendiente y corregir diseño/alcance con equipo; nunca marcarlo aprobado por detectar una persona.
- **12 de noviembre:** congelar componentes y funciones para ensayos. Sustitución posterior exige repetir prueba afectada.

Estas son puertas de planificación, no promesas de entrega ni resultados ya obtenidos. Los tres objetivos pedidos siguen en backlog, con sus bloqueos visibles.

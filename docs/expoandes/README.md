# Segunda entrega: investigación y plan ExpoAndes

Corte de investigación: **2 de noviembre de 2026**. Feria confirmada por el equipo: **17 de noviembre**. Código examinado: `0abca8cbd7dbf95c01ae0fbccdc67804174a13c9`. Esta entrega contiene revisión, investigación y planificación; no implementa ni despliega funciones nuevas.

Comenzar por [plan de ejecución](plan-ejecucion.md), que identifica prioridades, capacidad, dependencias y trabajo paralelo. El [índice de GitHub #26](https://github.com/ZuluCode777/proyecto-1-APP/issues/26) enlaza 27 tareas y es la lista de coordinación vigente; los borradores de tareas incluidos en cada informe son insumos históricos.

| Documento | Qué aporta |
| --- | --- |
| [Acta de alcance y capacidad — EA-01](acta-alcance-capacidad.md) | Registro del 3/11: integrantes, compras y Kiro asignados, presupuesto de COP 150.000–200.000, dedicación sin cuantificar, requisitos y pendientes de #27. |
| [Auditoría de código](auditoria-codigo.md) | Inventario de funciones, flujos, APIs, mapas, 16 hallazgos y reproducciones. |
| [Metro de Bogotá](investigacion-metro.md) | Estado de líneas, 16 estaciones de Línea 1, nombres/alias, fuentes, CRS y separación del servicio operativo. |
| [Render e IA](investigacion-render-ia.md) | Capacidad/costo/operación de Render, asistente determinista, modelos, avisos, privacidad y Kiro. |
| [Hardware e iOS](investigacion-hardware-ios.md) | ESP32, radar externo, Bluetooth/audio, alternativas iPhone, alimentación y propuesta BLE. |
| [Compra en Bogotá](compras-bogota.md) | Candidatos comerciales, precios observados y comprobaciones previas; ninguna reserva o compra. |
| [Arquitectura y experimentos](arquitectura-y-experimentos.md) | Comparación SwiftUI/Capacitor y núcleo local propuesto, propiedad, contratos y experimentos aún pendientes. |
| [Plan de firmware](plan-firmware.md) | Hardware comprado el 6/11 (ESP32-S3-N16R8 y SEN0395), qué mide el radar, diseño del firmware, ensayos de banco y calendario. |
| [Puertas de hardware](puertas-hardware.md) | Criterios propuestos para estáticos, móviles e interior; medidas de audio/enlace y ruta crítica. |
| [Enunciado, rúbrica y correcciones](lectura-rubrica.md) | Doce criterios, enunciado ExpoAndes y reconciliación del 3/11: trabajo reutilizable, comentarios de evaluación, afiche/stand, CANVAS y pendientes. |
| [Corroboración](corroboracion.md) | Pruebas observadas, fuentes contrastadas, datos confirmados y lo que permanece pendiente. |
| [Prototipo iPhone accesible: EA-02](prototipos/ea-02/README.md) | Prototipo desechable con dos variantes, especificación de accesibilidad, evaluación provisional y guion de sesiones de #28. A2 eligió la variante B. |

Las fuentes primarias y sus fechas están junto a las afirmaciones en los informes. Las recomendaciones posteriores de arquitectura ajustan las propuestas iniciales al calendario: SwiftUI **mínimo** condicionado a prueba, conservando backend Next y web; paridad completa permanece como trabajo posterior. Las cifras de ensayo son metas propuestas, no desempeño medido.

Actualización del 3/11: el equipo aportó enunciado ExpoAndes, entrega previa y evaluaciones de documento/MVP. Se leyeron y reconciliaron en la lectura académica; fecha y formato del informe siguen sin especificarse en esos PDF. No se publican originales, calificaciones, formularios ni datos identificables de participantes.

# EA-06 (#32): consulta y recuperación del catálogo

Rama `ea-06-catalogo-recuperable`, desde `origin/main` 7fbee2a, con EA-05.
Implementación inicial y correcciones con Kiro CLI local; recuperación del
cliente completada por Sonnet 5.5 con esfuerzo alto y revisión del orquestador.
No se modificaron la copia operativa, los workflows ni los servicios de Windows.

## Comportamiento

Los 124 códigos de la copia, incluidos los 16 número-letra como `8 G` y `1 P`,
ya resolvían con el helper compartido de búsqueda, reglas y modelo. El cambio
conserva ese resolver y agrega el barrido de regresión; no cambia los datos para
hacerlos coincidir con una deducción.

Antes de adoptar un catálogo, servidor y cliente comprueban que tenga estaciones,
rutas, fecha de consulta válida, geometrías utilizables y referencias coherentes.
Las paradas atendidas usan la misma identidad de estación que el planificador,
incluidos nodos ilegibles y ceros iniciales. Los nombres duplicados legítimos y
las etiquetas de extremos que no son nombres exactos de estaciones se conservan.
La frontera ArcGIS rechaza truncamiento declarado, ausencia de registros y
pérdida de identificadores o geometría; admite horarios nulos y códigos duplicados
que el normalizador deduplica. No exige un número fijo de registros.

El servidor comparte la consulta pendiente. Guarda datos en vivo seis horas;
si la renovación falla conserva el último catálogo válido, su fuente y su fecha,
y reintenta en cinco minutos. Si ya hay datos, los devuelve mientras renueva en
segundo plano. Solo usa la copia al arrancar sin ningún catálogo válido y sin
respuesta utilizable del servicio. Cada capa upstream tiene un límite de 15 s.

El cliente también comparte la consulta pendiente y conserva el último catálogo
válido ante HTTP fallido, vacío o incoherente. La frescura se calcula desde
`source` y `fetchedAt`: seis horas para datos en vivo recientes; cinco minutos
entre intentos con copia, datos viejos o fallos. Recibir otra vez datos antiguos
no los rejuvenece. Mientras la app está montada, comprueba cada minuto si toca
renovar y también al recuperar red o volver a la pestaña. Libera suscripciones y
temporizadores al salir. El límite cliente de 20 s deja margen al respaldo del
servidor. El reintento es visible y accesible en todos los modos, incluso cuando
falló la primera carga en el asistente de ceguera total.

Los resultados se derivan de la búsqueda confirmada y del catálogo actual;
no conservan objetos de rutas viejas con una fecha nueva. Una ruta abierta que
ya no existe ofrece volver. Lista, detalle, respuestas informativas del agente
y plan comunican procedencia; las listas la anuncian al entrar o cambiar sus
metadatos, sin repetirla al enfocar cada ruta. Los controles de paradas, sentido,
calendario y revalidación de EA-05 siguen siendo necesarios para prescribir viajes.
GPS y viajes sin estaciones responden sin acceder a una estación inexistente.
La renovación tampoco reinicia una captura de voz: el reconocimiento conserva
su instancia y usa los callbacks actuales del asistente o de la búsqueda. Al
desmontar, elimina los cuatro handlers y detiene el reconocimiento.

## Qué puede consultarse sin red

Una pestaña que ya cargó el catálogo conserva listas, búsqueda por código,
detalle, plan ya calculado y asistente por reglas. La app puede seguir mostrando
la geometría cargada; las teselas nuevas de OpenStreetMap requieren red.
No hay persistencia entre sesiones ni garantía de arranque offline al recargar.
No se descargan teselas masivamente y no se ofrecen llegadas de buses en tiempo real.

## Procedencia y licencia de la copia

Se conserva `data/transmilenio.json`, consultado originalmente el
2026-09-24T15:16:41.502Z. No se regeneró ni se amplió la evidencia operativa.

El 4 de noviembre de 2026 se consultaron los metadatos públicos del servicio
[ArcGIS de planificación SITP](https://gis.transmilenio.gov.co/arcgis/rest/services/ConsultaSubgerenciaPlanificacionSITP/Consulta_Planificacion_SITP/FeatureServer?f=pjson)
y sus capas 2 y 15. El servicio atribuye los datos a «Transmilenio S.A.,
Dirección TIC, Subgerencia de Planificación del SITP»; las capas no añaden una
licencia explícita. Estos metadatos acreditan atribución, no permiten afirmar
una licencia concreta para la copia ArcGIS. La declaración CC-BY-SA-4.0 del
conjunto GTFS, documentada en la nota EA-05, se mantiene separada y no se
traslada a ArcGIS.

## Evidencia y límites

Las pruebas persistentes cubren códigos, validación, frontera HTTP del servidor,
cache y renovación del cliente, fallos recuperables y ramas reales del TSX de
la interfaz. Los dobles de React/red no son evidencia de hardware ni de voz real.
Verificación final del orquestador sobre el código entregado:

- `pnpm exec tsc --noEmit`: salida 0.
- `pnpm test`: 161 pruebas correctas, ninguna fallida.
- `pnpm build`: salida 0.
- `pnpm verificar http://127.0.0.1:3106`: salida 0, nueve diagnósticos correctos,
  con cámara, micrófono y ubicación simulados.
- Chrome compilado, puerto 3107: cinco escenarios correctos con HTTP, reloj y
  reconocimiento controlados. Comprueban reintento inicial en modo total,
  captura activa durante renovación, recuperación sin recarga con reglas y
  procedencia, renovación del respaldo antiguo y conservación tras HTTP vacío.
  Esta reproducción falló antes de corregir el reintento y el ciclo de voz.
- Revisión independiente de especificación y revisión de estándares: sin
  hallazgos pendientes. Las regresiones de continuidad fallaron antes del
  arreglo y pasan con los handlers actuales y la limpieza al desmontar.

Los scripts de orquestación y sus registros están en
`/tmp/ea06-orquestacion/`; las regresiones persistentes están en `lib/`. La prueba PowerShell del instalador permanece en CI; no hay
`pwsh` instalado localmente. No se accedió a Windows ni se probó hardware físico.

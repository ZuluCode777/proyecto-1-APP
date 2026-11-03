# Corroboración y límites de la revisión

Corte: 2 de noviembre de 2026. Código base: `0abca8cbd7dbf95c01ae0fbccdc67804174a13c9`. La coordinación recibió cuatro investigaciones de Sol 6.1 y una revisión documental de Luna. No se modificó producto, firmware, infraestructura, secretos ni dependencias.

## Pruebas ejecutadas por la coordinación

| Comprobación | Resultado observado | Qué demuestra y qué no |
| --- | --- | --- |
| `pnpm test` | 36 pruebas aprobadas, cero fallos. | Preserva comportamiento cubierto; las paradas de la copia no quedan certificadas por ello. |
| `pnpm exec tsc --noEmit` | Código de salida 0. | Consistencia de tipos actual. |
| `pnpm build` | Compilación de producción aprobada. | Compila en este Linux; no mide memoria de Render. |
| `pnpm verificar http://127.0.0.1:3218` | Nueve de nueve comprobaciones aprobadas con clave de prueba, motor de reglas y dispositivos simulados. | Disponibilidad de capacidades y flujo diagnóstico en Chrome; no comprueba VoiceOver, reconocimiento real, auriculares, radar ni seguridad en calle. |
| Reproducciones del catálogo | Fallan los 16 códigos numéricos; 8 G y 8 T tienen extremos y listas opuestos; catálogo vacío pasa esquema y provoca excepción GPS. | Defectos deterministas reproducidos, no hipótesis. |
| Aclaración del asistente | «Salgo desde Ricaurte» pregunta destino; «Calle 72» vuelve a pedir origen. | Falta estado de aclaración entre turnos. |
| HTTP local sin credenciales | 401. | La configuración local tenía autenticación; la primera ejecución sin clave dio cero pruebas. Repetir con servidor de prueba propio y credenciales conocidas resolvió la configuración del ensayo. No se usó ni publicó la clave existente. |

Entorno observado: Node `26.13.0`, pnpm `12.3.4`; CI exige Node 24. Esta diferencia queda explícita: no se afirma ejecución local en Node 24. Compilación mostró aviso sobre lockfile situado fuera del repositorio, sin impedir resultado. No se ejecutó localmente el ensayo PowerShell del instalador; sigue siendo una comprobación de CI a preservar. No se fusiona nada en esta tarea.

El diagnóstico obtuvo 153 estaciones y 124 rutas en vivo. La copia versionada sigue fechada 24-09-2026. Son observaciones diferentes; no se actualizó la copia ni se certificó todo el inventario operativo de noviembre.

## Fuentes comprobadas de nuevo

Se abrieron las publicaciones oficiales de [nombres de estaciones](https://bogota.gov.co/mi-ciudad/movilidad/asi-se-nombraron-tres-estaciones-metro-de-bogota-tras-votacion), [avance de Línea 1](https://bogota.gov.co/mi-ciudad/movilidad/2026-10/solo-nos-falta-el-1627-para-subirnos-en-linea-1-del-metro-de-bogota), [precalificación de Línea 2](https://bogota.gov.co/mi-ciudad/movilidad/solicitud-precalificacion-construccion-de-linea-2-del-metro-de-bogota) y [catálogo espacial de estaciones](https://datosabiertos.bogota.gov.co/dataset/estaciones-de-la-primera-linea-del-metro-de-bogota). Coinciden con la distinción entre obra, contratación y operación del informe Metro. Los resultados futuros son previsiones.

La documentación de [Render Free](https://render.com/docs/free), sin fecha editorial visible, confirma reposo a los 15 minutos, despertar aproximado de un minuto, 750 horas por espacio de trabajo y pérdida de archivos escritos. Es evidencia de restricciones de plataforma, no de rendimiento del proyecto desplegado. La evaluación de RAM y tamaño de Ollama está documentada en el informe específico.

Se consultó además el [directorio oficial GTFS_dinamicos](https://gis.transmilenio.gov.co/arcgis/rest/services/GTFS_dinamicos?f=pjson): devolvió `services: []`. Eso no demuestra inexistencia de otros feeds. El [portal de datos abiertos del operador](https://www.transmilenio.gov.co/transparencia-y-acceso-a-la-informacion-publica/7-datos-abiertos) es punto institucional de entrada; validar matriz/GTFS, licencia y vigencia sigue siendo tarea del backlog. Corregir la afirmación absoluta del README sobre inexistencia de datos de buses si no puede sostenerse con una fuente actual.

La [política oficial de teselas de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/), sin fecha editorial visible, exige atribución y prohíbe descarga masiva o precarga. No construir mapas offline copiando esas teselas. Datos y último viaje pueden guardarse con su licencia; mapa sin red requiere proveedor y licencia apropiados o una alternativa textual.

Apple documenta [membresía](https://developer.apple.com/help/account/membership/program-enrollment) de USD 99 anuales, con condiciones regionales y posibles exenciones institucionales; no se contrató. La [cuenta Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account) permite pruebas personales, pero perfiles vencen en siete días y requieren reinstalación. TestFlight/App Store y firma deben resolverse antes de prometer distribución gratuita a todo el equipo. Elegibilidad de una exención de Uniandes no fue comprobada.

Se abrió la [documentación oficial de dependencias de issues](https://docs.github.com/en/rest/issues/issue-dependencies?apiVersion=2022-11-28) y se probó una lectura de dependencias del issue histórico #6, sin modificarlo. El backlog nuevo usa aristas nativas cuando la API las admite y también enumera bloqueadores en cada cuerpo.

Todas las fuentes de esta sección se consultaron el 02-11-2026. Confianza alta sobre contenido observado; estado de cuentas, feeds no accesibles y comportamiento físico permanecen pendientes. No se presentan resultados de búsqueda sin abrir como pruebas.

## Documentos previos y privacidad

La rúbrica local se convirtió con MarkItDown y se leyó completa. La revisión independiente de Luna hizo dos pasadas y no encontró errores materiales: 12 criterios, 110 puntos, inferencias identificadas y límites correctos. Se conserva [lectura-rubrica.md](lectura-rubrica.md).

También se revisaron el enunciado inicial, hoja local de entrevistas y transcripción anonimizada. Esta evidencia es cualitativa, de ocho participantes; no demuestra preferencias de toda la población ni mayoría de iPhone, pues no incluye sistema operativo. La prioridad iPhone procede del equipo, pendiente de validación con sus usuarios actuales. No se publican formularios, fotografías, nombres ni datos de salud identificables.

El enlace Outlook entregado por el equipo redirigió a inicio de sesión Microsoft. No se accedió a la entrega anterior alojada allí. El plan incluye recuperarla y reconciliarla con comentarios docentes; no se declara revisada. Posteriormente el usuario confirmó feria el **17 de noviembre**, equipo de **cinco personas: dos de app y tres de hardware**, último modelo de iPhone y **Mac/Xcode disponibles**, sin componentes comprados y con compra en Bogotá. Modelo exacto/iOS, experiencia y horas disponibles, presupuesto y referencia de ESP32/radar continúan pendientes. Las tres metas físicas siguen deseadas, con veredictos independientes para estáticos, móviles e interior y audio/enlace como condición compartida.

Al reanudar, código local y remoto conservan `0abca8cbd7dbf95c01ae0fbccdc67804174a13c9`, sin diferencias en archivos versionados. Por eso se reutilizan los resultados anteriores, sin afirmar una nueva ejecución. También se comprobó el [check de CI de ese commit](https://github.com/ZuluCode777/proyecto-1-APP/actions/runs/36074486316/job/107882519407): `verificar`, completado con éxito. Las nuevas modificaciones son documentación; no modifican producto ni corrigen los defectos descritos.

Se reabrieron Render Free/Compute Plans, publicaciones distritales de nombres y estados de Metro y la integración GitHub de Kiro; sus afirmaciones centrales coinciden con los informes. Se añadieron dos síntesis, [arquitectura y experimentos](arquitectura-y-experimentos.md) y [puertas de hardware](puertas-hardware.md), y una revisión independiente de Luna sobre las 27 tareas propuestas. Se corrigieron alcance móvil excesivo, fecha de recepción de radar y separación de veredictos estático/móvil; la revisión comprobó 27 claves únicas y 39 aristas acíclicas. La capacidad de trabajo y las pruebas físicas siguen sin demostrarse.

## Uso de skills

Se aplicaron investigación con fuentes, auditoría de código, lectura crítica y revisión, vocabulario de dominio, diseño de módulos y planificación de tickets. `architect` se adaptó a dos alternativas de cliente con los modelos Sol solicitados; su dependencia `arena` no está disponible en las skills del repositorio, por lo que no se afirma haberla ejecutado. No se usaron los modelos predeterminados de esa skill porque el equipo pidió Sol/Luna y máximo cinco agentes.

`prototype` orienta las tareas de experimentación: primero respuesta a una pregunta, después decisión. Esta tarea entrega investigación e issues; las pruebas físicas y prototipos de interfaz quedan como trabajo explícito, no como prototipos ficticiamente realizados. La autorización expresa del equipo para publicar issues reemplaza el paso opcional de aprobación previa del desglose; no se detuvo publicación para pedir una confirmación repetida. No se activó Kiro ni se aplicó su etiqueta disparadora.

## Publicación y prueba del backlog

Se crearon [índice #26](https://github.com/ZuluCode777/proyecto-1-APP/issues/26) y **27 issues de trabajo, #27–#53**, en orden topológico. GitHub aceptó **27 sub-issues y 39 relaciones nativas de bloqueo**, sin errores de escritura; también se enumeran bloqueadores en cada cuerpo. Se aplicaron etiquetas de coordinación/triage sin disparar Kiro ni asignar personas ficticias. No se modificaron ni cerraron #5/#6 del MVP anterior. Investigación y plan se publican en rama documental para revisión; no se fusiona ni se despliega producto.

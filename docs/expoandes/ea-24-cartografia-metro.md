# EA-24 · Cartografía del Metro con sistema de coordenadas y licencia verificados

Issue [#50](https://github.com/ZuluCode777/proyecto-1-APP/issues/50), parte de #26. Consulta de fuentes del **11 de noviembre de 2026**. El veredicto con toda la evidencia está en el [comentario de la issue](https://github.com/ZuluCode777/proyecto-1-APP/issues/50#issuecomment-6808492780). Este documento resume qué entró, qué quedó fuera y cómo repetir la comprobación.

## Veredicto

| Conjunto | Veredicto | En el mapa |
| --- | --- | --- |
| Trazado de la Línea 1 | Verificado | Línea punteada con el rótulo «proyecto futuro, sin servicio» |
| Estaciones de la Línea 1 | Verificado como huella ilustrativa | 16 polígonos con el aviso «no es una entrada» |
| Accesos peatonales | No verificado | Ausentes |
| Línea 2 | Fuera de alcance | Ausente |

«Verificado» tiene un límite. La transformación está probada al milímetro. La posición de las huellas está controlada a escala de cuadra, con decenas de metros de margen. La geometría es el diseño de 2022, no un levantamiento de lo construido.

## Qué muestra la app

La pantalla «Metro de Bogotá» del modo baja visión tiene ahora un mapa sobre el componente compartido `TransitMap`. El trazado va punteado y fino, distinto de una ruta en servicio. El rótulo queda siempre a la vista en el mapa, la nota de estado lo repite en texto y la voz lo dice al entrar. La atribución completa, con licencia, fecha y cambios, queda debajo del mapa, y una forma corta va en el control de atribución de Leaflet.

El listado de 16 estaciones sigue completo y no depende del mapa. Los mapas de ruta, de viaje y del GPS no dibujan el Metro. Una prueba falla si alguno recibe la capa.

## Fuente y consulta

Los datos son de la Empresa Metro de Bogotá, publicados en el servicio de Catastro e IDECA. `pnpm sync:metro-cartografia` hace cuatro consultas GET públicas y escribe `data/metro-cartografia.json`.

- Trazado: capa 1 de `movilidad/metrobogota/MapServer`, con `where=LINEA='Primera'` y `outSR=4326`.
- Estaciones: capa 0, con `where=LINEAS='Primera'` y `outSR=4326`.
- Las dos fichas de Datos Abiertos, para leer la licencia y la fecha del dato.

El archivo es un GeoJSON con pares `[longitud, latitud]`. Su miembro `procedencia` guarda la entidad, las dos consultas, el SHA-256 de cada respuesta, la fecha del dato, la fecha de consulta, el sistema de coordenadas, la licencia y los cambios.

La capa 1 se llama «primera línea», pero el 2 de noviembre devolvía también la segunda. Hoy solo trae la primera y la segunda está en la capa 5. La consulta filtra por atributo de todos modos, y la importación rechaza cualquier entidad que no sea `Primera`.

## Cambios hechos al dato

- El trazado pasó de 8.494 a 157 vértices con Douglas-Peucker y una tolerancia de 1 m.
- Las coordenadas se redondearon a 6 decimales, que mueve cada vértice 8 cm como mucho.
- Las huellas conservan todos sus vértices y su orden.

## Sistema de coordenadas

Los GeoJSON descargables de Datos Abiertos no están en WGS84. Usan el sistema local `PCS_CartMAGBOG` y no declaran `crs`. La app no los importa. Sirvieron para probar que la respuesta REST en 4326 es la misma geometría.

`ESTACIONES.prj` declara una Transverse Mercator con falso este 92334,879, falso norte 109320,965, meridiano central −74,14659166666667, latitud de origen 4,6804861111111 y un esferoide GRS80 con el semieje agrandado a 6380687. El [registro EPSG](https://apps.epsg.org/api/v1/CoordRefSystem/6247/export?format=wkt), con el IGAC como fuente, define EPSG:6247 «MAGNA-SIRGAS / Bogota urban grid» con el mismo origen y un plano de proyección a 2550 m de altura. Los 2550 m son la diferencia entre 6380687 y el semieje de GRS80. El datum es MAGNA-SIRGAS, que coincide con WGS84 por debajo del metro.

## Puntos de control

| Control | Fuente | Resultado |
| --- | --- | --- |
| 363 puntos geodésicos con coordenada local y geográfica | IDECA, Mapa de Referencia, capa 5 | Mediana 3,2 mm con la definición del `.prj`. Mediana 4,1 m si se ignora el plano de 2550 m |
| GeoJSON local transformado contra REST en 4326 | Datos Abiertos y Catastro | 97 vértices de estaciones y 8.494 del trazado, diferencia máxima 0,1 mm |
| KMZ oficial de estaciones contra REST | Datos Abiertos | Diferencia máxima 0,1 mm |
| Eje del corredor y vías del tramo publicado en 2020 | IDECA, Mapa de Referencia, capa 13 | Corredor a 30 m o menos de las 16 huellas. Vías del tramo a 107 m o menos |

De los 363 puntos geodésicos, uno llamado `BVRI` discrepa 1.180 m con cualquier hipótesis. Su registro es incoherente en la fuente y quedó fuera de la estadística. Los otros 362 quedan a 0,44 m o menos.

Las tres primeras filas comparan publicaciones del mismo dato de la EMB. Prueban la transformación, no la posición. La cuarta sí es independiente. Usa la malla vial de Catastro, IDU y Movilidad, y los tramos que el Distrito publicó para cada estación el 20 de octubre de 2020. La tabla por estación está en el comentario de la issue.

`lib/ea24-cartografia.test.ts` guarda 8 puntos geodésicos, el primer vértice local de cada estación y los 47 segmentos viales. Corre sin red.

## Licencia y atribución

Las fichas de [estaciones](https://datosabiertos.bogota.gov.co/dataset/estaciones-de-la-primera-linea-del-metro-de-bogota) y de [trazado](https://datosabiertos.bogota.gov.co/dataset/trazado-primera-linea-del-metro-de-bogota) declaran CC BY 4.0 y enumeran como recurso la capa REST consultada. El script de sincronización lo comprueba en cada corrida y falla si la licencia cambia o la capa deja de aparecer. La fecha del dato es el 18 de abril de 2022.

El Mapa de Referencia y la capa de puntos geodésicos, usados solo como control en la prueba, también son CC BY 4.0.

## Lo que queda ausente

- Los accesos peatonales. El servicio tiene una capa 6, «Edificio acceso primera línea», con 39 polígonos. Ninguna de las 7 fichas de la EMB en Datos Abiertos la cubre, así que no tiene licencia acreditada. Tampoco son puertas ni recorridos accesibles.
- Un punto por estación. Un centroide parecería una parada.
- La Línea 2 y cualquier intercambio con TransMilenio por cercanía.
- El Metro en los mapas de ruta, de viaje y del GPS.

## Límites

- La prueba del mapa usa un Leaflet falso que anota lo que se dibuja. No se comprobó el dibujo en un navegador real. `pnpm verificar` no se corrió en este trabajo porque usa un puerto de depuración fijo que comparten otros agentes.
- El control vial acota la posición a decenas de metros. Sirve para una ilustración a escala de ciudad, no para guiar a una persona hasta una estación.
- Si la EMB publica geometría de lo construido, el archivo cambia con `pnpm sync:metro-cartografia` y los controles de la prueba dirán si la nueva geometría sigue en su tramo.

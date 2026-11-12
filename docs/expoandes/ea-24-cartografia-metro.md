# EA-24 · Cartografía del Metro con sistema de coordenadas y licencia verificados

Issue [#50](https://github.com/ZuluCode777/proyecto-1-APP/issues/50), parte de #26. Las fuentes se consultaron el **11 de noviembre de 2026** y otra vez el 12, con los mismos SHA-256. El veredicto original está en el [comentario de la issue](https://github.com/ZuluCode777/proyecto-1-APP/issues/50#issuecomment-6808492780). Este documento dice qué entró, qué quedó fuera, qué prueba cada control y cómo repetirlo.

## Veredicto

| Conjunto | Veredicto | En el mapa |
| --- | --- | --- |
| Trazado de la Línea 1 | Verificado | Línea punteada, con el rótulo «proyecto futuro, sin servicio» en el marco |
| Estaciones de la Línea 1 | Verificado como huella ilustrativa | 16 polígonos con el aviso «no es una entrada» |
| Accesos peatonales | No verificado | Ausentes |
| Línea 2 | Fuera de alcance | Ausente |

«Verificado» junta dos cosas con precisiones distintas.

- La transformación del sistema local a coordenadas geográficas. Contra 363 puntos geodésicos oficiales da una mediana de 3,2 mm, y el peor caso es de 0,44 m en 362 de ellos.
- La posición de las huellas en la ciudad. El único control independiente de la Empresa Metro de Bogotá la acota a escala de cuadra: unos 30 m transversal al corredor y hasta unos 100 m a lo largo.

La geometría es el diseño de 2022, no un levantamiento de lo construido.

## Para qué sirve y para qué no

Sirve como ilustración a escala de ciudad, en la web y en el mapa de iPhone. El trazado y las 16 huellas están en WGS84, con la transformación comprobada y licencia CC BY 4.0.

No sirve para guiar a nadie hasta una estación. No hay entradas, y la posición solo está acotada a unos 30 m transversal al corredor y hasta unos 100 m a lo largo. Esa fue también la conclusión de la revisión del PR #85.

## Qué muestra la app

La pantalla «Metro de Bogotá» del modo baja visión tiene un mapa sobre el componente compartido `TransitMap`.

- El rótulo va en una barra pegada al marco del mapa, fuera del lienzo. Dentro del lienzo tapaba el extremo norte de la línea o quedaba bajo la atribución de Leaflet. Así sigue a la vista con cualquier zoom y se parte en renglones con letra grande.
- El trazado va punteado y fino, distinto de una ruta en servicio. Al tocarlo repite el rótulo.
- Cada huella dice su número, su nombre y «huella ilustrativa del proyecto; no es una entrada» al tocarla. A escala de ciudad mide 1 o 2 píxeles, así que lleva un borde grueso y se ve como un punto. Hay que acercar el mapa para ver su forma.
- La nota de estado dice lo mismo en texto, y la voz lo lee al entrar.
- Cada estación del listado repite el aviso de la huella. El listado se recorre con teclado y lector de pantalla; los polígonos del mapa, no.
- La atribución completa, con licencia, fecha y cambios, queda debajo del mapa. Una forma corta va en el control de atribución de Leaflet.

El listado de 16 estaciones sigue completo y no depende del mapa. Los mapas de ruta, de viaje y del GPS no dibujan el Metro. Una prueba lee el árbol sintáctico de cada archivo y falla si alguno importa la cartografía o le pasa una capa a `TransitMap`, también con un alias, con `{...props}` o con un `import()`.

## Fuente y consulta

Los datos son de la Empresa Metro de Bogotá, publicados en el servicio de Catastro e IDECA. `pnpm sync:metro-cartografia` hace cuatro consultas GET públicas y escribe `data/metro-cartografia.json`.

- Trazado: capa 1 de `movilidad/metrobogota/MapServer`, con `where=LINEA='Primera'` y `outSR=4326`.
- Estaciones: capa 0, con `where=LINEAS='Primera'` y `outSR=4326`.
- Las dos fichas de Datos Abiertos, para leer la licencia y la fecha del dato.

El archivo es un GeoJSON con pares `[longitud, latitud]`. Su miembro `procedencia` guarda la entidad, la URL exacta de cada consulta, el SHA-256 de cada respuesta, los conteos de vértices, la fecha del dato, la fecha de consulta, el sistema de coordenadas, la licencia y los cambios. El texto de los cambios y los conteos los escribe la importación; una prueba los compara con la geometría guardada.

Las respuestas crudas no están en el repositorio, porque la del trazado pesa 347 KB. Para comprobar que el archivo guardado sigue siendo fiel a la fuente:

```bash
pnpm sync:metro-cartografia --check
```

Descarga, compara los SHA-256 y la geometría con el archivo guardado y no escribe nada. Sale con 0 si coinciden, con 1 si difieren o la fuente ya no supera la verificación, y con 2 si no pudo comprobar: la fuente no respondió o el argumento no es `--check`.

Se ejecuta a mano y requiere red. No está en la integración continua ni en `scripts/verificar.mjs`. Sin red, ninguna prueba detecta que la fuente cambió: las pruebas solo comprueban que el SHA-256 guardado tiene forma de SHA-256 y que el archivo está escrito como lo escribe el script.

La capa 1 se llama «primera línea», pero el 2 de noviembre devolvía también la segunda. Hoy solo trae la primera y la segunda está en la capa 5. La consulta filtra por atributo de todos modos, y la importación rechaza cualquier entidad que no sea `Primera`.

## Cambios hechos al dato

- El trazado pasó de 8.494 a 157 vértices con Douglas-Peucker y una tolerancia de 1 m.
- Las coordenadas se redondearon a 6 decimales, que mueve cada vértice 8 cm como mucho.
- Las huellas conservan sus 97 vértices y su orden.

## Sistema de coordenadas

Los GeoJSON descargables de Datos Abiertos no están en WGS84. Usan el sistema local `PCS_CartMAGBOG` y no declaran `crs`. La app no los importa. Sirvieron para comprobar que la respuesta REST en 4326 es la misma geometría.

`ESTACIONES.prj` declara una Transverse Mercator con falso este 92334,879, falso norte 109320,965, meridiano central −74,14659166666667, latitud de origen 4,6804861111111 y un esferoide GRS80 con el semieje agrandado a 6380687. El [registro EPSG](https://apps.epsg.org/api/v1/CoordRefSystem/6247/export?format=wkt), con el IGAC como fuente, define EPSG:6247 «MAGNA-SIRGAS / Bogota urban grid» con el mismo origen y un plano de proyección a 2550 m de altura. Los 2550 m son la diferencia entre 6380687 y el semieje de GRS80. El datum es MAGNA-SIRGAS, que coincide con WGS84 por debajo del metro.

## Puntos de control

| Control | Qué prueba | Resultado | Cómo se repite |
| --- | --- | --- | --- |
| 363 puntos geodésicos con coordenada local y geográfica. IDECA, Mapa de Referencia, capa 5 | Que la definición del `.prj` es la correcta | Mediana 3,2 mm, percentil 90 de 7,3 mm, peor 0,44 m en 362 de 363. Los 317 de la Empresa de Acueducto, a 12 mm o menos. Sin el plano de 2550 m, mediana 4,11 m | `pnpm analisis:metro-cartografia` |
| GeoJSON local transformado contra la respuesta REST en 4326 | Que los dos son la misma geometría | 97 vértices de estaciones y 8.494 del trazado, diferencia máxima 0,1 mm | `pnpm analisis:metro-cartografia` |
| Muestra de 8 puntos geodésicos, primer vértice local de cada estación y los 2 extremos del trazado | Lo mismo que las dos filas de arriba, sin red | Puntos a 2 cm o menos. Vértices a 15 cm o menos, por el redondeo | `pnpm test` |
| 47 ejes de la malla vial. IDECA, Mapa de Referencia, capa 13 | La posición de las huellas, con una fuente que no es la EMB | Corredor a 30 m o menos de las 16 huellas. Vías del tramo a 107 m o menos | `pnpm test`, sobre una copia del 11-11-2026 |

`pnpm analisis:metro-cartografia` descarga las entradas y compara su SHA-256 con el que tenían el 11 y el 12 de noviembre. Sale con 1 si una fuente cambió o si un resultado ya no respalda esta tabla, y con 2 si una fuente no respondió. También se ejecuta a mano y requiere red.

De los 363 puntos geodésicos, uno llamado `BVRI` discrepa 1.180 m con cualquier hipótesis. Su registro es incoherente en la fuente y queda fuera de la estadística. La muestra de 8 que guarda la prueba son puntos de la Empresa de Acueducto dentro de la caja del trazado, ordenados por longitud y tomados a intervalos iguales.

### Qué no prueban

Las tres primeras filas son en parte circulares. Comparan dos publicaciones del mismo dato de la EMB, y la conversión a 4326 la hace el servidor de Catastro, no el código de este repositorio. Prueban la transformación, no la posición. Si la EMB hubiera dibujado una estación en el lugar equivocado, las tres filas seguirían en verde.

La cuarta fila es el único control independiente, y es de escala de cuadra. Usa la malla vial de Catastro, IDU y Movilidad, y los tramos que el Distrito publicó para cada estación el 20 de octubre de 2020. Acota la posición a unos 30 m transversal al corredor, que es la distancia al eje de la avenida, y hasta unos 100 m a lo largo, que es la distancia a las vías que delimitan el tramo. Detecta un error de datum o de origen, que corre la geometría cientos de metros. No detecta un error de 20 m.

Los umbrales de la prueba, 31 m y 108 m, son descriptivos. Se pusieron mirando el dato, un poco por encima de lo medido, y no salen de una tolerancia de diseño. Lo independiente de ese control son sus datos, no su cálculo: usa las mismas funciones de distancia que el validador.

La caja de Bogotá que valida la importación mide decenas de kilómetros. Rechaza ejes invertidos y coordenadas en metros, no un error de datum.

Los 47 ejes son una copia hecha el 11 de noviembre con una regla fija: para cada vía que el Distrito citó, el segmento oficial con esa etiqueta más cercano a la huella. El repositorio no vuelve a derivarlos de la malla vial en vivo. La tabla por estación está en el comentario de la issue.

El KMZ oficial de estaciones también coincidió con la respuesta REST, con 0,1 mm de diferencia máxima. Se comprobó a mano el 11 de noviembre y nada en el repositorio lo repite, así que no cuenta como evidencia aquí.

## Licencia y atribución

Las fichas de [estaciones](https://datosabiertos.bogota.gov.co/dataset/estaciones-de-la-primera-linea-del-metro-de-bogota) y de [trazado](https://datosabiertos.bogota.gov.co/dataset/trazado-primera-linea-del-metro-de-bogota) declaran CC BY 4.0 y enumeran como recurso la capa REST consultada. El script de sincronización lo comprueba en cada corrida, también con `--check`, y falla si la licencia cambia o la capa deja de aparecer. La fecha del dato es el 18 de abril de 2022.

El Mapa de Referencia y la capa de puntos geodésicos, usados solo como control, también son CC BY 4.0.

## Lo que queda ausente

- Los accesos peatonales. El servicio tiene una capa 6, «Edificio acceso primera línea», con 39 polígonos. Ninguna de las 7 fichas de la EMB en Datos Abiertos la cubre, así que no tiene licencia acreditada. Tampoco son puertas ni recorridos accesibles.
- Un punto por estación. Un centroide parecería una parada.
- La Línea 2 y cualquier intercambio con TransMilenio por cercanía.
- El Metro en los mapas de ruta, de viaje y del GPS.

## Límites

- El mapa se vio en un navegador el 12 de noviembre, a 390 px de ancho y con la letra al 100 % y al 200 %: rótulo completo, trazado y 16 huellas visibles, nada tapado por los controles. En la sesión de prueba (pestaña oculta) se simuló un temporizador; la app no cambió. No se probó en un teléfono ni con un lector de pantalla.
- Si Leaflet no carga, el mapa muestra «El mapa no cargó; el listado tiene lo mismo.» en lugar de un recuadro vacío. Eso vale para los cuatro mapas de la app.
- `pnpm verificar` no se corrió en este trabajo porque usa un puerto de depuración fijo que comparten otros agentes. Lo corre la integración continua.
- Las pruebas del mapa usan un Leaflet falso que anota lo que se dibuja.
- Si la EMB publica geometría de lo construido, nadie se entera solo. Lo muestra `pnpm sync:metro-cartografia --check`, que se ejecuta a mano y requiere red. Después de sincronizar, los controles de la prueba dicen si la nueva geometría sigue en su tramo.

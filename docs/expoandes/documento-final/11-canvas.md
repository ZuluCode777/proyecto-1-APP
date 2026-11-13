# 11. Modelo CANVAS

**Criterio:** Modelo CANVAS, claridad y coherencia, 10 puntos.
**Base:** el Proyecto 1 no tenía CANVAS.
**Estado:** propuesta para discutir con el equipo. Varios bloques son hipótesis de negocio que nadie ha validado, y el documento debe decirlo así.

Formato: Business Model Canvas de nueve bloques. Para la versión en Word se pasa a la plantilla de una página.

> **Por confirmar:** si el curso pide el Business Model Canvas o el Lean Canvas. Este borrador usa el primero.

## Los nueve bloques

**1. Segmentos de clientes**
- *Principal:* personas con baja visión o ceguera que usan, o quieren usar, TransMilenio en Bogotá. Cerca de 280.000 personas en Bogotá tienen alguna discapacidad visual (sección 1.1).
- *Secundarios:*
  - acompañantes y familias;
  - centros de rehabilitación y asociaciones de personas ciegas;
  - el operador del sistema, como posible aliado.

**2. Propuesta de valor**
- Preguntar por voz, en español, cómo llegar, qué bus tomar y dónde bajarse, con información verificada y sin inventar.
- Una interfaz hecha para baja visión y otra para ceguera total.
- Avisos de presencia cercana por los auriculares con un accesorio, sin prometer camino libre.
- Gratis para la persona usuaria.

**3. Canales**
- La web, que funciona sin instalar nada.
- La app de iPhone, hoy por instalación directa y en el futuro por el App Store.
- Centros de rehabilitación y asociaciones, para dar a conocer la app y enseñar a usarla.
- Ferias y eventos, como ExpoAndes.

**4. Relación con los clientes**
- Autoservicio por voz.
- Diseño con los usuarios: sesiones de prueba y ajustes según lo que encuentren.
- Canal de comentarios a través de las asociaciones.

**5. Fuentes de ingreso**
> **Hipótesis sin validar.** Hoy no hay ingresos.
- Uso gratuito para las personas.
- Convenios con entidades públicas de movilidad o de discapacidad, en cumplimiento de la Ley 1618 de 2013.
- Fondos de innovación social o de accesibilidad.
- Venta del accesorio a precio de costo.

**6. Recursos clave**
- Datos abiertos de TransMilenio: estaciones, rutas, GTFS y alertas.
- El código de la web, la app, el servidor y el firmware.
- El servidor en Render y, si se usa, un computador con GPU para el modelo.
- El accesorio: placa ESP32-S3 y radar.
- El equipo y su conocimiento de accesibilidad.

**7. Actividades clave**
- Mantener al día los datos y renovar la evidencia de paradas, que vence cada 31 días.
- Probar con usuarios y ajustar la interfaz.
- Desarrollar y mantener la web, la app y el firmware.
- Armar y probar cada accesorio.

**8. Socios clave**
- TransMilenio S.A., que publica los datos.
- Empresa Metro de Bogotá, por los datos de la Línea 1.
- INCI, CRAC y asociaciones de personas ciegas.
- Universidad de los Andes.
- OpenStreetMap, por los mapas.
- Proveedores de componentes en Bogotá.
- Render, por el alojamiento.

**9. Estructura de costos**
- Alojamiento: hoy USD 0 en el plan gratuito. Los planes de pago cuestan entre USD 7 y 85 al mes.
- Hardware: presupuesto de COP 150.000–200.000 para el prototipo. El precio real está por confirmar.
- Programa de desarrolladores de Apple, para publicar en el App Store.
- El tiempo del equipo.

## Coherencia con el resto del documento

| Bloque | Se apoya en |
| --- | --- |
| Segmentos | Sección 1: entrevistas y cifras de contexto |
| Propuesta de valor | Secciones 2 y 5: problema y comparación con otras apps |
| Recursos y actividades | Secciones 6 y 8: tecnología y ejecución |
| Costos | Secciones 3 (RNF-07) y 6.3 |
| Lo que no promete | Sección 4.2: restricciones |

// Pruebas en el portátil del intérprete del SEN0395 (EA-11). Todo es SINTÉTICO:
// tramas escritas a mano según la wiki de DFRobot, sin radar ni UART. No
// prueban el formato real del hardware (eco, prompt, latencias): eso es el
// ensayo B1 de banco (docs/expoandes/ea-11-radar.md).
// Uso: pruebas_sen0395
#include <stdint.h>
#include <stdio.h>

#include <string>

#include "emisor_sintetico.h"
#include "sen0395.h"
#include "trama_ble.h"

using namespace visionaria;
using namespace visionaria::sen0395;
using ble::EstadoRadar;

namespace {

int g_casos = 0;
int g_fallos = 0;

void exigir(bool condicion, const char* donde, const char* detalle) {
  ++g_casos;
  if (!condicion) {
    ++g_fallos;
    fprintf(stderr, "FALLO %s: %s\n", donde, detalle);
  }
}

const char* const kP = "$JYBSS,1, , , *\r\n";
const char* const kN = "$JYBSS,0, , , *\r\n";

// Entrega bytes sin lectura previa en el mismo instante (para probar huecos).
void dar_crudo(Interprete& r, const std::string& s, uint32_t t) {
  size_t desde = 0;
  do {
    const size_t c = r.procesar(reinterpret_cast<const uint8_t*>(s.data()) + desde, s.size() - desde, t);
    desde += c;
    if (c == 0) break;
  } while (desde < s.size());
}

// Como un ciclo normal del firmware: se lee la UART (aunque sea vacía) y luego los bytes.
void dar(Interprete& r, const std::string& s, uint32_t t) {
  r.procesar(nullptr, 0, t);
  dar_crudo(r, s, t);
}

std::string orden(const Interprete& r) {
  uint8_t b[kLongitudOrdenMax];
  const size_t n = r.salida_pendiente(b, sizeof(b));
  return std::string(reinterpret_cast<char*>(b), n);
}

// Envía y confirma las cinco órdenes; devuelve la hora del Done de sensorStart.
uint32_t configurar(Interprete& r, uint32_t t) {
  for (int i = 0; i < kPasosConfiguracion; ++i) {
    exigir(!orden(r).empty(), "configurar", "orden pendiente");
    r.salida_enviada(t);
    t += 20;
    dar(r, "Done\r\n", t);
  }
  return t;
}

// Configura y deja pasar la estabilización; devuelve la hora de su fin.
uint32_t operar(Interprete& r, uint32_t t) {
  const uint32_t done = configurar(r, t);
  const uint32_t fin = done + r.configuracion().estabilizacion_ms;
  r.salud(fin);
  return fin;
}

uint8_t salud_de(Interprete& r, uint32_t t) { return r.salud(t); }

void probar_ordenes() {
  Interprete r;
  uint8_t b[kLongitudOrdenMax];
  exigir(orden(r) == "sensorStop\r\n", "ordenes", "1.ª orden");
  exigir(r.salida_pendiente(b, 5) == 0, "ordenes", "capacidad insuficiente devuelve 0");
  exigir(r.salida_pendiente(nullptr, 64) == 0, "ordenes", "destino nulo");
  exigir(orden(r) == "sensorStop\r\n", "ordenes", "salida_pendiente no tiene efectos");
  r.salida_enviada(0);
  exigir(orden(r).empty(), "ordenes", "no hay orden nueva mientras se espera respuesta");
  dar(r, "Done\r\n", 10);
  exigir(orden(r) == "detRangeCfg -1 0 2\r\n", "ordenes", "ventana por defecto");
  r.salida_enviada(10);
  dar(r, "Done\r\n", 20);
  exigir(orden(r) == "outputLatency -1 0 8\r\n", "ordenes", "latencias por defecto");
  r.salida_enviada(20);
  dar(r, "Done\r\n", 30);
  exigir(orden(r) == "saveCfg 0x45670123 0xCDEF89AB 0x956128C6 0xDF54AC89\r\n", "ordenes", "saveCfg");
  r.salida_enviada(30);
  dar(r, "Done\r\n", 40);
  exigir(orden(r) == "sensorStart\r\n", "ordenes", "sensorStart");
  r.salida_enviada(40);
  exigir(r.fase() == Fase::Configurando, "ordenes", "aún configurando sin el último Done");
  dar(r, "Done\r\n", 50);
  exigir(r.fase() == Fase::Estabilizando && orden(r).empty(), "ordenes", "estabilizando, sin órdenes");

  Configuracion c;
  c.ventana_inicio = 2;
  c.ventana_fin = 127;
  c.latencia_deteccion = 8;
  c.latencia_desaparicion = 65535;
  Interprete p(c);
  p.salida_enviada(0);
  dar(p, "Done\r\n", 1);
  exigir(orden(p) == "detRangeCfg -1 2 127\r\n", "ordenes", "ventana personalizada");
  p.salida_enviada(1);
  dar(p, "Done\r\n", 2);
  exigir(orden(p) == "outputLatency -1 8 65535\r\n", "ordenes", "latencias personalizadas");
  exigir(p.ventana_minima_mm() == 300 && p.ventana_maxima_mm() == 19050, "ordenes", "ventana en mm");

  Interprete d;
  exigir(d.ventana_minima_mm() == 0 && d.ventana_maxima_mm() == 300, "ordenes", "ventana 0..30 cm");
  ble::Informacion info;
  info.perfil = 1;
  info.distancia_minima_mm = d.ventana_minima_mm();
  info.distancia_maxima_mm = d.ventana_maxima_mm();
  uint8_t t20[ble::kLongitudTrama];
  exigir(ble::codificar_informacion(info, t20) == ble::Error::Ninguno, "ordenes",
         "la ventana forma una Información válida");
}

void probar_configuracion_invalida() {
  Configuracion c;
  c.ventana_fin = 0;
  exigir(!configuracion_valida(c), "cfg", "ventana vacía");
  c = Configuracion();
  c.ventana_fin = 128;
  exigir(!configuracion_valida(c), "cfg", "índice > 127");
  c = Configuracion();
  c.estabilizacion_ms = 4999;
  exigir(!configuracion_valida(c), "cfg", "estabilización < 5 s");
  c = Configuracion();
  c.respuesta_max_ms = 0;
  exigir(!configuracion_valida(c), "cfg", "plazo cero");
  exigir(configuracion_valida(Configuracion()), "cfg", "la de fábrica es válida");

  c = Configuracion();
  c.estabilizacion_ms = 100;
  Interprete r(c);
  exigir(r.fase() == Fase::Fallo && r.motivo_fallo() == MotivoFallo::ConfiguracionInvalida, "cfg", "fallo");
  exigir(orden(r).empty(), "cfg", "no envía nada");
  const ble::EntradaRadar e = r.entrada(0);
  exigir(e.estado == EstadoRadar::Fallo && e.salud == kSaludConfigNoValida, "cfg", "salud 6");
  r.reiniciar();
  exigir(r.salud(1) == kSaludConfigNoValida, "cfg", "reiniciar no la arregla");
}

void probar_estabilizacion_y_primer_latido() {
  Interprete r;
  const uint32_t done = configurar(r, 1000);
  exigir(r.fase() == Fase::Estabilizando && salud_de(r, done) == kSaludIniciando, "estab", "salud 1");
  dar(r, kP, done + 3000);  // trama durante la estabilización: no vale
  exigir(salud_de(r, done + 4999) == kSaludIniciando && r.fase() == Fase::Estabilizando, "estab",
         "a 4999 ms sigue estabilizando");
  exigir(r.contadores().tramas_validas == 0 && r.contadores().lineas_ignoradas >= 1, "estab",
         "la trama temprana se ignora");
  const uint32_t fin = done + 5000;
  exigir(salud_de(r, fin) == kSaludIniciando && r.fase() == Fase::Operando, "estab",
         "a 5000 ms opera pero sin resultado: salud 1, nunca 0");
  exigir(r.entrada(fin).estado == EstadoRadar::Fallo, "estab", "sin trama nueva no hay resultado");
  exigir(salud_de(r, fin + 2500) == kSaludIniciando, "estab", "primer latido: 2500 ms aún es 1");
  exigir(salud_de(r, fin + 2501) == kSaludSinDatos, "estab", "primer latido: 2501 ms es 2");
  dar(r, kN, fin + 2600);
  exigir(salud_de(r, fin + 2600) == kSaludOk, "estab", "una trama íntegra nueva recupera");

  Configuracion c;
  c.estabilizacion_ms = 7000;
  Interprete q(c);
  const uint32_t d2 = configurar(q, 0);
  q.salud(d2 + 6999);
  exigir(q.fase() == Fase::Estabilizando, "estab", "estabilización configurable más larga");
  q.salud(d2 + 7000);
  exigir(q.fase() == Fase::Operando, "estab", "termina a los 7000 ms");

  // El flujo de tramas durante la configuración y el eco no cuentan.
  Interprete s;
  s.salida_enviada(0);
  dar(s, "sensorStop\r\n", 1);
  dar(s, kP, 2);
  exigir(s.fase() == Fase::Configurando && s.contadores().lineas_ignoradas == 2, "estab",
         "eco y tramas durante la configuración se ignoran");
  dar(s, "Done\r\n", 3);
  exigir(orden(s) == "detRangeCfg -1 0 2\r\n", "estab", "el Done sí avanza");
}

void probar_presencia_y_edad() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  dar(r, kP, t0 + 100);
  ble::EntradaRadar e = r.entrada(t0 + 100);
  exigir(e.estado == EstadoRadar::Presencia && e.edad_ms == 0 && e.salud == 0, "edad", "presencia");
  exigir(e.distancia_mm == ble::kDistanciaDesconocida && !e.tiene_azimut, "edad", "sin distancia ni azimut");
  e = r.entrada(t0 + 600);
  exigir(e.estado == EstadoRadar::Presencia && e.edad_ms == 500, "edad", "edad 500");
  for (int i = 0; i < 50; ++i) r.entrada(t0 + 600);
  exigir(r.entrada(t0 + 600).edad_ms == 500, "edad", "consultar no rejuvenece");
  dar(r, kN, t0 + 700);
  e = r.entrada(t0 + 720);
  exigir(e.estado == EstadoRadar::SinBlanco && e.edad_ms == 20 && e.salud == 0, "edad", "sin blanco");

  // Misma carga repetida: cada trama íntegra nueva renueva la edad (sin contador).
  dar(r, kN, t0 + 1700);
  exigir(r.entrada(t0 + 1800).edad_ms == 100, "edad", "una repetición del 0 renueva la edad");

  // Con el emisor: edad <= 500 vigente, > 500 vencido (conflicto de 1 Hz), nunca vigente.
  ble::Informacion info;
  info.perfil = 1;
  info.distancia_maxima_mm = r.ventana_maxima_mm();
  ble::EmisorSintetico em(info, false);
  uint8_t t20[ble::kLongitudTrama];
  ble::Medicion m;
  dar(r, kP, t0 + 2000);
  exigir(em.generar(t0 + 2100, r.entrada(t0 + 2100), t20) == ble::Error::Ninguno, "edad", "genera");
  exigir(ble::decodificar_medicion(t20, ble::kLongitudTrama, info, &m) == ble::Error::Ninguno &&
             m.banderas == (ble::kBanResultado | ble::kBanBlanco) && m.edad_radar_ms == 100 && m.salud == 0,
         "edad", "100 ms: presencia vigente");
  exigir(em.generar(t0 + 2501, r.entrada(t0 + 2501), t20) == ble::Error::Ninguno, "edad", "genera");
  exigir(ble::decodificar_medicion(t20, ble::kLongitudTrama, info, &m) == ble::Error::Ninguno &&
             (m.banderas & 0x0F) == 0 && m.edad_radar_ms == 501 && m.salud == 0,
         "edad", "501 ms: vencido, bits 0 a 3 en cero");
  exigir(em.generar(t0 + 2500, r.entrada(t0 + 2500), t20) == ble::Error::Ninguno &&
             ble::decodificar_medicion(t20, ble::kLongitudTrama, info, &m) == ble::Error::Ninguno &&
             (m.banderas & 0x0F) == (ble::kBanResultado | ble::kBanBlanco),
         "edad", "500 ms exactos: aún vigente (el reloj de prueba retrocedió, la edad se recalcula)");
}

void probar_formatos_de_linea() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  std::string p(kP);
  for (size_t i = 0; i < p.size(); ++i) {  // byte a byte
    dar(r, p.substr(i, 1), t0 + 10 + static_cast<uint32_t>(i));
  }
  exigir(salud_de(r, t0 + 40) == kSaludOk && r.contadores().tramas_validas == 1, "lineas", "byte a byte");
  dar(r, "$JYBSS,0, , , *\n", t0 + 100);
  exigir(r.contadores().tramas_validas == 2, "lineas", "terminador LF");
  dar(r, "$JYBSS,1, , , *\r", t0 + 110);
  exigir(r.contadores().tramas_validas == 3 && r.entrada(t0 + 110).estado == EstadoRadar::Presencia, "lineas",
         "terminador CR");
  dar(r, "\r\n\r\n\n", t0 + 120);
  exigir(salud_de(r, t0 + 120) == kSaludOk && r.contadores().invalidas_otras == 0, "lineas",
         "líneas vacías se ignoran sin contar");
  dar(r, "$JYBSS,0, , , *\r\n$JYBSS,1, , , *\r\n", t0 + 130);
  exigir(r.entrada(t0 + 130).estado == EstadoRadar::Presencia && r.contadores().tramas_validas == 5, "lineas",
         "dos tramas en un bloque: gana la última");
}

void probar_invalidas() {
  struct Caso {
    const char* texto;
    CausaInvalida causa;
    const char* nombre;
  };
  const Caso casos[] = {
      {"$JYBSS,1, , ,\r\n", CausaInvalida::Parcial, "cortada antes de *"},
      {"$JYB\r\n", CausaInvalida::Parcial, "cortada al inicio"},
      {"$\r\n", CausaInvalida::Parcial, "solo $"},
      {"YBSS,1, , , *\r\n", CausaInvalida::Otra, "empezada a la mitad"},
      {"$JYBSS,1, ,X, *\r\n", CausaInvalida::Otra, "un carácter alterado"},
      {"$jybss,1, , , *\r\n", CausaInvalida::Otra, "minúsculas"},
      {"$JYBSS,1, , , * \r\n", CausaInvalida::Otra, "espacio de más"},
      {"$JYBSS,1, , ,$JYBSS,0, , , *\r\n", CausaInvalida::Otra, "dos tramas pegadas sin terminador"},
      {"$JYBSS,2, , , *\r\n", CausaInvalida::Otra, "valor 2 no admitido"},
      {"$JYBSS,1,150, ,30*\r\n", CausaInvalida::Otra, "campos con valores: no es distancia ni ángulo"},
      {"$JYBSS,1,1.5,m,20*\r\n", CausaInvalida::Otra, "unidad en la trama"},
      {"leapMMW:/>\r\n", CausaInvalida::Otra, "ruido de consola"},
      {"hola\r\n", CausaInvalida::Otra, "basura"},
  };
  for (size_t i = 0; i < sizeof(casos) / sizeof(casos[0]); ++i) {
    Interprete r;
    const uint32_t t0 = operar(r, 0);
    dar(r, kP, t0 + 10);
    exigir(salud_de(r, t0 + 20) == kSaludOk, casos[i].nombre, "precondición: resultado vigente");
    dar(r, casos[i].texto, t0 + 30);
    exigir(salud_de(r, t0 + 30) == kSaludTramaInvalida, casos[i].nombre, "salud 3");
    exigir(r.ultima_causa_invalida() == casos[i].causa, casos[i].nombre, "causa");
    const ble::EntradaRadar e = r.entrada(t0 + 30);
    exigir(e.estado == EstadoRadar::Fallo && e.salud == 3 && e.edad_ms == ble::kEdadDesconocida, casos[i].nombre,
           "no reutiliza el resultado anterior");
    // El plazo corre desde la última trama válida (t0 + 10); la corrupción no lo renueva.
    exigir(salud_de(r, t0 + 10 + 2500) == kSaludTramaInvalida, casos[i].nombre, "salud 3 hasta 2500 ms de la válida");
    exigir(salud_de(r, t0 + 10 + 2501) == kSaludSinDatos, casos[i].nombre, "luego salud 2 si no llega nada");
    dar(r, kN, t0 + 3000);
    const ble::EntradaRadar ok = r.entrada(t0 + 3000);
    exigir(ok.estado == EstadoRadar::SinBlanco && ok.edad_ms == 0 && ok.salud == 0, casos[i].nombre,
           "recupera solo con una trama íntegra nueva");
  }

  // Byte NUL y no ASCII dentro de la trama.
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  dar(r, std::string("$JYBSS,1, , , *\0\r\n", 18), t0 + 10);
  exigir(salud_de(r, t0 + 10) == kSaludTramaInvalida, "invalidas", "NUL al final");
  dar(r, "$JYBSS,1, , \xFF, *\r\n", t0 + 20);
  exigir(salud_de(r, t0 + 20) == kSaludTramaInvalida, "invalidas", "byte no ASCII");
}

void probar_larga_y_parcial_sin_terminador() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  dar(r, kP, t0 + 10);
  dar(r, std::string(kLongitudLineaMax, 'x') + "\r\n", t0 + 20);
  exigir(r.ultima_causa_invalida() == CausaInvalida::Otra && r.contadores().invalidas_largas == 0, "larga",
         "64 bytes es el máximo admitido: línea inválida, pero no larga");
  dar(r, std::string(kLongitudLineaMax + 1, 'x') + "\r\n", t0 + 30);
  exigir(r.ultima_causa_invalida() == CausaInvalida::Larga && salud_de(r, t0 + 30) == kSaludTramaInvalida, "larga",
         "65 bytes es larga");
  dar(r, kP, t0 + 40);
  exigir(salud_de(r, t0 + 40) == kSaludOk && r.contadores().tramas_validas == 2, "larga",
         "la trama siguiente tras la línea larga vale");

  // Línea larga repartida en varias llamadas: se cuenta una vez y no corrompe la siguiente.
  dar(r, std::string(100, 'y'), t0 + 50);
  dar(r, std::string(100, 'y'), t0 + 60);
  dar(r, "\r\n", t0 + 70);
  exigir(r.contadores().invalidas_largas == 2, "larga", "una sola cuenta por línea larga");
  dar(r, kN, t0 + 80);
  exigir(salud_de(r, t0 + 80) == kSaludOk, "larga", "recupera");

  // Fragmento sin terminador y silencio: se descarta como parcial.
  dar(r, "$JYBSS,1, , ,", t0 + 100);
  exigir(salud_de(r, t0 + 600) == kSaludOk, "parcial", "500 ms: fragmento aún en curso, resultado previo vale");
  dar(r, kP, t0 + 601);  // una trama nueva tras 501 ms de silencio del fragmento
  exigir(r.contadores().invalidas_parciales == 1 && salud_de(r, t0 + 601) == kSaludOk, "parcial",
         "el fragmento viejo se descarta como parcial y no contamina la trama nueva");
  dar(r, "$JYBSS,1, , ,", t0 + 700);
  exigir(salud_de(r, t0 + 1201) == kSaludTramaInvalida && r.ultima_causa_invalida() == CausaInvalida::Parcial,
         "parcial", "sin terminador y sin bytes: parcial a los 501 ms");
  dar(r, "$JYBSS,0, , , *\r\n", t0 + 1300);
  exigir(salud_de(r, t0 + 1300) == kSaludOk && r.entrada(t0 + 1300).estado == EstadoRadar::SinBlanco, "parcial",
         "recupera sin restos del fragmento");
}

void probar_error_en_operacion() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  dar(r, kP, t0 + 10);
  dar(r, "Error\r\n", t0 + 20);
  exigir(salud_de(r, t0 + 20) == kSaludFalloRadar, "error", "salud 4");
  exigir(r.entrada(t0 + 20).estado == EstadoRadar::Fallo && r.contadores().errores_radar == 1, "error",
         "sin resultado");
  dar(r, "Done\r\n", t0 + 30);
  exigir(salud_de(r, t0 + 30) == kSaludFalloRadar && r.contadores().lineas_ignoradas >= 1, "error",
         "un Done suelto no limpia el fallo");
  dar(r, kP, t0 + 40);
  exigir(salud_de(r, t0 + 40) == kSaludOk, "error", "recupera con una trama íntegra nueva");
  dar(r, "Error\r\n", t0 + 50);
  exigir(salud_de(r, t0 + 50 + 2501) == kSaludSinDatos, "error", "sin tramas, el fallo caduca a salud 2");
}

void probar_caducidad_latido() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  dar(r, kP, t0 + 100);
  exigir(salud_de(r, t0 + 100 + 2500) == kSaludOk, "latido", "2500 ms: vigente");
  exigir(r.entrada(t0 + 100 + 2500).edad_ms == 2500, "latido", "edad 2500");
  exigir(r.latido_vigente(t0 + 100 + 2500), "latido", "latido vigente a 2500");
  exigir(salud_de(r, t0 + 100 + 2501) == kSaludSinDatos, "latido", "2501 ms: salud 2");
  exigir(!r.latido_vigente(t0 + 100 + 2501), "latido", "latido caducado");
  const ble::EntradaRadar e = r.entrada(t0 + 100 + 2501);
  exigir(e.estado == EstadoRadar::Fallo && e.salud == 2 && e.edad_ms == ble::kEdadDesconocida, "latido",
         "entrada de fallo, sin resultado");
  // Aunque el reloj pasado se consulte de nuevo, el resultado caducado no vuelve.
  exigir(r.entrada(t0 + 100 + 2400).estado == EstadoRadar::Fallo, "latido", "el resultado caducado no resucita");
  dar(r, kN, t0 + 4000);
  exigir(r.entrada(t0 + 4000).estado == EstadoRadar::SinBlanco, "latido", "recupera con trama nueva");

  // Un reloj que retrocede no rejuvenece nada.
  exigir(salud_de(r, t0 + 3000) != kSaludOk, "latido", "reloj hacia atrás: no es vigente");

  // Desconexión del cable: tras operar con normalidad, silencio absoluto.
  Interprete d;
  const uint32_t u = operar(d, 0);
  for (int i = 1; i <= 30; ++i) dar(d, kP, u + static_cast<uint32_t>(i) * 1000);
  exigir(salud_de(d, u + 30000) == kSaludOk, "latido", "1 Hz sostenido");
  exigir(salud_de(d, u + 30000 + 2501) == kSaludSinDatos, "latido", "desconexión: salud 2");
  d.procesar(nullptr, 0, u + 40000);
  exigir(d.entrada(u + 40000).salud == 2, "latido", "sigue en 2 sin bytes");
}

void probar_vuelta_de_reloj() {
  // La estabilización cruza la vuelta de 2^32.
  Interprete r;
  const uint32_t fin = operar(r, 0xFFFFFC00u);
  exigir(fin < 0x2000u && r.fase() == Fase::Operando, "vuelta", "cruzó la vuelta y opera");
  exigir(salud_de(r, fin + 2500) == kSaludIniciando && salud_de(r, fin + 2501) == kSaludSinDatos, "vuelta",
         "el plazo del primer latido cruza la vuelta");
  dar(r, kP, fin + 3000);
  exigir(r.entrada(fin + 3000 + 2500).edad_ms == 2500 && salud_de(r, fin + 3000 + 2500) == kSaludOk, "vuelta",
         "2500 ms vigente");
  exigir(salud_de(r, fin + 3000 + 2501) == kSaludSinDatos, "vuelta", "2501 ms caduca");

  // Trama justo antes de la vuelta, consulta después.
  Interprete z;
  operar(z, 0xFFFFE000u);
  const uint32_t antes = 0xFFFFFF00u;
  dar(z, kP, antes);
  const uint32_t despues = antes + 0x300u;
  exigir(despues < antes && z.entrada(despues).edad_ms == 0x300, "vuelta", "edad correcta tras la vuelta");
  exigir(z.salud(antes + 2500) == kSaludOk && z.salud(antes + 2501) == kSaludSinDatos, "vuelta",
         "caducidad exacta a través de la vuelta");

  // Fallo por timeout de orden a través de la vuelta.
  Interprete t;
  t.salida_enviada(0xFFFFFFF0u);
  exigir(salud_de(t, 0xFFFFFFF0u + 2000) == kSaludIniciando && salud_de(t, 0xFFFFFFF0u + 2001) == kSaludFalloRadar,
         "vuelta", "plazo de respuesta a través de la vuelta");
}

void probar_configuracion_con_respuestas() {
  // Error durante la configuración.
  Interprete r;
  r.salida_enviada(0);
  dar(r, "Error\r\n", 5);
  exigir(r.fase() == Fase::Fallo && r.motivo_fallo() == MotivoFallo::RespuestaError, "config", "Error");
  exigir(salud_de(r, 5) == kSaludFalloRadar && orden(r).empty(), "config", "salud 4 y sin más órdenes");
  dar(r, "Done\r\n", 6);
  exigir(r.fase() == Fase::Fallo && orden(r).empty(), "config", "un Done posterior no revive el fallo");
  exigir(r.entrada(7).estado == EstadoRadar::Fallo && r.entrada(7).salud == 4, "config", "entrada de fallo");

  // Timeout: 2000 ms es el máximo; 2001 falla.
  Interprete t;
  t.salida_enviada(100);
  exigir(salud_de(t, 100 + 2000) == kSaludIniciando && t.fase() == Fase::Configurando, "config",
         "2000 ms aún espera");
  exigir(salud_de(t, 100 + 2001) == kSaludFalloRadar && t.motivo_fallo() == MotivoFallo::RespuestaTimeout, "config",
         "2001 ms: timeout, salud 4");
  exigir(t.contadores().timeouts_orden == 1, "config", "cuenta el timeout");
  dar(t, "Done\r\n", 100 + 2100);
  exigir(t.fase() == Fase::Fallo, "config", "Done tardío tras el timeout no se acepta como éxito");

  // Un Done que llega a tiempo en el mismo instante límite sí vale; uno 1 ms tarde no.
  Interprete a;
  a.salida_enviada(0);
  dar(a, "Done\r\n", 2000);
  exigir(a.fase() == Fase::Configurando && orden(a) == "detRangeCfg -1 0 2\r\n", "config", "Done a 2000 ms vale");
  Interprete b;
  b.salida_enviada(0);
  dar(b, "Done\r\n", 2001);
  exigir(b.fase() == Fase::Fallo, "config", "Done a 2001 ms llega tarde");

  // Done duplicado o adelantado no confirma la orden siguiente.
  Interprete d;
  d.salida_enviada(0);
  dar(d, "Done\r\nDone\r\nDone\r\n", 10);
  exigir(orden(d) == "detRangeCfg -1 0 2\r\n" && d.fase() == Fase::Configurando, "config",
         "los Done sobrantes no avanzan nada");
  d.salida_enviada(20);
  exigir(d.fase() == Fase::Configurando && orden(d).empty(), "config", "la orden 2 espera su propio Done");
  dar(d, "Done\r\n", 30);
  exigir(orden(d) == "outputLatency -1 0 8\r\n", "config", "su Done sí la confirma");
  // Una línea parcial previa al envío no se mezcla con la respuesta.
  Interprete e;
  dar(e, "Do", 0);
  e.salida_enviada(1);
  dar(e, "ne\r\n", 2);
  exigir(e.fase() == Fase::Configurando && orden(e).empty() && e.contadores().lineas_ignoradas == 1, "config",
         "el resto 'ne' de un 'Do' previo no es un Done");

  // Error en estabilización: el radar declara un fallo.
  Interprete s;
  const uint32_t done = configurar(s, 0);
  dar(s, "Error\r\n", done + 100);
  exigir(s.fase() == Fase::Fallo && salud_de(s, done + 100) == kSaludFalloRadar, "config", "Error al estabilizar");
}

// R1 del banco del 12/11: con el radar ya parado, sensorStop contesta
// `sensor stopped already` y, en la línea siguiente, `Error`. Es éxito, pero solo
// para sensorStop y solo con esa línea exacta antes.
void probar_sensor_ya_parado() {
  const char* const ya = "sensor stopped already\r\n";

  // La respuesta real del banco, con el eco y el prompt de la consola.
  Interprete r;
  r.salida_enviada(0);
  dar(r, std::string("sensorStop\r\n") + ya + "Error\r\nleapMMW:/>", 20);
  exigir(r.fase() == Fase::Configurando && orden(r) == "detRangeCfg -1 0 2\r\n", "parado", "avanza a detRangeCfg");
  exigir(r.contadores().errores_radar == 0 && r.motivo_fallo() == MotivoFallo::Ninguno, "parado",
         "no es un fallo ni cuenta como Error del radar");
  exigir(salud_de(r, 20) == kSaludIniciando, "parado", "salud 1, no 4");

  // Línea y Error en llamadas distintas.
  Interprete p;
  p.salida_enviada(0);
  dar(p, ya, 10);
  exigir(p.fase() == Fase::Configurando && orden(p).empty(), "parado", "la línea sola aún no confirma nada");
  dar(p, "Error\r\n", 20);
  exigir(p.fase() == Fase::Configurando && orden(p) == "detRangeCfg -1 0 2\r\n", "parado", "su Error la confirma");

  // La secuencia entera llega a operar con ese Error en el primer paso.
  Interprete c;
  uint32_t t = 0;
  for (int i = 0; i < kPasosConfiguracion; ++i) {
    exigir(!orden(c).empty(), "parado", "orden pendiente");
    c.salida_enviada(t);
    t += 20;
    dar(c, i == 0 ? std::string(ya) + "Error\r\n" : std::string("Done\r\n"), t);
  }
  exigir(c.fase() == Fase::Estabilizando, "parado", "secuencia completa");
  const uint32_t fin = t + c.configuracion().estabilizacion_ms;
  dar(c, kP, fin + 10);
  exigir(salud_de(c, fin + 10) == kSaludOk && c.contadores().errores_radar == 0, "parado", "opera sin errores");

  // Un Error suelto en sensorStop sigue siendo fallo (el radar no la entendió).
  Interprete e;
  e.salida_enviada(0);
  dar(e, "Error\r\n", 10);
  exigir(e.fase() == Fase::Fallo && e.contadores().errores_radar == 1, "parado", "Error sin la línea: fallo");
  // Texto parecido no vale (R4: `ensorStop is not recognized as a CLI command`).
  Interprete q;
  q.salida_enviada(0);
  dar(q, "ensorStop is not recognized as a CLI command\r\nError\r\n", 10);
  exigir(q.fase() == Fase::Fallo, "parado", "comando no reconocido: fallo");
  for (const char* parecida : {"leapMMW:/>sensor stopped already\r\n", "sensor stopped already.\r\n",
                               "Sensor stopped already\r\n", "sensor started already\r\n"}) {
    Interprete f;
    f.salida_enviada(0);
    dar(f, std::string(parecida) + "Error\r\n", 10);
    exigir(f.fase() == Fase::Fallo, "parado", "solo la línea exacta");
  }

  // Solo en sensorStop: en los demás pasos esa línea + Error es un fallo.
  for (int paso = 1; paso < kPasosConfiguracion; ++paso) {
    Interprete o;
    uint32_t u = 0;
    for (int i = 0; i < paso; ++i) {
      o.salida_enviada(u);
      u += 20;
      dar(o, "Done\r\n", u);
    }
    o.salida_enviada(u);
    dar(o, std::string(ya) + "Error\r\n", u + 10);
    exigir(o.fase() == Fase::Fallo && o.contadores().errores_radar == 1, "parado", "otro paso: fallo");
  }

  // El aviso no se arrastra: ni al reiniciar, ni a la orden siguiente.
  Interprete a;
  a.salida_enviada(0);
  dar(a, ya, 10);
  a.reiniciar();
  const uint32_t plazo = a.configuracion().respuesta_max_ms;
  a.procesar(nullptr, 0, 10 + plazo + 1);                // vence la orden vieja
  a.procesar(nullptr, 0, 10 + plazo + 1 + plazo);        // y termina la purga
  exigir(orden(a) == "sensorStop\r\n", "parado", "la purga terminó");
  a.salida_enviada(10 + 2 * plazo + 1);
  dar(a, "Error\r\n", 20 + 2 * plazo + 1);
  exigir(a.fase() == Fase::Fallo, "parado", "tras reiniciar, la línea vieja no valida un Error");
  Interprete b;
  b.salida_enviada(0);
  dar(b, "Done\r\n", 10);
  b.salida_enviada(10);
  dar(b, "Error\r\n", 20);
  exigir(b.fase() == Fase::Fallo, "parado", "Error de detRangeCfg: fallo");
  // Fuera de espera (sin orden en curso) ni la línea ni el Error valen.
  Interprete g;
  dar(g, std::string(ya) + "Error\r\n", 10);
  exigir(g.fase() == Fase::Configurando && orden(g) == "sensorStop\r\n", "parado", "sin orden en curso no avanza");
  // Durante la estabilización, un Error sigue siendo un fallo.
  Interprete h;
  const uint32_t done = configurar(h, 0);
  dar(h, std::string(ya) + "Error\r\n", done + 100);
  exigir(h.fase() == Fase::Fallo, "parado", "Error al estabilizar: fallo");
}

void probar_reinicio() {
  Interprete r;
  uint32_t t0 = operar(r, 0);
  dar(r, kP, t0 + 10);
  exigir(salud_de(r, t0 + 20) == kSaludOk, "reinicio", "opera");
  dar(r, "$JYBSS,1", t0 + 25);  // fragmento pendiente al reiniciar
  r.reiniciar();
  exigir(r.fase() == Fase::Configurando && salud_de(r, t0 + 30) == kSaludIniciando, "reinicio", "salud 1");
  exigir(r.entrada(t0 + 30).estado == EstadoRadar::Fallo && r.entrada(t0 + 30).edad_ms == ble::kEdadDesconocida,
         "reinicio", "sin resultado antiguo");
  exigir(orden(r) == "sensorStop\r\n" && r.contadores().reinicios == 1, "reinicio", "repite la configuración");
  r.salida_enviada(t0 + 40);
  dar(r, ", , , *\r\n", t0 + 41);  // el resto del fragmento viejo no forma una trama
  exigir(r.contadores().tramas_validas == 1, "reinicio", "el fragmento viejo no se completa");
  dar(r, "Done\r\n", t0 + 42);
  exigir(orden(r) == "detRangeCfg -1 0 2\r\n", "reinicio", "avanza con su propio Done");
}

void probar_reinicio_completo() {
  Interprete r;
  uint32_t t0 = operar(r, 0);
  dar(r, kP, t0 + 10);
  r.reiniciar();
  // Reconfigura: el radar manda tramas viejas durante todo el proceso.
  uint32_t t = t0 + 100;
  for (int i = 0; i < kPasosConfiguracion; ++i) {
    r.salida_enviada(t);
    dar(r, kP, t + 5);
    t += 20;
    dar(r, "Done\r\n", t);
  }
  exigir(r.fase() == Fase::Estabilizando, "reinicio", "reconfigurado");
  dar(r, kP, t + 1000);
  exigir(salud_de(r, t + 5000) == kSaludIniciando && r.entrada(t + 5000).estado == EstadoRadar::Fallo, "reinicio",
         "tras 5 s no hay resultado: las tramas previas no cuentan");
  dar(r, kN, t + 5100);
  exigir(r.entrada(t + 5100).estado == EstadoRadar::SinBlanco, "reinicio", "una trama íntegra nueva recupera");
  exigir(r.entrada(t + 5100).edad_ms == 0, "reinicio", "con edad nueva");
}

void probar_purga_tras_timeout() {
  Interprete r;
  r.salida_enviada(0);
  exigir(salud_de(r, 2001) == kSaludFalloRadar, "purga", "timeout");
  r.reiniciar();
  exigir(orden(r).empty(), "purga", "tras un timeout la primera orden se retiene");
  dar(r, "Done\r\n", 2100);  // respuesta tardía de la orden vieja
  exigir(r.fase() == Fase::Configurando && orden(r).empty(), "purga", "durante la purga el Done no confirma nada");
  r.procesar(nullptr, 0, 2001 + 1999);
  exigir(orden(r).empty(), "purga", "1999 ms después del timeout aún se purga");
  r.procesar(nullptr, 0, 2001 + 2000);
  exigir(orden(r) == "sensorStop\r\n", "purga", "terminada la purga se reconfigura");
  r.salida_enviada(4100);
  dar(r, "Done\r\n", 4110);
  exigir(orden(r) == "detRangeCfg -1 0 2\r\n", "purga", "ahora sí avanza");

  // Reiniciar mientras se espera una respuesta: también se purga.
  Interprete e;
  e.salida_enviada(10);
  e.reiniciar();
  exigir(orden(e).empty(), "purga", "reinicio con orden en vuelo: purga");
  dar(e, "Done\r\n", 20);
  exigir(orden(e).empty(), "purga", "el Done de la orden en vuelo no confirma");
  e.procesar(nullptr, 0, 10 + 2000);
  exigir(orden(e).empty(), "purga", "a los 2000 ms la orden vieja aún está en su plazo: se retiene");
  dar(e, "Done\r\n", 10 + 2001);  // respuesta de la orden vieja justo pasado su plazo
  exigir(orden(e).empty(), "purga", "una respuesta vieja pasado su plazo tampoco confirma ni libera");
  e.procesar(nullptr, 0, 10 + 4000);
  exigir(orden(e).empty(), "purga", "hasta 2 x plazo desde el envío (cuenta desde el vencimiento) se retiene");
  e.procesar(nullptr, 0, 10 + 2001 + 2000);
  exigir(orden(e) == "sensorStop\r\n", "purga", "pasados 2 x plazo, sale sensorStop");
  e.salida_enviada(10 + 4001);
  dar(e, "Done\r\n", 10 + 4011);
  exigir(orden(e) == "detRangeCfg -1 0 2\r\n", "purga", "después, su propio Done avanza");

  // Hallazgo 2: reinicio a los 20 ms con la 2.ª orden enviada a los 10 ms; la
  // respuesta vieja llega a los 2011 ms (2001 ms tras el envío).
  Interprete g;
  g.salida_enviada(0);
  dar(g, "Done\r\n", 1);
  g.salida_enviada(10);
  g.procesar(nullptr, 0, 20);
  g.reiniciar();
  g.procesar(nullptr, 0, 2010);
  exigir(orden(g).empty(), "purga", "reinicio en vuelo: a 2010 ms no sale sensorStop");
  g.procesar(nullptr, 0, 2011);
  dar_crudo(g, "Done\r\n", 2011);
  exigir(orden(g).empty() && g.fase() == Fase::Configurando, "purga", "el Done viejo a 2011 ms no confirma nada");
  g.procesar(nullptr, 0, 4010);
  exigir(orden(g).empty(), "purga", "ni antes de los 4000 ms documentados");
  g.procesar(nullptr, 0, 4011);
  exigir(orden(g) == "sensorStop\r\n", "purga", "pasada la frontera, sale");

  // Reiniciar dos veces con la orden en vuelo no acorta la purga.
  Interprete h;
  h.salida_enviada(10);
  h.reiniciar();
  h.procesar(nullptr, 0, 500);
  h.reiniciar();
  h.procesar(nullptr, 0, 2011);
  h.procesar(nullptr, 0, 4010);
  exigir(orden(h).empty(), "purga", "reiniciar de nuevo no acorta la purga");
  h.procesar(nullptr, 0, 4011);
  exigir(orden(h) == "sensorStop\r\n", "purga", "sale pasada la frontera");

  // Fallo por Error: no hay respuesta pendiente, no se purga.
  Interprete f;
  f.salida_enviada(0);
  dar(f, "Error\r\n", 5);
  f.reiniciar();
  exigir(orden(f) == "sensorStop\r\n", "purga", "tras Error se reconfigura de inmediato");
}

void probar_hueco_de_lectura() {
  Interprete r;
  uint32_t t = operar(r, 0);
  for (int i = 0; i < 10; ++i) {
    t += 100;
    r.procesar(nullptr, 0, t);
  }
  // Bucle bloqueado 3 s: los bytes esperaron en la UART; la trama no puede ser reciente.
  t += 3000;
  dar_crudo(r, kP, t);
  exigir(r.entrada(t).estado == EstadoRadar::Fallo && salud_de(r, t) == kSaludSinDatos, "hueco",
         "trama tras 3 s sin leer: se fecha en la lectura anterior, ya caducada");
  // Con 300 ms de hueco se fecha en la llamada anterior.
  uint32_t u = t + 100;
  r.procesar(nullptr, 0, u);
  u += 300;
  dar_crudo(r, kP, u);
  exigir(r.entrada(u).edad_ms == 300, "hueco", "con 300 ms de hueco la edad es 300, no 0");
  // Con 250 ms exactos y con ciclos de 100 ms: edad real.
  r.procesar(nullptr, 0, u + 250);
  dar_crudo(r, kN, u + 250);
  exigir(r.entrada(u + 250).edad_ms == 0, "hueco", "hasta 250 ms se fecha en la lectura");
  u += 300;
  r.procesar(nullptr, 0, u);
  dar_crudo(r, kP, u + 100);
  exigir(r.entrada(u + 100).edad_ms == 0, "hueco", "ciclo normal de 100 ms");
}

const uint8_t* bytes_de(const std::string& s, size_t desde = 0) {
  return reinterpret_cast<const uint8_t*>(s.data()) + desde;
}

// Medición BLE tal como la publicaría el emisor en el instante t.
ble::Medicion publicar(Interprete& r, uint32_t t) {
  ble::Informacion info;
  info.id_arranque = 1;
  info.perfil = 1;
  info.distancia_maxima_mm = r.ventana_maxima_mm();
  ble::EmisorSintetico em(info, false);
  uint8_t b[ble::kLongitudTrama];
  ble::Medicion m;
  const bool ok = em.generar(t, r.entrada(t), b) == ble::Error::Ninguno &&
                  ble::decodificar_medicion(b, sizeof(b), info, &m) == ble::Error::Ninguno;
  exigir(ok, "publicar", "genera y decodifica");
  return m;
}

// Una oferta mayor que la cota se descarta ENTERA y se devuelve n: sin resto,
// sin lectura de un solo byte.
void probar_cota_de_lectura() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  std::string basura(1000, 'z');
  r.procesar(nullptr, 0, t0);  // lectura previa: sin hueco, los bytes se fechan al leerlos
  exigir(r.procesar(bytes_de(basura), kMaxBytesPorLlamada, t0 + 10) == kMaxBytesPorLlamada, "cota",
         "exactamente la cota se procesa y se devuelve entera");
  exigir(r.contadores().invalidas_largas == 1, "cota", "la cota procesada sí se lee (línea larga)");
  exigir(r.procesar(bytes_de(basura), kMaxBytesPorLlamada + 1, t0 + 20) == kMaxBytesPorLlamada + 1, "cota",
         "cota + 1: se descarta entera y se devuelve n, no 256");
  exigir(r.procesar(bytes_de(basura), basura.size(), t0 + 30) == basura.size(), "cota",
         "1000 bytes: se devuelven 1000 (descartados), no 256");
  exigir(r.procesar(bytes_de(basura), 10, t0 + 40) == 10, "cota", "menos que la cota: se consume lo ofrecido");
  exigir(r.procesar(nullptr, 5, t0 + 50) == 0, "cota", "puntero nulo no consume");
  exigir(r.procesar(nullptr, kMaxBytesPorLlamada + 5, t0 + 60) == 0, "cota", "puntero nulo y oferta grande: 0");

  // O(1): no lee ni un byte de la oferta grande (un solo byte válido detrás del puntero).
  const uint8_t uno = 'x';
  const size_t enorme = static_cast<size_t>(1) << 30;
  exigir(r.procesar(&uno, enorme, t0 + 70) == enorme, "cota", "oferta enorme: se descarta sin leerla");
}

// Regresión (hallazgo 1): una oferta fuera de la cota se rechaza ENTERA; ni la
// trama ni el Done dentro valen, y el retorno completo evita reofrecerla.
void probar_oversize_rechazado() {
  const std::string grande = std::string(3 * kMaxBytesPorLlamada, '\n') + kP;
  {  // Tras un hueco: nada de la oferta puede quedar como resultado reciente.
    Interprete r;
    const uint32_t t0 = operar(r, 0);
    r.procesar(nullptr, 0, t0);
    const size_t c = r.procesar(bytes_de(grande), grande.size(), t0 + 3000);
    exigir(c == grande.size(), "oversize", "devuelve la cantidad descartada completa");
    const ble::Medicion m = publicar(r, t0 + 3000);
    exigir(m.salud == 2 && (m.banderas & 0x0F) == 0 && r.contadores().tramas_validas == 0, "oversize",
           "la trama dentro de la oferta descartada no se acepta (salud 2, sin resultado)");
    exigir(!r.latido_vigente(t0 + 3000), "oversize", "no hay latido vigente");
    // Sin rejuvenecer, pasen los ciclos que pasen: cada ciclo vacío no cambia nada.
    for (uint32_t d = 3100; d <= 3400; d += 100) r.procesar(nullptr, 0, t0 + d);
    exigir(publicar(r, t0 + 3400).salud == 2 && r.contadores().tramas_validas == 0, "oversize",
           "los ciclos vacíos posteriores no resucitan nada");
    dar(r, kN, t0 + 3500);
    const ble::Medicion n = publicar(r, t0 + 3500);
    exigir(n.salud == 0 && n.edad_radar_ms == 0 && (n.banderas & 0x0F) != 0, "oversize",
           "una observación íntegra nueva recupera, con edad real");
  }
  {  // Con latido vigente: el resultado anterior deja de valer, el plazo no se renueva.
    Interprete r;
    const uint32_t t0 = operar(r, 0);
    dar(r, kP, t0 + 10);
    exigir(salud_de(r, t0 + 20) == kSaludOk, "oversize", "precondición: resultado vigente");
    exigir(r.procesar(bytes_de(grande), grande.size(), t0 + 110) == grande.size(), "oversize", "descarta entera");
    exigir(salud_de(r, t0 + 110) == kSaludTramaInvalida && r.ultima_causa_invalida() == CausaInvalida::Larga, "oversize",
           "no conserva el resultado válido anterior: salud 3, causa Larga");
    exigir(r.entrada(t0 + 110).estado == EstadoRadar::Fallo && r.contadores().tramas_validas == 1 &&
               r.contadores().invalidas_largas == 1,
           "oversize", "sin resultado; la trama descartada no se cuenta; una inválida larga");
    exigir(salud_de(r, t0 + 10 + 2500) == kSaludTramaInvalida && salud_de(r, t0 + 10 + 2501) == kSaludSinDatos, "oversize",
           "el timeout del latido sigue contando desde la última trama válida");
    dar(r, kN, t0 + 3000);
    exigir(salud_de(r, t0 + 3000) == kSaludOk && r.entrada(t0 + 3000).edad_ms == 0, "oversize",
           "una observación íntegra posterior recupera");
  }
  {  // Mezcla Done/datos en operación: ninguna línea de la oferta descartada cuenta.
    Interprete r;
    const uint32_t t0 = operar(r, 0);
    std::string mezcla;
    while (mezcla.size() <= kMaxBytesPorLlamada) mezcla += std::string("Done\r\n") + kP + kN + "Error\r\n";
    r.procesar(nullptr, 0, t0 + 10);
    exigir(r.procesar(bytes_de(mezcla), mezcla.size(), t0 + 20) == mezcla.size(), "oversize", "mezcla: devuelve n");
    const Contadores& c = r.contadores();
    exigir(c.tramas_validas == 0 && c.errores_radar == 0 && c.lineas_ignoradas == 0, "oversize",
           "mezcla: nada de la oferta se interpretó (ni tramas, ni Error, ni Done)");
    exigir(salud_de(r, t0 + 20) == kSaludTramaInvalida, "oversize", "mezcla: falla seguro, salud 3");
    dar(r, kP, t0 + 120);
    exigir(salud_de(r, t0 + 120) == kSaludOk, "oversize", "mezcla: recupera con la siguiente íntegra");
  }
  {  // La línea parcial en curso se pierde: no se une con lo que llegue después.
    Interprete r;
    const uint32_t t0 = operar(r, 0);
    dar(r, "$JYBSS,1, , ", t0 + 10);
    r.procesar(bytes_de(grande), grande.size(), t0 + 20);
    dar(r, ", *\r\n", t0 + 30);
    exigir(r.contadores().tramas_validas == 0 && salud_de(r, t0 + 30) == kSaludTramaInvalida, "oversize",
           "el fragmento previo no se completa con lo posterior");
  }
  {  // Configuración: un Done dentro de la oferta descartada no confirma nada.
    Interprete r;
    r.salida_enviada(0);
    const std::string con_done = "Done\r\n" + std::string(kMaxBytesPorLlamada, '\n') + "Done\r\n";
    exigir(r.procesar(bytes_de(con_done), con_done.size(), 10) == con_done.size(), "oversize", "config: devuelve n");
    exigir(r.fase() == Fase::Configurando && orden(r).empty() && r.contadores().lineas_ignoradas == 0, "oversize",
           "config: el Done descartado no confirma ni avanza");
    r.procesar(nullptr, 0, 2000);
    exigir(r.fase() == Fase::Configurando, "oversize", "config: 2000 ms aún espera");
    r.procesar(nullptr, 0, 2001);
    exigir(r.fase() == Fase::Fallo && r.motivo_fallo() == MotivoFallo::RespuestaTimeout, "oversize",
           "config: la orden sin respuesta vence por timeout (falla seguro)");
    // Si el radar sí responde después dentro del plazo, avanza.
    Interprete q;
    q.salida_enviada(0);
    q.procesar(bytes_de(con_done), con_done.size(), 10);
    dar(q, "Done\r\n", 20);
    exigir(orden(q) == "detRangeCfg -1 0 2\r\n", "oversize", "config: el Done íntegro posterior sí confirma");
  }
}

// UART simulada con el mismo recorte que atender_radar() de accesorio.ino: se
// leen hasta kMaxBytesPorLlamada; si queda más, se descarta todo y se ofrece
// n == 0. El intérprete nunca recibe más que la cota.
struct UartSimulada {
  std::string cola;
  size_t pos = 0;
  size_t descartados = 0;
  void llegan(const std::string& s) { cola += s; }
  size_t disponibles() const { return cola.size() - pos; }
  size_t ciclo(Interprete& radar, uint32_t t) {
    uint8_t bytes[kMaxBytesPorLlamada];
    size_t n = 0;
    while (n < sizeof(bytes) && disponibles() > 0) bytes[n++] = static_cast<uint8_t>(cola[pos++]);
    if (disponibles() > 0) {
      descartados += disponibles() + n;
      pos = cola.size();
      n = 0;
    }
    const size_t c = radar.procesar(bytes, n, t);
    exigir(c == n, "uart", "con <= 256 B el retorno es exactamente lo ofrecido");
    return c;
  }
};

void probar_uart_simulada() {
  Interprete r;
  UartSimulada u;
  uint32_t t = operar(r, 0);
  u.ciclo(r, t);
  // 1 Hz normal, ciclos de 100 ms.
  for (int i = 0; i < 30; ++i) {
    t += 100;
    if (i % 10 == 0) u.llegan(kP);
    u.ciclo(r, t);
  }
  exigir(salud_de(r, t) == kSaludOk && r.contadores().tramas_validas == 3, "uart", "1 Hz normal: 3 tramas");
  // Exactamente la cota esperando: se procesa entera.
  t += 100;
  u.llegan(std::string(kMaxBytesPorLlamada - std::string(kN).size(), '\n') + kN);
  exigir(u.disponibles() == kMaxBytesPorLlamada, "uart", "precondición: justo la cota");
  u.ciclo(r, t);
  exigir(u.descartados == 0 && r.contadores().tramas_validas == 4 && r.entrada(t).estado == EstadoRadar::SinBlanco, "uart",
         "256 B justos: se procesan");
  // Bucle bloqueado 3 s con 800 B (incluida una trama) en la UART: el recorte
  // la descarta y no se acepta como reciente.
  t += 3000;
  u.llegan(std::string(3 * kMaxBytesPorLlamada, '\n') + kP);
  u.ciclo(r, t);
  exigir(u.descartados == 3 * kMaxBytesPorLlamada + std::string(kP).size() && r.contadores().tramas_validas == 4, "uart",
         "800 B tras 3 s: se descartan, la trama no se acepta");
  exigir(salud_de(r, t) == kSaludSinDatos, "uart", "latido caducado, sin resultado viejo ni nuevo");
  t += 100;
  u.llegan(kP);
  u.ciclo(r, t);
  exigir(salud_de(r, t) == kSaludOk && r.entrada(t).edad_ms == 0, "uart", "la trama íntegra siguiente recupera");
}

// Regresión: la corrupción periódica no renueva el latido. El plazo corre
// desde la última trama válida.
void probar_ruido_no_oculta_timeout() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  const uint32_t valida = t0 + 100;
  dar(r, kP, valida);
  for (uint32_t d = 100; d <= 4000; d += 100) {
    if (d % 1000 == 0) dar(r, "x\r\n", valida + d);
    else r.procesar(nullptr, 0, valida + d);
    if (d == 2500) exigir(salud_de(r, valida + d) == kSaludTramaInvalida, "ruido", "2500 ms: aún salud 3");
    if (d == 2600) exigir(salud_de(r, valida + d) == kSaludSinDatos, "ruido", "2600 ms: salud 2");
  }
  exigir(salud_de(r, valida + 2501) == kSaludSinDatos, "ruido", "2501 ms: salud 2");
  const ble::Medicion m = publicar(r, valida + 4000);
  exigir(m.salud == 2 && (m.banderas & 0x0F) == 0, "ruido", "4000 ms con ruido cada 1000: salud 2");
  exigir(r.contadores().tramas_validas == 1 && r.contadores().invalidas_otras == 4, "ruido", "el ruido se cuenta");
  dar(r, kN, valida + 4100);
  exigir(salud_de(r, valida + 4100) == kSaludOk, "ruido", "una trama íntegra nueva recupera");

  // Antes de la primera trama el plazo corre desde el fin de la estabilización.
  Interprete p;
  const uint32_t fin = operar(p, 0);
  dar(p, "x\r\n", fin + 2000);
  exigir(salud_de(p, fin + 2000) == kSaludTramaInvalida, "ruido", "ruido sin primera trama: salud 3");
  dar(p, "x\r\n", fin + 2400);
  exigir(salud_de(p, fin + 2500) == kSaludTramaInvalida, "ruido", "primera trama: 2500 ms, salud 3");
  dar(p, "x\r\n", fin + 2600);
  exigir(salud_de(p, fin + 2600) == kSaludSinDatos, "ruido", "primera trama: 2600 ms con ruido, salud 2");

  // Lo mismo con `Error` periódico.
  Interprete e;
  const uint32_t te = operar(e, 0);
  dar(e, kP, te + 100);
  for (uint32_t d = 1100; d <= 4100; d += 1000) dar(e, "Error\r\n", te + d);
  exigir(salud_de(e, te + 4100) == kSaludSinDatos, "ruido", "Error periódico tampoco oculta el timeout");
}

void probar_limites_de_reloj() {
  Configuracion c;
  c.estabilizacion_ms = 0x80000000u;
  exigir(!configuracion_valida(c), "reloj", "estabilización >= 2^31 rechazada");
  c = Configuracion();
  c.respuesta_max_ms = 0x80000000u;
  exigir(!configuracion_valida(c), "reloj", "plazo de respuesta >= 2^31 rechazado");
  c = Configuracion();
  c.estabilizacion_ms = 0x7FFFFFFFu;
  c.respuesta_max_ms = 0x7FFFFFFFu;
  exigir(configuracion_valida(c), "reloj", "2^31 - 1 es el máximo admitido");
  Interprete r(c);
  operar(r, 0);
  exigir(r.fase() == Fase::Operando, "reloj", "el máximo admitido sí estabiliza");

  // Hallazgo 3: consultar justo antes, en y justo después del plazo máximo, o
  // saltándolo con mucho margen, no bloquea la estabilización.
  const uint32_t consultas[] = {kPlazoMaxMs - 1, kPlazoMaxMs, kPlazoMaxMs + 1, 0x80000005u, 0xC0000000u, 0xFFFFFFF0u};
  for (size_t i = 0; i < sizeof(consultas) / sizeof(consultas[0]); ++i) {
    Interprete e(c);
    const uint32_t done = configurar(e, 0);
    if (i > 0) {
      e.salud(done + kPlazoMaxMs - 1);
      exigir(e.fase() == Fase::Estabilizando, "reloj", "a plazo - 1 sigue estabilizando");
    }
    e.salud(done + consultas[i]);
    exigir(i == 0 ? e.fase() == Fase::Estabilizando : e.fase() == Fase::Operando, "reloj",
           "estabilización máxima: transición en plazo, plazo + 1 y saltándose el umbral");
  }
  // Mismo patrón en la purga tras timeout, con el plazo máximo.
  Interprete p(c);
  p.salida_enviada(0);
  const uint32_t falla = kPlazoMaxMs + 1;  // 2^31: primer instante con timeout
  exigir(p.salud(falla) == kSaludFalloRadar && p.motivo_fallo() == MotivoFallo::RespuestaTimeout, "reloj",
         "timeout con plazo máximo");
  p.reiniciar();
  p.procesar(nullptr, 0, falla + kPlazoMaxMs - 1);
  exigir(orden(p).empty(), "reloj", "purga máxima: plazo - 1 aún retiene");
  p.procesar(nullptr, 0, falla + kPlazoMaxMs);
  exigir(orden(p) == "sensorStop\r\n", "reloj", "purga máxima: libera en el plazo");
  Interprete q(c);
  q.salida_enviada(0);
  q.salud(falla);
  q.reiniciar();
  q.procesar(nullptr, 0, falla + kPlazoMaxMs + 1);
  exigir(orden(q) == "sensorStop\r\n", "reloj", "purga máxima: consultada pasado el plazo, libera");
  Interprete v(c);  // reinicio en vuelo con plazo máximo
  v.salida_enviada(0);
  v.reiniciar();
  v.procesar(nullptr, 0, kPlazoMaxMs);
  exigir(orden(v).empty(), "reloj", "en vuelo máximo: dentro del plazo se retiene");
  v.procesar(nullptr, 0, falla);
  v.procesar(nullptr, 0, falla + kPlazoMaxMs - 1);
  exigir(orden(v).empty(), "reloj", "en vuelo máximo: la purga dura el plazo completo");
  v.procesar(nullptr, 0, falla + kPlazoMaxMs);
  exigir(orden(v) == "sensorStop\r\n", "reloj", "en vuelo máximo: libera pasados 2 x plazo");

  // Un hueco de lectura >= 2^31 ms no rejuvenece los bytes.
  Interprete h;
  const uint32_t t0 = operar(h, 0);
  h.procesar(nullptr, 0, t0 + 10);
  dar_crudo(h, kP, t0 + 10 + 0x80000005u);
  exigir(salud_de(h, t0 + 10 + 0x80000005u) == kSaludSinDatos, "reloj",
         "tras un hueco de 2^31 ms la trama se fecha en la lectura anterior, no se rejuvenece");
}

void probar_nunca_distancia() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  const char* const lineas[] = {kP, kN, "$JYBSS,1,12,0,0*\r\n", "Error\r\n", "$JYBSS,2, , , *\r\n",
                                "$JYBSS,1, , ,\r\n", "x\r\n"};
  for (int vuelta = 0; vuelta < 3; ++vuelta) {
    for (size_t i = 0; i < sizeof(lineas) / sizeof(lineas[0]); ++i) {
      const uint32_t t = t0 + 100 + static_cast<uint32_t>(vuelta * 10 + static_cast<int>(i)) * 7;
      dar(r, lineas[i], t);
      const ble::EntradaRadar e = r.entrada(t);
      exigir(e.estado != EstadoRadar::Objetivo && e.distancia_mm == ble::kDistanciaDesconocida && !e.tiene_azimut,
             "distancia", "el SEN0395 nunca produce Objetivo, distancia ni azimut");
    }
  }
}

void probar_contadores_y_emisor() {
  Interprete r;
  const uint32_t t0 = operar(r, 0);
  dar(r, kP, t0 + 10);
  dar(r, "$JYBSS,1, , ,\r\n", t0 + 20);
  dar(r, kN, t0 + 30);
  dar(r, "basura\r\n", t0 + 40);
  const Contadores& c = r.contadores();
  exigir(c.tramas_validas == 2 && c.invalidas_parciales == 1 && c.invalidas_otras == 1 && c.invalidas_largas == 0,
         "contadores", "cuentas por causa");

  // Salud por el emisor: se publica en el campo salud y sin bits 0 a 3.
  ble::Informacion info;
  info.perfil = 1;
  info.distancia_maxima_mm = r.ventana_maxima_mm();
  ble::EmisorSintetico em(info, true);
  uint8_t t20[ble::kLongitudTrama];
  ble::Medicion m;
  exigir(em.generar(t0 + 40, r.entrada(t0 + 40), t20) == ble::Error::Ninguno, "emisor", "genera");
  exigir(ble::decodificar_medicion(t20, ble::kLongitudTrama, info, &m) == ble::Error::Ninguno && m.salud == 3 &&
             (m.banderas & 0x0F) == 0 && m.edad_radar_ms == ble::kEdadDesconocida,
         "emisor", "salud 3 sin resultado ni edad");
  Interprete s;  // sin estabilizar
  exigir(em.generar(0, s.entrada(0), t20) == ble::Error::Ninguno &&
             ble::decodificar_medicion(t20, ble::kLongitudTrama, info, &m) == ble::Error::Ninguno && m.salud == 1,
         "emisor", "salud 1 al iniciar");
}

}  // namespace

int main() {
  probar_ordenes();
  probar_configuracion_invalida();
  probar_estabilizacion_y_primer_latido();
  probar_presencia_y_edad();
  probar_formatos_de_linea();
  probar_invalidas();
  probar_larga_y_parcial_sin_terminador();
  probar_error_en_operacion();
  probar_caducidad_latido();
  probar_vuelta_de_reloj();
  probar_configuracion_con_respuestas();
  probar_sensor_ya_parado();
  probar_reinicio();
  probar_reinicio_completo();
  probar_purga_tras_timeout();
  probar_hueco_de_lectura();
  probar_cota_de_lectura();
  probar_oversize_rechazado();
  probar_uart_simulada();
  probar_ruido_no_oculta_timeout();
  probar_limites_de_reloj();
  probar_nunca_distancia();
  probar_contadores_y_emisor();
  printf("sen0395: %d comprobaciones, %d fallos\n", g_casos, g_fallos);
  return g_fallos == 0 ? 0 : 1;
}

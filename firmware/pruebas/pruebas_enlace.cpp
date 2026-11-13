// Pruebas en el portátil de enlace_accesorio (EA-12): ventana de alta, botón,
// sesión, suscripción, ritmo de notificaciones, "nada retenido" y selección de
// pines. No prueban el stack BLE, la UART ni el radar; el cifrado, la
// autenticación y el vínculo reales solo se prueban con la placa y un iPhone.
// Uso: pruebas_enlace
#include <initializer_list>
#include <stdint.h>
#include <stdio.h>

#include "emisor_sintetico.h"
#include "enlace_accesorio.h"
#include "sen0395.h"
#include "trama_ble.h"

using namespace visionaria::ble;
using namespace visionaria::enlace;

namespace {

int g_casos = 0;
int g_fallos = 0;

#define EXIGIR(cond)                                                           \
  do {                                                                         \
    ++g_casos;                                                                 \
    if (!(cond)) {                                                             \
      ++g_fallos;                                                              \
      fprintf(stderr, "FALLO %s:%d: %s\n", __FILE__, __LINE__, #cond);         \
    }                                                                          \
  } while (0)

// --- Clave y pines -----------------------------------------------------------

void prueba_clave() {
  EXIGIR(clave_valida(482913));
  EXIGIR(clave_valida(1));
  EXIGIR(clave_valida(999998));
  EXIGIR(!clave_valida(0));
  EXIGIR(!clave_valida(1000000));
  EXIGIR(!clave_valida(123456));  // clave por defecto de los ejemplos del núcleo
  EXIGIR(!clave_valida(654321));
  EXIGIR(!clave_valida(111111));
  EXIGIR(!clave_valida(999999));
  EXIGIR(!clave_valida(0xFFFFFFFFu));
  static_assert(clave_valida(482913), "constexpr");
}

void prueba_pines() {
  const int permitidos[] = {1, 2, 4, 5, 18, 21, 38, 42, 47, 48};
  for (int p : permitidos) EXIGIR(pin_permitido(p));
  const int vetados[] = {-1, 0, 3, 19, 20, 22, 25, 26, 32, 33, 35, 36, 37, 43, 44, 45, 46, 49, 100};
  for (int p : vetados) EXIGIR(!pin_permitido(p));
  EXIGIR(pin_boton_permitido(0));  // BOOT
  EXIGIR(pin_boton_permitido(4));
  EXIGIR(!pin_boton_permitido(3));
  EXIGIR(!pin_boton_permitido(19));
  EXIGIR(!pin_boton_permitido(45));
  static_assert(pin_permitido(4) && !pin_permitido(0), "constexpr");
}

// --- Identificador de arranque --------------------------------------------------

struct Guion {
  const uint32_t* valores;
  int n;
  int i;
};
uint32_t desde_guion(void* ctx) {
  Guion* g = static_cast<Guion*>(ctx);
  return g->valores[g->i < g->n ? g->i++ : g->n - 1];
}

void prueba_id_arranque() {
  uint32_t id = 7;
  const uint32_t v1[] = {0, 5, 5, 9};
  Guion g1{v1, 4, 0};
  EXIGIR(elegir_id_arranque(5, desde_guion, &g1, &id));  // salta el 0 y el igual al anterior
  EXIGIR(id == 9);

  id = 7;
  const uint32_t fijo[] = {5};
  Guion g2{fijo, 1, 0};
  EXIGIR(!elegir_id_arranque(5, desde_guion, &g2, &id));  // fuente atascada: no arranca
  EXIGIR(id == 7);

  const uint32_t cero[] = {0};
  Guion g3{cero, 1, 0};
  EXIGIR(!elegir_id_arranque(1, desde_guion, &g3, &id));
  EXIGIR(!elegir_id_arranque(1, nullptr, nullptr, &id));
  EXIGIR(!elegir_id_arranque(1, desde_guion, &g1, nullptr));
}

// --- Información ------------------------------------------------------------------

void prueba_informacion() {
  Informacion info;
  EXIGIR(informacion_sen0395(0xA1B2C3D4, 0, 3000, &info));
  EXIGIR(info.capacidades == 0);  // sin distancia, azimut ni batería
  EXIGIR(info.perfil == 1);
  EXIGIR(info.periodo_ms == 100 && info.caducidad_ms == 500);
  EXIGIR(info.version_mayor == 1 && info.version_menor == 0);
  EXIGIR(info.distancia_minima_mm == 0 && info.distancia_maxima_mm == 3000);
  EXIGIR(info.firmware_mayor == kFirmwareMayor && info.firmware_menor == kFirmwareMenor);
  uint8_t trama[kLongitudTrama];
  EXIGIR(codificar_informacion(info, trama) == Error::Ninguno);
  Informacion leida;
  EXIGIR(decodificar_informacion(trama, kLongitudTrama, &leida) == Error::Ninguno);
  EXIGIR(leida.id_arranque == 0xA1B2C3D4);

  Informacion intacta;
  intacta.id_arranque = 99;
  EXIGIR(!informacion_sen0395(1, 3000, 3000, &intacta));  // ventana vacía
  EXIGIR(intacta.id_arranque == 99);
  EXIGIR(!informacion_sen0395(1, 0, 65535, &intacta));
  EXIGIR(!informacion_sen0395(1, 0, 3000, nullptr));
}

// --- Nada retenido ------------------------------------------------------------------

EntradaRadar presencia(uint16_t edad) {
  EntradaRadar e;
  e.estado = EstadoRadar::Presencia;
  e.edad_ms = edad;
  return e;
}

void prueba_nada_retenido() {
  const uint32_t t_con = 10000;
  // Recibida 300 ms antes de conectar: ahora = t_con + 20, edad 320 > 20.
  EntradaRadar r = entrada_para_sesion(presencia(320), t_con, t_con + 20);
  EXIGIR(r.estado == EstadoRadar::SinBlanco && r.edad_ms == kEdadDesconocida);
  // Recibida justo en el instante de conectar: no es "después".
  r = entrada_para_sesion(presencia(20), t_con, t_con + 20);
  EXIGIR(r.edad_ms == kEdadDesconocida);
  // Recibida 1 ms después de conectar.
  r = entrada_para_sesion(presencia(19), t_con, t_con + 20);
  EXIGIR(r.estado == EstadoRadar::Presencia && r.edad_ms == 19);
  // Edad desconocida nunca pasa.
  r = entrada_para_sesion(presencia(kEdadDesconocida), t_con, t_con + 70000);
  EXIGIR(r.edad_ms == kEdadDesconocida && r.estado == EstadoRadar::SinBlanco);
  // Un fallo del radar se publica tal cual: es el estado actual, no un dato retenido.
  EntradaRadar f;
  f.estado = EstadoRadar::Fallo;
  f.salud = 2;
  r = entrada_para_sesion(f, t_con, t_con + 1);
  EXIGIR(r.estado == EstadoRadar::Fallo && r.salud == 2);
  // Vuelta del reloj entre la conexión y el instante actual.
  const uint32_t t_vuelta = 0xFFFFFF00u;
  r = entrada_para_sesion(presencia(100), t_vuelta, t_vuelta + 0x180);  // ahora = 0x80
  EXIGIR(r.estado == EstadoRadar::Presencia);
  r = entrada_para_sesion(presencia(400), t_vuelta, t_vuelta + 0x180);
  EXIGIR(r.edad_ms == kEdadDesconocida);

  // Extremo a extremo con el emisor: lo retenido sale sin bit 0 ni bit 1.
  Informacion info;
  informacion_sen0395(1, 0, 3000, &info);
  EmisorSintetico em(info, false);
  uint8_t t[kLongitudTrama];
  Medicion m;
  EXIGIR(em.generar(5000, entrada_para_sesion(presencia(50), t_con, t_con + 20), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & (kBanResultado | kBanBlanco)) == 0 && m.salud == 0);
  EXIGIR(em.generar(5001, entrada_para_sesion(presencia(10), t_con, t_con + 20), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & (kBanResultado | kBanBlanco)) == (kBanResultado | kBanBlanco));
}

void prueba_montaje_y_simulacion() {
  Informacion info;
  informacion_sen0395(1, 0, 3000, &info);
  uint8_t t[kLongitudTrama];
  Medicion m;
  EmisorSintetico real(info, false);
  EXIGIR(real.generar(1, entrada_montaje_no_validado(), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR(m.salud == 6 && (m.banderas & (kBanResultado | kBanBlanco)) == 0);
  EXIGIR((m.banderas & kBanSimulacion) == 0);

  EmisorSintetico sim(info, true);
  EXIGIR(sim.generar(1, entrada_simulada(0), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & kBanSimulacion) != 0);
  EXIGIR((m.banderas & kBanBlanco) == 0);  // 0..1999 ms: sin blanco, pero vigente
  EXIGIR((m.banderas & kBanResultado) != 0);
  EXIGIR(sim.generar(2, entrada_simulada(2500), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & kBanBlanco) != 0 && (m.banderas & kBanSimulacion) != 0);
}

// Cada lectura genera una trama nueva: secuencia +1 e instante propio.
void prueba_lectura_fresca() {
  Informacion info;
  informacion_sen0395(1, 0, 3000, &info);
  EmisorSintetico em(info, false);
  uint8_t a[kLongitudTrama], b[kLongitudTrama];
  Medicion ma, mb;
  EXIGIR(em.generar(1000, presencia(10), a) == Error::Ninguno);
  EXIGIR(em.generar(1030, presencia(10), b) == Error::Ninguno);
  EXIGIR(decodificar_medicion(a, kLongitudTrama, info, &ma) == Error::Ninguno);
  EXIGIR(decodificar_medicion(b, kLongitudTrama, info, &mb) == Error::Ninguno);
  EXIGIR(static_cast<uint16_t>(mb.secuencia - ma.secuencia) == 1);
  EXIGIR(mb.instante_ms == 1030 && ma.instante_ms == 1000);
}

// --- Ventana de alta --------------------------------------------------------------

void prueba_ventana() {
  VentanaAlta v;
  EXIGIR(!v.abierta(0));
  EXIGIR(v.actualizar(0) == Transicion::SinCambio);
  v.abrir(1000);
  EXIGIR(v.abierta(1000));
  EXIGIR(v.actualizar(1000) == Transicion::Abrio);
  EXIGIR(v.actualizar(1001) == Transicion::SinCambio);
  EXIGIR(v.restante_ms(1000) == kVentanaAltaMs);
  EXIGIR(v.abierta(1000 + kVentanaAltaMs - 1));
  EXIGIR(v.restante_ms(1000 + kVentanaAltaMs - 1) == 1);
  EXIGIR(!v.abierta(1000 + kVentanaAltaMs));  // 60 000 ms exactos: cerrada
  EXIGIR(v.actualizar(1000 + kVentanaAltaMs) == Transicion::Cerro);
  EXIGIR(v.restante_ms(1000 + kVentanaAltaMs) == 0);
  EXIGIR(!v.abierta(1000 + kVentanaAltaMs - 1));  // cierre sin retorno aunque se consulte atrás

  // Cierra al pasar la vuelta del reloj de 32 bits.
  VentanaAlta w;
  w.abrir(0xFFFFFFFFu - 10000);
  EXIGIR(w.abierta(0xFFFFFFFFu));
  EXIGIR(w.abierta(40000));  // pasó la vuelta; han transcurrido 50 001 ms
  EXIGIR(w.abierta(49998));  // 59 999 ms
  EXIGIR(!w.abierta(49999));  // 60 000 ms
  EXIGIR(!w.abierta(5));  // ya cerrada para siempre: no reabre con la vuelta

  // Reloj que retrocede: falla cerrado.
  VentanaAlta x;
  x.abrir(100000);
  EXIGIR(!x.abierta(99000));

  // Cierre manual y reapertura que reinicia el plazo.
  VentanaAlta y;
  y.abrir(0);
  y.actualizar(0);
  y.cerrar();
  EXIGIR(!y.abierta(10));
  EXIGIR(y.actualizar(10) == Transicion::Cerro);
  y.abrir(20);
  y.abrir(50000);
  EXIGIR(y.abierta(50000 + kVentanaAltaMs - 1));
  EXIGIR(!y.abierta(50000 + kVentanaAltaMs));

  // Abrir y cerrar entre dos actualizar() no cambia la clave del stack.
  VentanaAlta z;
  z.abrir(0);
  z.cerrar();
  EXIGIR(z.actualizar(1) == Transicion::SinCambio);
}

// --- Botón ------------------------------------------------------------------------

AccionBoton pulsar(Boton* b, uint32_t t0, uint32_t duracion_ms) {
  AccionBoton a = AccionBoton::Ninguna;
  for (uint32_t t = 0; t < duracion_ms; ++t) {
    const AccionBoton r = b->muestrear(true, t0 + t);
    if (r != AccionBoton::Ninguna) a = r;
  }
  for (uint32_t t = 0; t < 200; ++t) {
    const AccionBoton r = b->muestrear(false, t0 + duracion_ms + t);
    if (r != AccionBoton::Ninguna) a = r;
  }
  return a;
}

void prueba_boton() {
  { Boton b; EXIGIR(pulsar(&b, 0, 100) == AccionBoton::Ninguna); }
  { Boton b; EXIGIR(pulsar(&b, 0, kPulsacionAltaMs - 1) == AccionBoton::Ninguna); }
  { Boton b; EXIGIR(pulsar(&b, 0, kPulsacionAltaMs) == AccionBoton::AbrirAlta); }
  { Boton b; EXIGIR(pulsar(&b, 0, kPulsacionBorradoMs - 1) == AccionBoton::AbrirAlta); }
  { Boton b; EXIGIR(pulsar(&b, 0, kPulsacionBorradoMs) == AccionBoton::BorrarVinculos); }
  { Boton b; EXIGIR(pulsar(&b, 0, 60000) == AccionBoton::BorrarVinculos); }

  // La acción sale una sola vez, al soltar; mantenerlo pulsado no hace nada.
  {
    Boton b;
    for (uint32_t t = 0; t < 20000; ++t) EXIGIR(b.muestrear(true, t) == AccionBoton::Ninguna);
  }
  {
    Boton b;
    int acciones = 0;
    for (uint32_t t = 0; t < 4000; ++t) acciones += b.muestrear(true, t) != AccionBoton::Ninguna;
    for (uint32_t t = 4000; t < 6000; ++t) acciones += b.muestrear(false, t) != AccionBoton::Ninguna;
    EXIGIR(acciones == 1);
  }
  // Un rebote corto (soltado < 50 ms) no parte la pulsación en dos.
  {
    Boton b;
    AccionBoton a = AccionBoton::Ninguna;
    for (uint32_t t = 0; t < 2000; ++t) b.muestrear(true, t);
    for (uint32_t t = 2000; t < 2030; ++t) b.muestrear(false, t);  // rebote de 30 ms
    for (uint32_t t = 2030; t < 3500; ++t) b.muestrear(true, t);
    for (uint32_t t = 3500; t < 3700; ++t) {
      const AccionBoton r = b.muestrear(false, t);
      if (r != AccionBoton::Ninguna) a = r;
    }
    EXIGIR(a == AccionBoton::AbrirAlta);  // 3500 ms desde el primer flanco
  }
  // Pulsación que cruza la vuelta del reloj.
  { Boton b; EXIGIR(pulsar(&b, 0xFFFFFFFFu - 1000, 4000) == AccionBoton::AbrirAlta); }
  // Dos pulsaciones seguidas: cada una cuenta aparte.
  {
    Boton b;
    EXIGIR(pulsar(&b, 0, 4000) == AccionBoton::AbrirAlta);
    EXIGIR(pulsar(&b, 5000, 500) == AccionBoton::Ninguna);
    EXIGIR(pulsar(&b, 9000, 11000) == AccionBoton::BorrarVinculos);
  }
}

// --- Seguridad --------------------------------------------------------------------

void prueba_seguridad() {
  EstadoSeguridad s;
  EXIGIR(!seguridad_suficiente(s));
  s.cifrado = s.autenticado = s.vinculado = true;
  s.tamano_clave = 16;
  EXIGIR(seguridad_suficiente(s));
  EstadoSeguridad t = s;
  t.cifrado = false;
  EXIGIR(!seguridad_suficiente(t));
  t = s;
  t.autenticado = false;  // Just Works: cifrado sin MITM
  EXIGIR(!seguridad_suficiente(t));
  t = s;
  t.vinculado = false;
  EXIGIR(!seguridad_suficiente(t));
  t = s;
  t.tamano_clave = 15;
  EXIGIR(!seguridad_suficiente(t));
  t.tamano_clave = 7;
  EXIGIR(!seguridad_suficiente(t));
}

// --- Sesión y suscripción ---------------------------------------------------------

// Recorre [desde, hasta) ms de 1 en 1 y cuenta las notificaciones.
int contar(SesionEnlace* s, uint32_t desde, uint32_t hasta, uint32_t paso = 1) {
  int n = 0;
  for (uint32_t t = desde; t != hasta; t += paso) n += s->debe_notificar(t);
  return n;
}

void prueba_sesion() {
  SesionEnlace s;
  EXIGIR(!s.conectada() && !s.suscrita() && !s.protegida());
  EXIGIR(!s.debe_notificar(0));
  EXIGIR(!s.fijar_suscripcion(true));  // sin conexión
  s.marcar_protegida(true);            // sin conexión: nada
  EXIGIR(!s.protegida());

  s.conectar(3, 1000);
  EXIGIR(s.conectada() && s.id_conexion() == 3 && s.t_conexion_ms() == 1000);
  EXIGIR(!s.protegida() && !s.suscrita());
  // Sin protección no hay suscripción ni notificaciones.
  EXIGIR(!s.fijar_suscripcion(true));
  EXIGIR(!s.suscrita());
  EXIGIR(contar(&s, 1000, 3000) == 0);

  s.marcar_protegida(true);
  EXIGIR(!s.suscrita());  // proteger no suscribe
  EXIGIR(s.fijar_suscripcion(true));
  EXIGIR(s.suscrita());
  // Suscribir otra vez no duplica nada ni reinicia el ritmo.
  EXIGIR(!s.fijar_suscripcion(true));
  EXIGIR(!s.fijar_suscripcion(true));
  EXIGIR(s.debe_notificar(2000));  // la primera sale de inmediato
  EXIGIR(!s.debe_notificar(2000));
  EXIGIR(!s.debe_notificar(2099));
  EXIGIR(s.debe_notificar(2100));

  // Dar de baja la suscripción detiene las notificaciones.
  EXIGIR(s.fijar_suscripcion(false));
  EXIGIR(!s.suscrita());
  EXIGIR(contar(&s, 2100, 3000) == 0);
  EXIGIR(!s.fijar_suscripcion(false));

  // Perder la protección borra la suscripción y no vuelve sola.
  EXIGIR(s.fijar_suscripcion(true));
  s.marcar_protegida(false);
  EXIGIR(!s.suscrita() && !s.protegida());
  s.marcar_protegida(true);
  EXIGIR(!s.suscrita());

  // La desconexión limpia; la reconexión empieza de cero.
  EXIGIR(s.fijar_suscripcion(true));
  s.desconectar();
  EXIGIR(!s.conectada() && !s.suscrita() && !s.protegida());
  EXIGIR(!s.debe_notificar(5000));
  s.conectar(4, 9000);
  EXIGIR(s.conectada() && !s.protegida() && !s.suscrita());
  EXIGIR(s.t_conexion_ms() == 9000);
  EXIGIR(!s.fijar_suscripcion(true));  // no hereda la suscripción anterior
  EXIGIR(contar(&s, 9000, 10000) == 0);

  // conectar() sin desconectar (evento duplicado) también reinicia todo.
  s.marcar_protegida(true);
  s.fijar_suscripcion(true);
  s.conectar(5, 20000);
  EXIGIR(!s.protegida() && !s.suscrita() && s.id_conexion() == 5);
}

void prueba_ritmo() {
  SesionEnlace s;
  s.conectar(1, 0);
  s.marcar_protegida(true);
  s.fijar_suscripcion(true);
  // 10 s con ciclos de 1 ms: 100 notificaciones, ni una más (sin acumular).
  const int n = contar(&s, 0, 10000);
  EXIGIR(n == 100);

  // Ciclos de 7 ms: separación real >= 100 ms (aquí 105) y ~190 en 20 s.
  // Barrido de pasos: ningún paso produce dos envíos a menos de 100 ms.
  for (uint32_t paso : {1u, 7u, 33u, 50u, 99u, 150u}) {
    SesionEnlace t;
    t.conectar(1, 0);
    t.marcar_protegida(true);
    t.fijar_suscripcion(true);
    uint32_t ultima = 0;
    bool hubo = false;
    int total = 0;
    for (uint32_t ms = 0; ms < 20000; ms += paso) {
      if (t.debe_notificar(ms)) {
        if (hubo) EXIGIR(ms - ultima >= kPeriodoNotificacionMs);  // nunca más de una cada 100 ms
        hubo = true;
        ultima = ms;
        ++total;
      }
    }
    if (paso == 7) EXIGIR(total >= 150 && total <= 200);
  }

  // Un bloqueo de 2 s no se recupera en ráfaga: una sola notificación después.
  SesionEnlace u;
  u.conectar(1, 0);
  u.marcar_protegida(true);
  u.fijar_suscripcion(true);
  EXIGIR(u.debe_notificar(0));
  EXIGIR(u.debe_notificar(2000));
  EXIGIR(!u.debe_notificar(2000));
  EXIGIR(!u.debe_notificar(2050));
  EXIGIR(u.debe_notificar(2100));

  // Ciclo irregular 0, 150, 200: el envío de 150 empuja el siguiente a 250.
  SesionEnlace w;
  w.conectar(1, 0);
  w.marcar_protegida(true);
  w.fijar_suscripcion(true);
  EXIGIR(w.debe_notificar(0));
  EXIGIR(w.debe_notificar(150));
  EXIGIR(!w.debe_notificar(200));
  EXIGIR(!w.debe_notificar(249));
  EXIGIR(w.debe_notificar(250));

  // Vuelta del reloj de 32 bits en medio del ritmo.
  SesionEnlace v;
  const uint32_t ini = 0xFFFFFFFFu - 500;
  v.conectar(1, ini);
  v.marcar_protegida(true);
  v.fijar_suscripcion(true);
  EXIGIR(contar(&v, ini, ini + 2000) == 20);
}

void prueba_gracia() {
  SesionEnlace s;
  EXIGIR(!s.vencio_gracia(100000));  // sin conexión
  s.conectar(1, 1000);
  EXIGIR(!s.vencio_gracia(1000 + kGraciaSeguridadMs - 1));
  EXIGIR(s.vencio_gracia(1000 + kGraciaSeguridadMs));
  s.marcar_protegida(true);
  EXIGIR(!s.vencio_gracia(1000 + kGraciaSeguridadMs));  // ya protegida: no se corta
  s.desconectar();
  EXIGIR(!s.vencio_gracia(1000 + kGraciaSeguridadMs));
}

// H3 (banco 12/11): tras la petición de la clave, la persona tiene kGraciaClaveMs
// completos; el límite solo crece y nunca pasa de kGraciaMaximaMs desde la conexión.
void prueba_gracia_tras_pedir_la_clave() {
  SesionEnlace s;
  s.clave_pedida(5000);  // sin conexión: nada
  EXIGIR(!s.vencio_gracia(100000));
  s.conectar(1, 1000);
  // Petición a los 24,5 s (el caso del banco): corta a los 54,5 s, no a los 30 s.
  s.clave_pedida(1000 + 24500);
  EXIGIR(!s.vencio_gracia(1000 + kGraciaSeguridadMs));
  EXIGIR(!s.vencio_gracia(1000 + 24500 + kGraciaClaveMs - 1));
  EXIGIR(s.vencio_gracia(1000 + 24500 + kGraciaClaveMs));
  // Una petición más temprana (reloj atrás) no acorta el límite ya alcanzado.
  s.clave_pedida(1000 + 10000);
  EXIGIR(!s.vencio_gracia(1000 + 24500 + kGraciaClaveMs - 1));
  // El tope cuenta desde la conexión, pida cuantas veces pida.
  s.clave_pedida(1000 + 40000);
  EXIGIR(!s.vencio_gracia(1000 + kGraciaMaximaMs - 1));
  EXIGIR(s.vencio_gracia(1000 + kGraciaMaximaMs));
  EXIGIR(s.vencio_gracia(1000 + 5 * kGraciaMaximaMs));
  // Ya protegida: no se corta, haya pedido la clave o no.
  s.marcar_protegida(true);
  EXIGIR(!s.vencio_gracia(1000 + 5 * kGraciaMaximaMs));
  // Una petición muy temprana alarga solo lo que dura la clave.
  SesionEnlace t;
  t.conectar(1, 1000);
  t.clave_pedida(1000 + 100);
  EXIGIR(!t.vencio_gracia(1000 + 100 + kGraciaClaveMs - 1));
  EXIGIR(t.vencio_gracia(1000 + 100 + kGraciaClaveMs));
  // Una conexión nueva vuelve a la gracia base.
  t.conectar(2, 200000);
  EXIGIR(t.vencio_gracia(200000 + kGraciaSeguridadMs));
  // Vuelta del reloj de 32 bits: las restas son módulo 2^32.
  SesionEnlace v;
  const uint32_t ini = 0xFFFFFFFFu - 10000;
  v.conectar(1, ini);
  v.clave_pedida(ini + 24500);
  EXIGIR(!v.vencio_gracia(ini + kGraciaSeguridadMs));
  EXIGIR(!v.vencio_gracia(ini + 24500 + kGraciaClaveMs - 1));
  EXIGIR(v.vencio_gracia(ini + 24500 + kGraciaClaveMs));
  // Un reloj que avanza casi 2^32 desde la conexión no alarga nada: falla cerrada.
  SesionEnlace w;
  w.conectar(1, 1000);
  w.clave_pedida(1000 - 1000);  // 2^32 - 1000 ms «después»: la suma da la vuelta
  EXIGIR(w.vencio_gracia(1000 + kGraciaSeguridadMs));
}

// El alta cierra la ventana al emparejar y no queda abierta tras un borrado.
void prueba_flujo_alta() {
  VentanaAlta v;
  Boton b;
  const uint32_t t0 = 100000;
  AccionBoton a = pulsar(&b, t0, 4000);
  EXIGIR(a == AccionBoton::AbrirAlta);
  const uint32_t ahora = t0 + 4200;
  v.abrir(ahora);
  EXIGIR(v.actualizar(ahora) == Transicion::Abrio);
  v.cerrar();  // emparejamiento completado
  EXIGIR(v.actualizar(ahora + 5000) == Transicion::Cerro);
  v.abrir(ahora + 6000);
  EXIGIR(v.actualizar(ahora + 6000) == Transicion::Abrio);
  v.cerrar();  // borrado de vínculos
  EXIGIR(!v.abierta(ahora + 6001));
  EXIGIR(v.actualizar(ahora + 6001) == Transicion::Cerro);
}


// --- Con el intérprete real del SEN0395 (EA-11) -----------------------------------

size_t dar(visionaria::sen0395::Interprete* r, const char* texto, uint32_t t) {
  size_t n = 0;
  while (texto[n] != '\0') ++n;
  return r->procesar(reinterpret_cast<const uint8_t*>(texto), n, t);
}

// Configura el radar simulado y deja pasar la estabilización; devuelve el instante.
uint32_t operar(visionaria::sen0395::Interprete* r, uint32_t t) {
  uint8_t orden[visionaria::sen0395::kLongitudOrdenMax];
  for (int i = 0; i < visionaria::sen0395::kPasosConfiguracion; ++i) {
    EXIGIR(r->salida_pendiente(orden, sizeof(orden)) > 0);
    r->salida_enviada(t);
    t += 20;
    dar(r, "Done\r\n", t);
  }
  t += r->configuracion().estabilizacion_ms;
  r->salud(t);
  return t;
}

// Como en loop(): el intérprete se alimenta en cada ciclo, también sin bytes,
// para saber cuándo se leyó la UART por última vez.
struct CicloRadar {
  visionaria::sen0395::Interprete radar;
  uint32_t t = 0;
  void ir_a(uint32_t destino) {
    while (static_cast<int32_t>(destino - t) > 0) {
      t += (destino - t > 50) ? 50 : (destino - t);
      radar.procesar(nullptr, 0, t);
    }
  }
  void trama(const char* texto, uint32_t destino) {
    ir_a(destino);
    dar(&radar, texto, destino);
  }
};

// La conexión nueva no hereda la observación anterior, la edad es la real de
// la UART y un estancamiento del radar se publica como fallo, no como dato.
void prueba_con_interprete_real() {
  CicloRadar c;
  Informacion info;
  informacion_sen0395(1, c.radar.ventana_minima_mm(), c.radar.ventana_maxima_mm(), &info);
  EXIGIR(info.distancia_minima_mm == 0 && info.distancia_maxima_mm == 450);
  EmisorSintetico em(info, false);
  uint8_t t[kLongitudTrama];
  Medicion m;

  c.t = 1000;
  c.t = operar(&c.radar, c.t);
  c.trama("$JYBSS,1, , , *\r\n", c.t + 100);  // observación ANTES de conectar
  const uint32_t t_obs = c.t;
  const uint32_t t_conexion = t_obs + 400;
  c.ir_a(t_conexion);
  SesionEnlace s;
  s.conectar(1, t_conexion);

  // Lectura al conectar: la presencia previa no cuenta.
  uint32_t ahora = t_conexion + 20;
  c.ir_a(ahora);
  EXIGIR(em.generar(ahora, entrada_para_sesion(c.radar.entrada(ahora), s.t_conexion_ms(), ahora), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & (kBanResultado | kBanBlanco)) == 0 && m.salud == 0);

  // Observación nueva tras conectar: vigente con su edad real (10 ms).
  c.trama("$JYBSS,1, , , *\r\n", t_conexion + 700);
  ahora = t_conexion + 710;
  c.ir_a(ahora);
  EXIGIR(em.generar(ahora, entrada_para_sesion(c.radar.entrada(ahora), s.t_conexion_ms(), ahora), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & (kBanResultado | kBanBlanco)) == (kBanResultado | kBanBlanco));
  EXIGIR(m.edad_radar_ms == 10 && m.salud == 0);

  // Consultar o reemitir no rejuvenece: la edad crece sola; 500 ms aún vigente, 501 vencida.
  ahora = t_conexion + 1200;
  c.ir_a(ahora);
  EXIGIR(em.generar(ahora, entrada_para_sesion(c.radar.entrada(ahora), s.t_conexion_ms(), ahora), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR(m.edad_radar_ms == 500 && (m.banderas & kBanResultado) != 0);
  ahora = t_conexion + 1201;
  c.ir_a(ahora);
  EXIGIR(em.generar(ahora, entrada_para_sesion(c.radar.entrada(ahora), s.t_conexion_ms(), ahora), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & (kBanResultado | kBanBlanco)) == 0);

  // El radar se estanca (sin tramas): pasados 2500 ms, salud 2 sin datos.
  ahora = t_conexion + 700 + 2501;
  c.ir_a(ahora);
  EXIGIR(em.generar(ahora, entrada_para_sesion(c.radar.entrada(ahora), s.t_conexion_ms(), ahora), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR(m.salud == 2 && (m.banderas & (kBanResultado | kBanBlanco)) == 0);

  // Reconexión: la sesión nueva no usa la observación vieja aunque el radar la tenga.
  c.trama("$JYBSS,1, , , *\r\n", ahora + 100);
  s.desconectar();
  s.conectar(2, ahora + 150);
  ahora += 170;
  c.ir_a(ahora);
  EXIGIR(em.generar(ahora, entrada_para_sesion(c.radar.entrada(ahora), s.t_conexion_ms(), ahora), t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & (kBanResultado | kBanBlanco)) == 0 && m.salud == 0);
}

// Un ciclo que se estanca más de 250 ms no rejuvenece los bytes que esperaban
// en la UART: el intérprete los fecha en la llamada anterior.
void prueba_estancamiento_del_ciclo() {
  CicloRadar c;
  c.t = operar(&c.radar, 1000);
  c.ir_a(c.t + 100);
  // El ciclo se detiene 1 s; al volver lee de golpe una trama que llegó al principio.
  const uint32_t vuelta = c.t + 1100;
  c.t = vuelta;
  dar(&c.radar, "$JYBSS,1, , , *\r\n", vuelta);
  const EntradaRadar e = c.radar.entrada(vuelta);
  EXIGIR(e.estado == EstadoRadar::Presencia);
  EXIGIR(e.edad_ms >= 1000);  // fechada en la llamada anterior: nunca "10 ms"
  Informacion info;
  informacion_sen0395(1, 0, 3000, &info);
  EmisorSintetico em(info, false);
  uint8_t t[kLongitudTrama];
  Medicion m;
  EXIGIR(em.generar(vuelta, e, t) == Error::Ninguno);
  EXIGIR(decodificar_medicion(t, kLongitudTrama, info, &m) == Error::Ninguno);
  EXIGIR((m.banderas & kBanResultado) == 0);  // vencida
}

}  // namespace

int main() {
  prueba_clave();
  prueba_pines();
  prueba_id_arranque();
  prueba_informacion();
  prueba_nada_retenido();
  prueba_montaje_y_simulacion();
  prueba_lectura_fresca();
  prueba_ventana();
  prueba_boton();
  prueba_seguridad();
  prueba_sesion();
  prueba_ritmo();
  prueba_gracia();
  prueba_gracia_tras_pedir_la_clave();
  prueba_flujo_alta();
  prueba_con_interprete_real();
  prueba_estancamiento_del_ciclo();
  printf("%d comprobaciones, %d fallos\n", g_casos, g_fallos);
  return g_fallos == 0 ? 0 : 1;
}

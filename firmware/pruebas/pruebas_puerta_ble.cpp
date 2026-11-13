// Pruebas de puerta_ble.h (EA-12) en el portátil: la política que accesorio.ino
// aplica en los ganchos NATIVOS de NimBLE (emparejamiento, almacén de vínculos,
// lectura GATT, notificación), ejecutada con el intérprete REAL del radar, la
// sesión real y la ventana real. Lo único simulado es lo que entrega el stack
// (estado del enlace, números de conexión, acciones de emparejamiento).
//
// No ejecutan NimBLE, cifrado ni emparejamiento reales. El gate de símbolos del
// ELF comprueba qué código se enlaza; las fuentes nativas permiten revisar las
// llamadas, y el banco confirma el comportamiento físico. Cubren:
//   - sin ventana de alta no se entrega la clave, no se re-empareja y se declara
//     OOB para vetar Just Works; ningún vínculo sin autenticar llega al almacén;
//   - vínculos autorizados se restauran sin ventana;
//   - toda lectura de Medición genera una trama NUEVA (también varias seguidas, o
//     tras una notificación) y solo con el enlace protegido EN VIVO;
//   - lectura y notificación no comparten ningún valor;
//   - una conexión nueva no recibe nada de la anterior;
//   - todo enlace vivo tiene sesión (CONNECT con status ≠ 0, CONNECT tras ENC_CHANGE)
//     y un fallo de conexión o un enlace caído nunca la crea (H2, banco 12/11);
//   - la gracia sin proteger da a la persona el plazo completo tras la petición de la
//     clave, con un tope desde la conexión (H3, banco 12/11);
//   - la notificación es UNA operación (enlace en vivo, sesión, ritmo, trama y envío)
//     y se detiene ante un cambio de cifrado, una desconexión con manejador
//     reutilizado o una revocación, con acciones inyectadas en cada frontera;
//   - la pulsación larga revoca la sesión al instante, corta y vacía el almacén, y un
//     emparejamiento en vuelo no puede escribir antes, durante ni después del borrado;
//     un vínculo nuevo solo se persiste si ESA conexión recibió la clave con la
//     ventana abierta.
// Límite: el hilo del host de NimBLE no está aquí; que los eventos del stack no se
// intercalen dentro de la operación lo garantiza la cola de eventos del host, que
// solo el banco comprueba.
// Uso: pruebas_puerta_ble
#include <functional>
#include <initializer_list>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <vector>

#include "emisor_sintetico.h"
#include "enlace_accesorio.h"
#include "puerta_ble.h"
#include "sen0395.h"
#include "trama_ble.h"

using namespace visionaria;
using enlace::EstadoSeguridad;
using puerta::AccionClave;
using puerta::AccionGap;
using puerta::Notificacion;
using puerta::PuertaBle;

namespace {

int g_casos = 0;
int g_fallos = 0;

#define EXIGIR(cond)                                                   \
  do {                                                                 \
    ++g_casos;                                                         \
    if (!(cond)) {                                                     \
      ++g_fallos;                                                      \
      fprintf(stderr, "FALLO %s:%d: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                  \
  } while (0)

constexpr uint32_t kClave = 482915;
constexpr uint16_t kConn = 7;
constexpr uint8_t kAccDisp = puerta::kAccionClaveEnPantalla;

EstadoSeguridad protegido() {
  EstadoSeguridad s;
  s.cifrado = s.autenticado = s.vinculado = true;
  s.tamano_clave = 16;
  return s;
}
EstadoSeguridad just_works() {  // cifrado pero sin MITM, y no vinculado
  EstadoSeguridad s;
  s.cifrado = true;
  s.tamano_clave = 16;
  return s;
}

// Intérprete del radar ya operando y con trama reciente.
struct RadarOperando {
  sen0395::Interprete radar;
  // Empieza poco antes del cero del reloj (vuelta módulo 2^32): al terminar la
  // estabilización el intérprete ya opera y las pruebas usan instantes desde 1000 ms.
  uint32_t t = static_cast<uint32_t>(-5300);
  RadarOperando() {
    uint8_t orden[sen0395::kLongitudOrdenMax];
    for (int i = 0; i < sen0395::kPasosConfiguracion; ++i) {
      if (radar.salida_pendiente(orden, sizeof(orden)) == 0) break;
      radar.salida_enviada(t);
      t += 10;
      radar.procesar(reinterpret_cast<const uint8_t*>("Done\r\n"), 6, t);
    }
    t += sen0395::kEstabilizacionMinMs;
    radar.procesar(nullptr, 0, t);
  }
  void trama(bool presencia) {
    const char* texto = presencia ? "$JYBSS,1, , , *\r\n" : "$JYBSS,0, , , *\r\n";
    radar.procesar(nullptr, 0, t);  // el ciclo anterior leyó la UART justo antes: la trama se fecha en t
    radar.procesar(reinterpret_cast<const uint8_t*>(texto), strlen(texto), t);
  }
};

struct Banco {
  RadarOperando r;
  ble::Informacion info;
  PuertaBle puerta;
  Banco() : puerta(&r.radar, false, kClave) {
    EXIGIR(enlace::informacion_sen0395(0xA1B2C3D4u, 0, 3000, &info));
    EXIGIR(puerta.iniciar(info));
  }
  // Conexión protegida (vínculo restaurado o recién emparejado) y suscrita.
  void conectar_suscrita(uint16_t conn, uint32_t ahora) {
    puerta.al_conectar(conn, ahora);
    EXIGIR(puerta.al_cambiar_cifrado(conn, 0, protegido()) == AccionGap::Nada);
    EXIGIR(puerta.al_suscribir(conn, true, protegido()));
  }
  bool leer(uint16_t conn, uint32_t ahora, ble::Medicion* m) {
    uint8_t trama[ble::kLongitudTrama];
    memset(trama, 0xEE, sizeof(trama));
    const int rc = puerta.leer_medicion(conn, true, protegido(), ahora, trama);
    if (rc != puerta::kAttOk) return false;
    return ble::decodificar_medicion(trama, sizeof(trama), info, m) == ble::Error::Ninguno;
  }
};

// --- UUID ----------------------------------------------------------------------------

void prueba_uuid() {
  const puerta::Uuid128 u = puerta::uuid128_le("e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e31");
  const uint8_t esperado[16] = {0x31, 0x7e, 0x8a, 0x8d, 0x4f, 0x8c, 0x2b, 0x9d, 0xb0, 0x4f, 0xb8, 0x76, 0x00, 0x00, 0x3a, 0xe1};
  EXIGIR(u.valido && memcmp(u.le, esperado, 16) == 0);
  EXIGIR(puerta::uuid128_le("e13a0002-76b8-4fb0-9d2b-8c4f8d8a7e31").le[12] == 0x02);
  EXIGIR(puerta::uuid128_le("e13a0002-76b8-4fb0-9d2b-8c4f8d8a7e31").le[14] == 0x3a);
  EXIGIR(!puerta::uuid128_le("e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e3").valido);     // corto
  EXIGIR(!puerta::uuid128_le("e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e311").valido);   // largo
  EXIGIR(!puerta::uuid128_le("e13a0000_76b8-4fb0-9d2b-8c4f8d8a7e31").valido);    // separador
  EXIGIR(!puerta::uuid128_le("g13a0000-76b8-4fb0-9d2b-8c4f8d8a7e31").valido);    // no hexadecimal
  static_assert(puerta::uuid128_le("e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e31").valido, "constexpr");
}

// --- Almacén de vínculos: nada sin autenticar llega a la flash --------------------------------

void prueba_almacen_de_vinculos() {
  using puerta::persistencia_permitida;
  for (int tipo : {puerta::kObjetoClaveNuestra, puerta::kObjetoClaveDelPar}) {
    EXIGIR(persistencia_permitida(tipo, true, true, 16));
    EXIGIR(!persistencia_permitida(tipo, false, true, 16));  // Just Works: sin MITM
    EXIGIR(!persistencia_permitida(tipo, true, false, 16));  // emparejamiento heredado
    EXIGIR(!persistencia_permitida(tipo, true, true, 15));   // clave corta
    EXIGIR(!persistencia_permitida(tipo, false, false, 0));
  }
  // CCCD y otros objetos no son claves de enlace: pasan.
  EXIGIR(persistencia_permitida(3, false, false, 0));
  EXIGIR(persistencia_permitida(4, false, false, 0));
}

// --- Emparejamiento: la clave solo con la ventana de alta abierta --------------------------------

void prueba_clave_solo_con_ventana() {
  Banco b;
  uint32_t clave = 0;
  b.puerta.al_conectar(kConn, 1000);
  // Ventana cerrada (nunca se abrió): nunca se entrega la clave.
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 1000, &clave) == AccionClave::Cortar);
  EXIGIR(clave == 0);
  // Abierta: se entrega, y solo esa vez y a esa conexión.
  b.puerta.ventana().abrir(2000);
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 2000, &clave) == AccionClave::Inyectar);
  EXIGIR(clave == kClave);
  uint32_t otra = 0;
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn + 1, 2001, &otra) == AccionClave::Cortar);  // conexión ajena
  EXIGIR(otra == 0);
  // Acciones que no son «mostrar la clave»: comparación numérica, entrada, OOB...
  for (int accion : {0, 1, 2, 4, 5, 6, 7, 255}) {
    uint32_t c = 0;
    EXIGIR(b.puerta.al_pedir_clave(static_cast<uint8_t>(accion), kConn, 2002, &c) == AccionClave::Cortar);
    EXIGIR(c == 0);
  }
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 2002, nullptr) == AccionClave::Cortar);
  // 59 999 ms después sigue abierta; a los 60 000 ms, no.
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 2000 + 59999, &clave) == AccionClave::Inyectar);
  clave = 0;
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 2000 + 60000, &clave) == AccionClave::Cortar);
  EXIGIR(clave == 0);
  // Sin conexión no hay a quién entregarla.
  b.puerta.ventana().abrir(100000);
  b.puerta.al_desconectar(kConn);
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 100001, &clave) == AccionClave::Cortar);
  EXIGIR(clave == 0);
}

void prueba_clave_invalida_nunca_se_entrega() {
  const uint32_t malas[] = {0, 123456, 111111, 1000000, 0xFFFFFFFFu};
  for (uint32_t mala : malas) {
    RadarOperando r;
    PuertaBle p(&r.radar, false, mala);
    p.al_conectar(kConn, 1000);
    p.ventana().abrir(1000);
    uint32_t c = 7;
    EXIGIR(p.al_pedir_clave(kAccDisp, kConn, 1001, &c) == AccionClave::Cortar);
    EXIGIR(c == 7);
  }
}

void prueba_reemparejar_y_oob() {
  Banco b;
  // Cerrada: se conserva el vínculo viejo y se declara OOB (veta Just Works).
  EXIGIR(!b.puerta.reemparejar_permitido(1000));
  EXIGIR(b.puerta.vetar_negociacion(1000));
  // Abierta: se permite sustituir el vínculo y no se declara OOB (la clave por pantalla).
  b.puerta.ventana().abrir(2000);
  EXIGIR(b.puerta.reemparejar_permitido(2000));
  EXIGIR(!b.puerta.vetar_negociacion(2000));
  EXIGIR(!b.puerta.vetar_negociacion(2000 + 59999));
  EXIGIR(b.puerta.reemparejar_permitido(2000 + 59999));
  // Cumplido el plazo vuelve a vetar, aunque nadie llame a actualizar.
  EXIGIR(b.puerta.vetar_negociacion(2000 + 60000));
  EXIGIR(!b.puerta.reemparejar_permitido(2000 + 60000));
  // Un emparejamiento con éxito cierra la ventana.
  b.puerta.ventana().abrir(70000);
  b.puerta.al_conectar(kConn, 70001);
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
  EXIGIR(b.puerta.vetar_negociacion(70002));
  // El reloj que retrocede cierra: falla cerrado.
  b.puerta.ventana().abrir(100000);
  EXIGIR(b.puerta.vetar_negociacion(99000));
}

// --- Resultado del cifrado ------------------------------------------------------------------------

void prueba_cifrado_negativos() {
  Banco b;
  b.puerta.ventana().abrir(1000);
  b.puerta.al_conectar(kConn, 1000);
  // Just Works (sin MITM y sin vínculo), aunque el stack lo cifre: se corta y no protege.
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, just_works()) == AccionGap::Cortar);
  EXIGIR(!b.puerta.sesion().protegida());
  EXIGIR(b.puerta.ventana().abierta(1001));  // un intento fallido no consume el alta
  // Cada requisito por separado.
  EstadoSeguridad s = protegido();
  s.cifrado = false;
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, s) == AccionGap::Cortar);
  s = protegido();
  s.autenticado = false;
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, s) == AccionGap::Cortar);
  s = protegido();
  s.vinculado = false;
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, s) == AccionGap::Cortar);
  s = protegido();
  s.tamano_clave = 15;
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, s) == AccionGap::Cortar);
  // Estado de fallo del stack, aunque el estado parezca bueno.
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 5, protegido()) == AccionGap::Cortar);
  EXIGIR(!b.puerta.sesion().protegida());
  // Una conexión que no es la de la sesión no la protege.
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn + 1, 0, protegido()) == AccionGap::Cortar);
  EXIGIR(!b.puerta.sesion().protegida());
  EXIGIR(b.puerta.ventana().abierta(1002));
  // Perder la protección borra la suscripción.
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
  EXIGIR(b.puerta.al_suscribir(kConn, true, protegido()));
  EXIGIR(b.puerta.sesion().suscrita());
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, just_works()) == AccionGap::Cortar);
  EXIGIR(!b.puerta.sesion().suscrita());
}

void prueba_vinculo_autorizado_se_restaura_sin_ventana() {
  Banco b;
  // La ventana NUNCA se abrió: el teléfono ya vinculado reconecta, cifra con su clave
  // guardada, lee y se suscribe.
  EXIGIR(!b.puerta.ventana().abierta(5000));
  b.puerta.al_conectar(kConn, 5000);
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
  EXIGIR(b.puerta.sesion().protegida());
  EXIGIR(b.puerta.al_suscribir(kConn, true, protegido()));  // suscripción restaurada del vínculo
  EXIGIR(b.puerta.sesion().suscrita());
  b.r.t = 5100;
  b.r.trama(true);
  ble::Medicion m;
  EXIGIR(b.leer(kConn, 5150, &m));
  EXIGIR(m.id_arranque == 0xA1B2C3D4u);
  // Y sigue sin poder emparejar nada nuevo.
  uint32_t c = 0;
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 5150, &c) == AccionClave::Cortar);
}

// --- Suscripción -------------------------------------------------------------------------------------

void prueba_suscripcion() {
  Banco b;
  b.puerta.al_conectar(kConn, 1000);
  // Antes de proteger el enlace: se ignora, y no se arrastra al proteger después.
  EXIGIR(!b.puerta.al_suscribir(kConn, true, just_works()));
  EXIGIR(!b.puerta.sesion().suscrita());
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
  EXIGIR(!b.puerta.sesion().suscrita());
  // Ya protegido: una vez, idempotente, y retirable.
  EXIGIR(b.puerta.al_suscribir(kConn, true, protegido()));
  EXIGIR(!b.puerta.al_suscribir(kConn, true, protegido()));
  EXIGIR(b.puerta.al_suscribir(kConn, false, protegido()));
  EXIGIR(!b.puerta.sesion().suscrita());
  // Conexión ajena o desconectada: nada.
  EXIGIR(!b.puerta.al_suscribir(kConn + 1, true, protegido()));
  b.puerta.al_desconectar(kConn);
  EXIGIR(!b.puerta.al_suscribir(kConn, true, protegido()));
}

// --- Lectura de Medición: siempre fresca, solo con enlace protegido en vivo -----------------------------

void prueba_lecturas_siempre_frescas() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1050;
  b.r.trama(true);
  ble::Medicion m1, m2, m3;
  // Varias lecturas seguidas (lo que ocurre en una lectura múltiple o larga): ninguna
  // repite ni reutiliza la anterior; cada una lleva su secuencia y su instante.
  EXIGIR(b.leer(kConn, 1100, &m1));
  EXIGIR(b.leer(kConn, 1100, &m2));
  EXIGIR(b.leer(kConn, 1137, &m3));
  EXIGIR(m2.secuencia == m1.secuencia + 1u);
  EXIGIR(m3.secuencia == m2.secuencia + 1u);
  EXIGIR(m1.instante_ms == 1100 && m2.instante_ms == 1100 && m3.instante_ms == 1137);
  // La edad es la real de la última trama del radar (1050): no se rejuvenece.
  EXIGIR(m1.edad_radar_ms == 50 && m3.edad_radar_ms == 87);
  // Una trama nueva del radar se refleja en la siguiente lectura y no en las anteriores.
  b.r.t = 1200;
  b.r.trama(false);
  ble::Medicion m4;
  EXIGIR(b.leer(kConn, 1210, &m4));
  EXIGIR(m4.edad_radar_ms == 10);
  EXIGIR((m1.banderas & ble::kBanBlanco) != 0 && (m4.banderas & ble::kBanBlanco) == 0);
}

void prueba_lectura_rechazos() {
  Banco b;
  uint8_t trama[ble::kLongitudTrama];
  memset(trama, 0xEE, sizeof(trama));
  uint8_t copia[ble::kLongitudTrama];
  memcpy(copia, trama, sizeof(trama));
  // Sin conexión.
  EXIGIR(b.puerta.leer_medicion(kConn, true, protegido(), 1000, trama) == puerta::kAttInesperado);
  b.puerta.al_conectar(kConn, 1000);
  // Conexión ajena.
  EXIGIR(b.puerta.leer_medicion(kConn + 1, true, protegido(), 1001, trama) == puerta::kAttInesperado);
  // Enlace que el stack ya no tiene, o sin protección suficiente EN VIVO, aunque la
  // sesión se marcara protegida antes.
  b.puerta.al_cambiar_cifrado(kConn, 0, protegido());
  EXIGIR(b.puerta.leer_medicion(kConn, false, protegido(), 1002, trama) == puerta::kAttAutenticacionInsuficiente);
  EXIGIR(b.puerta.leer_medicion(kConn, true, just_works(), 1002, trama) == puerta::kAttAutenticacionInsuficiente);
  EstadoSeguridad s = protegido();
  s.tamano_clave = 8;
  EXIGIR(b.puerta.leer_medicion(kConn, true, s, 1002, trama) == puerta::kAttAutenticacionInsuficiente);
  // Ningún rechazo escribió nada ni gastó una secuencia.
  EXIGIR(memcmp(trama, copia, sizeof(trama)) == 0);
  ble::Medicion m;
  EXIGIR(b.leer(kConn, 1003, &m));
  EXIGIR(m.secuencia == 0);
  // Sin Información válida, nada sale.
  RadarOperando r;
  PuertaBle sin_iniciar(&r.radar, false, kClave);
  sin_iniciar.al_conectar(kConn, 1000);
  sin_iniciar.al_cambiar_cifrado(kConn, 0, protegido());
  EXIGIR(!sin_iniciar.lista());
  EXIGIR(sin_iniciar.leer_medicion(kConn, true, protegido(), 1001, trama) == puerta::kAttInesperado);
  EXIGIR(memcmp(trama, copia, sizeof(trama)) == 0);
}

void prueba_conexion_nueva_no_hereda_nada() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1500;
  b.r.trama(true);
  ble::Medicion m;
  EXIGIR(b.leer(kConn, 1550, &m));
  EXIGIR((m.banderas & ble::kBanResultado) != 0 && (m.banderas & ble::kBanBlanco) != 0);
  b.puerta.al_desconectar(kConn);
  // Otro cliente conecta DESPUÉS de esa trama (mismo número de conexión): no ve la
  // observación previa, ni la suscripción, ni la secuencia como si fuera suya.
  b.puerta.al_conectar(kConn, 1600);
  EXIGIR(!b.puerta.sesion().suscrita());
  EXIGIR(!b.puerta.sesion().protegida());
  uint8_t trama[ble::kLongitudTrama];
  EXIGIR(b.puerta.leer_medicion(kConn, true, protegido(), 1610, trama) == puerta::kAttInesperado ||
         b.puerta.leer_medicion(kConn, true, protegido(), 1610, trama) == puerta::kAttOk);
  b.puerta.al_cambiar_cifrado(kConn, 0, protegido());
  ble::Medicion n;
  EXIGIR(b.leer(kConn, 1700, &n));
  EXIGIR((n.banderas & ble::kBanResultado) == 0);  // vencido: la trama es anterior a la conexión
  EXIGIR((n.banderas & ble::kBanBlanco) == 0);
  EXIGIR(n.edad_radar_ms == ble::kEdadDesconocida);
  // Hasta que llegue una trama POSTERIOR a la conexión.
  b.r.t = 1750;
  b.r.trama(false);
  ble::Medicion p;
  EXIGIR(b.leer(kConn, 1760, &p));
  EXIGIR((p.banderas & ble::kBanResultado) != 0 && p.edad_radar_ms == 10);
}

// --- Notificación: ritmo, enlace en vivo y ningún valor compartido ------------------------------------------

void prueba_notificacion() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1010;
  b.r.trama(true);
  uint16_t conn = 0;
  uint8_t trama[ble::kLongitudTrama];
  EXIGIR(b.puerta.notificacion_posible(&conn));
  EXIGIR(conn == kConn);
  // La primera sale de inmediato; el turno se consume AL GENERAR, así que las
  // siguientes quedan a >= 100 ms de ESA trama.
  EXIGIR(b.puerta.preparar_notificacion(conn, true, protegido(), 1021, trama) == Notificacion::Enviar);
  EXIGIR(b.puerta.preparar_notificacion(conn, true, protegido(), 1050, trama) == Notificacion::Nada);
  EXIGIR(b.puerta.preparar_notificacion(conn, true, protegido(), 1120, trama) == Notificacion::Nada);
  EXIGIR(b.puerta.preparar_notificacion(conn, true, protegido(), 1121, trama) == Notificacion::Enviar);
  // El enlace perdió la protección entre la suscripción y el envío: se corta, no se envía.
  uint8_t previa[ble::kLongitudTrama];
  memcpy(previa, trama, sizeof(previa));
  EXIGIR(b.puerta.preparar_notificacion(conn, true, just_works(), 1300, trama) == Notificacion::Cortar);
  EXIGIR(memcmp(previa, trama, sizeof(previa)) == 0);
  EXIGIR(!b.puerta.sesion().suscrita());
  EXIGIR(!b.puerta.notificacion_posible(&conn));  // sin suscripción no hay a quién notificar
  // Si el stack ya no conoce la conexión, tampoco.
  b.conectar_suscrita(kConn, 2000);
  EXIGIR(b.puerta.notificacion_posible(&conn));
  EXIGIR(b.puerta.preparar_notificacion(conn, false, EstadoSeguridad(), 2021, trama) == Notificacion::Cortar);
}

void prueba_lectura_y_notificacion_no_comparten_valor() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1010;
  b.r.trama(true);
  uint16_t conn = 0;
  EXIGIR(b.puerta.notificacion_posible(&conn));
  uint8_t notif[ble::kLongitudTrama];
  // Una lectura se atiende justo antes de la notificación. Cada una produce su
  // trama en SU búfer: nada se pisa, y las secuencias son distintas.
  uint8_t lectura[ble::kLongitudTrama];
  EXIGIR(b.puerta.leer_medicion(kConn, true, protegido(), 1030, lectura) == puerta::kAttOk);
  EXIGIR(b.puerta.preparar_notificacion(conn, true, protegido(), 1031, notif) == Notificacion::Enviar);
  uint8_t copia_notif[ble::kLongitudTrama];
  memcpy(copia_notif, notif, sizeof(notif));
  uint8_t lectura2[ble::kLongitudTrama];
  EXIGIR(b.puerta.leer_medicion(kConn, true, protegido(), 1032, lectura2) == puerta::kAttOk);
  EXIGIR(memcmp(copia_notif, notif, sizeof(notif)) == 0);  // la lectura posterior no tocó la notificación
  ble::Medicion ml, mn, ml2;
  EXIGIR(ble::decodificar_medicion(lectura, sizeof(lectura), b.info, &ml) == ble::Error::Ninguno);
  EXIGIR(ble::decodificar_medicion(notif, sizeof(notif), b.info, &mn) == ble::Error::Ninguno);
  EXIGIR(ble::decodificar_medicion(lectura2, sizeof(lectura2), b.info, &ml2) == ble::Error::Ninguno);
  EXIGIR(mn.secuencia == ml.secuencia + 1u && ml2.secuencia == mn.secuencia + 1u);
  EXIGIR(ml.instante_ms == 1030 && mn.instante_ms == 1031 && ml2.instante_ms == 1032);
}

void prueba_conexion_cambia_entre_pasos() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1010;
  b.r.trama(true);
  uint16_t conn = 0;
  uint8_t trama[ble::kLongitudTrama];
  uint8_t centinela[ble::kLongitudTrama];
  memset(trama, 0xAB, sizeof(trama));
  memcpy(centinela, trama, sizeof(trama));
  // Destino la conexión 7; antes de preparar esa conexión cae y entra otra con
  // OTRO número: lo preparado para la anterior no sale.
  EXIGIR(b.puerta.notificacion_posible(&conn));
  b.puerta.al_desconectar(kConn);
  b.puerta.al_conectar(kConn + 1, 1021);
  b.puerta.al_cambiar_cifrado(kConn + 1, 0, protegido());
  b.puerta.al_suscribir(kConn + 1, true, protegido());
  EXIGIR(b.puerta.preparar_notificacion(conn, true, protegido(), 1022, trama) == Notificacion::Nada);
  EXIGIR(memcmp(trama, centinela, sizeof(trama)) == 0);
  // Lo mismo si el stack REUTILIZA el número: la sesión nueva aún no se suscribió.
  Banco c;
  c.conectar_suscrita(kConn, 1000);
  c.r.t = 1010;
  c.r.trama(true);
  EXIGIR(c.puerta.notificacion_posible(&conn));
  c.puerta.al_desconectar(kConn);
  c.puerta.al_conectar(kConn, 1021);
  EXIGIR(c.puerta.preparar_notificacion(conn, true, protegido(), 1022, trama) == Notificacion::Nada);
  c.puerta.al_cambiar_cifrado(kConn, 0, protegido());  // protegida, pero sin suscribirse
  EXIGIR(c.puerta.preparar_notificacion(conn, true, protegido(), 1023, trama) == Notificacion::Nada);
  EXIGIR(memcmp(trama, centinela, sizeof(trama)) == 0);
  // Una desconexión de una conexión vieja no borra la sesión actual.
  EXIGIR(!c.puerta.al_desconectar(kConn + 9));
  EXIGIR(c.puerta.sesion().conectada());
}

// --- Doble del stack para las operaciones del hilo del host --------------------------------------------
// Ejecuta el código REAL de PuertaBle::atender_notificacion / atender_borrado. Cada
// frontera (consulta del enlace, envío, corte, borrado) admite una acción inyectada
// que representa «lo que otro hilo hace en ese instante». El envío y el reloj
// requieren cerrojo; consultar, cortar y borrar se hacen sin él.

struct StackFalso : puerta::PuertoStack {
  int tomados = 0;
  uint32_t t = 0;
  bool conoce = true;
  EstadoSeguridad vivo = protegido();
  bool acepta = true;
  bool borra = true;
  std::vector<std::vector<uint8_t>> enviadas;
  std::vector<uint32_t> instantes;
  std::vector<uint16_t> cortes;
  int borrados = 0;
  std::vector<int>* almacen = nullptr;  // el «flash»: tipos de objeto guardados
  std::function<void()> en_consulta, antes_de_enviar, al_cortar, al_borrar, al_liberar;

  void tomar() override { ++tomados; }
  void soltar() override {
    --tomados;
    if (tomados == 0 && al_liberar) {
      const auto accion = al_liberar;
      al_liberar = nullptr;
      accion();
    }
  }
  uint32_t ahora() override {
    EXIGIR(tomados > 0);  // el reloj se lee dentro del cerrojo
    return t;
  }
  bool estado_enlace(uint16_t, EstadoSeguridad* s) override {
    EXIGIR(tomados == 0);
    if (en_consulta) en_consulta();
    *s = vivo;
    return conoce;
  }
  bool enviar(uint16_t, const uint8_t trama[ble::kLongitudTrama]) override {
    EXIGIR(tomados > 0);  // la revocación física espera hasta acabar este envío
    if (antes_de_enviar) antes_de_enviar();
    if (!acepta) return false;
    enviadas.emplace_back(trama, trama + ble::kLongitudTrama);
    instantes.push_back(t);
    return true;
  }
  void cortar(uint16_t c) override {
    EXIGIR(tomados == 0);
    if (al_cortar) al_cortar();
    cortes.push_back(c);
  }
  bool borrar_vinculos() override {
    EXIGIR(tomados == 0);
    if (al_borrar) al_borrar();
    ++borrados;
    if (!borra) return false;
    if (almacen != nullptr) almacen->clear();
    return true;
  }
};

// Lo que el stack hace al persistir: pasa por la compuerta y, si pasa, guarda.
bool escribir_en(std::vector<int>& flash, const PuertaBle& p, int tipo, bool aut = true, bool sc = true, uint8_t clave = 16) {
  if (!p.persistir_vinculo(tipo, aut, sc, clave)) return false;
  flash.push_back(tipo);
  return true;
}

void prueba_notificacion_es_una_operacion() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1010;
  b.r.trama(true);
  StackFalso st;
  // Ritmo: se consume al generar, con el reloj de ESE instante; mínimo 100 ms reales.
  st.t = 1100;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Enviada);
  st.t = 1199;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
  st.t = 1200;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Enviada);
  st.t = 1250;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
  st.t = 1300;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Enviada);
  EXIGIR(st.enviadas.size() == 3 && st.tomados == 0 && st.cortes.empty());
  // Cada trama es NUEVA: secuencia creciente e instante del momento de generarla.
  ble::Medicion m0, m1, m2;
  EXIGIR(ble::decodificar_medicion(st.enviadas[0].data(), 20, b.info, &m0) == ble::Error::Ninguno);
  EXIGIR(ble::decodificar_medicion(st.enviadas[1].data(), 20, b.info, &m1) == ble::Error::Ninguno);
  EXIGIR(ble::decodificar_medicion(st.enviadas[2].data(), 20, b.info, &m2) == ble::Error::Ninguno);
  EXIGIR(m1.secuencia == m0.secuencia + 1u && m2.secuencia == m1.secuencia + 1u);
  EXIGIR(m0.instante_ms == 1100 && m1.instante_ms == 1200 && m2.instante_ms == 1300);
  EXIGIR(m1.instante_ms - m0.instante_ms >= 100 && m2.instante_ms - m1.instante_ms >= 100);
  // Un envío rechazado por el transporte se informa, sin repetirse en el mismo turno.
  st.acepta = false;
  st.t = 1400;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Fallida);
  st.acepta = true;
  st.t = 1450;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
}

void prueba_cifrado_revocado_antes_del_envio() {
  // El escenario del revisor: el host procesa un cambio de cifrado que retira la
  // protección (y pide terminar, asíncrono) ANTES de que se ejecute la notificación.
  // El transporte nativo la aceptaría igual (no mira el cifrado): solo la
  // comprobación de PuertaBle la detiene.
  for (int caso = 0; caso < 3; ++caso) {
    Banco b;
    b.conectar_suscrita(kConn, 1000);
    b.r.t = 1010;
    b.r.trama(true);
    StackFalso st;
    st.t = 1100;
    EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Enviada);  // antes del cambio, sale
    EstadoSeguridad s = protegido();
    int estado = 0;
    if (caso == 0) s = just_works();  // el cifrado se revoca y el enlace ya lo refleja
    if (caso == 1) estado = 5;        // falla del stack
    if (caso == 2) s.cifrado = false;
    EXIGIR(b.puerta.al_cambiar_cifrado(kConn, estado, s) == AccionGap::Cortar);
    st.vivo = s;
    st.t = 1300;
    EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
    EXIGIR(st.enviadas.size() == 1);  // nada después del cambio
    uint16_t destino = 0;
    EXIGIR(!b.puerta.sesion().suscrita() && !b.puerta.notificacion_posible(&destino));
  }
  // Aunque el estado vivo aún pareciera protegido, la sesión ya no está suscrita.
  Banco c;
  c.conectar_suscrita(kConn, 1000);
  c.r.t = 1010;
  c.r.trama(true);
  StackFalso st;
  c.puerta.al_cambiar_cifrado(kConn, 0, just_works());
  st.t = 1100;
  EXIGIR(c.puerta.atender_notificacion(st) == puerta::Envio::Nada && st.enviadas.empty());
}

void prueba_desconexion_y_reuso_antes_del_envio() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1010;
  b.r.trama(true);
  StackFalso st;
  st.t = 1100;
  // Cae la conexión y otra entra con el MISMO manejador: la nueva no se suscribió.
  b.puerta.al_desconectar(kConn);
  b.puerta.al_conectar(kConn, 1101);
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
  b.puerta.al_cambiar_cifrado(kConn, 0, protegido());  // cifrada, sin CCCD
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
  EXIGIR(st.enviadas.empty());
  EXIGIR(b.puerta.al_suscribir(kConn, true, protegido()));
  st.t = 1110;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Enviada);
  // El stack ya no conoce la conexión, o el enlace en vivo no protege: se corta, no se envía.
  st.conoce = false;
  st.t = 1300;
  EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Cortada);
  EXIGIR(st.cortes.size() == 1 && st.cortes[0] == kConn && st.enviadas.size() == 1);
  Banco c;
  c.conectar_suscrita(kConn, 1000);
  c.r.t = 1010;
  c.r.trama(true);
  StackFalso st2;
  st2.vivo = just_works();
  st2.t = 1100;
  EXIGIR(c.puerta.atender_notificacion(st2) == puerta::Envio::Cortada && st2.enviadas.empty());
}

void prueba_revocacion_entre_los_pasos_de_la_notificacion() {
  // Lo que el loop (pulsación larga) puede hacer en cada frontera de la operación.
  {  // Entre la consulta del enlace y la generación: no sale nada.
    Banco b;
    b.conectar_suscrita(kConn, 1000);
    b.r.t = 1010;
    b.r.trama(true);
    StackFalso st;
    st.t = 1100;
    st.en_consulta = [&] { b.puerta.revocar_sesion(); };
    EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
    EXIGIR(st.enviadas.empty() && st.tomados == 0);
  }
  {  // Una desconexión con el mismo manejador en esa frontera: tampoco.
    Banco b;
    b.conectar_suscrita(kConn, 1000);
    b.r.t = 1010;
    b.r.trama(true);
    StackFalso st;
    st.t = 1100;
    st.en_consulta = [&] {
      b.puerta.al_desconectar(kConn);
      b.puerta.al_conectar(kConn, 1100);
    };
    EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
    EXIGIR(st.enviadas.empty());
  }
  {  // Un cambio de cifrado en esa frontera (aquí el host lo haría ANTES, no durante):
     // la operación lo ve igual y no envía.
    Banco b;
    b.conectar_suscrita(kConn, 1000);
    b.r.t = 1010;
    b.r.trama(true);
    StackFalso st;
    st.t = 1100;
    st.en_consulta = [&] { b.puerta.al_cambiar_cifrado(kConn, 0, just_works()); };
    EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
    EXIGIR(st.enviadas.empty());
  }
  {  // Después de generar, la pulsación del loop espera el cerrojo del envío.
    Banco b;
    b.conectar_suscrita(kConn, 1000);
    b.r.t = 1010;
    b.r.trama(true);
    StackFalso st;
    st.t = 1100;
    st.antes_de_enviar = [&] {
      EXIGIR(st.tomados > 0);
      st.al_liberar = [&] { b.puerta.revocar_sesion(); };
    };
    EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Enviada);
    st.antes_de_enviar = nullptr;
    st.t = 1300;
    EXIGIR(b.puerta.atender_notificacion(st) == puerta::Envio::Nada);
    EXIGIR(st.enviadas.size() == 1);
  }
}

void prueba_revocar_sesion() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1010;
  b.r.trama(true);
  b.puerta.ventana().abrir(1000);
  uint16_t conn = 0;
  uint8_t trama[ble::kLongitudTrama];
  b.puerta.revocar_sesion();
  EXIGIR(!b.puerta.ventana().abierta(1001));
  EXIGIR(b.puerta.conexion_revocada(&conn) && conn == kConn);
  EXIGIR(!b.puerta.notificacion_posible(&conn));
  EXIGIR(!b.puerta.sesion().protegida() && !b.puerta.sesion().suscrita());
  EXIGIR(b.puerta.leer_medicion(kConn, true, protegido(), 1002, trama) == puerta::kAttAutenticacionInsuficiente);
  EXIGIR(!b.puerta.al_suscribir(kConn, true, protegido()));
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Cortar);
  EXIGIR(!b.puerta.sesion().protegida());
  // Aunque se vuelva a abrir la ventana, la conexión revocada no recibe la clave...
  b.puerta.ventana().abrir(2000);
  uint32_t clave = 0;
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 2001, &clave) == AccionClave::Cortar && clave == 0);
  // ...ni se reinicia con un evento de conexión repetido.
  EXIGIR(!b.puerta.al_conectar(kConn, 2002));
  EXIGIR(b.puerta.conexion_revocada(&conn));
  // Terminar la conexión no abre la admisión antes de que el almacén esté vacío.
  EXIGIR(b.puerta.al_desconectar(kConn));
  EXIGIR(!b.puerta.conexion_revocada(&conn));
  EXIGIR(!b.puerta.al_conectar(kConn, 2999));
  StackFalso st;
  EXIGIR(b.puerta.atender_borrado(st));
  EXIGIR(b.puerta.al_conectar(kConn, 3000));
  b.puerta.ventana().abrir(3001);
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 3002, &clave) == AccionClave::Inyectar);
  // Sin sesión, el borrado también veta la admisión hasta completarse.
  Banco c;
  c.puerta.ventana().abrir(1000);
  c.puerta.revocar_sesion();
  EXIGIR(!c.puerta.ventana().abierta(1001) && !c.puerta.conexion_revocada(&conn));
  EXIGIR(!c.puerta.al_conectar(kConn, 1002));
  EXIGIR(!c.puerta.persistir_vinculo(3, false, false, 0));
  EXIGIR(c.puerta.atender_borrado(st));
  EXIGIR(c.puerta.al_conectar(kConn, 1003));
}

void prueba_borrado_corta_y_vacia_el_almacen() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  std::vector<int> flash = {puerta::kObjetoClaveNuestra, puerta::kObjetoClaveDelPar, 3};
  StackFalso st;
  st.almacen = &flash;
  b.puerta.revocar_sesion();
  st.al_cortar = [&] { EXIGIR(!flash.empty()); };  // se corta antes de vaciar
  EXIGIR(b.puerta.atender_borrado(st));
  EXIGIR(st.cortes.size() == 1 && st.cortes[0] == kConn);
  EXIGIR(st.borrados == 1 && flash.empty() && st.tomados == 0);
  // Sin sesión se vacía el almacén y no se corta nada. Sin petición no se borra.
  Banco c;
  StackFalso st2;
  c.puerta.revocar_sesion();
  c.puerta.atender_borrado(st2);
  EXIGIR(st2.cortes.empty() && st2.borrados == 1);
  Banco d;
  d.conectar_suscrita(kConn, 1000);
  StackFalso st3;
  d.puerta.atender_borrado(st3);  // sesión no revocada: no se toca
  EXIGIR(st3.cortes.empty() && st3.borrados == 0 && d.puerta.sesion().conectada());
}

void prueba_borrado_fallido_conserva_el_bloqueo() {
  Banco b;
  std::vector<int> flash = {puerta::kObjetoClaveNuestra, puerta::kObjetoClaveDelPar, 3};
  StackFalso st;
  st.almacen = &flash;
  st.borra = false;
  b.puerta.revocar_sesion();
  EXIGIR(!b.puerta.atender_borrado(st));
  EXIGIR(st.borrados == 1 && flash.size() == 3);
  EXIGIR(!b.puerta.al_conectar(kConn, 1000));
  b.puerta.ventana().abrir(1000);
  EXIGIR(!b.puerta.reemparejar_permitido(1001));
  EXIGIR(b.puerta.vetar_negociacion(1001));
  for (int tipo : {puerta::kObjetoClaveNuestra, puerta::kObjetoClaveDelPar, 3, 4}) {
    EXIGIR(!escribir_en(flash, b.puerta, tipo));
  }
  // Otra pulsación puede reintentar; la admisión vuelve solo tras vaciar el almacén.
  b.puerta.revocar_sesion();
  st.borra = true;
  EXIGIR(b.puerta.atender_borrado(st) && flash.empty());
  EXIGIR(b.puerta.al_conectar(kConn, 2000));
  uint32_t clave = 0;
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 2001, &clave) == AccionClave::Cortar);
  b.puerta.ventana().abrir(2002);
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 2003, &clave) == AccionClave::Inyectar);
}

void prueba_emparejamiento_en_vuelo_no_sobrevive_al_borrado() {
  const int propia = puerta::kObjetoClaveNuestra;
  const int par = puerta::kObjetoClaveDelPar;
  uint32_t clave = 0;
  {  // La clave se mostró con la ventana abierta; el borrado llega A MITAD de la persistencia.
    Banco b;
    std::vector<int> flash;
    StackFalso st;
    st.almacen = &flash;
    b.puerta.al_conectar(kConn, 1000);
    b.puerta.ventana().abrir(1000);
    EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 1001, &clave) == AccionClave::Inyectar);
    EXIGIR(escribir_en(flash, b.puerta, propia));  // el stack escribe sus claves...
    b.puerta.revocar_sesion();                      // ...pulsación larga...
    EXIGIR(!escribir_en(flash, b.puerta, par));     // ...y la otra mitad ya no entra
    b.puerta.atender_borrado(st);                   // el borrado del host vacía lo escrito
    EXIGIR(flash.empty());
    // Lo que el emparejamiento en vuelo intente después del borrado, también se rechaza.
    EXIGIR(!escribir_en(flash, b.puerta, propia));
    EXIGIR(!escribir_en(flash, b.puerta, par));
    EXIGIR(!escribir_en(flash, b.puerta, 3));  // ni el CCCD
    EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Cortar);  // el cifrado tardío tampoco protege
    EXIGIR(flash.empty());
  }
  {  // El emparejamiento termina entero ANTES de la pulsación: el borrado lo elimina.
    Banco b;
    std::vector<int> flash;
    StackFalso st;
    st.almacen = &flash;
    b.puerta.al_conectar(kConn, 1000);
    b.puerta.ventana().abrir(1000);
    EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 1001, &clave) == AccionClave::Inyectar);
    EXIGIR(escribir_en(flash, b.puerta, propia) && escribir_en(flash, b.puerta, par));
    EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
    b.puerta.revocar_sesion();
    b.puerta.atender_borrado(st);
    EXIGIR(flash.empty());
  }
}

void prueba_persistencia_ligada_al_alta_de_la_conexion() {
  const int propia = puerta::kObjetoClaveNuestra;
  const int par = puerta::kObjetoClaveDelPar;
  uint32_t clave = 0;
  std::vector<int> flash;
  Banco b;
  // Sin conexión, o con conexión que no recibió la clave: ni autenticada, LESC y de 16 bytes entra.
  EXIGIR(!escribir_en(flash, b.puerta, propia) && !escribir_en(flash, b.puerta, par));
  b.puerta.al_conectar(kConn, 1000);
  EXIGIR(!escribir_en(flash, b.puerta, propia));
  b.puerta.ventana().abrir(1000);  // ventana abierta, pero esta conexión no pidió ni recibió la clave
  EXIGIR(!escribir_en(flash, b.puerta, propia) && !escribir_en(flash, b.puerta, par));
  // Pedir la clave con la ventana CERRADA no autoriza nada.
  Banco c;
  c.puerta.al_conectar(kConn, 1000);
  EXIGIR(c.puerta.al_pedir_clave(kAccDisp, kConn, 1001, &clave) == AccionClave::Cortar);
  EXIGIR(!escribir_en(flash, c.puerta, propia));
  // Un evento de clave DIFERIDO más allá del plazo de la ventana se rechaza al
  // ejecutarse (la comprobación usa el reloj de la ejecución), y no autoriza.
  Banco d;
  d.puerta.al_conectar(kConn, 1000);
  d.puerta.ventana().abrir(1000);
  EXIGIR(d.puerta.al_pedir_clave(kAccDisp, kConn, 1000 + 60000, &clave) == AccionClave::Cortar);
  EXIGIR(!escribir_en(flash, d.puerta, par));
  // Con la clave entregada, la conexión actual persiste lo autenticado y nada más.
  EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 1002, &clave) == AccionClave::Inyectar);
  EXIGIR(!escribir_en(flash, b.puerta, propia, false, true, 16));  // Just Works
  EXIGIR(!escribir_en(flash, b.puerta, par, true, false, 16));     // heredado
  EXIGIR(!escribir_en(flash, b.puerta, par, true, true, 15));      // clave corta
  EXIGIR(escribir_en(flash, b.puerta, propia) && escribir_en(flash, b.puerta, par));
  // La autorización acaba con el cifrado del emparejamiento: un alta, un vínculo.
  EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
  flash.clear();
  EXIGIR(!escribir_en(flash, b.puerta, propia) && !escribir_en(flash, b.puerta, par));
  // Tampoco pasa a la conexión siguiente.
  Banco e;
  e.puerta.al_conectar(kConn, 1000);
  e.puerta.ventana().abrir(1000);
  EXIGIR(e.puerta.al_pedir_clave(kAccDisp, kConn, 1001, &clave) == AccionClave::Inyectar);
  e.puerta.al_desconectar(kConn);
  EXIGIR(!escribir_en(flash, e.puerta, propia));
  e.puerta.al_conectar(kConn, 1100);
  EXIGIR(!escribir_en(flash, e.puerta, propia) && !escribir_en(flash, e.puerta, par));
  // Y un cifrado fallido también la retira.
  Banco f;
  f.puerta.al_conectar(kConn, 1000);
  f.puerta.ventana().abrir(1000);
  EXIGIR(f.puerta.al_pedir_clave(kAccDisp, kConn, 1001, &clave) == AccionClave::Inyectar);
  EXIGIR(f.puerta.al_cambiar_cifrado(kConn, 5, protegido()) == AccionGap::Cortar);
  EXIGIR(!escribir_en(flash, f.puerta, propia));
  EXIGIR(flash.empty());
  // Lo que no es una clave de enlace (CCCD) pasa sin alta mientras no haya revocación:
  // el vínculo ya autorizado restaura su suscripción fuera de la ventana.
  Banco g;
  g.puerta.al_conectar(kConn, 1000);
  EXIGIR(escribir_en(flash, g.puerta, 3));
}

void prueba_un_solo_cliente() {
  Banco b;
  b.conectar_suscrita(kConn, 1000);
  b.r.t = 1010;
  b.r.trama(true);
  // Una segunda conexión no desplaza a la primera ni se atiende.
  EXIGIR(!b.puerta.al_conectar(kConn + 1, 1100));
  EXIGIR(b.puerta.sesion().id_conexion() == kConn && b.puerta.sesion().suscrita());
  uint8_t trama[ble::kLongitudTrama];
  EXIGIR(b.puerta.leer_medicion(kConn + 1, true, protegido(), 1101, trama) == puerta::kAttInesperado);
  EXIGIR(!b.puerta.al_desconectar(kConn + 1));  // su caída no cierra la sesión de la primera
  EXIGIR(b.puerta.sesion().conectada());
  // La misma conexión repetida (CONNECT que llega después de ENC_CHANGE o dos veces)
  // no reinicia lo ya registrado: ni protección, ni suscripción, ni el instante de
  // la conexión que fija el plazo. Cambió con H2 (banco 12/11): antes la reiniciaba.
  EXIGIR(b.puerta.al_conectar(kConn, 1200));
  EXIGIR(b.puerta.sesion().suscrita() && b.puerta.sesion().protegida() && b.puerta.sesion().t_conexion_ms() == 1000);
  // Nada se hereda de una conexión que terminó, aunque reutilice el manejador.
  EXIGIR(b.puerta.al_desconectar(kConn));
  EXIGIR(b.puerta.al_conectar(kConn, 1300));
  EXIGIR(!b.puerta.sesion().suscrita() && !b.puerta.sesion().protegida() && b.puerta.sesion().t_conexion_ms() == 1300);
}

void prueba_gracia() {
  Banco b;
  uint16_t conn = 0;
  b.puerta.al_conectar(kConn, 1000);
  EXIGIR(!b.puerta.gracia_vencida(1000 + enlace::kGraciaSeguridadMs - 1, &conn));
  EXIGIR(b.puerta.gracia_vencida(1000 + enlace::kGraciaSeguridadMs, &conn));
  EXIGIR(conn == kConn);
  b.puerta.al_cambiar_cifrado(kConn, 0, protegido());
  EXIGIR(!b.puerta.gracia_vencida(1000 + 10 * enlace::kGraciaSeguridadMs, &conn));
}

// H4: el sketch avisa por el serie con registrar_corte_por_gracia() de la sesión de
// la puerta; el corte (gracia_vencida) se repite cada ciclo hasta la desconexión.
void prueba_aviso_unico_del_corte_por_gracia() {
  Banco b;
  uint16_t conn = 0;
  int cortes = 0;
  int avisos = 0;
  auto ciclo = [&](uint32_t t) {
    if (b.puerta.gracia_vencida(t, &conn)) {
      ++cortes;
      if (b.puerta.sesion().registrar_corte_por_gracia()) ++avisos;
    }
  };
  b.puerta.al_conectar(kConn, 1000);
  for (int i = 0; i < 12; ++i) ciclo(1000 + enlace::kGraciaSeguridadMs + 7 * i);
  EXIGIR(cortes == 12 && avisos == 1 && conn == kConn);
  b.puerta.al_desconectar(kConn);
  b.puerta.al_conectar(kConn, 200000);
  for (int i = 0; i < 12; ++i) ciclo(200000 + enlace::kGraciaSeguridadMs + 7 * i);
  EXIGIR(cortes == 24 && avisos == 2);
  // Un enlace protegido a tiempo no corta ni avisa.
  b.puerta.al_desconectar(kConn);
  b.puerta.al_conectar(kConn, 400000);
  b.puerta.al_cambiar_cifrado(kConn, 0, protegido());
  for (int i = 0; i < 12; ++i) ciclo(400000 + enlace::kGraciaSeguridadMs + 7 * i);
  EXIGIR(cortes == 24 && avisos == 2);
}

// Ordenes de eventos de un enlace vivo (H2/S2, banco 12/11). NimBLE entrega CONNECT
// al terminar la lectura de funciones remotas del par, con un status que no dice
// si el enlace vive, y a veces después de ENC_CHANGE. El sketch registra el enlace
// en cada uno de esos eventos con registrar_enlace(), y lo vivo lo dice el stack.
void prueba_enlace_vivo_se_registra_en_cualquier_evento() {
  using puerta::Registro;
  // Portátil con BlueZ: CONNECT con status 26 en un enlace vivo. El enlace se
  // registra y la gracia lo corta aunque no llegue nada más (antes: sin sesión,
  // abierto más de 40 s).
  {
    Banco b;
    uint16_t conn = 0;
    EXIGIR(b.puerta.registrar_enlace(kConn, true, 1000) == Registro::Nuevo);
    EXIGIR(b.puerta.sesion().conectada() && b.puerta.sesion().id_conexion() == kConn);
    EXIGIR(!b.puerta.gracia_vencida(1000 + enlace::kGraciaSeguridadMs - 1, &conn));
    EXIGIR(b.puerta.gracia_vencida(1000 + enlace::kGraciaSeguridadMs, &conn) && conn == kConn);
    // Sin protección no hay datos: ni lectura ni notificación.
    uint8_t trama[ble::kLongitudTrama];
    EXIGIR(b.puerta.leer_medicion(kConn, true, EstadoSeguridad(), 1100, trama) == puerta::kAttAutenticacionInsuficiente);
    EXIGIR(!b.puerta.al_suscribir(kConn, true, EstadoSeguridad()) && !b.puerta.sesion().suscrita());
  }
  // iPhone: ENC_CHANGE llega ANTES que CONNECT. El primero registra el enlace; el
  // CONNECT tardío (status 0, 22 o 19) no deshace lo decidido.
  {
    Banco b;
    EXIGIR(b.puerta.registrar_enlace(kConn, true, 1000) == Registro::Nuevo);  // por ENC_CHANGE
    EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
    EXIGIR(b.puerta.al_suscribir(kConn, true, protegido()));
    EXIGIR(b.puerta.registrar_enlace(kConn, true, 1400) == Registro::Conocido);  // el CONNECT tardío
    EXIGIR(b.puerta.sesion().protegida() && b.puerta.sesion().suscrita() && b.puerta.sesion().t_conexion_ms() == 1000);
    uint16_t conn = 0;
    EXIGIR(!b.puerta.gracia_vencida(1000 + 10 * enlace::kGraciaSeguridadMs, &conn));
    ble::Medicion m;
    EXIGIR(b.leer(kConn, 1500, &m));
  }
  // El cifrado con éxito antes de CONNECT, sin sesión previa: es la misma ruta, y
  // sin registrar el enlace antes se cortaría un enlace legítimo.
  {
    Banco b;
    EXIGIR(b.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Cortar);  // lo que ocurría sin registrar
    Banco c;
    c.puerta.registrar_enlace(kConn, true, 1000);
    EXIGIR(c.puerta.al_cambiar_cifrado(kConn, 0, protegido()) == AccionGap::Nada);
  }
  // CONNECT de un enlace que ya no existe (status 22 o 19, tras DISCONNECT), o un
  // fallo de conexión sin manejador: nunca crea sesión.
  {
    Banco b;
    EXIGIR(b.puerta.registrar_enlace(kConn, false, 1000) == Registro::Ninguno);
    EXIGIR(b.puerta.registrar_enlace(puerta::kSinConexion, true, 1000) == Registro::Ninguno);
    EXIGIR(b.puerta.registrar_enlace(puerta::kSinConexion, false, 1000) == Registro::Ninguno);
    EXIGIR(!b.puerta.sesion().conectada());
    uint16_t conn = 0;
    EXIGIR(!b.puerta.gracia_vencida(1000 + 10 * enlace::kGraciaSeguridadMs, &conn));
    // Ni deja ocupado el cupo: el siguiente enlace vivo entra.
    EXIGIR(b.puerta.registrar_enlace(kConn + 1, true, 2000) == Registro::Nuevo);
  }
  // Un solo cliente: el segundo enlace vivo se rechaza (el sketch lo corta) sin
  // tocar la sesión del primero, y el primero sigue siendo conocido.
  {
    Banco b;
    EXIGIR(b.puerta.registrar_enlace(kConn, true, 1000) == Registro::Nuevo);
    EXIGIR(b.puerta.registrar_enlace(kConn + 1, true, 1100) == Registro::Rechazado);
    EXIGIR(b.puerta.sesion().id_conexion() == kConn);
    EXIGIR(b.puerta.registrar_enlace(kConn, true, 1200) == Registro::Conocido);
  }
  // Borrado de vínculos pendiente o sesión revocada: se rechaza, no se reinicia.
  {
    Banco b;
    b.conectar_suscrita(kConn, 1000);
    b.puerta.revocar_sesion();
    EXIGIR(b.puerta.registrar_enlace(kConn, true, 1100) == Registro::Rechazado);
    EXIGIR(!b.puerta.sesion().protegida());
  }
}

// H3 (banco 12/11): la gracia de 30 s contaba desde la conexión y cortó mientras la
// persona tecleaba la clave (petición a los 24,5 s). Ahora la petición de clave da
// kGraciaClaveMs completos, con tope de kGraciaMaximaMs desde la conexión.
void prueba_gracia_tras_pedir_la_clave() {
  uint16_t conn = 0;
  // El caso del banco: petición a los 24,5 s de la conexión.
  {
    Banco b;
    b.puerta.al_conectar(kConn, 1000);
    b.puerta.ventana().abrir(1000);
    uint32_t clave = 0;
    EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 1000 + 24500, &clave) == AccionClave::Inyectar);
    // Con la gracia vieja (30 s) esto cortaba a los 30 s, a 5,5 s de la petición.
    EXIGIR(!b.puerta.gracia_vencida(1000 + enlace::kGraciaSeguridadMs, &conn));
    EXIGIR(!b.puerta.gracia_vencida(1000 + 24500 + enlace::kGraciaClaveMs - 1, &conn));
    EXIGIR(b.puerta.gracia_vencida(1000 + 24500 + enlace::kGraciaClaveMs, &conn) && conn == kConn);
    // Emparejar a tiempo cancela el corte.
    b.puerta.al_cambiar_cifrado(kConn, 0, protegido());
    EXIGIR(!b.puerta.gracia_vencida(1000 + 10 * enlace::kGraciaSeguridadMs, &conn));
  }
  // Sin petición de clave el plazo es el de siempre (portátil sin autenticar).
  {
    Banco b;
    b.puerta.al_conectar(kConn, 1000);
    EXIGIR(b.puerta.gracia_vencida(1000 + enlace::kGraciaSeguridadMs, &conn));
  }
  // Pedir la clave una y otra vez no mantiene abierto un enlace sin proteger: el
  // tope cuenta desde la conexión.
  {
    Banco b;
    b.puerta.al_conectar(kConn, 1000);
    b.puerta.ventana().abrir(1000);
    uint32_t clave = 0;
    for (uint32_t t = 5000; t < enlace::kGraciaMaximaMs; t += 5000) {
      EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 1000 + t, &clave) == AccionClave::Inyectar);
      EXIGIR(!b.puerta.gracia_vencida(1000 + t, &conn));
    }
    EXIGIR(!b.puerta.gracia_vencida(1000 + enlace::kGraciaMaximaMs - 1, &conn));
    EXIGIR(b.puerta.gracia_vencida(1000 + enlace::kGraciaMaximaMs, &conn));
    EXIGIR(b.puerta.gracia_vencida(1000 + 10 * enlace::kGraciaMaximaMs, &conn));
  }
  // Una petición rechazada (ventana cerrada, otra conexión) no alarga nada.
  {
    Banco b;
    b.puerta.al_conectar(kConn, 1000);
    uint32_t clave = 0;
    EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn, 1000 + 24500, &clave) == AccionClave::Cortar);  // ventana cerrada
    b.puerta.ventana().abrir(1000);
    EXIGIR(b.puerta.al_pedir_clave(kAccDisp, kConn + 1, 1000 + 24500, &clave) == AccionClave::Cortar);  // conexión ajena
    EXIGIR(b.puerta.al_pedir_clave(kAccDisp + 1, kConn, 1000 + 24500, &clave) == AccionClave::Cortar);  // acción no admitida
    EXIGIR(b.puerta.gracia_vencida(1000 + enlace::kGraciaSeguridadMs, &conn));
  }
  // La conexión siguiente empieza con la gracia base, no con la alargada.
  {
    Banco b;
    b.puerta.al_conectar(kConn, 1000);
    b.puerta.ventana().abrir(1000);
    uint32_t clave = 0;
    b.puerta.al_pedir_clave(kAccDisp, kConn, 1000 + 24500, &clave);
    b.puerta.al_desconectar(kConn);
    b.puerta.al_conectar(kConn, 100000);
    EXIGIR(b.puerta.gracia_vencida(100000 + enlace::kGraciaSeguridadMs, &conn));
  }
}

void prueba_simulacion_y_sin_radar() {
  RadarOperando r;
  ble::Informacion info;
  EXIGIR(enlace::informacion_sen0395(1, 0, 3000, &info));
  // Simulación: bit 5 siempre, presencia alterna.
  PuertaBle sim(nullptr, true, kClave);
  EXIGIR(sim.iniciar(info));
  sim.al_conectar(kConn, 1000);
  sim.al_cambiar_cifrado(kConn, 0, protegido());
  uint8_t trama[ble::kLongitudTrama];
  EXIGIR(sim.leer_medicion(kConn, true, protegido(), 1100, trama) == puerta::kAttOk);
  ble::Medicion m;
  EXIGIR(ble::decodificar_medicion(trama, sizeof(trama), info, &m) == ble::Error::Ninguno);
  EXIGIR((m.banderas & ble::kBanSimulacion) != 0);
  // Sin radar ni simulación: salud 6 (montaje no validado), nunca «sin blanco».
  PuertaBle sin(nullptr, false, kClave);
  EXIGIR(sin.iniciar(info));
  sin.al_conectar(kConn, 1000);
  sin.al_cambiar_cifrado(kConn, 0, protegido());
  EXIGIR(sin.leer_medicion(kConn, true, protegido(), 1100, trama) == puerta::kAttOk);
  EXIGIR(ble::decodificar_medicion(trama, sizeof(trama), info, &m) == ble::Error::Ninguno);
  EXIGIR(m.salud == 6 && (m.banderas & ble::kBanResultado) == 0 && (m.banderas & ble::kBanSimulacion) == 0);
}

}  // namespace

int main() {
  prueba_uuid();
  prueba_almacen_de_vinculos();
  prueba_clave_solo_con_ventana();
  prueba_clave_invalida_nunca_se_entrega();
  prueba_reemparejar_y_oob();
  prueba_cifrado_negativos();
  prueba_vinculo_autorizado_se_restaura_sin_ventana();
  prueba_suscripcion();
  prueba_lecturas_siempre_frescas();
  prueba_lectura_rechazos();
  prueba_conexion_nueva_no_hereda_nada();
  prueba_notificacion();
  prueba_lectura_y_notificacion_no_comparten_valor();
  prueba_conexion_cambia_entre_pasos();
  prueba_notificacion_es_una_operacion();
  prueba_cifrado_revocado_antes_del_envio();
  prueba_desconexion_y_reuso_antes_del_envio();
  prueba_revocacion_entre_los_pasos_de_la_notificacion();
  prueba_revocar_sesion();
  prueba_borrado_corta_y_vacia_el_almacen();
  prueba_borrado_fallido_conserva_el_bloqueo();
  prueba_emparejamiento_en_vuelo_no_sobrevive_al_borrado();
  prueba_persistencia_ligada_al_alta_de_la_conexion();
  prueba_un_solo_cliente();
  prueba_gracia();
  prueba_aviso_unico_del_corte_por_gracia();
  prueba_enlace_vivo_se_registra_en_cualquier_evento();
  prueba_gracia_tras_pedir_la_clave();
  prueba_simulacion_y_sin_radar();
  printf("%d comprobaciones, %d fallos\n", g_casos, g_fallos);
  return g_fallos == 0 ? 0 : 1;
}

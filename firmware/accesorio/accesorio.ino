// Accesorio de proximidad Visionaria: ESP32-S3 + radar SEN0395 + BLE (EA-12).
//
// Une los módulos portátiles (trama_ble, emisor_sintetico, sen0395,
// enlace_accesorio, enlace_radar, puerta_ble) con el hardware. Contrato:
// docs/expoandes/contrato-ble.md (v1.0). Diseño, seguridad y límites:
// docs/expoandes/ea-12-ble.md.
//
// Nada de hardware se habilita sin una selección humana: los pines y la clave
// salen de macros que fija quien prepara el accesorio (configuracion_local.h,
// ignorado por Git, o banderas de compilación). Sin ellos no hay UART, ni alta,
// ni BLE. Ningún pin de este repositorio está probado en la placa.
//
// Núcleo Arduino de Espressif con NimBLE (esp32:esp32 3.3.12, placa esp32s3).
//
// La biblioteca BLE de Arduino solo ARRANCA el stack (BLEDevice::init). El GAP
// (anuncio, conexión, emparejamiento), el GATT (servicio, lecturas, notificación)
// y el almacén de vínculos son de este sketch, sobre la API nativa de NimBLE: la
// biblioteca no ve las lecturas ni las notificaciones (no hay valor guardado que
// pueda quedar viejo ni compartirse entre hilos), no imprime la clave y no puede
// persistir un vínculo no autorizado. Las decisiones están en puerta_ble.h, que
// las pruebas del portátil ejecutan.

#include <Arduino.h>
#include <BLEDevice.h>
#include <Preferences.h>
#include <esp_random.h>
#include <host/ble_gap.h>
#include <host/ble_gatt.h>
#include <host/ble_hs.h>
#include <host/ble_hs_id.h>
#include <host/ble_hs_mbuf.h>
#include <host/ble_sm.h>
#include <host/ble_store.h>
#include <nimble/nimble_npl.h>
#include <nimble/nimble_port.h>
#include <services/gap/ble_svc_gap.h>
#include <services/gatt/ble_svc_gatt.h>

#include <atomic>

#include "emisor_sintetico.h"
#include "enlace_accesorio.h"
#include "enlace_radar.h"
#include "puerta_ble.h"
#include "sen0395.h"
#include "trama_ble.h"

#if __has_include("configuracion_local.h")
#include "configuracion_local.h"
#endif

#if !defined(CONFIG_NIMBLE_ENABLED)
#error "Este firmware está escrito para NimBLE (esp32:esp32 3.3.12 en esp32s3). Con otro stack hay que revisar la protección GATT."
#endif

namespace {

using namespace visionaria;

// --- Selección humana: pines, clave y modo ------------------------------------

#if defined(VISIONARIA_SIMULACION) && (defined(VISIONARIA_PIN_RADAR_RX) || defined(VISIONARIA_PIN_RADAR_TX))
#error "La simulación no se combina con los pines del radar: compila una cosa o la otra."
#endif
#if defined(VISIONARIA_PIN_RADAR_RX) != defined(VISIONARIA_PIN_RADAR_TX)
#error "Define VISIONARIA_PIN_RADAR_RX y VISIONARIA_PIN_RADAR_TX juntos."
#endif

#if defined(VISIONARIA_PIN_RADAR_RX)
constexpr bool kRadarHabilitado = true;
static_assert(enlace::pin_permitido(VISIONARIA_PIN_RADAR_RX), "VISIONARIA_PIN_RADAR_RX está en la lista de pines vetados");
static_assert(enlace::pin_permitido(VISIONARIA_PIN_RADAR_TX), "VISIONARIA_PIN_RADAR_TX está en la lista de pines vetados");
static_assert(VISIONARIA_PIN_RADAR_RX != VISIONARIA_PIN_RADAR_TX, "RX y TX del radar deben ser pines distintos");
#else
constexpr bool kRadarHabilitado = false;
#endif

#if defined(VISIONARIA_PIN_BOTON)
constexpr bool kBotonHabilitado = true;
static_assert(enlace::pin_boton_permitido(VISIONARIA_PIN_BOTON), "VISIONARIA_PIN_BOTON está en la lista de pines vetados");
#if defined(VISIONARIA_PIN_RADAR_RX)
static_assert(VISIONARIA_PIN_BOTON != VISIONARIA_PIN_RADAR_RX && VISIONARIA_PIN_BOTON != VISIONARIA_PIN_RADAR_TX,
              "El botón no puede compartir pin con el radar");
#endif
#else
constexpr bool kBotonHabilitado = false;
#endif

#if defined(VISIONARIA_CLAVE_ENLACE)
constexpr bool kClaveProvisionada = true;
constexpr uint32_t kClave = VISIONARIA_CLAVE_ENLACE;
static_assert(enlace::clave_valida(kClave), "VISIONARIA_CLAVE_ENLACE debe tener 6 dígitos y no ser trivial");
#else
constexpr bool kClaveProvisionada = false;
constexpr uint32_t kClave = 0;
#endif

#if defined(VISIONARIA_SIMULACION)
constexpr bool kSimulacion = true;
constexpr const char* kNombre = "Visionaria-SIM";
#else
constexpr bool kSimulacion = false;
constexpr const char* kNombre = "Visionaria";
#endif


// --- Contrato -----------------------------------------------------------------

constexpr const char* kUuidServicio = "e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e31";
constexpr const char* kUuidInformacion = "e13a0001-76b8-4fb0-9d2b-8c4f8d8a7e31";
constexpr const char* kUuidMedicion = "e13a0002-76b8-4fb0-9d2b-8c4f8d8a7e31";
static_assert(puerta::uuid128_le(kUuidServicio).valido && puerta::uuid128_le(kUuidInformacion).valido &&
                  puerta::uuid128_le(kUuidMedicion).valido,
              "UUID del contrato mal escrito");

// Los valores que puerta_ble.h repite para no depender de NimBLE son los del stack.
static_assert(puerta::kAttAutenticacionInsuficiente == BLE_ATT_ERR_INSUFFICIENT_AUTHEN, "código ATT distinto del de NimBLE");
static_assert(puerta::kAttInesperado == BLE_ATT_ERR_UNLIKELY, "código ATT distinto del de NimBLE");
static_assert(puerta::kAccionClaveEnPantalla == BLE_SM_IOACT_DISP, "acción de emparejamiento distinta de la de NimBLE");
static_assert(puerta::kObjetoClaveNuestra == BLE_STORE_OBJ_TYPE_OUR_SEC, "tipo de almacén distinto del de NimBLE");
static_assert(puerta::kObjetoClaveDelPar == BLE_STORE_OBJ_TYPE_PEER_SEC, "tipo de almacén distinto del de NimBLE");
static_assert(puerta::kSinConexion == BLE_HS_CONN_HANDLE_NONE, "manejador vacío distinto del de NimBLE");

constexpr uint32_t kBaudios = sen0395::kBaudios;
constexpr uint32_t kPeriodoCicloMs = 2;
constexpr uint32_t kPeriodoEstadoMs = 5000;
constexpr uint32_t kPeriodoAnuncioMs = 250;  // entre intentos de volver a anunciar

// --- Estado compartido (lo tocan loop() y las tareas del stack BLE) ---------------
// Todo lo de este bloque se protege con g_cerrojo. millis() se lee DENTRO del
// cerrojo para que el reloj que ve el intérprete nunca decrezca. El cerrojo es
// recursivo. Solo la entrega de una notificación lo conserva hasta el envío, para
// que la revocación física no se intercale. El callback del almacén solo lee
// atómicos y NOTIFY_TX no toma el cerrojo: no invierten el orden de los cerrojos.
// Cortar, consultar el enlace, borrar vínculos y anunciar se hacen sin él. Lo que debe ser UNA
// operación respecto a los eventos del stack (notificar, borrar vínculos) no se
// hace en el loop sino en el hilo del host de NimBLE, por su cola de eventos
// (más abajo): ahí no se intercalan cambios de cifrado, suscripciones ni
// desconexiones. Los contadores que toca ese hilo son atómicos.

SemaphoreHandle_t g_cerrojo = nullptr;

struct Cerrojo {
  Cerrojo() { xSemaphoreTakeRecursive(g_cerrojo, portMAX_DELAY); }
  ~Cerrojo() { xSemaphoreGiveRecursive(g_cerrojo); }
  Cerrojo(const Cerrojo&) = delete;
  Cerrojo& operator=(const Cerrojo&) = delete;
};

sen0395::Interprete g_radar;
radar::SupervisorRadar g_supervisor;
radar::EstadoUart g_uart_estado;
std::atomic<bool> g_perdida_uart{false};  // la pone la tarea de eventos de la UART
ble::Informacion g_info;
puerta::PuertaBle g_puerta(kRadarHabilitado ? &g_radar : nullptr, kSimulacion, kClave);
enlace::Boton g_boton;

bool g_ble_activo = false;
uint16_t g_val_medicion = 0;  // manejador del valor de Medición, que asigna NimBLE

std::atomic<uint32_t> g_notificaciones{0};  // los incrementa el hilo del host
uint32_t g_lecturas = 0;
std::atomic<uint32_t> g_vinculos_rechazados{0};  // los incrementa el callback del almacén
uint32_t g_ultimo_estado_ms = 0;
uint32_t g_ultimo_anuncio_ms = 0;

// --- Utilidades -----------------------------------------------------------------

uint32_t aleatorio(void*) { return esp_random(); }

enlace::EstadoSeguridad estado_de(const ble_gap_conn_desc* d) {
  enlace::EstadoSeguridad s;
  s.cifrado = d->sec_state.encrypted;
  s.autenticado = d->sec_state.authenticated;
  s.vinculado = d->sec_state.bonded;
  s.tamano_clave = d->sec_state.key_size;
  return s;
}

// Estado EN VIVO del enlace según el stack. Se consulta SIN el cerrojo.
bool estado_en_vivo(uint16_t conexion, enlace::EstadoSeguridad* s) {
  ble_gap_conn_desc d;
  if (ble_gap_conn_find(conexion, &d) != 0) return false;
  *s = estado_de(&d);
  return true;
}

void cortar(uint16_t conexion) { ble_gap_terminate(conexion, BLE_ERR_REM_USER_CONN_TERM); }

// --- Operaciones en el hilo del host -----------------------------------------------------
// ble_gatts_notify_custom() y ble_store_clear() no comprueban nada de la sesión: el
// transporte nativo solo mira el manejador. Lo que importa es QUÉ eventos pueden
// ocurrir entre la comprobación de la sesión y la acción. Los cambios de cifrado,
// las suscripciones, las desconexiones y la reutilización de un manejador los
// procesa la tarea del host de NimBLE, una a una. Por eso la notificación y el
// borrado de vínculos se ejecutan COMO eventos de esa misma cola
// (nimble_port_get_dflt_eventq): entre el primer paso y el último de cada uno
// no se intercala ninguno de ellos. El loop solo los pide.

// Lo que puerta_ble.h pide del stack, sobre NimBLE y FreeRTOS.
class StackNimble : public puerta::PuertoStack {
 public:
  void tomar() override { xSemaphoreTakeRecursive(g_cerrojo, portMAX_DELAY); }
  void soltar() override { xSemaphoreGiveRecursive(g_cerrojo); }
  uint32_t ahora() override { return millis(); }
  bool estado_enlace(uint16_t conexion, enlace::EstadoSeguridad* s) override { return estado_en_vivo(conexion, s); }
  bool enviar(uint16_t conexion, const uint8_t trama[ble::kLongitudTrama]) override {
    os_mbuf* om = ble_hs_mbuf_from_flat(trama, ble::kLongitudTrama);
    if (om == nullptr) return false;
    if (ble_gatts_notify_custom(conexion, g_val_medicion, om) != 0) return false;  // consume `om` siempre
    ++g_notificaciones;
    return true;
  }
  void cortar(uint16_t conexion) override { ble_gap_terminate(conexion, BLE_ERR_REM_USER_CONN_TERM); }
  bool borrar_vinculos() override { return ble_store_clear() == 0; }
};
StackNimble g_stack;

ble_npl_event g_evento_notificar;
ble_npl_event g_evento_borrar;
std::atomic<bool> g_notificar_pedido{false};
std::atomic<bool> g_borrar_pedido{false};

// Se ejecutan en el hilo del host. El indicador se baja AL EMPEZAR: una petición
// que llegue durante la ejecución encola otra, y las repetidas se funden en una.
void anunciar();

// La sesión se consulta y se actúa sobre ella en el mismo hilo que reutiliza sus manejadores.
void evento_notificar(ble_npl_event*) {
  g_notificar_pedido.store(false);
  {
    Cerrojo c;
    // La configuración SMP la modifica su propio hilo; el loop solo cambia la ventana.
    ble_hs_cfg.sm_oob_data_flag = g_puerta.vetar_negociacion(millis());
  }
  bool conectada;
  bool cortar_sesion;
  uint16_t conexion = 0;
  uint16_t id_sesion;
  {
    Cerrojo c;
    conectada = g_puerta.sesion().conectada();
    id_sesion = g_puerta.sesion().id_conexion();
    cortar_sesion = g_puerta.gracia_vencida(millis(), &conexion);
  }
  if (cortar_sesion) {
    Serial.println("BLE: enlace sin proteger pasado el plazo; se corta");
    cortar(conexion);
  }
  if (conectada) {
    ble_gap_conn_desc d;
    if (ble_gap_conn_find(id_sesion, &d) != 0) {
      Cerrojo c;
      g_puerta.al_desconectar(id_sesion);
      conectada = false;
    }
  }
  if (!conectada) {
    const uint32_t ahora = millis();
    if (ahora - g_ultimo_anuncio_ms >= kPeriodoAnuncioMs) {
      g_ultimo_anuncio_ms = ahora;
      anunciar();
    }
    return;
  }
  g_puerta.atender_notificacion(g_stack);
}

void evento_borrar(ble_npl_event*) {
  g_borrar_pedido.store(false);
  if (g_puerta.atender_borrado(g_stack)) {
    Serial.println("Vínculos borrados; sesión revocada hasta desconectar");
  } else {
    Serial.println("Borrado de vínculos falló; BLE bloqueado. Repite la pulsación de borrado");
  }
}

// Desde el loop (cualquier tarea): encola el evento en el hilo del host.
void pedir_en_el_host(ble_npl_event* evento, std::atomic<bool>& pedido) {
  if (!pedido.exchange(true)) ble_npl_eventq_put(nimble_port_get_dflt_eventq(), evento);
}

// --- UART del radar -------------------------------------------------------------------

// Adaptador de Serial1 para enlace_radar.h.
class UartArduino : public radar::PuertoUart {
 public:
  uint32_t ahora() override { return millis(); }
  int disponibles() override { return Serial1.available(); }
  int leer() override { return Serial1.read(); }
  size_t escribibles() override {
    const int n = Serial1.availableForWrite();
    return n > 0 ? static_cast<size_t>(n) : 0;
  }
  size_t escribir(const uint8_t* datos, size_t n) override { return Serial1.write(datos, n); }
  bool perdida_del_controlador() override { return g_perdida_uart.exchange(false); }
};
UartArduino g_uart;

// Lee la UART, entrega los bytes al intérprete y envía su orden pendiente; luego
// vigila la salud para reiniciar su configuración si hace falta. Se ejecuta en
// cada ciclo, haya o no cliente BLE, esté o no autorizado: el radar sigue
// adquiriendo y diagnosticándose sin suscripción y sin BLE. Con el cerrojo
// tomado. Las reglas (qué se descarta, cuándo se reinicia) están en
// enlace_radar.h y las ejecutan las pruebas del portátil.
void atender_radar() {
  if (!kRadarHabilitado) return;
  radar::atender_uart(g_radar, g_uart, g_uart_estado);
  if (g_supervisor.vigilar(g_radar, g_uart)) {
    Serial.println("Radar: sin latido o configuración fallida; se recupera el radar");
  }
}

void iniciar_radar() {
#if defined(VISIONARIA_PIN_RADAR_RX)
  Serial1.begin(kBaudios, SERIAL_8N1, VISIONARIA_PIN_RADAR_RX, VISIONARIA_PIN_RADAR_TX);
  // Un desborde del controlador de la UART avisa a la lectura: lo perdido no se une con lo siguiente.
  Serial1.onReceiveError([](hardwareSerial_error_t) { g_perdida_uart.store(true); });
  // Nada que haya quedado en el búfer antes de arrancar vale como observación.
  while (Serial1.available() > 0) Serial1.read();
  g_perdida_uart.store(false);
  g_radar.reiniciar();  // el arranque guarda la configuración (una vez); las recuperaciones, no, si ya está guardada
#endif
}

// --- GATT nativo --------------------------------------------------------------------------

ble_uuid128_t g_uuid_servicio;
ble_uuid128_t g_uuid_informacion;
ble_uuid128_t g_uuid_medicion;
ble_gatt_chr_def g_caracteristicas[3];
ble_gatt_svc_def g_servicios[2];

void fijar_uuid(ble_uuid128_t* destino, const char* texto) {
  destino->u.type = BLE_UUID_TYPE_128;
  const puerta::Uuid128 u = puerta::uuid128_le(texto);
  memcpy(destino->value, u.le, sizeof(destino->value));
}

int escribir_en_respuesta(os_mbuf* om, const uint8_t* trama) {
  return os_mbuf_append(om, trama, ble::kLongitudTrama) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

// Información: 20 bytes inmutables desde el arranque. Los permisos de la
// característica exigen enlace cifrado y autenticado.
int acceso_informacion(uint16_t, uint16_t, ble_gatt_access_ctxt* ctxt, void*) {
  if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) return BLE_ATT_ERR_UNLIKELY;
  return escribir_en_respuesta(ctxt->om, g_puerta.trama_informacion());
}

// Medición: NimBLE llama aquí en CADA lectura (simple, larga, de varias
// características); no hay otro camino ni valor guardado. Cada llamada genera una
// trama nueva para la conexión actual, con el enlace protegido consultado en vivo.
int acceso_medicion(uint16_t conexion, uint16_t, ble_gatt_access_ctxt* ctxt, void*) {
  if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR || conexion == BLE_HS_CONN_HANDLE_NONE) return BLE_ATT_ERR_UNLIKELY;
  enlace::EstadoSeguridad vivo;
  const bool hay = estado_en_vivo(conexion, &vivo);
  uint8_t trama[ble::kLongitudTrama];
  int rc;
  {
    Cerrojo c;
    rc = g_puerta.leer_medicion(conexion, hay, vivo, millis(), trama);
    if (rc == puerta::kAttOk) ++g_lecturas;
  }
  if (rc != puerta::kAttOk) return rc;
  return escribir_en_respuesta(ctxt->om, trama);
}

bool registrar_gatt() {
  fijar_uuid(&g_uuid_servicio, kUuidServicio);
  fijar_uuid(&g_uuid_informacion, kUuidInformacion);
  fijar_uuid(&g_uuid_medicion, kUuidMedicion);
  memset(g_caracteristicas, 0, sizeof(g_caracteristicas));
  memset(g_servicios, 0, sizeof(g_servicios));

  // Lectura solo con enlace cifrado y autenticado (MITM) y clave de 16 bytes. No
  // hay escritura alguna: la única es el CCCD, que NimBLE añade por ser Notify, y
  // también exige enlace cifrado y autenticado.
  const ble_gatt_chr_flags lectura_protegida = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC | BLE_GATT_CHR_F_READ_AUTHEN;
  g_caracteristicas[0].uuid = &g_uuid_informacion.u;
  g_caracteristicas[0].access_cb = acceso_informacion;
  g_caracteristicas[0].flags = lectura_protegida;
  g_caracteristicas[0].min_key_size = enlace::kTamanoClaveMinimo;
  g_caracteristicas[1].uuid = &g_uuid_medicion.u;
  g_caracteristicas[1].access_cb = acceso_medicion;
  g_caracteristicas[1].flags = lectura_protegida | BLE_GATT_CHR_F_NOTIFY | BLE_GATT_CHR_F_NOTIFY_INDICATE_ENC |
                               BLE_GATT_CHR_F_NOTIFY_INDICATE_AUTHEN;
  g_caracteristicas[1].min_key_size = enlace::kTamanoClaveMinimo;
  g_caracteristicas[1].val_handle = &g_val_medicion;
  // g_caracteristicas[2] queda a cero: fin de la lista.

  g_servicios[0].type = BLE_GATT_SVC_TYPE_PRIMARY;
  g_servicios[0].uuid = &g_uuid_servicio.u;
  g_servicios[0].characteristics = g_caracteristicas;
  // g_servicios[1] queda a cero: fin de la lista.

  ble_gatts_reset();
  ble_svc_gap_init();
  ble_svc_gatt_init();
  if (ble_gatts_count_cfg(g_servicios) != 0 || ble_gatts_add_svcs(g_servicios) != 0 || ble_gatts_start() != 0) return false;
  // ble_svc_gap_init() restablece el nombre: se fija después de iniciar el GATT.
  return ble_svc_gap_device_name_set(kNombre) == 0;
}

// --- Vínculos ------------------------------------------------------------------------------

ble_store_write_fn* g_escribir_original = nullptr;

// Compuerta del almacén de vínculos: lo que el stack negocie, solo se persiste si
// está autenticado, es LESC, de 16 bytes y de un emparejamiento autorizado por la
// alta física de ESTA conexión que nadie revocó (PuertaBle::persistir_vinculo).
// Va ANTES de la flash. No toma el cerrojo de la aplicación: puede correr con locks
// del stack tomados y el loop llama al stack con el cerrojo suelto, no al revés.
int escribir_vinculo(int tipo, const union ble_store_value* valor) {
  const bool clave = tipo == BLE_STORE_OBJ_TYPE_OUR_SEC || tipo == BLE_STORE_OBJ_TYPE_PEER_SEC;
  // La revocación también veta escrituras del CCCD y del resto del almacén.
  if (!g_puerta.persistir_vinculo(tipo, clave && valor->sec.authenticated, clave && valor->sec.sc,
                                clave ? valor->sec.key_size : 0)) {
    ++g_vinculos_rechazados;
    return BLE_HS_EREJECT;
  }
  return g_escribir_original(tipo, valor);
}

// --- Eventos GAP (hilo del stack) ------------------------------------------------------------

// Todo enlace VIVO tiene sesión, y con ella el corte de gracia. En este núcleo
// (ESP-IDF 5.5.5, CONFIG_BT_NIMBLE_ENABLE_CONN_REATTEMPT=y) el stack entrega
// BLE_GAP_EVENT_CONNECT cuando termina la lectura de funciones remotas del par
// (ble_gap_rx_rd_rem_sup_feat_complete), no al crearse el enlace, y con el status
// CRUDO de esa lectura, no el del enlace: 26 (0x1A, función remota no soportada;
// el portátil) en un enlace vivo, 22 o 19 (0x16 y 0x13, el enlace terminó antes)
// en uno que ya no existe. Por eso ni el status ni el orden dicen si hay enlace:
// lo dice ble_gap_conn_find(). Un fallo de conexión de verdad llega sin manejador
// y no crea sesión. CONNECT puede llegar DESPUÉS de ENC_CHANGE, de la petición de
// clave o de la suscripción: esos eventos también registran el enlace
// (PuertaBle::al_conectar no reinicia lo ya registrado). Sin el cerrojo.
void registrar_enlace(uint16_t conexion) {
  ble_gap_conn_desc d;
  const bool viva = ble_gap_conn_find(conexion, &d) == 0;
  puerta::Registro r;
  {
    Cerrojo c;
    r = g_puerta.registrar_enlace(conexion, viva, millis());
  }
  if (r == puerta::Registro::Nuevo) {
    Serial.println("BLE: conexión nueva; sesión limpia, sin suscripción ni datos previos");
  } else if (r == puerta::Registro::Rechazado) {
    Serial.println("BLE: segundo cliente rechazado; un solo cliente a la vez");
    cortar(conexion);
  }
}

int evento_gap(ble_gap_event* ev, void*) {
  switch (ev->type) {
    case BLE_GAP_EVENT_CONNECT: {
      if (ev->connect.status != 0) {
        Serial.printf("BLE: CONNECT con status %d (lectura de funciones remotas del par); se comprueba el enlace\n",
                      ev->connect.status);
      }
      registrar_enlace(ev->connect.conn_handle);
      return 0;
    }

    case BLE_GAP_EVENT_DISCONNECT: {
      Cerrojo c;
      if (g_puerta.al_desconectar(ev->disconnect.conn.conn_handle)) Serial.println("BLE: conexión terminada");
      return 0;
    }

    case BLE_GAP_EVENT_ENC_CHANGE: {
      const uint16_t conexion = ev->enc_change.conn_handle;
      registrar_enlace(conexion);
      enlace::EstadoSeguridad s;
      const bool hay = estado_en_vivo(conexion, &s);
      puerta::AccionGap accion;
      {
        Cerrojo c;
        accion = g_puerta.al_cambiar_cifrado(conexion, hay ? ev->enc_change.status : -1, s);
      }
      if (accion == puerta::AccionGap::Cortar) {
        Serial.println("BLE: enlace sin protección suficiente; se corta");
        cortar(conexion);
      } else {
        Serial.println("BLE: enlace cifrado, autenticado y vinculado");
      }
      return 0;
    }

    case BLE_GAP_EVENT_SUBSCRIBE: {
      if (ev->subscribe.attr_handle != g_val_medicion) return 0;
      enlace::EstadoSeguridad s;
      const uint16_t conexion = ev->subscribe.conn_handle;
      registrar_enlace(conexion);
      const bool hay = estado_en_vivo(conexion, &s);
      Cerrojo c;
      // Suscribir sin cifrado, autenticación y vínculo no sirve: se ignora y la
      // gracia de seguridad corta la conexión (contrato §5.1).
      if (!hay) return 0;
      if (g_puerta.al_suscribir(conexion, ev->subscribe.cur_notify != 0, s)) {
        Serial.println(ev->subscribe.cur_notify ? "BLE: suscrito a Medición" : "BLE: suscripción retirada");
      }
      return 0;
    }

    case BLE_GAP_EVENT_PASSKEY_ACTION: {
      const uint16_t conexion = ev->passkey.conn_handle;
      registrar_enlace(conexion);
      uint32_t clave = 0;
      puerta::AccionClave accion;
      {
        Cerrojo c;
        accion = g_puerta.al_pedir_clave(ev->passkey.params.action, conexion, millis(), &clave);
      }
      if (accion == puerta::AccionClave::Inyectar) {
        ble_sm_io io;
        memset(&io, 0, sizeof(io));
        io.action = BLE_SM_IOACT_DISP;
        io.passkey = clave;
        const int rc = ble_sm_inject_io(conexion, &io);
        clave = 0;
        io.passkey = 0;
        if (rc != 0) cortar(conexion);
      } else {
        Serial.println("BLE: emparejamiento rechazado (sin ventana de alta o acción no admitida)");
        cortar(conexion);
      }
      return 0;
    }

    case BLE_GAP_EVENT_REPEAT_PAIRING: {
      // Un par vinculado quiere emparejar de nuevo. Solo con la ventana de alta
      // abierta se sustituye su vínculo; fuera de ella se conserva y se corta.
      const uint16_t conexion = ev->repeat_pairing.conn_handle;
      bool permitir;
      {
        Cerrojo c;
        permitir = g_puerta.reemparejar_permitido(millis());
      }
      ble_gap_conn_desc d;
      if (!permitir || ble_gap_conn_find(conexion, &d) != 0) {
        Serial.println("BLE: re-emparejamiento rechazado; el vínculo se conserva");
        cortar(conexion);
        return BLE_GAP_REPEAT_PAIRING_IGNORE;
      }
      ble_store_util_delete_peer(&d.peer_id_addr);
      return BLE_GAP_REPEAT_PAIRING_RETRY;
    }

    default:
      return 0;
  }
}

// Anuncio del servicio. Se llama sin el cerrojo.
void anunciar() {
  if (ble_gap_adv_active()) return;
  ble_hs_adv_fields campos;
  memset(&campos, 0, sizeof(campos));
  campos.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
  campos.uuids128 = &g_uuid_servicio;
  campos.num_uuids128 = 1;
  campos.uuids128_is_complete = 1;
  ble_hs_adv_fields respuesta;
  memset(&respuesta, 0, sizeof(respuesta));
  respuesta.name = reinterpret_cast<const uint8_t*>(kNombre);
  respuesta.name_len = static_cast<uint8_t>(strlen(kNombre));
  respuesta.name_is_complete = 1;
  if (ble_gap_adv_set_fields(&campos) != 0 || ble_gap_adv_rsp_set_fields(&respuesta) != 0) return;
  ble_gap_adv_params parametros;
  memset(&parametros, 0, sizeof(parametros));
  parametros.conn_mode = BLE_GAP_CONN_MODE_UND;
  parametros.disc_mode = BLE_GAP_DISC_MODE_GEN;
  // Siempre la dirección PÚBLICA (la MAC de fábrica del chip): es la que el iPhone
  // guarda con el vínculo y la única estable. BLEDevice::init() deja además una
  // dirección aleatoria nueva en cada arranque (ble_hs_util_ensure_addr), y
  // ble_hs_id_infer_auto() la prefiere: con ella el vínculo de iOS no sobrevive a
  // un reinicio de la placa. Sin dirección pública no hay anuncio, y se dice.
  const int rc = ble_gap_adv_start(BLE_OWN_ADDR_PUBLIC, nullptr, BLE_HS_FOREVER, &parametros, evento_gap, nullptr);
  static int ultimo_rc = 0;
  if (rc != ultimo_rc) {
    ultimo_rc = rc;
    if (rc != 0) Serial.printf("BLE: no se pudo anunciar con la dirección pública (rc=%d)\n", rc);
  }
}

// --- Arranque del BLE --------------------------------------------------------------

bool iniciar_ble() {
  // Identificador de arranque aleatorio y distinto del anterior (el anterior se
  // guarda en NVS). Si la fuente no lo logra, no se arranca el BLE.
  Preferences prefs;
  prefs.begin("visionaria", false);
  const uint32_t anterior = prefs.getUInt("arranque", 0);
  uint32_t id = 0;
  if (!enlace::elegir_id_arranque(anterior, aleatorio, nullptr, &id)) {
    prefs.end();
    Serial.println("BLE: sin identificador de arranque; no se inicia");
    return false;
  }
  prefs.putUInt("arranque", id);
  prefs.end();

  const uint16_t minima = kRadarHabilitado ? g_radar.ventana_minima_mm() : 0;
  const uint16_t maxima = kRadarHabilitado ? g_radar.ventana_maxima_mm() : 3000;
  if (!enlace::informacion_sen0395(id, minima, maxima, &g_info) || !g_puerta.iniciar(g_info)) {
    Serial.println("BLE: Información inválida; no se inicia");
    return false;
  }

  // La biblioteca solo arranca el stack. Desde aquí, todo es nativo.
  if (!BLEDevice::init(kNombre)) return false;

  // Seguridad: emparejamiento seguro (LESC) con MITM por clave mostrada (IO
  // solo-pantalla) y vínculo. La clave solo se entrega con la ventana de alta
  // abierta (puerta_ble.h); con ella cerrada, además, se declaran datos OOB para
  // que el stack no negocie Just Works. Lo que se negocie igualmente solo se
  // persiste si está autenticado (escribir_vinculo) y se corta si no protege
  // (BLE_GAP_EVENT_ENC_CHANGE).
  ble_hs_cfg.sm_io_cap = BLE_HS_IO_DISPLAY_ONLY;
  ble_hs_cfg.sm_bonding = 1;
  ble_hs_cfg.sm_mitm = 1;
  ble_hs_cfg.sm_sc = 1;
  ble_hs_cfg.sm_sc_only = 1;
  ble_hs_cfg.sm_oob_data_flag = 1;  // ventana cerrada hasta que el botón la abra
  ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  g_escribir_original = ble_hs_cfg.store_write_cb;
  if (g_escribir_original == nullptr) {
    Serial.println("BLE: sin almacén de vínculos; no se inicia");
    return false;
  }
  ble_hs_cfg.store_write_cb = escribir_vinculo;

  ble_npl_event_init(&g_evento_notificar, evento_notificar, nullptr);
  ble_npl_event_init(&g_evento_borrar, evento_borrar, nullptr);

  if (!registrar_gatt()) {
    Serial.println("BLE: no se pudo registrar el servicio; no se inicia");
    return false;
  }
  anunciar();

  Serial.printf("BLE: %s listo, contrato %u.%u, firmware %u.%u.%u, arranque %08lx\n", kNombre, g_info.version_mayor,
                g_info.version_menor, g_info.firmware_mayor, g_info.firmware_menor, g_info.firmware_revision,
                static_cast<unsigned long>(id));
  return true;
}

// --- Ciclo BLE (loop) -------------------------------------------------------------------------

// Decide con el cerrojo y actúa sin él.
void ciclo_ble() {
  enlace::AccionBoton boton = enlace::AccionBoton::Ninguna;
  enlace::Transicion transicion = enlace::Transicion::SinCambio;
  {
    Cerrojo c;
    const uint32_t ahora = millis();
#if defined(VISIONARIA_PIN_BOTON)
    boton = g_boton.muestrear(digitalRead(VISIONARIA_PIN_BOTON) == LOW, ahora);
#endif
    if (boton == enlace::AccionBoton::AbrirAlta) {
      g_puerta.ventana().abrir(ahora);
    } else if (boton == enlace::AccionBoton::BorrarVinculos) {
      // Revoca YA (ventana, autorización de emparejar, sesión); el hilo del host
      // corta y vacía el almacén después, y lo que un emparejamiento en vuelo
      // intente escribir mientras tanto o después se rechaza.
      g_puerta.revocar_sesion();
    }
    transicion = g_puerta.actualizar_ventana(ahora);
  }

  if (boton == enlace::AccionBoton::AbrirAlta) Serial.println("Alta: ventana abierta 60 s");
  if (transicion == enlace::Transicion::Cerro) Serial.println("Alta: ventana cerrada");
  if (boton == enlace::AccionBoton::BorrarVinculos) {
    Serial.println("Borrado de vínculos pedido; ventana de alta cerrada, sesión revocada");
    pedir_en_el_host(&g_evento_borrar, g_borrar_pedido);
  }
  // También sin conexión: abrir o cerrar la ventana actualiza SMP en el hilo del host.
  pedir_en_el_host(&g_evento_notificar, g_notificar_pedido);
}

void imprimir_estado(uint32_t ahora) {
  if (ahora - g_ultimo_estado_ms < kPeriodoEstadoMs) return;
  g_ultimo_estado_ms = ahora;
  Serial.printf("estado t=%lu radar=%s salud=%u fase=%u conectada=%d suscrita=%d alta=%lu notif=%lu lecturas=%lu rechazados=%lu\n",
                static_cast<unsigned long>(ahora), kSimulacion ? "simulado" : (kRadarHabilitado ? "real" : "sin-pines"),
                kSimulacion ? 0 : (kRadarHabilitado ? g_radar.salud(ahora) : 6),
                kRadarHabilitado ? static_cast<unsigned>(g_radar.fase()) : 0u, g_puerta.sesion().conectada(),
                g_puerta.sesion().suscrita(), static_cast<unsigned long>(g_puerta.ventana().restante_ms(ahora)),
                static_cast<unsigned long>(g_notificaciones.load()), static_cast<unsigned long>(g_lecturas),
                static_cast<unsigned long>(g_vinculos_rechazados.load()));
  if (kRadarHabilitado) {
    const sen0395::Contadores& k = g_radar.contadores();
    Serial.printf("uart validas=%lu parciales=%lu largas=%lu otras=%lu ignoradas=%lu errores=%lu timeouts=%lu descartados=%lu perdidas=%lu reintentos=%lu\n",
                  static_cast<unsigned long>(k.tramas_validas), static_cast<unsigned long>(k.invalidas_parciales),
                  static_cast<unsigned long>(k.invalidas_largas), static_cast<unsigned long>(k.invalidas_otras),
                  static_cast<unsigned long>(k.lineas_ignoradas), static_cast<unsigned long>(k.errores_radar),
                  static_cast<unsigned long>(k.timeouts_orden), static_cast<unsigned long>(g_uart_estado.bytes_descartados),
                  static_cast<unsigned long>(g_uart_estado.perdidas), static_cast<unsigned long>(g_supervisor.reintentos()));
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  g_cerrojo = xSemaphoreCreateRecursiveMutex();
  Serial.printf("Accesorio Visionaria, firmware %u.%u.%u, contrato %u.%u, modo %s\n", enlace::kFirmwareMayor,
                enlace::kFirmwareMenor, enlace::kFirmwareRevision, ble::kVersionMayor, ble::kVersionMenor,
                kSimulacion ? "SIMULACIÓN" : "real");
  if (!kRadarHabilitado && !kSimulacion) {
    Serial.println("Radar: sin pines seleccionados; no se abre la UART y se publica salud 6");
  }
  if (!kBotonHabilitado) {
    Serial.println("Botón: sin pin seleccionado; la ventana de alta no puede abrirse");
  } else {
#if defined(VISIONARIA_PIN_BOTON)
    pinMode(VISIONARIA_PIN_BOTON, INPUT_PULLUP);
#endif
  }
  iniciar_radar();  // el diagnóstico de la UART no depende del BLE ni de su autorización
  if (!kClaveProvisionada) {
    // Falla cerrado: sin clave no hay emparejamiento seguro posible.
    Serial.println("BLE: sin clave provisionada (configuracion_local.h); no se inicia. Ver firmware/README.md");
    return;
  }
  Cerrojo c;
  g_ble_activo = iniciar_ble();
}

void loop() {
  delay(kPeriodoCicloMs);
  {
    Cerrojo c;
    atender_radar();
  }
  if (g_ble_activo) ciclo_ble();
  Cerrojo c;
  imprimir_estado(millis());
}

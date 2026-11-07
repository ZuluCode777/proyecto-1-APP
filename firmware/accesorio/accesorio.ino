// Accesorio de proximidad Visionaria: ESP32-S3 + radar SEN0395 + BLE (EA-12).
//
// Une los módulos portátiles (trama_ble, emisor_sintetico, sen0395,
// enlace_accesorio) con el hardware. Contrato: docs/expoandes/contrato-ble.md
// (v1.0). Diseño, seguridad y límites: docs/expoandes/ea-12-ble.md.
//
// Nada de hardware se habilita sin una selección humana: los pines y la clave
// salen de macros que fija quien prepara el accesorio (configuracion_local.h,
// ignorado por Git, o banderas de compilación). Sin ellos no hay UART, ni alta,
// ni BLE. Ningún pin de este repositorio está probado en la placa.
//
// Núcleo Arduino de Espressif con NimBLE (esp32:esp32 3.3.12, placa esp32s3).

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLESecurity.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Preferences.h>
#include <esp_random.h>
#include <host/ble_store.h>

#include "emisor_sintetico.h"
#include "enlace_accesorio.h"
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

constexpr uint32_t kBaudios = sen0395::kBaudios;
constexpr uint32_t kPeriodoCicloMs = 2;
constexpr uint32_t kPeriodoEstadoMs = 5000;

// --- Estado compartido (lo tocan loop() y las tareas del stack BLE) ---------------
// Todo lo de este bloque se protege con g_cerrojo. millis() se lee DENTRO del
// cerrojo para que el reloj que ve el intérprete nunca decrezca.

SemaphoreHandle_t g_cerrojo = nullptr;

struct Cerrojo {
  Cerrojo() { xSemaphoreTake(g_cerrojo, portMAX_DELAY); }
  ~Cerrojo() { xSemaphoreGive(g_cerrojo); }
  Cerrojo(const Cerrojo&) = delete;
  Cerrojo& operator=(const Cerrojo&) = delete;
};

sen0395::Interprete g_radar;
ble::Informacion g_info;
// Hasta iniciar_ble() lleva una Información inválida: generar() falla y no sale ninguna trama.
ble::EmisorSintetico g_emisor{ble::Informacion(), kSimulacion};
enlace::SesionEnlace g_sesion;
enlace::VentanaAlta g_ventana;
enlace::Boton g_boton;

BLEServer* g_servidor = nullptr;
BLECharacteristic* g_medicion = nullptr;
bool g_ble_activo = false;

uint32_t g_bytes_descartados = 0;

uint32_t g_notificaciones = 0;
uint32_t g_lecturas = 0;
uint32_t g_ultimo_estado_ms = 0;

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

// Lectura en vivo del stack: el enlace sigue cifrado, autenticado y vinculado.
bool enlace_protegido_en_vivo(uint16_t conexion) {
  ble_gap_conn_desc d;
  return ble_gap_conn_find(conexion, &d) == 0 && enlace::seguridad_suficiente(estado_de(&d));
}

void cortar(uint16_t conexion) {
  if (g_servidor != nullptr) g_servidor->disconnect(conexion);
}

// Con el alta cerrada, el emparejamiento falla porque la clave que usa el stack
// es aleatoria y nadie la conoce; con el alta abierta es la clave provisionada.
void aplicar_clave_alta(bool abierta) {
  if (abierta) {
    BLESecurity::setPassKey(true, kClave);
    return;
  }
  uint32_t cerrada;
  do {
    cerrada = esp_random() % (enlace::kClaveMaxima + 1);
  } while (cerrada == kClave || cerrada == 0);
  BLESecurity::setPassKey(true, cerrada);
}

// Presencia del radar para esta lectura. La edad es la real de la UART: ni se
// rejuvenece al consultarla ni se conserva de otra conexión.
ble::EntradaRadar fuente(uint32_t ahora) {
  if (kSimulacion) return enlace::entrada_simulada(ahora);
  if (kRadarHabilitado) return g_radar.entrada(ahora);
  return enlace::entrada_montaje_no_validado();
}

// Genera una trama NUEVA (secuencia e instante propios) para una lectura o una
// notificación. Llamar con el cerrojo tomado y `ahora` leído dentro de él.
bool generar_medicion(uint32_t ahora, uint8_t trama[ble::kLongitudTrama]) {
  const ble::EntradaRadar e = enlace::entrada_para_sesion(fuente(ahora), g_sesion.t_conexion_ms(), ahora);
  return g_emisor.generar(ahora, e, trama) == ble::Error::Ninguno;
}

// --- Callbacks del stack -----------------------------------------------------------

class CallbacksServidor : public BLEServerCallbacks {
  void onConnect(BLEServer*, ble_gap_conn_desc* d) override {
    Cerrojo c;
    g_sesion.conectar(d->conn_handle, millis());
    Serial.println("BLE: conexión nueva; sesión limpia, sin suscripción ni datos previos");
  }
  void onDisconnect(BLEServer*, ble_gap_conn_desc*) override {
    Cerrojo c;
    g_sesion.desconectar();
    Serial.println("BLE: conexión terminada");
  }
};

class CallbacksMedicion : public BLECharacteristicCallbacks {
  // Toda lectura genera una trama fresca: nunca se devuelve la última notificada.
  void onRead(BLECharacteristic* ch, ble_gap_conn_desc* d) override {
    Cerrojo c;
    uint8_t trama[ble::kLongitudTrama];
    if (g_sesion.conectada() && d->conn_handle == g_sesion.id_conexion() && generar_medicion(millis(), trama)) {
      ch->setValue(trama, ble::kLongitudTrama);
      ++g_lecturas;
    } else {
      ch->setValue(trama, 0);  // longitud 0: el cliente la rechaza; falla cerrado
    }
  }
  // La única escritura posible es el CCCD, que el stack entrega aquí como suscripción
  // (también la que restaura de un vínculo al reconectar).
  void onSubscribe(BLECharacteristic*, ble_gap_conn_desc* d, uint16_t valor) override {
    Cerrojo c;
    if (!g_sesion.conectada() || d->conn_handle != g_sesion.id_conexion()) return;
    const bool protegida = enlace::seguridad_suficiente(estado_de(d));
    g_sesion.marcar_protegida(protegida);
    if (!protegida) {
      // Suscribir sin cifrado, autenticación y vínculo no sirve: se ignora y la
      // gracia de seguridad corta la conexión. El cliente debe leer Información
      // (que fuerza el emparejamiento) antes de suscribirse (contrato §5.1).
      Serial.println("BLE: suscripción ignorada, enlace sin proteger");
      return;
    }
    if (g_sesion.fijar_suscripcion((valor & 1) != 0)) {
      Serial.println((valor & 1) ? "BLE: suscrito a Medición" : "BLE: suscripción retirada");
    }
  }
};

class CallbacksSeguridad : public BLESecurityCallbacks {
  void onAuthenticationComplete(ble_gap_conn_desc* d, int estado) override {
    Cerrojo c;
    const bool ok = estado == 0 && enlace::seguridad_suficiente(estado_de(d));
    if (g_sesion.conectada() && d->conn_handle == g_sesion.id_conexion()) g_sesion.marcar_protegida(ok);
    if (ok) {
      g_ventana.cerrar();  // un alta, un emparejamiento
      Serial.println("BLE: enlace cifrado, autenticado y vinculado");
    } else {
      Serial.println("BLE: enlace sin protección suficiente; se corta");
      cortar(d->conn_handle);
    }
  }
  bool onSecurityRequest() override {
    Cerrojo c;
    return g_ventana.abierta(millis());
  }
  // No se usa la comparación numérica ni la entrada de clave: IO solo-pantalla.
  bool onConfirmPIN(uint32_t) override { return false; }
  uint32_t onPassKeyRequest() override { return esp_random() % (enlace::kClaveMaxima + 1); }
};

CallbacksServidor g_cb_servidor;
CallbacksMedicion g_cb_medicion;
CallbacksSeguridad g_cb_seguridad;

// --- Arranque del BLE --------------------------------------------------------------

bool iniciar_ble() {
  BLEDevice::init(kNombre);

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
  if (!enlace::informacion_sen0395(id, minima, maxima, &g_info)) {
    Serial.println("BLE: Información inválida; no se inicia");
    return false;
  }
  g_emisor = ble::EmisorSintetico(g_info, kSimulacion);

  // Seguridad en el stack: emparejamiento seguro (LESC) con MITM por clave
  // mostrada (IO solo-pantalla; nunca Just Works) y vínculo. El alta cierra la
  // clave real: con la ventana cerrada el stack usa una aleatoria.
  BLESecurity::setCapability(ESP_IO_CAP_OUT);
  BLESecurity::setAuthenticationMode(true, true, true);
  BLESecurity::setInitEncryptionKey();
  BLESecurity::setRespEncryptionKey();
  ble_hs_cfg.sm_sc_only = 1;
  aplicar_clave_alta(false);
  BLEDevice::setSecurityCallbacks(&g_cb_seguridad);

  g_servidor = BLEDevice::createServer();
  g_servidor->setCallbacks(&g_cb_servidor);
  BLEService* servicio = g_servidor->createService(kUuidServicio);

  // Lectura solo con enlace cifrado y autenticado (MITM). No hay escritura
  // alguna: la única es el CCCD, que genera el stack por ser Notify.
  const uint32_t lectura_protegida =
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_ENC | BLECharacteristic::PROPERTY_READ_AUTHEN;
  BLECharacteristic* informacion = servicio->createCharacteristic(kUuidInformacion, lectura_protegida);
  uint8_t trama[ble::kLongitudTrama];
  if (ble::codificar_informacion(g_info, trama) != ble::Error::Ninguno) return false;
  informacion->setValue(trama, ble::kLongitudTrama);

  g_medicion = servicio->createCharacteristic(kUuidMedicion, lectura_protegida | BLECharacteristic::PROPERTY_NOTIFY);
  g_medicion->setCallbacks(&g_cb_medicion);

  servicio->start();
  BLEAdvertising* anuncio = BLEDevice::getAdvertising();
  anuncio->addServiceUUID(kUuidServicio);
  anuncio->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.printf("BLE: %s listo, contrato %u.%u, firmware %u.%u.%u, arranque %08lx\n", kNombre, g_info.version_mayor,
                g_info.version_menor, g_info.firmware_mayor, g_info.firmware_menor, g_info.firmware_revision,
                static_cast<unsigned long>(id));
  return true;
}

// --- Radar --------------------------------------------------------------------------

// Lee la UART, entrega los bytes al intérprete y envía su orden pendiente. Se
// ejecuta en cada ciclo, haya o no cliente BLE, esté o no autorizado: el radar
// sigue adquiriendo y diagnosticándose sin suscripción y sin BLE. Con el
// cerrojo tomado.
//
// Los bytes se fechan al leerlos. Si en la UART esperan más que un trozo
// (kMaxBytesPorLlamada), lo que sobra es un retraso de más de un ciclo y no
// se puede fechar con verdad: se descarta entero en vez de entregarlo como si
// fuera reciente. Perder esas tramas es seguro (llegan otras en ~1 s; a lo
// sumo queda una línea partida que se cuenta como inválida); rejuvenecerlas no.
void atender_radar() {
  if (!kRadarHabilitado) return;
  uint8_t bytes[sen0395::kMaxBytesPorLlamada];
  size_t n = 0;
  while (n < sizeof(bytes) && Serial1.available() > 0) {
    const int b = Serial1.read();
    if (b < 0) break;
    bytes[n++] = static_cast<uint8_t>(b);
  }
  if (Serial1.available() > 0) {
    // Hay más de un trozo esperando: nada de esto se entrega.
    while (Serial1.read() >= 0) ++g_bytes_descartados;
    g_bytes_descartados += n;
    n = 0;
  }
  g_radar.procesar(bytes, n, millis());  // también con n == 0: marca la lectura
  uint8_t orden[sen0395::kLongitudOrdenMax];
  const size_t largo = g_radar.salida_pendiente(orden, sizeof(orden));
  if (largo > 0 && static_cast<size_t>(Serial1.availableForWrite()) >= largo && Serial1.write(orden, largo) == largo) {
    g_radar.salida_enviada(millis());
  }
}

void iniciar_radar() {
#if defined(VISIONARIA_PIN_RADAR_RX)
  Serial1.begin(kBaudios, SERIAL_8N1, VISIONARIA_PIN_RADAR_RX, VISIONARIA_PIN_RADAR_TX);
  // Nada que haya quedado en el búfer antes de arrancar vale como observación.
  while (Serial1.available() > 0) Serial1.read();
  g_radar.reiniciar();
#endif
}

// --- Botón y ventana de alta ----------------------------------------------------------

void atender_boton_y_ventana(uint32_t ahora) {
  if (kBotonHabilitado) {
#if defined(VISIONARIA_PIN_BOTON)
    switch (g_boton.muestrear(digitalRead(VISIONARIA_PIN_BOTON) == LOW, ahora)) {
      case enlace::AccionBoton::AbrirAlta:
        g_ventana.abrir(ahora);
        Serial.println("Alta: ventana abierta 60 s");
        break;
      case enlace::AccionBoton::BorrarVinculos:
        g_ventana.cerrar();
        ble_store_clear();
        if (g_sesion.conectada()) cortar(g_sesion.id_conexion());
        Serial.println("Vínculos borrados; ventana de alta cerrada");
        break;
      case enlace::AccionBoton::Ninguna:
        break;
    }
#endif
  }
  switch (g_ventana.actualizar(ahora)) {
    case enlace::Transicion::Abrio:
      aplicar_clave_alta(true);
      break;
    case enlace::Transicion::Cerro:
      aplicar_clave_alta(false);
      Serial.println("Alta: ventana cerrada");
      break;
    case enlace::Transicion::SinCambio:
      break;
  }
}

// --- Notificaciones --------------------------------------------------------------------

void atender_notificaciones(uint32_t ahora) {
  if (!g_sesion.conectada()) {
    if (g_servidor->getConnectedCount() == 0 && !BLEDevice::getAdvertising()->isAdvertising()) {
      BLEDevice::startAdvertising();  // un solo cliente a la vez: se anuncia solo sin conexión
    }
    return;
  }
  if (g_sesion.vencio_gracia(ahora)) {
    Serial.println("BLE: enlace sin proteger pasado el plazo; se corta");
    cortar(g_sesion.id_conexion());
    return;
  }
  if (!g_sesion.suscrita() || !g_sesion.debe_notificar(ahora)) return;
  if (!enlace_protegido_en_vivo(g_sesion.id_conexion())) {
    g_sesion.marcar_protegida(false);
    cortar(g_sesion.id_conexion());
    return;
  }
  uint8_t trama[ble::kLongitudTrama];
  if (!generar_medicion(ahora, trama)) return;
  g_medicion->setValue(trama, ble::kLongitudTrama);
  g_medicion->notify();
  ++g_notificaciones;
}

void imprimir_estado(uint32_t ahora) {
  if (ahora - g_ultimo_estado_ms < kPeriodoEstadoMs) return;
  g_ultimo_estado_ms = ahora;
  Serial.printf("estado t=%lu radar=%s salud=%u fase=%u conectada=%d suscrita=%d alta=%lu notif=%lu lecturas=%lu\n",
                static_cast<unsigned long>(ahora), kSimulacion ? "simulado" : (kRadarHabilitado ? "real" : "sin-pines"),
                kSimulacion ? 0 : (kRadarHabilitado ? g_radar.salud(ahora) : 6),
                kRadarHabilitado ? static_cast<unsigned>(g_radar.fase()) : 0u, g_sesion.conectada(), g_sesion.suscrita(),
                static_cast<unsigned long>(g_ventana.restante_ms(ahora)), static_cast<unsigned long>(g_notificaciones),
                static_cast<unsigned long>(g_lecturas));
  if (kRadarHabilitado) {
    const sen0395::Contadores& k = g_radar.contadores();
    Serial.printf("uart validas=%lu parciales=%lu largas=%lu otras=%lu ignoradas=%lu errores=%lu timeouts=%lu descartados=%lu\n",
                  static_cast<unsigned long>(k.tramas_validas), static_cast<unsigned long>(k.invalidas_parciales),
                  static_cast<unsigned long>(k.invalidas_largas), static_cast<unsigned long>(k.invalidas_otras),
                  static_cast<unsigned long>(k.lineas_ignoradas), static_cast<unsigned long>(k.errores_radar),
                  static_cast<unsigned long>(k.timeouts_orden), static_cast<unsigned long>(g_bytes_descartados));
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  g_cerrojo = xSemaphoreCreateMutex();
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
  Cerrojo c;
  atender_radar();
  // Después de la UART: el reloj que ve el intérprete no debe decrecer.
  const uint32_t ahora = millis();
  if (g_ble_activo) {
    atender_boton_y_ventana(ahora);
    atender_notificaciones(ahora);
  }
  imprimir_estado(ahora);
}

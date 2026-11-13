// Lógica portátil de sesión, seguridad y alta del accesorio BLE (EA-12).
//
// Qué hace: ventana de alta de 60 s, gesto del botón, estado de la conexión y de
// la suscripción, ritmo acotado de notificaciones, regla "nada retenido" para
// una conexión nueva, selección de pines y validación de la clave provisionada.
//
// Qué NO hace: no habla con el stack BLE, la UART ni los GPIO, y no sustituye la
// protección del stack. La protección real (enlace cifrado y autenticado con
// MITM, permisos de las características, clave) la configura accesorio.ino en
// NimBLE; este módulo solo decide a partir de lo que el stack le informa.
//
// Portátil: sin Arduino.h, sin excepciones y sin memoria dinámica. El reloj es
// el monotónico del ESP32 en ms (uint32_t); todas las restas son módulo 2^32.
// Ver docs/expoandes/ea-12-ble.md.
#ifndef VISIONARIA_ENLACE_ACCESORIO_H
#define VISIONARIA_ENLACE_ACCESORIO_H

#include <stddef.h>
#include <stdint.h>

#include "emisor_sintetico.h"
#include "trama_ble.h"

namespace visionaria {
namespace enlace {

// Versión del firmware que se publica en Información (bytes 8, 9 y 10). La
// versión del contrato sigue siendo 1.0 (trama_ble.h).
constexpr uint8_t kFirmwareMayor = 0;
constexpr uint8_t kFirmwareMenor = 1;
constexpr uint8_t kFirmwareRevision = 0;

// Valores de diseño por confirmar en banco; ninguno está medido.
constexpr uint32_t kVentanaAltaMs = 60000;        // alta propuesta por el contrato (§6)
constexpr uint32_t kPeriodoNotificacionMs = 100;  // periodo nominal de Información
constexpr uint32_t kPulsacionAltaMs = 3000;       // pulsación para abrir el alta
constexpr uint32_t kPulsacionBorradoMs = 10000;   // pulsación para borrar vínculos
constexpr uint32_t kRebotesMs = 50;               // un soltado más corto no cuenta
constexpr uint32_t kGraciaSeguridadMs = 30000;    // plazo para proteger el enlace, desde la conexión
constexpr uint32_t kGraciaClaveMs = 30000;        // plazo desde que se muestra la clave (la persona la teclea)
constexpr uint32_t kGraciaMaximaMs = 60000;       // tope desde la conexión: ningún enlace sin proteger lo supera
static_assert(kGraciaSeguridadMs <= kGraciaMaximaMs && kGraciaClaveMs <= kGraciaMaximaMs, "la gracia base y la de la clave caben en el tope");

constexpr uint32_t kClaveMaxima = 999999;
constexpr uint8_t kTamanoClaveMinimo = 16;  // bytes de la clave de enlace (LESC)

// --- Clave provisionada -------------------------------------------------------
// Solo comprueba el formato (6 dígitos) y descarta valores triviales. No hace
// segura una clave: la clave la genera quien prepara el accesorio y no se
// versiona (configuracion_local.ejemplo.h).
constexpr bool clave_valida(uint32_t clave) {
  if (clave == 0 || clave > kClaveMaxima) return false;
  if (clave == 123456 || clave == 654321) return false;
  return clave % 111111 != 0;  // 111111, 222222, ..., 999999
}

// --- Pines --------------------------------------------------------------------
// Política de pines del plan de firmware (arranque, USB, consola y PSRAM
// octal), más los que no existen o ocupa la flash. Es una lista de exclusión
// sobre documentación del fabricante; no prueba que un pin concreto funcione en
// la placa recibida. Un pin permitido tampoco queda "probado".
constexpr bool pin_permitido(int pin) {
  if (pin < 0 || pin > 48) return false;
  if (pin == 0 || pin == 3 || pin == 45 || pin == 46) return false;  // arranque
  if (pin == 19 || pin == 20) return false;                          // USB
  if (pin == 43 || pin == 44) return false;                          // consola UART0
  if (pin >= 22 && pin <= 37) return false;                          // inexistentes, flash y PSRAM
  return true;
}
// El pulsador admite además GPIO0 (BOOT), que puede leerse después del arranque.
constexpr bool pin_boton_permitido(int pin) { return pin == 0 || pin_permitido(pin); }

// --- Identificador de arranque --------------------------------------------------
typedef uint32_t (*FuenteAleatoria)(void* contexto);
// Elige un identificador distinto de cero y del anterior. Devuelve false, sin
// tocar *id, si la fuente no lo logra en pocos intentos (por ejemplo, si
// devuelve siempre lo mismo); en ese caso el accesorio no debe arrancar el BLE.
bool elegir_id_arranque(uint32_t anterior, FuenteAleatoria fuente, void* contexto, uint32_t* id);

// --- Información del SEN0395 ------------------------------------------------------
// Capacidades 0 (sin distancia, azimut ni batería), perfil 1, periodo 100 ms y
// caducidad 500 ms. La ventana (mm) describe la zona de presencia configurada,
// no una distancia medida. Falso si el contrato rechaza la combinación.
bool informacion_sen0395(uint32_t id_arranque, uint16_t ventana_minima_mm,
                         uint16_t ventana_maxima_mm, ble::Informacion* info);

// --- Entradas de radar para el emisor ----------------------------------------------
// Montaje o configuración sin validar (salud 6): no hay selección humana de
// pines. Nunca equivale a "sin blanco".
ble::EntradaRadar entrada_montaje_no_validado();

// Nada retenido: una observación del radar vale para esta conexión solo si se
// recibió estrictamente después de conectar. Una más antigua, o de edad
// desconocida, sale como resultado vencido (sin blanco y sin vigencia), nunca
// como presencia. Un fallo se publica tal cual: la salud describe el estado
// actual, no un dato retenido. t_conexion_ms es el instante de la conexión.
ble::EntradaRadar entrada_para_sesion(const ble::EntradaRadar& entrada, uint32_t t_conexion_ms,
                                      uint32_t ahora_ms);

// Presencia sintética alterna cada 2 s con edad fija 20 ms. Solo para la
// compilación de simulación, que además publica el bit 5.
ble::EntradaRadar entrada_simulada(uint32_t ahora_ms);

// --- Ventana de alta ----------------------------------------------------------------
enum class Transicion : uint8_t { SinCambio, Abrio, Cerro };

class VentanaAlta {
 public:
  void abrir(uint32_t ahora_ms);
  void cerrar();
  // Cierra al cumplirse kVentanaAltaMs, también tras la vuelta del reloj (resta
  // módulo 2^32). Si el reloj retrocede, la resta es enorme y la ventana cierra:
  // falla cerrada. Llámala en cada ciclo y antes de decidir con ella.
  bool abierta(uint32_t ahora_ms);
  // Milisegundos que le quedan (0 si está cerrada).
  uint32_t restante_ms(uint32_t ahora_ms);
  // Dice si hay que aplicar al stack una apertura o un cierre desde la última
  // llamada; el llamador cambia la clave del stack solo en una transición.
  Transicion actualizar(uint32_t ahora_ms);

 private:
  bool abierta_ = false;
  bool aplicada_ = false;
  uint32_t inicio_ms_ = 0;
};

// --- Botón ------------------------------------------------------------------------
enum class AccionBoton : uint8_t { Ninguna, AbrirAlta, BorrarVinculos };

// La acción se decide AL SOLTAR, por lo que duró la pulsación: menos de
// kPulsacionAltaMs no hace nada; entre kPulsacionAltaMs y kPulsacionBorradoMs
// abre el alta; desde kPulsacionBorradoMs borra los vínculos. Un botón atascado
// no hace nada. Un soltado de menos de kRebotesMs se toma como rebote.
class Boton {
 public:
  AccionBoton muestrear(bool presionado, uint32_t ahora_ms);

 private:
  bool pulsado_ = false;
  bool suelto_pendiente_ = false;
  uint32_t t_inicio_ = 0;
  uint32_t t_suelto_ = 0;
};

// --- Seguridad del enlace -------------------------------------------------------------
// Estado del enlace según el stack (NimBLE: ble_gap_conn_desc.sec_state).
struct EstadoSeguridad {
  bool cifrado = false;
  bool autenticado = false;  // emparejamiento con protección MITM
  bool vinculado = false;
  uint8_t tamano_clave = 0;
};
// Cifrado, autenticación MITM, vínculo y clave de 16 bytes. Sin una de ellas, no.
bool seguridad_suficiente(const EstadoSeguridad& s);

// --- Sesión de una conexión ----------------------------------------------------------
// Una conexión, una sesión. conectar() borra todo lo de la anterior.
class SesionEnlace {
 public:
  void conectar(uint16_t id_conexion, uint32_t ahora_ms);
  void desconectar();
  bool conectada() const { return conectada_; }
  uint16_t id_conexion() const { return id_; }
  uint32_t t_conexion_ms() const { return t_conexion_; }

  // El stack informa si el enlace cumple seguridad_suficiente(). Perderla borra
  // la suscripción.
  void marcar_protegida(bool protegida);
  bool protegida() const { return conectada_ && protegida_; }

  // Escritura del CCCD (o suscripción restaurada por el stack). Es un booleano,
  // no un contador: suscribir dos veces no duplica nada. Sin enlace protegido
  // se rechaza y devuelve false sin cambios. Devuelve true si el estado cambió.
  bool fijar_suscripcion(bool notificaciones);
  bool suscrita() const { return conectada_ && protegida_ && suscrita_; }

  // true como máximo una vez por periodo: la primera tras suscribirse sale de
  // inmediato y cada envío fija el siguiente a ahora_ms + kPeriodoNotificacionMs,
  // así que dos envíos nunca quedan a menos de ese periodo. El ritmo real
  // depende del ciclo del llamador (con ciclos de 7 ms, cada 105 ms) y tras un
  // hueco largo no recupera lo perdido en ráfaga.
  bool debe_notificar(uint32_t ahora_ms);

  // El stack pidió mostrar la clave: la persona necesita kGraciaClaveMs para
  // teclearla, aunque la conexión ya haya gastado casi toda su gracia base. El
  // límite solo crece y nunca pasa de kGraciaMaximaMs desde la conexión, así que
  // pedir la clave una y otra vez no mantiene abierto un enlace sin proteger.
  void clave_pedida(uint32_t ahora_ms);

  // true si el enlace sigue sin protegerse pasado su límite (kGraciaSeguridadMs
  // desde la conexión, o más si se pidió la clave; ver clave_pedida); el
  // llamador debe cortar la conexión (libera el único cupo).
  bool vencio_gracia(uint32_t ahora_ms) const;

 private:
  bool conectada_ = false;
  bool protegida_ = false;
  bool suscrita_ = false;
  bool primera_pendiente_ = false;
  uint16_t id_ = 0;
  uint32_t t_conexion_ = 0;
  uint32_t proxima_ = 0;
  uint32_t gracia_ms_ = kGraciaSeguridadMs;  // límite sin proteger, desde t_conexion_
};

}  // namespace enlace
}  // namespace visionaria

#endif

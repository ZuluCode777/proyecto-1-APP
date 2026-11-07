// Decisiones de GAP y GATT del accesorio BLE (EA-12), sin el stack.
//
// Qué hace: es la política que accesorio.ino aplica en los ganchos NATIVOS de
// NimBLE (eventos GAP, callback de acceso GATT, almacén de vínculos). Cada
// método recibe lo que el stack informó, decide y devuelve la acción; el sketch
// solo traduce estructuras de NimBLE a estos tipos y ejecuta la acción. Aquí
// viven, juntos y con el intérprete real del radar detrás:
//   - quién puede emparejar (solo con la ventana de alta física abierta) y qué
//     vínculos se persisten (solo autenticados, LESC, clave de 16 bytes);
//   - cuándo se entrega una Medición (cada lectura genera una trama NUEVA para
//     la conexión actual con el enlace protegido EN VIVO; nunca un valor
//     guardado) y cuándo se notifica;
//   - la sesión: una conexión, una suscripción, nada heredado.
//
// Qué NO hace: no llama a NimBLE, FreeRTOS ni al reloj directamente: lo que
// necesita del stack lo pide por PuertoStack (el sketch lo implementa; las
// pruebas, un doble). El estado de PuertaBle no tiene cerrojo propio: el sketch
// serializa sus llamadas con un cerrojo que PuertoStack::tomar()/soltar() expone,
// y atender_notificacion lo conserva hasta entregar la trama: la revocación del
// loop no puede intercalarse. El callback del almacén solo lee atómicos y nunca
// toma este cerrojo, para no invertir los cerrojos del host y de la aplicación. Ninguna
// función imprime ni guarda la clave de enlace.
//
// Portátil: sin Arduino.h, sin excepciones y sin memoria dinámica.
// Ver docs/expoandes/ea-12-ble.md.
#ifndef VISIONARIA_PUERTA_BLE_H
#define VISIONARIA_PUERTA_BLE_H

#include <stddef.h>
#include <stdint.h>

#include <atomic>

#include "emisor_sintetico.h"
#include "enlace_accesorio.h"
#include "sen0395.h"
#include "trama_ble.h"

namespace visionaria {
namespace puerta {

// Códigos ATT que devuelve el callback de acceso (valores de la especificación;
// accesorio.ino comprueba con static_assert que coinciden con los de NimBLE).
constexpr int kAttOk = 0x00;
constexpr int kAttAutenticacionInsuficiente = 0x05;
constexpr int kAttInesperado = 0x0E;

// Valores de NimBLE que usa la política (también comprobados en el sketch).
constexpr uint8_t kAccionClaveEnPantalla = 3;  // BLE_SM_IOACT_DISP
constexpr int kObjetoClaveNuestra = 1;         // BLE_STORE_OBJ_TYPE_OUR_SEC
constexpr int kObjetoClaveDelPar = 2;          // BLE_STORE_OBJ_TYPE_PEER_SEC

// --- UUID de 128 bits ----------------------------------------------------------
// NimBLE los pide en orden little-endian. Se calculan del texto del contrato para
// que no haya dos copias que se desincronicen.
struct Uuid128 {
  uint8_t le[16];
  bool valido;
};

constexpr int valor_hex(char c) {
  return (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
}

constexpr Uuid128 uuid128_le(const char* texto) {
  Uuid128 r{};
  int bytes = 0;
  int alto = -1;
  int i = 0;
  for (; texto[i] != '\0' && i < 64; ++i) {
    if (texto[i] == '-') {
      if (i != 8 && i != 13 && i != 18 && i != 23) return r;
      continue;
    }
    const int v = valor_hex(texto[i]);
    if (v < 0) return r;
    if (alto < 0) {
      alto = v;
    } else {
      if (bytes >= 16) return r;
      r.le[15 - bytes] = static_cast<uint8_t>(alto * 16 + v);
      ++bytes;
      alto = -1;
    }
  }
  r.valido = (i == 36 && bytes == 16 && alto < 0);
  return r;
}

// --- Vínculos ---------------------------------------------------------------------
// Regla de calidad de un vínculo: solo se persisten vínculos autenticados con
// clave (MITM), LESC y clave de 16 bytes. Lo demás (Just Works, emparejamiento
// sin protección) nunca llega a la flash, aunque el stack lo negocie. Otros tipos
// de objeto (CCCD, etc.) pasan esta regla. Es pura: no depende del tiempo ni del
// estado. La compuerta completa (que además exige una alta física vigente) es
// PuertaBle::persistir_vinculo().
bool persistencia_permitida(int tipo_objeto, bool autenticado, bool sc, uint8_t tamano_clave);

enum class AccionGap : uint8_t { Nada, Cortar };
enum class AccionClave : uint8_t { Inyectar, Cortar };
enum class Notificacion : uint8_t { Nada, Cortar, Enviar };
enum class Envio : uint8_t { Nada, Cortada, Enviada, Fallida };

// Lo que PuertaBle necesita del stack para las dos operaciones que deben ser UNA
// sola en el hilo del host de NimBLE (atender_notificacion, atender_borrado).
// El sketch lo implementa sobre NimBLE y FreeRTOS; las pruebas, con un doble que
// puede inyectar acciones en cada frontera.
class PuertoStack {
 public:
  virtual ~PuertoStack() {}
  virtual void tomar() = 0;   // cerrojo de la aplicación (recursivo)
  virtual void soltar() = 0;
  virtual uint32_t ahora() = 0;  // reloj; se llama CON el cerrojo, así no decrece
  // Estado EN VIVO del enlace según el stack; false si ya no conoce la conexión.
  // Se llama SIN el cerrojo.
  virtual bool estado_enlace(uint16_t conexion, enlace::EstadoSeguridad* seguridad) = 0;
  // Entrega la trama al transporte nativo (que NO comprueba cifrado ni CCCD), CON cerrojo.
  virtual bool enviar(uint16_t conexion, const uint8_t trama[ble::kLongitudTrama]) = 0;
  virtual void cortar(uint16_t conexion) = 0;  // sin cerrojo
  virtual bool borrar_vinculos() = 0;          // sin cerrojo; true solo si el almacén se vació
};

class PuertaBle {
 public:
  // `radar` es el intérprete de la UART (nullptr: sin radar). `simulacion`
  // genera presencia sintética con el bit 5. `clave` es la clave de enlace
  // provisionada (6 dígitos); inválida, nunca se entrega al stack.
  PuertaBle(sen0395::Interprete* radar, bool simulacion, uint32_t clave);

  // Información del accesorio. Hasta que no sea válida, ninguna lectura sale.
  bool iniciar(const ble::Informacion& info);
  bool lista() const { return lista_; }
  const uint8_t* trama_informacion() const { return info_trama_; }

  enlace::VentanaAlta& ventana() { return ventana_; }
  enlace::SesionEnlace& sesion() { return sesion_; }

  // --- Conexión -------------------------------------------------------------------
  // false si ya hay otra conexión: un solo cliente a la vez. La segunda no toca la
  // sesión de la primera y el llamador debe cortarla.
  bool al_conectar(uint16_t conexion, uint32_t ahora_ms);
  // Solo si es la conexión de la sesión; una vieja o ajena no la borra.
  bool al_desconectar(uint16_t conexion);

  // --- Emparejamiento ----------------------------------------------------------------
  // El stack pide mostrar la clave (acción = BLE_SM_IOACT_*). Solo con la ventana
  // de alta ABIERTA, la conexión de la sesión y la acción de pantalla se entrega la
  // clave; fuera de eso (ventana cerrada, comparación numérica, entrada, OOB) se
  // corta. `*clave` solo se escribe con Inyectar.
  AccionClave al_pedir_clave(uint8_t accion, uint16_t conexion, uint32_t ahora_ms, uint32_t* clave);
  // Un par ya vinculado intenta emparejar otra vez: solo con la ventana abierta
  // se permite borrar su vínculo viejo y seguir; si no, el vínculo se conserva.
  bool reemparejar_permitido(uint32_t ahora_ms);
  // true: el accesorio debe declarar datos OOB en su respuesta de emparejamiento.
  // El algoritmo SC con OOB pide al aplicativo datos que este firmware no tiene, y
  // evita Just Works con pares sin entrada ni salida. Se pide con la ventana cerrada.
  bool vetar_negociacion(uint32_t ahora_ms);
  enlace::Transicion actualizar_ventana(uint32_t ahora_ms) { return ventana_.actualizar(ahora_ms); }
  // Resultado de cifrar el enlace (estado = 0 es éxito). Solo un enlace cifrado,
  // autenticado, vinculado y de 16 bytes lo protege; si no, se corta. Cierra la
  // ventana de alta al emparejar con éxito.
  AccionGap al_cambiar_cifrado(uint16_t conexion, int estado, const enlace::EstadoSeguridad& seguridad);

  // Compuerta del almacén de NimBLE (store_write_cb). Se llama SIN cerrojo y desde
  // cualquier hilo (el stack puede llamarla con sus propios cerrojos tomados): solo
  // lee atómicos. Una clave de enlace (propia o del par) solo se persiste si
  //   - cumple persistencia_permitida() (autenticada, LESC, 16 bytes), Y
  //   - la conexión actual recibió la clave por pantalla con la ventana de alta
  //     abierta (al_pedir_clave) y esa autorización no se ha revocado, y
  //   - la sesión no está revocada.
  // Con la sesión revocada no se escribe NADA (tampoco el CCCD). La autorización
  // acaba con el cifrado del emparejamiento, la desconexión o la revocación: un
  // emparejamiento en vuelo no puede escribir después de un borrado.
  bool persistir_vinculo(int tipo_objeto, bool autenticado, bool sc, uint8_t tamano_clave) const;

  // Pulsación larga (borrado de vínculos). Con el cerrojo: bloquea nuevas conexiones
  // y escrituras hasta completar el borrado, cierra la ventana, retira
  // la autorización de emparejamiento y, si hay sesión, la revoca YA: deja de
  // medirse, notificarse o suscribirse y no admite emparejar ni persistir nada hasta
  // que la conexión termine. La terminación y el borrado los hace atender_borrado()
  // en el hilo del host.
  void revocar_sesion();
  // true (y la conexión) si la sesión actual está revocada y por tanto hay que cortarla.
  bool conexion_revocada(uint16_t* conexion) const;

  // --- Suscripción ---------------------------------------------------------------------
  // Escritura del CCCD de Medición, o suscripción restaurada del vínculo. Sin
  // enlace protegido se ignora. true si cambió la suscripción.
  bool al_suscribir(uint16_t conexion, bool notificaciones, const enlace::EstadoSeguridad& seguridad);

  // --- Lectura de Medición ----------------------------------------------------------------
  // Se llama en CADA acceso de lectura (lectura simple, larga, de varias
  // características...). `hay_enlace` y `seguridad` son el estado EN VIVO de la
  // conexión según el stack. Genera una trama nueva (secuencia propia) o devuelve
  // el código ATT del rechazo; sin éxito no escribe `trama`.
  int leer_medicion(uint16_t conexion, bool hay_enlace, const enlace::EstadoSeguridad& seguridad, uint32_t ahora_ms,
                    uint8_t trama[ble::kLongitudTrama]);

  // --- Notificación y plazos -----------------------------------------------------------------
  // ¿Hay a quién notificar (sesión conectada, protegida, suscrita y no revocada)?
  // No consume el turno del ritmo.
  bool notificacion_posible(uint16_t* conexion) const;
  // Genera, comprueba y entrega UNA notificación como una sola operación. El sketch
  // la ejecuta en el hilo del host de NimBLE (cola de eventos del host), el mismo
  // que procesa los cambios de cifrado, las suscripciones y las desconexiones: así
  // ninguno de ellos (ni la reutilización del número de conexión) puede intercalarse
  // entre la comprobación y el envío. El transporte nativo solo mira el manejador,
  // no el cifrado ni el CCCD ni la sesión; esta es la única comprobación.
  //   1. destino = sesión actual (con cerrojo);
  //   2. enlace EN VIVO del stack (sin cerrojo);
  //   3. con cerrojo, con el reloj leído dentro: preparar_notificacion() (enlace,
  //      suscripción, ritmo de 100 ms desde ESTE instante y trama nueva);
  //   4. envío SIN soltar el cerrojo: el loop no puede revocar entre 3 y 4.
  // Debe llamarse sin el cerrojo tomado. El callback del almacén no toma el cerrojo
  // y el callback síncrono NOTIFY_TX no modifica la sesión ni lo necesita.
  Envio atender_notificacion(PuertoStack& stack);
  // Borrado de vínculos, en el hilo del host: corta la sesión revocada y vacía el
  // almacén. Se pide tras revocar_sesion(); el flag de revocación (atómico) hace
  // que cualquier escritura de un emparejamiento en vuelo, anterior o posterior a
  // este borrado, sea rechazada. Un fallo conserva el bloqueo; otra pulsación
  // puede repetir el borrado. Sin el cerrojo tomado. Devuelve el resultado del almacén.
  bool atender_borrado(PuertoStack& stack);
  // Paso 2 del envío (con cerrojo): comprueba el enlace en vivo que se le pasa,
  // aplica el ritmo y prepara una trama NUEVA e independiente (no hay valor
  // compartido con las lecturas). `ahora_ms` es el instante de generación y el del
  // ritmo: dos envíos nunca quedan a menos de kPeriodoNotificacionMs.
  Notificacion preparar_notificacion(uint16_t conexion, bool hay_enlace, const enlace::EstadoSeguridad& seguridad,
                                     uint32_t ahora_ms, uint8_t trama[ble::kLongitudTrama]);
  // El enlace sigue sin protegerse pasada la gracia: hay que cortar.
  bool gracia_vencida(uint32_t ahora_ms, uint16_t* conexion) const;

 private:
  ble::EntradaRadar fuente(uint32_t ahora_ms);
  bool generar_medicion(uint32_t ahora_ms, uint8_t trama[ble::kLongitudTrama]);

  sen0395::Interprete* radar_;
  // Atómicos: los lee persistir_vinculo() sin cerrojo, desde el hilo del stack.
  std::atomic<bool> emparejamiento_autorizado_{false};
  std::atomic<bool> revocada_{false};
  std::atomic<bool> borrado_pendiente_{false};
  bool simulacion_;
  uint32_t clave_;
  bool lista_ = false;
  uint8_t info_trama_[ble::kLongitudTrama] = {};
  ble::EmisorSintetico emisor_;
  enlace::SesionEnlace sesion_;
  enlace::VentanaAlta ventana_;
};

}  // namespace puerta
}  // namespace visionaria

#endif

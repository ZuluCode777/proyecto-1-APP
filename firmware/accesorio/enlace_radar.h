// Lectura de la UART del radar y recuperación acotada (EA-11 integrada en EA-12).
//
// Qué hace: (1) atender_uart() pasa al intérprete lo que llegó por la UART y le
// ENTREGA las órdenes pendientes; si se pierden bytes (más de un trozo esperando,
// o un desborde del controlador) se lo dice con Interprete::perder_entrada() en
// vez de dejar una línea a medias que se una con lo que llegue después.
// (2) SupervisorRadar recupera el radar, con espera creciente y sin escribir su
// flash mientras la configuración ya esté guardada, cuando el radar se reinicia,
// calla o rechaza la configuración.
//
// Qué NO hace: no toca la UART de Arduino ni el reloj: usa PuertoUart, que
// implementa accesorio.ino y que las pruebas sustituyen por un doble. No decide
// la salud (la decide sen0395.h) ni habla de BLE.
//
// Portátil: sin Arduino.h, sin excepciones y sin memoria dinámica.
#ifndef VISIONARIA_ENLACE_RADAR_H
#define VISIONARIA_ENLACE_RADAR_H

#include <stddef.h>
#include <stdint.h>

#include "sen0395.h"

namespace visionaria {
namespace radar {

// Lo mínimo que se pide a la UART y al reloj. Implementado sobre Serial1 en el
// sketch; en las pruebas, un doble que reproduce desbordes y reinicios.
class PuertoUart {
 public:
  virtual ~PuertoUart() {}
  virtual uint32_t ahora() = 0;           // reloj monotónico en ms (millis())
  virtual int disponibles() = 0;          // bytes recibidos y sin leer
  virtual int leer() = 0;                 // un byte, o -1 si no hay
  virtual size_t escribibles() = 0;       // espacio libre para escribir
  virtual size_t escribir(const uint8_t* datos, size_t n) = 0;
  // true UNA vez por cada desborde que el controlador de la UART haya notado
  // (búfer lleno, FIFO desbordado): esos bytes se perdieron sin que nadie los lea.
  virtual bool perdida_del_controlador() = 0;
};

struct EstadoUart {
  uint32_t bytes_descartados = 0;  // leídos o drenados sin entregarse
  uint32_t perdidas = 0;           // veces que se avisó al intérprete de una pérdida
  // true si el último ciclo dejó bytes sin leer tras su drenaje acotado: son
  // anteriores a ese ciclo y el siguiente los descarta (sea cual sea su cantidad)
  // hasta ver la UART vacía. Mientras dure no se envía ninguna orden.
  bool drenando = false;
};

// Tope de bytes que un ciclo drena de la UART tras un desborde. Si queda más,
// EstadoUart::drenando lo recuerda y el ciclo siguiente lo sigue descartando
// entero (aunque quepa en un trozo, ni una trama ni un Done viejos valen): el
// ciclo no se alarga sin límite.
constexpr size_t kMaxDrenajePorCiclo = 4096;

// Un ciclo de lectura, SIEMPRE (también sin bytes: así el intérprete sabe cuándo
// se leyó la UART por última vez). Lee a lo sumo kMaxBytesPorLlamada y los
// entrega fechados con ahora(). Si en la UART queda más, o el controlador avisó
// de una pérdida (consultado al empezar Y otra vez tras la lectura y el drenaje,
// justo antes de entregar nada al parser: onReceiveError corre en otra tarea),
// NADA de lo leído en el ciclo se entrega (no se puede fechar con
// verdad ni se sabe dónde falta algo), el resto se drena y el intérprete recibe
// perder_entrada(): lo que tuviera a medias se descarta. Después envía la orden
// pendiente del intérprete si cabe entera, salvo mientras quede cola vieja sin
// drenar (EstadoUart::drenando): una orden no puede mezclarse con su respuesta
// ya encolada de antes. Un EstadoUart por UART y el mismo en todos los ciclos.
void atender_uart(sen0395::Interprete& radar, PuertoUart& uart, EstadoUart& estado);

// Recuperación acotada. Observa el intérprete cada ciclo y decide reiniciar su
// configuración cuando:
//   - está operando y lleva kSilencioReiniciaMs sin una sola trama válida (el
//     radar se reinició o se calló: salud 1, 2, 3 o 4 de forma continua), o
//   - su configuración falló (Error o timeout) y lleva kEsperaFalloMs en fallo.
// Nunca reintenta una configuración inválida (decisión del llamador, no del
// radar). Los reintentos se espacian con espera creciente (kEsperaInicialMs,
// el doble tras cada intento sin recuperación, tope kEsperaMaximaMs) y el
// contador vuelve a cero cuando el radar lleva kSanoReseteaMs sano.
//
// Cada reintento hace recuperar(): con la configuración ya guardada en la flash
// del radar (saveCfg confirmado desde el arranque), solo repite sensorStop y
// sensorStart, así que ni un radar mudo ni uno que se reinicia sin parar gastan
// su flash. NO reaplica rango y latencia sin saveCfg: el SEN0395 se niega a
// arrancar con parámetros sin guardar y quedaría parado hasta reiniciar la placa.
// Si esa configuración nunca llegó a guardarse (arranque con el radar mudo) o un
// intento ligero recibió `Error`, recuperar() hace la configuración completa con
// saveCfg; eso solo ocurre si el radar contesta antes a sensorStop, rango y
// latencia, y los reintentos van espaciados (tope kEsperaMaximaMs). Antes de
// reiniciar vacía la UART: lo que haya quedado no vale como observación ni como
// respuesta a la orden nueva. El intérprete exige luego su estabilización
// (>= 5 s) y una trama íntegra NUEVA. Si la purga topa con kMaxDrenajePorCiclo y
// queda cola, el reinicio espera al ciclo en que la UART quede vacía.
//
// Tiempos reales para quien documente el enlace (EA-12): el contrato fija solo el
// latido (2500 ms desde la última trama válida); NO fija 10 s para recuperar.
// kSilencioReiniciaMs cuenta desde que la salud deja de ser sana (>= 2501 ms
// después de la última trama válida), así que el reinicio llega a ~12,5 s de la
// última trama válida, y tras él el intérprete exige >= 5 s de estabilización.
constexpr uint32_t kSilencioReiniciaMs = 10000;
constexpr uint32_t kEsperaFalloMs = 5000;
constexpr uint32_t kEsperaInicialMs = 5000;
constexpr uint32_t kEsperaMaximaMs = 60000;
constexpr uint32_t kSanoReseteaMs = 30000;

class SupervisorRadar {
 public:
  // Llamar cada ciclo, después de atender_uart(). true si reinició la configuración.
  bool vigilar(sen0395::Interprete& radar, PuertoUart& uart);

  uint32_t reintentos() const { return reintentos_; }          // acumulados desde el arranque
  uint8_t intentos_seguidos() const { return intentos_; }      // sin recuperación todavía

 private:
  bool mal_ = false;        // lleva un tramo sin latido ni configuración válida
  uint32_t mal_desde_ = 0;
  bool sano_ = false;
  uint32_t sano_desde_ = 0;
  bool hay_proximo_ = false;
  uint32_t proximo_ms_ = 0;
  uint8_t intentos_ = 0;
  uint32_t reintentos_ = 0;
};

}  // namespace radar
}  // namespace visionaria

#endif

#include "enlace_radar.h"

namespace visionaria {
namespace radar {

namespace {
// Diferencia con signo módulo 2^32: >= 0 si `a` es igual o posterior a `b`.
inline bool alcanzado(uint32_t a, uint32_t b) { return static_cast<int32_t>(a - b) >= 0; }

uint32_t espera_tras(uint8_t intentos) {
  uint32_t espera = kEsperaInicialMs;
  for (uint8_t i = 1; i < intentos && espera < kEsperaMaximaMs; ++i) espera *= 2;
  return espera < kEsperaMaximaMs ? espera : kEsperaMaximaMs;
}
}  // namespace

void atender_uart(sen0395::Interprete& radar, PuertoUart& uart, EstadoUart& estado) {
  uint8_t bytes[sen0395::kMaxBytesPorLlamada];
  size_t n = 0;
  bool perdida = uart.perdida_del_controlador();
  if (estado.drenando) {
    // Un ciclo anterior no terminó de vaciar la UART: todo lo que haya, aunque
    // sean <= kMaxBytesPorLlamada, es cola vieja y no se puede fechar con verdad.
    perdida = true;
  } else {
    while (n < sizeof(bytes) && uart.disponibles() > 0) {
      const int b = uart.leer();
      if (b < 0) break;
      bytes[n++] = static_cast<uint8_t>(b);
    }
  }
  if (uart.disponibles() > 0) {
    // Hay más de un trozo esperando (o queda cola vieja): se tira lo leído y lo que sigue.
    for (size_t i = 0; i < kMaxDrenajePorCiclo && uart.leer() >= 0; ++i) ++estado.bytes_descartados;
    perdida = true;
  }
  // Si el drenaje topó con su cota, lo que queda es anterior a este ciclo: el
  // siguiente lo descarta también, hasta observar la UART vacía.
  estado.drenando = uart.disponibles() > 0;
  // El desborde pudo ocurrir DURANTE la lectura o el drenaje (onReceiveError corre
  // en otra tarea): se consulta otra vez, siempre, antes de entregar nada al
  // parser. La llamada va primero para que consuma el aviso aunque ya haya pérdida.
  const bool tardia = uart.perdida_del_controlador();
  perdida = tardia || perdida;
  if (perdida) {
    estado.bytes_descartados += n;
    n = 0;
    ++estado.perdidas;
    radar.perder_entrada(uart.ahora());
  }
  radar.procesar(bytes, n, uart.ahora());  // también con n == 0: marca la lectura
  if (estado.drenando) return;             // no se envía una orden con cola vieja pendiente
  uint8_t orden[sen0395::kLongitudOrdenMax];
  const size_t largo = radar.salida_pendiente(orden, sizeof(orden));
  if (largo > 0 && uart.escribibles() >= largo && uart.escribir(orden, largo) == largo) {
    radar.salida_enviada(uart.ahora());
  }
}

bool SupervisorRadar::vigilar(sen0395::Interprete& radar, PuertoUart& uart) {
  const uint32_t ahora = uart.ahora();
  const sen0395::Fase fase = radar.fase();
  const uint8_t salud = radar.salud(ahora);  // también avanza sus plazos

  if (fase == sen0395::Fase::Fallo && radar.motivo_fallo() == sen0395::MotivoFallo::ConfiguracionInvalida) {
    return false;  // terminal: el radar no tiene la culpa
  }
  if (salud == sen0395::kSaludOk) {
    mal_ = false;
    if (!sano_) {
      sano_ = true;
      sano_desde_ = ahora;
    }
    if (intentos_ > 0 && static_cast<uint32_t>(ahora - sano_desde_) >= kSanoReseteaMs) {
      intentos_ = 0;
      hay_proximo_ = false;
    }
    return false;
  }
  sano_ = false;
  if (fase == sen0395::Fase::Configurando || fase == sen0395::Fase::Estabilizando) {
    mal_ = false;  // configurándose: un intento en marcha, no se interrumpe
    return false;
  }
  if (!mal_) {
    mal_ = true;
    mal_desde_ = ahora;
  }
  const uint32_t umbral = fase == sen0395::Fase::Fallo ? kEsperaFalloMs : kSilencioReiniciaMs;
  if (static_cast<uint32_t>(ahora - mal_desde_) < umbral) return false;
  if (hay_proximo_ && !alcanzado(ahora, proximo_ms_)) return false;

  for (size_t i = 0; i < kMaxDrenajePorCiclo && uart.leer() >= 0; ++i) {
  }
  // Queda cola sin vaciar (cota del ciclo): atender_uart() la sigue descartando
  // y el reinicio espera al ciclo en que la UART esté vacía.
  if (uart.disponibles() > 0) return false;
  radar.reiniciar(false);
  if (intentos_ < 255) ++intentos_;
  ++reintentos_;
  proximo_ms_ = ahora + espera_tras(intentos_);
  hay_proximo_ = true;
  mal_ = false;
  return true;
}

}  // namespace radar
}  // namespace visionaria

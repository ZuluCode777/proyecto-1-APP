// Emisor SINTÉTICO de tramas del contrato BLE v1.0. Genera Medición desde una
// entrada de radar simulada o ya interpretada por el firmware; no habla con
// radar, UART, GPIO ni BLE. Sirve para pruebas en el portátil y para que el
// iPhone use las mismas tramas sin radar. Portátil: sin Arduino.h.
#ifndef VISIONARIA_EMISOR_SINTETICO_H
#define VISIONARIA_EMISOR_SINTETICO_H

#include "trama_ble.h"

namespace visionaria {
namespace ble {

enum class EstadoRadar : uint8_t {
  SinBlanco,  // radar sano, nada detectado (nunca "camino libre")
  Presencia,  // blanco dentro de la ventana, sin distancia ni azimut (SEN0395)
  Objetivo,   // blanco con distancia y, si se conoce, azimut
  Fallo,      // salud distinta de 0
};

struct EntradaRadar {
  EstadoRadar estado = EstadoRadar::SinBlanco;
  uint16_t distancia_mm = kDistanciaDesconocida;
  bool tiene_azimut = false;
  int16_t azimut_centesimas = 0;
  // Edad del resultado: desde su recepción íntegra y validada hasta emitir.
  // Una fuente que llega a 1 Hz (UART del SEN0395) supera caducidad_ms la
  // mitad del tiempo; entonces la trama sale como "vencida", nunca como vigente.
  uint16_t edad_ms = kEdadDesconocida;
  uint8_t salud = 0;  // solo con EstadoRadar::Fallo; debe ser 1..6
  uint8_t bateria = kBateriaDesconocida;
  bool bateria_baja = false;
};

class EmisorSintetico {
 public:
  // La Información ya debe ser válida (ver codificar_informacion).
  EmisorSintetico(const Informacion& info, bool simulacion, uint16_t secuencia_inicial = 0)
      : info_(info), simulacion_(simulacion), secuencia_(secuencia_inicial) {}

  const Informacion& informacion() const { return info_; }
  uint16_t siguiente_secuencia() const { return secuencia_; }

  // Genera la trama y avanza la secuencia solo si salió bien.
  Error generar(uint32_t instante_ms, const EntradaRadar& entrada, uint8_t salida[kLongitudTrama]);

  // Simula un reinicio: identificador de arranque nuevo y secuencia en cero.
  // Devuelve false (sin cambios) si el identificador es igual al actual.
  bool reiniciar(uint32_t nuevo_id_arranque);

 private:
  Informacion info_;
  bool simulacion_;
  uint16_t secuencia_;
};

}  // namespace ble
}  // namespace visionaria

#endif

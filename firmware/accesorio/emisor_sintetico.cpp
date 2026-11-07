#include "emisor_sintetico.h"

namespace visionaria {
namespace ble {

Error EmisorSintetico::generar(uint32_t instante_ms, const EntradaRadar& e,
                               uint8_t salida[kLongitudTrama]) {
  Medicion m;
  m.secuencia = secuencia_;
  m.id_arranque = info_.id_arranque;
  m.instante_ms = instante_ms;
  m.edad_radar_ms = e.edad_ms;

  const bool fallo = e.estado == EstadoRadar::Fallo;
  if (fallo) {
    if (e.salud == 0 || e.salud > kSaludMaxima) return Error::SaludInvalida;
    m.salud = e.salud;
  }
  // Vencido o fallo: banderas 0..3 en cero y medidas desconocidas.
  const bool vigente = !fallo && e.edad_ms != kEdadDesconocida && e.edad_ms <= info_.caducidad_ms;
  if (vigente) {
    m.banderas |= kBanResultado;
    if (e.estado != EstadoRadar::SinBlanco) m.banderas |= kBanBlanco;
    const bool distancia_ok = e.estado == EstadoRadar::Objetivo &&
                              (info_.capacidades & kCapDistancia) && e.distancia_mm != 0 &&
                              e.distancia_mm >= info_.distancia_minima_mm &&
                              e.distancia_mm <= info_.distancia_maxima_mm;
    if (distancia_ok) {
      m.banderas |= kBanDistanciaValida;
      m.distancia_mm = e.distancia_mm;
      if (e.tiene_azimut && (info_.capacidades & kCapAzimut)) {
        m.banderas |= kBanAzimutValido;
        m.azimut_centesimas = e.azimut_centesimas;
      }
    }
  }
  if (info_.capacidades & kCapBateria) {
    m.bateria = e.bateria;
    if (e.bateria_baja && e.bateria != kBateriaDesconocida) m.banderas |= kBanBateriaBaja;
  }
  if (simulacion_) m.banderas |= kBanSimulacion;

  const Error r = codificar_medicion(m, info_, salida);
  if (r == Error::Ninguno) ++secuencia_;
  return r;
}

bool EmisorSintetico::reiniciar(uint32_t nuevo_id_arranque) {
  if (nuevo_id_arranque == info_.id_arranque) return false;
  info_.id_arranque = nuevo_id_arranque;
  secuencia_ = 0;
  return true;
}

}  // namespace ble
}  // namespace visionaria

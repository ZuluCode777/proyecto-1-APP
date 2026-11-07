#include "trama_ble.h"

#include <string.h>

namespace visionaria {
namespace ble {

namespace {

const char* const kNombres[] = {
    "ninguno",
    "longitudIncorrecta",
    "versionIncompatible",
    "bitsReservados",
    "capacidadInconsistente",
    "perfilInvalido",
    "periodoInvalido",
    "caducidadInvalida",
    "limitesInvalidos",
    "saludInvalida",
    "banderasIncoherentes",
    "centinelaInconsistente",
    "valorFueraDeRango",
};
constexpr size_t kCantidadNombres = sizeof(kNombres) / sizeof(kNombres[0]);

void poner16(uint8_t* p, uint16_t v) {
  p[0] = static_cast<uint8_t>(v & 0xFF);
  p[1] = static_cast<uint8_t>(v >> 8);
}
void poner32(uint8_t* p, uint32_t v) {
  poner16(p, static_cast<uint16_t>(v & 0xFFFF));
  poner16(p + 2, static_cast<uint16_t>(v >> 16));
}
uint16_t leer16(const uint8_t* p) {
  return static_cast<uint16_t>(p[0] | (static_cast<uint16_t>(p[1]) << 8));
}
uint32_t leer32(const uint8_t* p) {
  return static_cast<uint32_t>(leer16(p)) | (static_cast<uint32_t>(leer16(p + 2)) << 16);
}

// Orden fijo, igual que en Swift: versión, bits reservados, capacidades,
// perfil, periodo, caducidad, límites.
Error validar_informacion(const Informacion& i) {
  if (i.version_mayor != kVersionMayor || i.version_menor != kVersionMenor)
    return Error::VersionIncompatible;
  if ((i.capacidades & ~kCapMascaraValida) != 0) return Error::BitsReservados;
  if ((i.capacidades & kCapAzimut) && !(i.capacidades & kCapDistancia))
    return Error::CapacidadInconsistente;
  if (i.perfil > 3) return Error::PerfilInvalido;
  if (i.periodo_ms == 0) return Error::PeriodoInvalido;
  if (i.caducidad_ms != kCaducidadMs) return Error::CaducidadInvalida;
  if (i.distancia_maxima_mm <= i.distancia_minima_mm || i.distancia_maxima_mm > 65534)
    return Error::LimitesInvalidos;
  return Error::Ninguno;
}

// Orden fijo, igual que en Swift: versión, bits reservados, salud, banderas,
// centinelas, rangos, y al final capacidades y límites de la Información.
Error validar_medicion(const Medicion& m, const Informacion& info) {
  if (m.version_mayor != kVersionMayor) return Error::VersionIncompatible;
  if (m.banderas & kBanReservadas) return Error::BitsReservados;
  if (m.salud > kSaludMaxima) return Error::SaludInvalida;

  const bool resultado = m.banderas & kBanResultado;
  const bool blanco = m.banderas & kBanBlanco;
  const bool dist_ok = m.banderas & kBanDistanciaValida;
  const bool az_ok = m.banderas & kBanAzimutValido;
  const bool baja = m.banderas & kBanBateriaBaja;
  const bool alguna_medida = resultado || blanco || dist_ok || az_ok;

  if (!resultado && (blanco || dist_ok || az_ok)) return Error::BanderasIncoherentes;
  if (dist_ok && !blanco) return Error::BanderasIncoherentes;
  if (az_ok && !dist_ok) return Error::BanderasIncoherentes;
  if (m.salud != 0 && alguna_medida) return Error::BanderasIncoherentes;
  if (m.edad_radar_ms == kEdadDesconocida && alguna_medida) return Error::BanderasIncoherentes;
  if (m.bateria == kBateriaDesconocida && baja) return Error::BanderasIncoherentes;

  if (!dist_ok && m.distancia_mm != kDistanciaDesconocida) return Error::CentinelaInconsistente;
  if (dist_ok && m.distancia_mm == kDistanciaDesconocida) return Error::CentinelaInconsistente;
  if (!az_ok && m.azimut_centesimas != kAzimutDesconocido) return Error::CentinelaInconsistente;
  if (az_ok && m.azimut_centesimas == kAzimutDesconocido) return Error::CentinelaInconsistente;

  if (az_ok && (m.azimut_centesimas < -kAzimutMaximo || m.azimut_centesimas > kAzimutMaximo))
    return Error::ValorFueraDeRango;
  if (m.bateria != kBateriaDesconocida && m.bateria > 100) return Error::ValorFueraDeRango;

  if (dist_ok && !(info.capacidades & kCapDistancia)) return Error::CapacidadInconsistente;
  if (az_ok && !(info.capacidades & kCapAzimut)) return Error::CapacidadInconsistente;
  if ((m.bateria != kBateriaDesconocida || baja) && !(info.capacidades & kCapBateria))
    return Error::CapacidadInconsistente;
  if (dist_ok && (m.distancia_mm == 0 || m.distancia_mm < info.distancia_minima_mm ||
                  m.distancia_mm > info.distancia_maxima_mm))
    return Error::ValorFueraDeRango;
  return Error::Ninguno;
}

}  // namespace

const char* nombre(Error e) {
  const size_t i = static_cast<size_t>(e);
  return i < kCantidadNombres ? kNombres[i] : "desconocido";
}

Error error_desde_nombre(const char* texto) {
  for (size_t i = 1; i < kCantidadNombres; ++i)
    if (strcmp(texto, kNombres[i]) == 0) return static_cast<Error>(i);
  return Error::Ninguno;
}

Error codificar_informacion(const Informacion& i, uint8_t* out) {
  const Error e = validar_informacion(i);
  if (e != Error::Ninguno) return e;
  out[0] = i.version_mayor;
  out[1] = i.version_menor;
  poner16(out + 2, i.capacidades);
  poner32(out + 4, i.id_arranque);
  out[8] = i.firmware_mayor;
  out[9] = i.firmware_menor;
  out[10] = i.firmware_revision;
  out[11] = i.perfil;
  poner16(out + 12, i.periodo_ms);
  poner16(out + 14, i.caducidad_ms);
  poner16(out + 16, i.distancia_minima_mm);
  poner16(out + 18, i.distancia_maxima_mm);
  return Error::Ninguno;
}

Error decodificar_informacion(const uint8_t* d, size_t n, Informacion* i) {
  if (n != kLongitudTrama) return Error::LongitudIncorrecta;
  Informacion r;
  r.version_mayor = d[0];
  r.version_menor = d[1];
  r.capacidades = leer16(d + 2);
  r.id_arranque = leer32(d + 4);
  r.firmware_mayor = d[8];
  r.firmware_menor = d[9];
  r.firmware_revision = d[10];
  r.perfil = d[11];
  r.periodo_ms = leer16(d + 12);
  r.caducidad_ms = leer16(d + 14);
  r.distancia_minima_mm = leer16(d + 16);
  r.distancia_maxima_mm = leer16(d + 18);
  const Error e = validar_informacion(r);
  if (e == Error::Ninguno) *i = r;
  return e;
}

Error codificar_medicion(const Medicion& m, const Informacion& info, uint8_t* out) {
  const Error e = validar_medicion(m, info);
  if (e != Error::Ninguno) return e;
  out[0] = m.version_mayor;
  out[1] = m.banderas;
  poner16(out + 2, m.secuencia);
  poner32(out + 4, m.id_arranque);
  poner32(out + 8, m.instante_ms);
  poner16(out + 12, m.distancia_mm);
  poner16(out + 14, static_cast<uint16_t>(m.azimut_centesimas));
  poner16(out + 16, m.edad_radar_ms);
  out[18] = m.bateria;
  out[19] = m.salud;
  return Error::Ninguno;
}

Error decodificar_medicion(const uint8_t* d, size_t n, const Informacion& info, Medicion* m) {
  if (n != kLongitudTrama) return Error::LongitudIncorrecta;
  Medicion r;
  r.version_mayor = d[0];
  r.banderas = d[1];
  r.secuencia = leer16(d + 2);
  r.id_arranque = leer32(d + 4);
  r.instante_ms = leer32(d + 8);
  r.distancia_mm = leer16(d + 12);
  r.azimut_centesimas = static_cast<int16_t>(leer16(d + 14));
  r.edad_radar_ms = leer16(d + 16);
  r.bateria = d[18];
  r.salud = d[19];
  const Error e = validar_medicion(r, info);
  if (e == Error::Ninguno) *m = r;
  return e;
}

}  // namespace ble
}  // namespace visionaria

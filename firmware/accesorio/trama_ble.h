// Contrato BLE v1.0 del accesorio de proximidad: tramas de 20 bytes.
// Portátil: sin Arduino.h, sin excepciones ni memoria dinámica. La
// especificación congelada está en docs/expoandes/contrato-ble.md.
#ifndef VISIONARIA_TRAMA_BLE_H
#define VISIONARIA_TRAMA_BLE_H

#include <stddef.h>
#include <stdint.h>

namespace visionaria {
namespace ble {

constexpr size_t kLongitudTrama = 20;
constexpr uint8_t kVersionMayor = 1;
constexpr uint8_t kVersionMenor = 0;
constexpr uint16_t kCaducidadMs = 500;

constexpr uint16_t kCapDistancia = 1u << 0;
constexpr uint16_t kCapAzimut = 1u << 1;
constexpr uint16_t kCapBateria = 1u << 2;
constexpr uint16_t kCapMascaraValida = kCapDistancia | kCapAzimut | kCapBateria;

constexpr uint8_t kBanResultado = 1u << 0;
constexpr uint8_t kBanBlanco = 1u << 1;
constexpr uint8_t kBanDistanciaValida = 1u << 2;
constexpr uint8_t kBanAzimutValido = 1u << 3;
constexpr uint8_t kBanBateriaBaja = 1u << 4;
constexpr uint8_t kBanSimulacion = 1u << 5;
constexpr uint8_t kBanReservadas = 0xC0;

constexpr uint16_t kDistanciaDesconocida = 0xFFFF;
constexpr int16_t kAzimutDesconocido = -32768;
constexpr uint16_t kEdadDesconocida = 0xFFFF;
constexpr uint8_t kBateriaDesconocida = 255;
constexpr int16_t kAzimutMaximo = 9000;
constexpr uint8_t kSaludMaxima = 6;

// Los códigos coinciden, por nombre, con ErrorContrato de Swift y con los
// vectores de contratos/ble/. El orden de las comprobaciones también.
enum class Error : uint8_t {
  Ninguno = 0,
  LongitudIncorrecta,
  VersionIncompatible,
  BitsReservados,
  CapacidadInconsistente,
  PerfilInvalido,
  PeriodoInvalido,
  CaducidadInvalida,
  LimitesInvalidos,
  SaludInvalida,
  BanderasIncoherentes,
  CentinelaInconsistente,
  ValorFueraDeRango,
};

const char* nombre(Error e);
// Devuelve Error::Ninguno si el nombre no corresponde a ningún código.
Error error_desde_nombre(const char* texto);

struct Informacion {
  uint8_t version_mayor = kVersionMayor;
  uint8_t version_menor = kVersionMenor;
  uint16_t capacidades = 0;
  uint32_t id_arranque = 0;
  uint8_t firmware_mayor = 0;
  uint8_t firmware_menor = 0;
  uint8_t firmware_revision = 0;
  uint8_t perfil = 0;  // 0 desconocido, 1 personas, 2 distancia, 3 nube
  uint16_t periodo_ms = 100;
  uint16_t caducidad_ms = kCaducidadMs;
  uint16_t distancia_minima_mm = 0;
  uint16_t distancia_maxima_mm = 0;
};

struct Medicion {
  uint8_t version_mayor = kVersionMayor;
  uint8_t banderas = 0;
  uint16_t secuencia = 0;
  uint32_t id_arranque = 0;
  uint32_t instante_ms = 0;
  uint16_t distancia_mm = kDistanciaDesconocida;
  int16_t azimut_centesimas = kAzimutDesconocido;
  uint16_t edad_radar_ms = kEdadDesconocida;
  uint8_t bateria = kBateriaDesconocida;
  uint8_t salud = 0;
};

// Comprueba la estructura y escribe 20 bytes solo si es válida.
Error codificar_informacion(const Informacion& info, uint8_t salida[kLongitudTrama]);
Error decodificar_informacion(const uint8_t* datos, size_t longitud, Informacion* info);

// Las comprobaciones contra la Información (capacidades, límites) van incluidas.
// No compara el identificador de arranque: es decisión de sesión.
Error codificar_medicion(const Medicion& med, const Informacion& info,
                         uint8_t salida[kLongitudTrama]);
Error decodificar_medicion(const uint8_t* datos, size_t longitud, const Informacion& info,
                           Medicion* med);

}  // namespace ble
}  // namespace visionaria

#endif

#include "enlace_accesorio.h"

namespace visionaria {
namespace enlace {

namespace {
constexpr int kIntentosIdArranque = 8;
// Diferencia con signo módulo 2^32: >= 0 si `a` es igual o posterior a `b`.
inline bool alcanzado(uint32_t a, uint32_t b) { return static_cast<int32_t>(a - b) >= 0; }
}  // namespace

bool elegir_id_arranque(uint32_t anterior, FuenteAleatoria fuente, void* contexto, uint32_t* id) {
  if (fuente == nullptr || id == nullptr) return false;
  for (int i = 0; i < kIntentosIdArranque; ++i) {
    const uint32_t candidato = fuente(contexto);
    if (candidato != 0 && candidato != anterior) {
      *id = candidato;
      return true;
    }
  }
  return false;
}

bool informacion_sen0395(uint32_t id_arranque, uint16_t ventana_minima_mm,
                         uint16_t ventana_maxima_mm, ble::Informacion* info) {
  if (info == nullptr) return false;
  ble::Informacion i;
  i.capacidades = 0;
  i.id_arranque = id_arranque;
  i.firmware_mayor = kFirmwareMayor;
  i.firmware_menor = kFirmwareMenor;
  i.firmware_revision = kFirmwareRevision;
  i.perfil = 1;
  i.periodo_ms = static_cast<uint16_t>(kPeriodoNotificacionMs);
  i.caducidad_ms = ble::kCaducidadMs;
  i.distancia_minima_mm = ventana_minima_mm;
  i.distancia_maxima_mm = ventana_maxima_mm;
  uint8_t trama[ble::kLongitudTrama];
  if (ble::codificar_informacion(i, trama) != ble::Error::Ninguno) return false;
  *info = i;
  return true;
}

ble::EntradaRadar entrada_montaje_no_validado() {
  ble::EntradaRadar e;
  e.estado = ble::EstadoRadar::Fallo;
  e.salud = 6;
  e.edad_ms = ble::kEdadDesconocida;
  return e;
}

ble::EntradaRadar entrada_para_sesion(const ble::EntradaRadar& entrada, uint32_t t_conexion_ms,
                                      uint32_t ahora_ms) {
  if (entrada.estado == ble::EstadoRadar::Fallo) return entrada;
  const uint32_t desde_conexion = ahora_ms - t_conexion_ms;
  // Recibida estrictamente después de conectar: edad < tiempo desde la conexión.
  const bool posterior = entrada.edad_ms != ble::kEdadDesconocida && entrada.edad_ms < desde_conexion;
  if (posterior) return entrada;
  ble::EntradaRadar e;
  e.estado = ble::EstadoRadar::SinBlanco;
  e.edad_ms = ble::kEdadDesconocida;
  e.bateria = entrada.bateria;
  e.bateria_baja = entrada.bateria_baja;
  return e;
}

ble::EntradaRadar entrada_simulada(uint32_t ahora_ms) {
  ble::EntradaRadar e;
  e.estado = ((ahora_ms / 2000) % 2) ? ble::EstadoRadar::Presencia : ble::EstadoRadar::SinBlanco;
  e.edad_ms = 20;
  return e;
}

// --- VentanaAlta ------------------------------------------------------------------

void VentanaAlta::abrir(uint32_t ahora_ms) {
  abierta_ = true;
  inicio_ms_ = ahora_ms;
}

void VentanaAlta::cerrar() { abierta_ = false; }

bool VentanaAlta::abierta(uint32_t ahora_ms) {
  if (abierta_ && static_cast<uint32_t>(ahora_ms - inicio_ms_) >= kVentanaAltaMs) abierta_ = false;
  return abierta_;
}

uint32_t VentanaAlta::restante_ms(uint32_t ahora_ms) {
  if (!abierta(ahora_ms)) return 0;
  return kVentanaAltaMs - static_cast<uint32_t>(ahora_ms - inicio_ms_);
}

Transicion VentanaAlta::actualizar(uint32_t ahora_ms) {
  const bool ahora = abierta(ahora_ms);
  if (ahora == aplicada_) return Transicion::SinCambio;
  aplicada_ = ahora;
  return ahora ? Transicion::Abrio : Transicion::Cerro;
}

// --- Boton --------------------------------------------------------------------------

AccionBoton Boton::muestrear(bool presionado, uint32_t ahora_ms) {
  if (presionado) {
    if (!pulsado_) {
      pulsado_ = true;
      t_inicio_ = ahora_ms;
    }
    suelto_pendiente_ = false;  // un soltado corto fue rebote: sigue la misma pulsación
    return AccionBoton::Ninguna;
  }
  if (!pulsado_) return AccionBoton::Ninguna;
  if (!suelto_pendiente_) {
    suelto_pendiente_ = true;
    t_suelto_ = ahora_ms;
    return AccionBoton::Ninguna;
  }
  if (static_cast<uint32_t>(ahora_ms - t_suelto_) < kRebotesMs) return AccionBoton::Ninguna;
  const uint32_t duracion = t_suelto_ - t_inicio_;
  pulsado_ = false;
  suelto_pendiente_ = false;
  if (duracion >= kPulsacionBorradoMs) return AccionBoton::BorrarVinculos;
  if (duracion >= kPulsacionAltaMs) return AccionBoton::AbrirAlta;
  return AccionBoton::Ninguna;
}

// --- Seguridad ----------------------------------------------------------------------

bool seguridad_suficiente(const EstadoSeguridad& s) {
  return s.cifrado && s.autenticado && s.vinculado && s.tamano_clave >= kTamanoClaveMinimo;
}

// --- SesionEnlace -------------------------------------------------------------------

void SesionEnlace::conectar(uint16_t id_conexion, uint32_t ahora_ms) {
  conectada_ = true;
  protegida_ = false;
  suscrita_ = false;
  primera_pendiente_ = false;
  id_ = id_conexion;
  t_conexion_ = ahora_ms;
  proxima_ = ahora_ms;
}

void SesionEnlace::desconectar() {
  conectada_ = false;
  protegida_ = false;
  suscrita_ = false;
  primera_pendiente_ = false;
}

void SesionEnlace::marcar_protegida(bool protegida) {
  if (!conectada_) return;
  protegida_ = protegida;
  if (!protegida) {
    suscrita_ = false;
    primera_pendiente_ = false;
  }
}

bool SesionEnlace::fijar_suscripcion(bool notificaciones) {
  if (!conectada_ || !protegida_) return false;
  if (notificaciones == suscrita_) return false;
  suscrita_ = notificaciones;
  primera_pendiente_ = notificaciones;
  return true;
}

bool SesionEnlace::debe_notificar(uint32_t ahora_ms) {
  if (!suscrita()) return false;
  if (primera_pendiente_) {
    primera_pendiente_ = false;
    proxima_ = ahora_ms + kPeriodoNotificacionMs;
    return true;
  }
  if (!alcanzado(ahora_ms, proxima_)) return false;
  // Siempre desde el envío real: separación mínima kPeriodoNotificacionMs, sin ráfagas.
  proxima_ = ahora_ms + kPeriodoNotificacionMs;
  return true;
}

bool SesionEnlace::vencio_gracia(uint32_t ahora_ms) const {
  return conectada_ && !protegida_ &&
         static_cast<uint32_t>(ahora_ms - t_conexion_) >= kGraciaSeguridadMs;
}

}  // namespace enlace
}  // namespace visionaria

#include "puerta_ble.h"

#include <string.h>

namespace visionaria {
namespace puerta {

bool persistencia_permitida(int tipo_objeto, bool autenticado, bool sc, uint8_t tamano_clave) {
  if (tipo_objeto != kObjetoClaveNuestra && tipo_objeto != kObjetoClaveDelPar) return true;
  return autenticado && sc && tamano_clave >= enlace::kTamanoClaveMinimo;
}

PuertaBle::PuertaBle(sen0395::Interprete* radar, bool simulacion, uint32_t clave)
    : radar_(radar), simulacion_(simulacion), clave_(clave), emisor_(ble::Informacion(), simulacion) {}

bool PuertaBle::iniciar(const ble::Informacion& info) {
  uint8_t trama[ble::kLongitudTrama];
  if (ble::codificar_informacion(info, trama) != ble::Error::Ninguno) return false;
  memcpy(info_trama_, trama, sizeof(info_trama_));
  emisor_ = ble::EmisorSintetico(info, simulacion_);
  lista_ = true;
  return true;
}

ble::EntradaRadar PuertaBle::fuente(uint32_t ahora_ms) {
  if (simulacion_) return enlace::entrada_simulada(ahora_ms);
  if (radar_ != nullptr) return radar_->entrada(ahora_ms);
  return enlace::entrada_montaje_no_validado();
}

bool PuertaBle::generar_medicion(uint32_t ahora_ms, uint8_t trama[ble::kLongitudTrama]) {
  const ble::EntradaRadar e = enlace::entrada_para_sesion(fuente(ahora_ms), sesion_.t_conexion_ms(), ahora_ms);
  return emisor_.generar(ahora_ms, e, trama) == ble::Error::Ninguno;
}

Registro PuertaBle::registrar_enlace(uint16_t conexion, bool viva, uint32_t ahora_ms) {
  if (!viva || conexion == kSinConexion) return Registro::Ninguno;
  const bool nueva = !sesion_.conectada();
  if (!al_conectar(conexion, ahora_ms)) return Registro::Rechazado;
  return nueva ? Registro::Nuevo : Registro::Conocido;
}

bool PuertaBle::al_conectar(uint16_t conexion, uint32_t ahora_ms) {
  if (borrado_pendiente_.load()) return false;
  if (sesion_.conectada()) {
    // El mismo enlace visto por otro evento (CONNECT llega después de ENC_CHANGE, o
    // dos veces): ya está registrado y no se reinicia, o se borraría lo que ese
    // evento anterior decidió (protección, suscripción, plazo). Una sesión
    // revocada tampoco se reinicia: termina primero.
    return conexion == sesion_.id_conexion() && !revocada_.load();
  }
  emparejamiento_autorizado_.store(false);
  sesion_.conectar(conexion, ahora_ms);
  return true;
}

bool PuertaBle::al_desconectar(uint16_t conexion) {
  if (!sesion_.conectada() || conexion != sesion_.id_conexion()) return false;
  emparejamiento_autorizado_.store(false);
  revocada_.store(false);
  sesion_.desconectar();
  return true;
}

AccionClave PuertaBle::al_pedir_clave(uint8_t accion, uint16_t conexion, uint32_t ahora_ms, uint32_t* clave) {
  if (clave == nullptr || accion != kAccionClaveEnPantalla) return AccionClave::Cortar;
  if (!sesion_.conectada() || conexion != sesion_.id_conexion() || revocada_.load() || borrado_pendiente_.load()) {
    return AccionClave::Cortar;
  }
  if (!ventana_.abierta(ahora_ms)) return AccionClave::Cortar;
  if (!enlace::clave_valida(clave_)) return AccionClave::Cortar;
  // Esta conexión, con la ventana de alta física abierta AHORA, puede dejar un
  // vínculo; ninguna otra ni ninguna anterior (persistir_vinculo).
  emparejamiento_autorizado_.store(true);
  sesion_.clave_pedida(ahora_ms);  // la persona teclea la clave: gracia propia, con tope
  *clave = clave_;
  return AccionClave::Inyectar;
}

bool PuertaBle::reemparejar_permitido(uint32_t ahora_ms) {
  return !revocada_.load() && !borrado_pendiente_.load() && ventana_.abierta(ahora_ms);
}

bool PuertaBle::vetar_negociacion(uint32_t ahora_ms) {
  return revocada_.load() || borrado_pendiente_.load() || !ventana_.abierta(ahora_ms);
}

AccionGap PuertaBle::al_cambiar_cifrado(uint16_t conexion, int estado, const enlace::EstadoSeguridad& seguridad) {
  const bool propia = sesion_.conectada() && conexion == sesion_.id_conexion();
  const bool ok = propia && !revocada_.load() && !borrado_pendiente_.load() && estado == 0 &&
                  enlace::seguridad_suficiente(seguridad);
  if (propia) {
    sesion_.marcar_protegida(ok);
    // El stack persiste las claves ANTES de avisar del cifrado: el emparejamiento
    // terminó, con éxito o sin él, y su autorización con él.
    emparejamiento_autorizado_.store(false);
  }
  if (!ok) return AccionGap::Cortar;
  ventana_.cerrar();  // un alta, un emparejamiento
  return AccionGap::Nada;
}

bool PuertaBle::al_suscribir(uint16_t conexion, bool notificaciones, const enlace::EstadoSeguridad& seguridad) {
  if (!sesion_.conectada() || conexion != sesion_.id_conexion() || revocada_.load()) return false;
  const bool protegida = enlace::seguridad_suficiente(seguridad);
  sesion_.marcar_protegida(protegida);
  if (!protegida) return false;  // la gracia de seguridad corta la conexión
  return sesion_.fijar_suscripcion(notificaciones);
}

int PuertaBle::leer_medicion(uint16_t conexion, bool hay_enlace, const enlace::EstadoSeguridad& seguridad,
                             uint32_t ahora_ms, uint8_t trama[ble::kLongitudTrama]) {
  if (!lista_ || !sesion_.conectada() || conexion != sesion_.id_conexion()) return kAttInesperado;
  if (revocada_.load() || !hay_enlace || !enlace::seguridad_suficiente(seguridad)) return kAttAutenticacionInsuficiente;
  uint8_t nueva[ble::kLongitudTrama];
  if (!generar_medicion(ahora_ms, nueva)) return kAttInesperado;
  memcpy(trama, nueva, sizeof(nueva));
  return kAttOk;
}

bool PuertaBle::notificacion_posible(uint16_t* conexion) const {
  if (conexion == nullptr || !sesion_.conectada() || !sesion_.suscrita() || revocada_.load()) return false;
  *conexion = sesion_.id_conexion();
  return true;
}

Notificacion PuertaBle::preparar_notificacion(uint16_t conexion, bool hay_enlace, const enlace::EstadoSeguridad& seguridad,
                                              uint32_t ahora_ms, uint8_t trama[ble::kLongitudTrama]) {
  // Lo preparado para otra conexión no sale; tampoco si la sesión actual (aunque
  // reutilice el número) no se suscribió o fue revocada.
  if (!lista_ || !sesion_.conectada() || conexion != sesion_.id_conexion() || !sesion_.suscrita() || revocada_.load()) {
    return Notificacion::Nada;
  }
  if (!hay_enlace || !enlace::seguridad_suficiente(seguridad)) {
    sesion_.marcar_protegida(false);
    return Notificacion::Cortar;
  }
  // El turno se consume AL GENERAR: dos tramas nunca quedan a menos de 100 ms.
  if (!sesion_.debe_notificar(ahora_ms)) return Notificacion::Nada;
  uint8_t nueva[ble::kLongitudTrama];
  if (!generar_medicion(ahora_ms, nueva)) return Notificacion::Nada;
  memcpy(trama, nueva, sizeof(nueva));
  return Notificacion::Enviar;
}

Envio PuertaBle::atender_notificacion(PuertoStack& stack) {
  uint16_t destino = 0;
  stack.tomar();
  const bool posible = notificacion_posible(&destino);
  stack.soltar();
  if (!posible) return Envio::Nada;

  enlace::EstadoSeguridad vivo;
  const bool hay = stack.estado_enlace(destino, &vivo);

  uint8_t trama[ble::kLongitudTrama];
  stack.tomar();
  const Notificacion accion = preparar_notificacion(destino, hay, vivo, stack.ahora(), trama);
  if (accion == Notificacion::Enviar) {
    const bool enviada = stack.enviar(destino, trama);
    stack.soltar();
    return enviada ? Envio::Enviada : Envio::Fallida;
  }
  stack.soltar();

  if (accion == Notificacion::Cortar) {
    stack.cortar(destino);
    return Envio::Cortada;
  }
  return Envio::Nada;
}

bool PuertaBle::persistir_vinculo(int tipo_objeto, bool autenticado, bool sc, uint8_t tamano_clave) const {
  if (revocada_.load() || borrado_pendiente_.load()) return false;
  if (!persistencia_permitida(tipo_objeto, autenticado, sc, tamano_clave)) return false;
  const bool clave_de_enlace = tipo_objeto == kObjetoClaveNuestra || tipo_objeto == kObjetoClaveDelPar;
  return !clave_de_enlace || emparejamiento_autorizado_.load();
}

void PuertaBle::revocar_sesion() {
  // Primero lo que lee el almacén sin cerrojo: desde este punto no se escribe nada.
  borrado_pendiente_.store(true);
  emparejamiento_autorizado_.store(false);
  ventana_.cerrar();
  if (!sesion_.conectada()) return;
  revocada_.store(true);
  sesion_.marcar_protegida(false);
}

bool PuertaBle::conexion_revocada(uint16_t* conexion) const {
  if (conexion == nullptr || !sesion_.conectada() || !revocada_.load()) return false;
  *conexion = sesion_.id_conexion();
  return true;
}

bool PuertaBle::atender_borrado(PuertoStack& stack) {
  if (!borrado_pendiente_.load()) return true;
  uint16_t conexion = 0;
  stack.tomar();
  const bool cortar = conexion_revocada(&conexion);
  stack.soltar();
  if (cortar) stack.cortar(conexion);
  if (!stack.borrar_vinculos()) return false;
  borrado_pendiente_.store(false);
  return true;
}

bool PuertaBle::gracia_vencida(uint32_t ahora_ms, uint16_t* conexion) const {
  if (conexion == nullptr || !sesion_.vencio_gracia(ahora_ms)) return false;
  *conexion = sesion_.id_conexion();
  return true;
}

}  // namespace puerta
}  // namespace visionaria

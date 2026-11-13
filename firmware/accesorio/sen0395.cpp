#include "sen0395.h"

#include <string.h>

namespace visionaria {
namespace sen0395 {

namespace {

constexpr uint8_t kPasoParar = 0;     // sensorStop
constexpr uint8_t kPasoRango = 1;     // detRangeCfg
constexpr uint8_t kPasoGuardar = 3;   // saveCfg
constexpr uint8_t kPasoArrancar = 4;  // sensorStart
// getRange: solo en la recuperación ligera, con el radar parado, tras sensorStop.
// Fuera de la cuenta 0..4 de la secuencia completa (kPasosConfiguracion).
constexpr uint8_t kPasoVerificar = 6;

// Tolerancia al comparar la ventana leída con la configurada. El radar responde
// en metros con tres decimales (`0.450` para el índice 3); un índice son 150 mm,
// así que 10 mm absorbe un redondeo y nunca confunde dos índices distintos.
constexpr int32_t kToleranciaRangoMm = 10;

const char kTramaPresencia[] = "$JYBSS,1, , , *";
const char kTramaNadie[] = "$JYBSS,0, , , *";

bool igual(const uint8_t* a, size_t n, const char* texto) {
  return n == strlen(texto) && memcmp(a, texto, n) == 0;
}

// Prefijo propio y no vacío de una trama válida: un corte, no una corrupción.
bool prefijo_estricto(const uint8_t* a, size_t n, const char* texto) {
  return n > 0 && n < strlen(texto) && memcmp(a, texto, n) == 0;
}

// Reloj uint32_t con vuelta: la resta sin signo da el tiempo transcurrido. Para
// la edad de un dato, una diferencia >= 2^31 es un reloj que retrocedió: se
// trata como "infinitamente viejo" (nunca como reciente), error visible y seguro.
// Los plazos de transición (estabilización, purga, hueco de lectura) NO usan
// ese corte: comparan `ahora - marca >= duración` en módulo 2^32, así un plazo
// de hasta 2^31 - 1 ms vence aunque se consulte pasado el umbral.
uint32_t edad(uint32_t ahora, uint32_t marca) {
  const uint32_t d = ahora - marca;
  return d >= 0x80000000u ? 0xFFFFFFFFu : d;
}

// Metros decimales sin signo (`0.450`) a milímetros, con redondeo al mm. Estricto:
// 1 a 3 cifras enteras y, si hay punto, 1 a 6 decimales; nada más. `*i` avanza.
bool metros_a_mm(const uint8_t* a, size_t n, size_t* i, int32_t* mm) {
  size_t k = *i;
  int32_t entero = 0;
  size_t cifras = 0;
  while (k < n && a[k] >= '0' && a[k] <= '9' && cifras < 3) {
    entero = entero * 10 + (a[k++] - '0');
    ++cifras;
  }
  if (cifras == 0) return false;
  int32_t frac = 0;  // milésimas
  bool sube = false;
  if (k < n && a[k] == '.') {
    ++k;
    size_t d = 0;
    while (k < n && a[k] >= '0' && a[k] <= '9' && d < 6) {
      const int32_t v = a[k++] - '0';
      if (d < 3) frac = frac * 10 + v;
      else if (d == 3) sube = v >= 5;
      ++d;
    }
    if (d == 0) return false;
    for (size_t r = d; r < 3; ++r) frac *= 10;
  }
  if (k < n && a[k] >= '0' && a[k] <= '9') return false;  // más cifras de las admitidas
  *mm = entero * 1000 + frac + (sube ? 1 : 0);
  *i = k;
  return true;
}

// `Response <inicio> <fin>` (metros) de getRange; false si no es exactamente eso.
bool leer_respuesta_rango(const uint8_t* l, size_t n, int32_t* inicio_mm, int32_t* fin_mm) {
  const char kPrefijo[] = "Response ";
  const size_t m = sizeof(kPrefijo) - 1;
  if (n <= m || memcmp(l, kPrefijo, m) != 0) return false;
  size_t i = m;
  if (!metros_a_mm(l, n, &i, inicio_mm)) return false;
  if (i >= n || l[i] != ' ') return false;
  ++i;
  return metros_a_mm(l, n, &i, fin_mm) && i == n;
}

int32_t abs_mm(int32_t v) { return v < 0 ? -v : v; }

struct Escritor {
  Escritor(uint8_t* d, size_t c) : destino(d), capacidad(c) {}
  uint8_t* destino;
  size_t capacidad;
  size_t n = 0;
  bool ok = true;

  void texto(const char* t) {
    const size_t m = strlen(t);
    if (n + m > capacidad) {
      ok = false;
      return;
    }
    memcpy(destino + n, t, m);
    n += m;
  }
  void numero(uint32_t v) {
    char dig[10];
    size_t k = 0;
    do {
      dig[k++] = static_cast<char>('0' + v % 10);
      v /= 10;
    } while (v != 0);
    char sal[11];
    size_t j = 0;
    while (k > 0) sal[j++] = dig[--k];
    sal[j] = '\0';
    texto(sal);
  }
};

}  // namespace

bool configuracion_valida(const Configuracion& c) {
  return c.ventana_inicio < c.ventana_fin && c.ventana_fin <= kIndiceVentanaMax &&
         c.estabilizacion_ms >= kEstabilizacionMinMs && c.estabilizacion_ms <= kPlazoMaxMs &&
         c.respuesta_max_ms > 0 && c.respuesta_max_ms <= kPlazoMaxMs;
}

Interprete::Interprete(const Configuracion& cfg) : cfg_(cfg) {
  memset(linea_, 0, sizeof(linea_));
  reiniciar();
  cont_.reinicios = 0;  // la construcción no es un reinicio
}

void Interprete::reiniciar(bool completa) {
  ++cont_.reinicios;
  // Sin configuración guardada por nosotros, el radar no puede arrancar sin pasar
  // por detRangeCfg, outputLatency y saveCfg (banco 12/11, R2).
  ligera_ = !completa && guardada_;
  parado_ya_ = false;
  rango_ok_ = false;
  // Una respuesta tardía de la orden vieja no debe confirmar la nueva. Con la
  // orden en vuelo, la purga empieza cuando venza su plazo (en avanzar()), como
  // tras un timeout: así dura >= 2 x respuesta_max_ms desde su envío.
  en_vuelo_ = en_vuelo_ || esperando_;
  purgando_ = purgando_ || esperando_ || motivo_ == MotivoFallo::RespuestaTimeout;
  const bool valida = configuracion_valida(cfg_);
  fase_ = valida ? Fase::Configurando : Fase::Fallo;
  motivo_ = valida ? MotivoFallo::Ninguno : MotivoFallo::ConfiguracionInvalida;
  paso_ = 0;
  esperando_ = false;
  hay_trama_ = false;
  malo_ = Malo::Ninguno;
  causa_ = CausaInvalida::Ninguna;
  largo_ = 0;
  descartando_ = false;
  hay_llamada_ = false;
}

size_t Interprete::construir_orden(uint8_t paso, uint8_t* destino, size_t capacidad) const {
  if (destino == nullptr) return 0;
  Escritor w(destino, capacidad);
  switch (paso) {
    case kPasoParar:
      w.texto("sensorStop");
      break;
    case kPasoRango:
      w.texto("detRangeCfg -1 ");
      w.numero(cfg_.ventana_inicio);
      w.texto(" ");
      w.numero(cfg_.ventana_fin);
      break;
    case 2:
      w.texto("outputLatency -1 ");
      w.numero(cfg_.latencia_deteccion);
      w.texto(" ");
      w.numero(cfg_.latencia_desaparicion);
      break;
    case kPasoGuardar:
      w.texto("saveCfg 0x45670123 0xCDEF89AB 0x956128C6 0xDF54AC89");
      break;
    case kPasoArrancar:
      w.texto("sensorStart");
      break;
    case kPasoVerificar:
      w.texto("getRange");
      break;
    default:
      return 0;
  }
  w.texto("\r\n");
  return w.ok ? w.n : 0;
}

size_t Interprete::salida_pendiente(uint8_t* destino, size_t capacidad) const {
  if (fase_ != Fase::Configurando || esperando_ || purgando_) return 0;
  return construir_orden(paso_, destino, capacidad);
}

void Interprete::salida_enviada(uint32_t ahora_ms) {
  if (fase_ != Fase::Configurando || esperando_ || purgando_) return;
  esperando_ = true;
  parado_ya_ = false;
  rango_ok_ = false;
  t_envio_ = ahora_ms;
  // Lo recibido antes de la orden no es su respuesta.
  largo_ = 0;
  descartando_ = false;
}

// La orden en curso quedó cumplida (su Done, o el Error aceptado de sensorStop).
void Interprete::orden_confirmada(uint32_t ahora_ms) {
  esperando_ = false;
  parado_ya_ = false;
  if (paso_ == kPasoVerificar) {
    if (rango_ok_) {
      paso_ = kPasoArrancar;  // la flash del radar tiene nuestra ventana: arranca sin tocar nada
    } else {
      // Otra ventana, ilegible o `Error`: no se sabe qué tiene el radar. Secuencia
      // completa, con saveCfg (el radar sigue parado, así que acepta los parámetros).
      ++cont_.rangos_distintos;
      ligera_ = false;
      paso_ = kPasoRango;
    }
    return;
  }
  // Recuperación ligera: del paro a comprobar la ventana, sin tocar parámetros.
  if (ligera_ && paso_ == kPasoParar) {
    paso_ = kPasoVerificar;
    return;
  }
  ++paso_;
  if (paso_ >= kPasosConfiguracion) {
    fase_ = Fase::Estabilizando;
    t_estab_ = ahora_ms;  // los 5 s cuentan desde el Done de sensorStart
  }
}

void Interprete::fallar(MotivoFallo m, uint32_t ahora_ms) {
  fase_ = Fase::Fallo;
  motivo_ = m;
  esperando_ = false;
  hay_trama_ = false;
  t_fallo_ = ahora_ms;
}

void Interprete::marcar_malo(Malo m, CausaInvalida causa) {
  if (fase_ != Fase::Operando) return;
  hay_trama_ = false;  // nunca se reutiliza el resultado anterior
  malo_ = m;
  if (m == Malo::ErrorRadar) {
    ++cont_.errores_radar;
    return;
  }
  causa_ = causa;
  if (causa == CausaInvalida::Parcial) ++cont_.invalidas_parciales;
  else if (causa == CausaInvalida::Larga) ++cont_.invalidas_largas;
  else ++cont_.invalidas_otras;
}

void Interprete::avanzar(uint32_t ahora_ms) {
  if (en_vuelo_ && edad(ahora_ms, t_envio_) > cfg_.respuesta_max_ms) {
    en_vuelo_ = false;  // venció el plazo de la orden vieja: empieza la purga
    t_fallo_ = ahora_ms;
  }
  if (purgando_ && !en_vuelo_ && ahora_ms - t_fallo_ >= cfg_.respuesta_max_ms) purgando_ = false;
  if (fase_ == Fase::Configurando && esperando_) {
    const uint32_t d = edad(ahora_ms, t_envio_);
    if (d > cfg_.respuesta_max_ms) {
      ++cont_.timeouts_orden;
      fallar(MotivoFallo::RespuestaTimeout, ahora_ms);
    }
  }
  if (fase_ == Fase::Estabilizando) {
    if (ahora_ms - t_estab_ >= cfg_.estabilizacion_ms) {
      fase_ = Fase::Operando;
      // El plazo del primer latido corre desde el fin de la estabilización.
      t_trama_ = t_estab_ + cfg_.estabilizacion_ms;
      // Lo recibido durante la estabilización no cuenta: solo tramas íntegras nuevas.
      largo_ = 0;
      descartando_ = false;
      hay_trama_ = false;
      malo_ = Malo::Ninguno;
    }
  }
  if (fase_ == Fase::Operando && hay_trama_ && edad(ahora_ms, t_trama_) > kLatidoCaducaMs)
    hay_trama_ = false;
  if ((largo_ > 0 || descartando_) && edad(ahora_ms, t_byte_) > kLineaParcialMaxMs) {
    const bool era_larga = descartando_;
    largo_ = 0;
    descartando_ = false;
    if (!era_larga) marcar_malo(Malo::Invalida, CausaInvalida::Parcial);
  }
}

void Interprete::linea_completa(uint32_t ahora_ms, uint32_t sello_ms) {
  const uint8_t* l = linea_;
  const size_t n = largo_;
  switch (fase_) {
    case Fase::Fallo:
      return;
    case Fase::Configurando:
      if (!esperando_) {
        ++cont_.lineas_ignoradas;  // respuesta sin orden en curso: nunca vale
      } else if (igual(l, n, "Done")) {
        if (paso_ == kPasoGuardar) guardada_ = true;
        orden_confirmada(ahora_ms);
      } else if (paso_ == kPasoParar && igual(l, n, "sensor stopped already")) {
        // El SEN0395 contesta así a sensorStop con el radar ya parado, y la línea
        // siguiente es `Error` (banco 12/11, R1; la wiki de DFRobot documenta ese
        // Error: «the sensor is not in operating status»). Que ya esté parado es
        // lo que se pedía: el Error que sigue se acepta solo en este paso.
        parado_ya_ = true;
        ++cont_.lineas_ignoradas;
      } else if (paso_ == kPasoVerificar && n > 0 && l[0] == 'R') {
        // La respuesta de getRange. Vale la última: una línea ilegible o de otra
        // ventana la anula y el radar no se arranca con ella (ver orden_confirmada).
        int32_t ini = 0, fin = 0;
        rango_ok_ = leer_respuesta_rango(l, n, &ini, &fin) &&
                    abs_mm(ini - cfg_.ventana_inicio * kPasoVentanaMm) <= kToleranciaRangoMm &&
                    abs_mm(fin - cfg_.ventana_fin * kPasoVentanaMm) <= kToleranciaRangoMm;
      } else if (igual(l, n, "Error")) {
        if (paso_ == kPasoVerificar) {
          // getRange rechazado: no es un fallo, es no poder comprobar. Se cae a la completa.
          rango_ok_ = false;
          orden_confirmada(ahora_ms);
        } else if (parado_ya_) {
          orden_confirmada(ahora_ms);
        } else {
          ++cont_.errores_radar;
          // Una recuperación ligera que acaba en Error no sabe qué tiene el radar
          // en la flash: la siguiente repite la secuencia completa.
          if (ligera_) guardada_ = false;
          fallar(MotivoFallo::RespuestaError, ahora_ms);
        }
      } else {
        ++cont_.lineas_ignoradas;  // eco de la orden, tramas de salida continua...
      }
      return;
    case Fase::Estabilizando:
      if (igual(l, n, "Error")) {
        ++cont_.errores_radar;
        fallar(MotivoFallo::RespuestaError, ahora_ms);
      } else {
        ++cont_.lineas_ignoradas;
      }
      return;
    case Fase::Operando:
      break;
  }
  const bool presencia = igual(l, n, kTramaPresencia);
  if (presencia || igual(l, n, kTramaNadie)) {
    ++cont_.tramas_validas;
    hay_trama_ = true;
    presencia_ = presencia;
    t_trama_ = sello_ms;  // cada trama íntegra nueva renueva la edad, aunque repita el 0/1
    malo_ = Malo::Ninguno;
  } else if (igual(l, n, "Error")) {
    marcar_malo(Malo::ErrorRadar, CausaInvalida::Ninguna);
  } else if (igual(l, n, "Done")) {
    ++cont_.lineas_ignoradas;
  } else {
    const bool corte = prefijo_estricto(l, n, kTramaPresencia) || prefijo_estricto(l, n, kTramaNadie);
    marcar_malo(Malo::Invalida, corte ? CausaInvalida::Parcial : CausaInvalida::Otra);
  }
}

size_t Interprete::procesar(const uint8_t* datos, size_t n, uint32_t ahora_ms) {
  avanzar(ahora_ms);
  // Si el llamador tardó, los bytes pudieron esperar en la UART: se fechan en
  // la llamada anterior (más viejos), nunca en el instante de lectura.
  uint32_t sello = ahora_ms;
  if (hay_llamada_ && ahora_ms - t_llamada_ > kHuecoLecturaMaxMs) sello = t_llamada_;
  hay_llamada_ = true;
  t_llamada_ = ahora_ms;

  if (datos == nullptr) return 0;
  if (n > kMaxBytesPorLlamada) {
    // Oferta fuera de la cota: se descarta entera sin leerla (ni trama ni Done
    // dentro valen) y falla seguro. Se pierde la línea en curso; en operación,
    // el resultado anterior deja de valer hasta una trama íntegra nueva y el
    // plazo del latido no se renueva. Un Done perdido en la configuración
    // vence por timeout.
    largo_ = 0;
    descartando_ = false;
    marcar_malo(Malo::Invalida, CausaInvalida::Larga);
    return n;
  }
  for (size_t i = 0; i < n; ++i) {
    const uint8_t b = datos[i];
    if (b == '\r' || b == '\n') {
      if (!descartando_ && largo_ > 0) linea_completa(ahora_ms, sello);
      largo_ = 0;
      descartando_ = false;
      continue;
    }
    t_byte_ = ahora_ms;
    if (descartando_) continue;
    if (largo_ >= kLongitudLineaMax) {
      descartando_ = true;
      largo_ = 0;
      marcar_malo(Malo::Invalida, CausaInvalida::Larga);
    } else {
      linea_[largo_++] = b;
    }
  }
  return n;
}

void Interprete::perder_entrada(uint32_t ahora_ms) {
  avanzar(ahora_ms);
  largo_ = 0;
  descartando_ = false;
  marcar_malo(Malo::Invalida, CausaInvalida::Larga);
}

uint8_t Interprete::salud_actual(uint32_t ahora_ms) const {
  switch (fase_) {
    case Fase::Fallo:
      return motivo_ == MotivoFallo::ConfiguracionInvalida ? kSaludConfigNoValida : kSaludFalloRadar;
    case Fase::Configurando:
    case Fase::Estabilizando:
      return kSaludIniciando;
    case Fase::Operando:
      break;
  }
  // El plazo corre desde la última trama válida (o el fin de la estabilización):
  // ni la corrupción ni un `Error` lo renuevan.
  if (edad(ahora_ms, t_trama_) > kLatidoCaducaMs) return kSaludSinDatos;
  if (hay_trama_) return kSaludOk;
  if (malo_ != Malo::Ninguno) return malo_ == Malo::ErrorRadar ? kSaludFalloRadar : kSaludTramaInvalida;
  return kSaludIniciando;
}

uint8_t Interprete::salud(uint32_t ahora_ms) {
  avanzar(ahora_ms);
  return salud_actual(ahora_ms);
}

bool Interprete::latido_vigente(uint32_t ahora_ms) { return salud(ahora_ms) == kSaludOk; }

ble::EntradaRadar Interprete::entrada(uint32_t ahora_ms) {
  avanzar(ahora_ms);
  ble::EntradaRadar e;
  const uint8_t s = salud_actual(ahora_ms);
  if (s == kSaludOk) {
    // Solo presencia 0/1: nunca Objetivo, distancia ni azimut.
    e.estado = presencia_ ? ble::EstadoRadar::Presencia : ble::EstadoRadar::SinBlanco;
    e.edad_ms = static_cast<uint16_t>(edad(ahora_ms, t_trama_));  // <= 2500
  } else {
    e.estado = ble::EstadoRadar::Fallo;
    e.salud = s;
    e.edad_ms = ble::kEdadDesconocida;
  }
  return e;
}

}  // namespace sen0395
}  // namespace visionaria

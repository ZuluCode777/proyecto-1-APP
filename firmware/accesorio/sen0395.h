// Intérprete portátil de la UART del radar DFRobot SEN0395 (EA-11).
//
// Qué hace: arma las órdenes de configuración, interpreta sus respuestas y las
// tramas `$JYBSS,0, , , *` / `$JYBSS,1, , , *`, y entrega una EntradaRadar para
// el emisor del contrato BLE v1.0, con salud explícita.
//
// Qué NO hace: el SEN0395 entrega presencia dentro de una ventana, nunca
// distancia, ángulo ni "camino libre". Aquí no existe ninguna ruta que produzca
// EstadoRadar::Objetivo, distancia o azimut. Tampoco lee GPIO2: el pin es
// provisional hasta el ensayo B2 y no acredita nada (contrato-ble.md, §7).
//
// Portátil: sin Arduino.h, sin bloqueos, sin excepciones y sin memoria
// dinámica (todo el estado vive en el objeto, 176 bytes en x86-64). El llamador pasa
// bytes ya leídos de la UART y el reloj monotónico en ms (uint32_t, con
// vuelta módulo 2^32 correcta). Ver docs/expoandes/ea-11-radar.md.
#ifndef VISIONARIA_SEN0395_H
#define VISIONARIA_SEN0395_H

#include <stddef.h>
#include <stdint.h>

#include "emisor_sintetico.h"

namespace visionaria {
namespace sen0395 {

// UART del módulo: 115200 baudios, 8N1 (wiki de DFRobot, consulta 6/11/2026).
constexpr uint32_t kBaudios = 115200;

// Salud del contrato BLE (§3). El intérprete solo produce estos valores.
// 5 (alimentación) y la medición eléctrica no son asunto suyo: la decide EA-12.
constexpr uint8_t kSaludOk = 0;
constexpr uint8_t kSaludIniciando = 1;     // configurando o estabilizando
constexpr uint8_t kSaludSinDatos = 2;      // sin trama VÁLIDA en 2500 ms: timeout o desconexión
constexpr uint8_t kSaludTramaInvalida = 3; // parcial, corrupta, larga o no admitida
constexpr uint8_t kSaludFalloRadar = 4;    // `Error`, o orden sin respuesta
constexpr uint8_t kSaludConfigNoValida = 6;  // configuración del llamador rechazada

// Un latido (trama válida) caduca cuando su edad supera 2500 ms: edad <= 2500
// es vigente, 2501 no, igual que el 500/501 de la caducidad BLE. Umbral de
// diseño por confirmar en B1/B2 (contrato-ble.md, §7).
constexpr uint32_t kLatidoCaducaMs = 2500;
// El fabricante exige >= 5 s tras encender o arrancar (plan-firmware.md);
// B1 mide el valor real. Ninguna Configuracion puede bajar de aquí.
constexpr uint32_t kEstabilizacionMinMs = 5000;
// Una línea sin terminador se descarta (y cuenta como parcial) tras este silencio.
constexpr uint32_t kLineaParcialMaxMs = 500;
// Si el llamador tarda más que esto entre dos llamadas a procesar(), los bytes
// pudieron esperar en el búfer de la UART: sus tramas se fechan en la llamada
// anterior (más viejas, nunca más jóvenes que la realidad).
constexpr uint32_t kHuecoLecturaMaxMs = 250;

// Tope de los plazos de Configuracion (2^31 - 1 ms, ~24,8 días). Los plazos se
// miden con la resta módulo 2^32 y vencen cuando la diferencia es >= el plazo:
// aun si el llamador consulta mucho después del vencimiento, la transición
// ocurre. A cambio, `ahora_ms` no debe decrecer (un reloj atrás se lee como
// mucho tiempo transcurrido y vence antes, no después).
constexpr uint32_t kPlazoMaxMs = 0x7FFFFFFFu;

constexpr size_t kLongitudLineaMax = 64;       // más larga: línea inválida
constexpr size_t kMaxBytesPorLlamada = 256;    // más que esto en una oferta: se descarta entera
constexpr size_t kLongitudOrdenMax = 64;       // capacidad suficiente para salida_pendiente
constexpr uint8_t kPasosConfiguracion = 5;     // stop, rango, latencia, guardar, start
constexpr uint8_t kIndiceVentanaMax = 127;     // detRangeCfg: índices 0..127
constexpr uint16_t kPasoVentanaMm = 150;       // 15 cm por índice

struct Configuracion {
  // Ventana de detección, en índices de 15 cm (0..127). Por defecto 0 a 45 cm
  // (índice 3: `getRange` responde `0.000 0.450` en el banco del 12/11), la
  // ventana de ~40 cm que usa el equipo. La de fábrica (índice 20, 3 m) dejaba el
  // radar en «presencia» casi siempre.
  uint8_t ventana_inicio = 0;
  uint8_t ventana_fin = 3;
  // outputLatency (primero detectar, luego desaparecer). Valores de fábrica, SIN
  // cambiar: B2 decide el mínimo estable y no se inventa uno sin medición.
  // Medido el 12/11: tras `outputLatency -1 100 400`, `getLatency` responde
  // `0.025 10.000` (s): 0,025 s al detectar y 10 s al desaparecer, no 2,5 s / 10 s.
  // `latencia_desaparicion` va en pasos de 25 ms (400 x 25 ms = 10 s). Con
  // `latencia_deteccion` = 100 el radar informa 0,025 s, no los 2,5 s que darían
  // 100 x 25 ms: su unidad no es de 25 ms (un solo punto medido; no se extrapola).
  uint16_t latencia_deteccion = 100;
  uint16_t latencia_desaparicion = 400;
  uint32_t estabilizacion_ms = kEstabilizacionMinMs;
  // Plazo de cada orden desde que salida_enviada() la da por escrita.
  uint32_t respuesta_max_ms = 2000;
};

// Falso si la ventana es vacía o sale de 0..127, si estabilizacion_ms < 5000 o
// > kPlazoMaxMs, o si respuesta_max_ms es 0 o > kPlazoMaxMs. Un intérprete con configuración inválida no envía
// nada y queda en salud 6.
bool configuracion_valida(const Configuracion& cfg);

enum class Fase : uint8_t {
  Configurando,   // enviando órdenes y esperando Done/Error
  Estabilizando,  // sensorStart aceptado; se ignoran las tramas
  Operando,       // se interpretan tramas
  Fallo,          // terminal hasta reiniciar()
};

enum class MotivoFallo : uint8_t {
  Ninguno,
  ConfiguracionInvalida,
  RespuestaError,     // el radar contestó Error
  RespuestaTimeout,   // la orden no recibió respuesta a tiempo
};

enum class CausaInvalida : uint8_t {
  Ninguna,
  Parcial,  // línea terminada que es prefijo estricto de una trama válida, o
            // fragmento sin terminador descartado por silencio
  Larga,    // más de kLongitudLineaMax bytes
  Otra,     // corrupta o formato no admitido (incluye campos con valores)
};

// Contadores acumulados; reiniciar() no los borra (sirven en la bitácora de banco).
struct Contadores {
  uint32_t tramas_validas = 0;
  uint32_t invalidas_parciales = 0;
  uint32_t invalidas_largas = 0;
  uint32_t invalidas_otras = 0;
  uint32_t lineas_ignoradas = 0;  // no vacías, fuera de lugar (eco, Done suelto, durante la espera)
  uint32_t errores_radar = 0;     // líneas `Error`
  uint32_t timeouts_orden = 0;
  uint32_t reinicios = 0;
};

class Interprete {
 public:
  explicit Interprete(const Configuracion& cfg = Configuracion());

  // Vuelve al principio: borra línea parcial, resultado y fallo, y repite la
  // configuración desde sensorStop. NUNCA conserva un resultado anterior; la
  // recuperación exige una observación íntegra NUEVA tras la estabilización.
  // Úsalo tras reiniciar o desconectar el radar. Una configuración fallida no
  // se reintenta sola: quien reintenta es enlace_radar.h (SupervisorRadar), con
  // espera creciente. `guardar_en_flash = false` omite saveCfg: aplica rango y
  // latencia solo en la RAM del sensor, sin gastar ciclos de su flash. El
  // arranque de la placa usa true (una escritura por arranque); toda recuperación
  // posterior usa false.
  // Purga: tras un fallo por timeout, o si se reinicia con una orden en vuelo,
  // la primera orden nueva se retiene hasta que pasen respuesta_max_ms desde que
  // venció el plazo de la orden vieja (en total, >= 2 x respuesta_max_ms desde
  // que ella se envió). Una respuesta vieja que llegue dentro de ese tiempo no
  // puede confirmar la nueva. Límite real: las respuestas no traen eco ni
  // identificador, así que una que llegue más de 2 x respuesta_max_ms después
  // de su orden no se distingue de la de la orden nueva; B1 mide la latencia
  // real de cada orden y fija un plazo que lo haga imposible. El llamador debe
  // además vaciar la UART al reiniciar.
  void reiniciar(bool guardar_en_flash = true);

  // --- Salida: órdenes hacia el radar ---------------------------------------
  // Copia la orden pendiente (con "\r\n") a destino y devuelve su longitud.
  // Devuelve 0 si no hay orden por enviar (se espera respuesta, se purga, se
  // estabiliza, opera o falló) o si no cabe en `capacidad` (usa
  // kLongitudOrdenMax). La purga termina dentro de procesar()/entrada(). Sin
  // efectos: se puede llamar de nuevo hasta que salida_enviada() la confirme.
  size_t salida_pendiente(uint8_t* destino, size_t capacidad) const;
  // Confirma que la orden de salida_pendiente() se escribió ENTERA en la UART
  // (no confirmes escrituras parciales: reintenta con salida_pendiente()). Inicia
  // el plazo de respuesta y descarta cualquier línea parcial anterior.
  void salida_enviada(uint32_t ahora_ms);

  // --- Entrada: bytes de la UART --------------------------------------------
  // Procesa una oferta de bytes y devuelve cuántos ATENDIÓ (consumió o
  // descartó); el llamador no debe volver a ofrecerlos. Nunca queda resto.
  //   n <= kMaxBytesPorLlamada: se procesan los n bytes y se devuelve n.
  //   n >  kMaxBytesPorLlamada: la oferta ENTERA se descarta en O(1), sin leer
  //     un solo byte (ni trama ni `Done` dentro de ella valen), y se devuelve n.
  //     El trabajo leído es acotado, pero el retorno puede ser mayor que la
  //     cota: son bytes descartados, no procesados. Se pierde la línea parcial
  //     en curso, y en operación el resultado anterior deja de valer (salud 3,
  //     contada como `Larga`) hasta una trama íntegra NUEVA; el plazo del
  //     latido no se renueva. Durante la configuración un `Done` perdido
  //     vence por timeout (nada se confirma por error). Con `datos == nullptr`
  //     devuelve 0 y no cambia nada.
  // No bloquea. Llámalo en CADA ciclo, también con n == 0: así el intérprete
  // sabe cuándo se leyó la UART por última vez (ver kHuecoLecturaMaxMs).
  // `ahora_ms` es la hora en que se leyeron esos bytes.
  // Edad: cada trama válida COMPLETA y nueva renueva la edad, aunque repita el
  // 0/1 anterior (la trama no trae contador ni marca de tiempo). La edad mide
  // desde la recepción íntegra, no desde la captura del radar, y el intérprete
  // no puede saber si el radar repitió internamente una lectura vieja. Solo
  // recibir otra trama renueva la edad: consultar entrada() o reemitir por BLE
  // nunca la rejuvenece.
  size_t procesar(const uint8_t* datos, size_t n, uint32_t ahora_ms);

  // El llamador PERDIÓ bytes de la UART (descartó un trozo que no pudo fechar, o
  // el controlador de la UART avisó de un desborde). Lo que el intérprete tenga
  // a medias deja de valer: la línea parcial se borra (no se une con lo que
  // llegue después) y, en operación, el resultado anterior deja de valer (salud
  // 3, contada como `Larga`) hasta una trama íntegra NUEVA; el plazo del latido
  // no se renueva. Durante la configuración un `Done` perdido vence por timeout.
  // No fabrica ni restaura ninguna trama. Llámalo antes del procesar() de ese
  // ciclo.
  void perder_entrada(uint32_t ahora_ms);

  // --- Consulta ---------------------------------------------------------------
  // Entrada para ble::EmisorSintetico::generar(). Avanza el tiempo (caducidad,
  // estabilización, plazo de respuesta). `ahora_ms` no debe decrecer.
  //   salud 0: SinBlanco o Presencia con edad_ms = ahora - recepción íntegra de
  //            la última trama (<= 2500). Con edad > 500 el emisor publica
  //            "vencido": es el conflicto de 1 Hz de la UART, no un defecto.
  //   otra salud: EstadoRadar::Fallo, edad desconocida, sin resultado alguno.
  // El plazo de 2500 ms corre desde la última trama VÁLIDA (o desde el fin de la
  // estabilización): ni línea corrupta ni `Error` lo renuevan. Pasado el plazo,
  // salud 2 aunque siga llegando ruido.
  ble::EntradaRadar entrada(uint32_t ahora_ms);
  // Salud actual (0..4 o 6); mismo avance de tiempo que entrada().
  uint8_t salud(uint32_t ahora_ms);
  // true si hay una trama válida con edad <= kLatidoCaducaMs. Para EA-12: si
  // luego se adopta GPIO2 (provisional hasta B2), solo vale con este latido.
  bool latido_vigente(uint32_t ahora_ms);

  Fase fase() const { return fase_; }
  MotivoFallo motivo_fallo() const { return motivo_; }
  CausaInvalida ultima_causa_invalida() const { return causa_; }
  const Contadores& contadores() const { return cont_; }
  const Configuracion& configuracion() const { return cfg_; }
  // Ventana en mm para ble::Informacion (capacidades 0: describe la ventana de
  // presencia, no una distancia medida).
  uint16_t ventana_minima_mm() const { return cfg_.ventana_inicio * kPasoVentanaMm; }
  uint16_t ventana_maxima_mm() const { return cfg_.ventana_fin * kPasoVentanaMm; }

 private:
  enum class Malo : uint8_t { Ninguno, Invalida, ErrorRadar };

  void avanzar(uint32_t ahora_ms);
  void linea_completa(uint32_t ahora_ms, uint32_t sello_ms);
  void marcar_malo(Malo m, CausaInvalida causa);
  void fallar(MotivoFallo m, uint32_t ahora_ms);
  size_t construir_orden(uint8_t paso, uint8_t* destino, size_t capacidad) const;
  uint8_t salud_actual(uint32_t ahora_ms) const;

  Configuracion cfg_;
  Contadores cont_;

  bool guardar_ = true;  // false: la configuración se aplica sin saveCfg (paso 3)
  Fase fase_ = Fase::Configurando;
  MotivoFallo motivo_ = MotivoFallo::Ninguno;
  uint8_t paso_ = 0;
  bool esperando_ = false;
  uint32_t t_envio_ = 0;
  uint32_t t_estab_ = 0;
  bool purgando_ = false;
  bool en_vuelo_ = false;  // reiniciar() con orden en vuelo: la purga empieza cuando venza su plazo
  uint32_t t_fallo_ = 0;   // inicio de la purga

  bool hay_trama_ = false;
  bool presencia_ = false;
  uint32_t t_trama_ = 0;  // última trama válida; al operar, fin de la estabilización
  Malo malo_ = Malo::Ninguno;
  CausaInvalida causa_ = CausaInvalida::Ninguna;

  uint8_t linea_[kLongitudLineaMax];
  size_t largo_ = 0;
  bool descartando_ = false;  // línea larga: se tira hasta el terminador
  uint32_t t_byte_ = 0;
  bool hay_llamada_ = false;
  uint32_t t_llamada_ = 0;
};

}  // namespace sen0395
}  // namespace visionaria

#endif

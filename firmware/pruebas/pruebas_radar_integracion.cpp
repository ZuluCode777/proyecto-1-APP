// Pruebas de integración del radar (EA-11 dentro de EA-12), en el portátil: el
// intérprete REAL de sen0395.h, la lectura de la UART y el supervisor de
// recuperación de enlace_radar.h, con un doble mínimo de la UART y del radar
// (bytes, reloj y respuestas Done/Error). Cubre:
//   - desborde de la UART: una línea a medias NO se une con lo que llegue después
//     (la lógica anterior fabricaba una trama válida con un SinBlanco falso), y el
//     resultado anterior deja de valer hasta una trama íntegra nueva;
//   - recuperación acotada: el radar se reinicia o se calla, la configuración
//     falla; purga de la UART, estabilización de al menos 5 s, observación nueva,
//     espera creciente y ninguna escritura de la flash del sensor al recuperar.
// No prueban la UART real, el radar ni NimBLE: eso es de la placa.
// Uso: pruebas_radar_integracion
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <deque>
#include <string>
#include <vector>

#include "enlace_radar.h"
#include "sen0395.h"

using namespace visionaria;
using sen0395::Fase;
using sen0395::Interprete;

namespace {

int g_casos = 0;
int g_fallos = 0;

#define EXIGIR(cond)                                                   \
  do {                                                                 \
    ++g_casos;                                                         \
    if (!(cond)) {                                                     \
      ++g_fallos;                                                      \
      fprintf(stderr, "FALLO %s:%d: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                  \
  } while (0)

// UART y radar simulados. Un ciclo (tick) son 2 ms, como el loop del sketch.
// El radar simulado se comporta como el SEN0395 real del banco del 12/11/2026
// (radar-ordenes.log) y de la wiki de DFRobot:
//   - sensorStop con el radar parado: `sensor stopped already` + `Error` (R1);
//   - detRangeCfg/outputLatency con el radar en marcha: `sensor is not stopped` + `Error`;
//   - detRangeCfg/outputLatency aceptados dejan «parámetros sin guardar», aunque
//     repitan los valores guardados;
//   - sensorStart con parámetros sin guardar: `new parameter isn't save, can't
//     startSensor` + `Error` (R2); con el radar en marcha: `sensor started already`;
//   - saveCfg sin nada que guardar: `Error`; si no, escribe la flash;
//   - getRange: eco de la orden, `Response 0.000 0.450` (metros, ventana aplicada),
//     `Done` y el indicador `leapMMW:/>`, como en el banco; con `getrange_crudo` se
//     contesta lo que se quiera (basura, `Error`, tramas intercaladas...);
//   - tras reiniciarse, vuelve PARADO y con lo último que guardó.
class SimUart : public radar::PuertoUart {
 public:
  // ErrorAlGuardar: el primer saveCfg contesta Error (una escritura de la flash que falla).
  enum class Modo { Normal, Mudo, ErrorAlGuardar, ErrorSiempre };

  uint32_t t = 1000;
  std::deque<uint8_t> rx;
  std::vector<std::string> ordenes;  // una por línea enviada al radar
  bool perdida = false;
  // > 0: el desborde se produce DURANTE la lectura, al leer() número `perder_al_leer`
  // (onReceiveError corre en otra tarea mientras loop() lee la UART).
  int perder_al_leer = 0;
  Modo modo = Modo::Normal;
  bool marcha = false;  // el radar emite una trama por segundo
  uint32_t proxima_trama = 0;
  bool presencia = false;
  bool sin_guardar = false;  // parámetros aplicados y no guardados en la flash del radar
  int escrituras_flash = 0;  // saveCfg que sí escribieron la flash
  bool sin_guardar_al_volver = false;  // el próximo reinicio del radar lo deja sin la configuración guardada
  // Ventana (índices de 15 cm) que el radar tiene aplicada y la que guardó en su flash.
  // De fábrica, 0 a 20 (3 m). Las pruebas cambian `rango_flash_*` para imitar un módulo
  // sustituido o una flash que perdió la configuración.
  int rango_ini = 0, rango_fin = 20;
  int rango_flash_ini = 0, rango_flash_fin = 20;
  std::string getrange_crudo;  // si no está vacío, es TODO lo que getRange contesta

  uint32_t ahora() override { return t; }
  int disponibles() override { return static_cast<int>(rx.size()); }
  int leer() override {
    if (rx.empty()) return -1;
    const uint8_t b = rx.front();
    rx.pop_front();
    if (perder_al_leer > 0 && --perder_al_leer == 0) perdida = true;
    return b;
  }
  size_t escribibles() override { return 64; }
  size_t escribir(const uint8_t* d, size_t n) override {
    escrito_.append(reinterpret_cast<const char*>(d), n);
    size_t fin;
    while ((fin = escrito_.find('\n')) != std::string::npos) {
      std::string linea = escrito_.substr(0, fin);
      if (!linea.empty() && linea.back() == '\r') linea.pop_back();
      escrito_.erase(0, fin + 1);
      radar_recibe(linea);
    }
    return n;
  }
  bool perdida_del_controlador() override {
    const bool p = perdida;
    perdida = false;
    return p;
  }

  void poner(const std::string& texto) { rx.insert(rx.end(), texto.begin(), texto.end()); }

  void tick() {
    t += 2;
    while (!respuestas_.empty() && respuestas_.front().vence <= t) {
      poner(respuestas_.front().texto);
      respuestas_.pop_front();
    }
    if (marcha && modo != Modo::Mudo && t >= proxima_trama) {
      poner(presencia ? "$JYBSS,1, , , *\r\n" : "$JYBSS,0, , , *\r\n");
      presencia = !presencia;
      proxima_trama += 1000;
    }
  }

  // El radar se reinicia: calla `mudo_ms` y vuelve SIN la configuración (no emite).
  void reiniciar_radar(uint32_t mudo_ms) {
    marcha = false;
    sin_guardar = false;  // la flash conserva lo último que se guardó; lo aplicado y sin guardar se pierde
    rango_ini = rango_flash_ini;
    rango_fin = rango_flash_fin;
    modo = Modo::Mudo;
    vuelve_ = t + mudo_ms;
    respuestas_.clear();
  }
  void revisar_vuelta() {
    if (vuelve_ != 0 && t >= vuelve_) {
      vuelve_ = 0;
      modo = Modo::Normal;
      rango_ini = rango_flash_ini;
      rango_fin = rango_flash_fin;
      sin_guardar = sin_guardar_al_volver;
      sin_guardar_al_volver = false;
      poner("Done\r\nDone\r\n");  // eco de arranque que no responde a ninguna orden
    }
  }

  void respuestas_vaciar() { respuestas_.clear(); }

  int contar(const char* prefijo) const {
    int n = 0;
    for (const std::string& o : ordenes) n += o.rfind(prefijo, 0) == 0 ? 1 : 0;
    return n;
  }

 private:
  struct Respuesta {
    uint32_t vence;
    std::string texto;
  };
  void responder(const char* texto) { respuestas_.push_back({t + 20, texto}); }
  void radar_recibe(const std::string& linea) {
    ordenes.push_back(linea);
    if (modo == Modo::Mudo) return;
    if (modo == Modo::ErrorSiempre) {
      responder("Error\r\n");
      return;
    }
    if (linea == "sensorStop") {
      if (!marcha) {
        responder("sensor stopped already\r\nError\r\n");
      } else {
        marcha = false;
        responder("Done\r\n");
      }
    } else if (linea.rfind("detRangeCfg", 0) == 0 || linea.rfind("outputLatency", 0) == 0) {
      if (marcha) {
        responder("sensor is not stopped\r\nError\r\n");
      } else {
        sin_guardar = true;
        int ini = 0, fin = 0;
        if (sscanf(linea.c_str(), "detRangeCfg -1 %d %d", &ini, &fin) == 2) {
          rango_ini = ini;
          rango_fin = fin;
        }
        responder("Done\r\n");
      }
    } else if (linea == "getRange") {
      if (!getrange_crudo.empty()) {
        responder(getrange_crudo.c_str());
      } else {
        char buf[96];
        snprintf(buf, sizeof(buf), "getRange\r\nResponse %.3f %.3f\r\nDone\r\nleapMMW:/>", rango_ini * 0.15, rango_fin * 0.15);
        responder(buf);
      }
    } else if (linea.rfind("saveCfg", 0) == 0) {
      if (modo == Modo::ErrorAlGuardar) {
        modo = Modo::Normal;  // solo falla la primera vez
        responder("Error\r\n");
      } else if (!sin_guardar) {
        responder("Error\r\n");  // nada que guardar
      } else {
        sin_guardar = false;
        rango_flash_ini = rango_ini;
        rango_flash_fin = rango_fin;
        ++escrituras_flash;
        responder("save cfg complete\r\nDone\r\n");
      }
    } else if (linea == "sensorStart") {
      if (marcha) {
        responder("sensor started already\r\nError\r\n");
      } else if (sin_guardar) {
        responder("new parameter isn't save, can't startSensor\r\nError\r\n");
      } else {
        marcha = true;
        proxima_trama = t + 1000;
        responder("Done\r\n");
      }
    } else {
      responder("Error\r\n");
    }
  }
  std::string escrito_;
  std::deque<Respuesta> respuestas_;
  uint32_t vuelve_ = 0;
};

struct Banco {
  SimUart uart;
  Interprete radar;
  radar::SupervisorRadar supervisor;
  radar::EstadoUart estado;
  uint32_t reinicios_supervisor = 0;

  bool ciclo() {
    uart.tick();
    uart.revisar_vuelta();
    radar::atender_uart(radar, uart, estado);
    const bool r = supervisor.vigilar(radar, uart);
    if (r) ++reinicios_supervisor;
    return r;
  }
  void correr(uint32_t ms) {
    const uint32_t fin = uart.t + ms;
    while (uart.t < fin) ciclo();
  }
  uint8_t salud() { return radar.salud(uart.t); }
  // Corre hasta que se cumpla `p` o pasen `max_ms`; devuelve el tiempo que tardó o -1.
  template <typename P>
  int64_t correr_hasta(P p, uint32_t max_ms) {
    const uint32_t inicio = uart.t;
    while (uart.t - inicio < max_ms) {
      if (p()) return uart.t - inicio;
      ciclo();
    }
    return p() ? static_cast<int64_t>(uart.t - inicio) : -1;
  }
};

// Radar sano y operando.
void poner_operando(Banco& b) {
  const int64_t ms = b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 20000);
  EXIGIR(ms >= 0);
}

// El radar se reinicia solo (R3): espera a que la salud lo note y a que el
// supervisor lo recupere. Devuelve los reintentos que hicieron falta, o -1.
int reiniciar_radar_y_recuperar(Banco& b, uint32_t mudo_ms) {
  const uint32_t reintentos0 = b.supervisor.reintentos();
  b.uart.reiniciar_radar(mudo_ms);
  if (b.correr_hasta([&] { return b.salud() != sen0395::kSaludOk; }, 5000) < 0) return -1;
  if (b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 240000) < 0) return -1;
  return static_cast<int>(b.supervisor.reintentos() - reintentos0);
}

// Lógica de lectura ANTERIOR (accesorio.ino de f9f9fb0), solo para reproducir el
// defecto: lo leído se descartaba con n = 0 y el intérprete conservaba su línea
// parcial. NO es código del firmware.
void atender_uart_anterior(Interprete& r, SimUart& u) {
  uint8_t bytes[sen0395::kMaxBytesPorLlamada];
  size_t n = 0;
  while (n < sizeof(bytes) && u.disponibles() > 0) {
    const int b = u.leer();
    if (b < 0) break;
    bytes[n++] = static_cast<uint8_t>(b);
  }
  if (u.disponibles() > 0) {
    while (u.leer() >= 0) {
    }
    n = 0;
  }
  r.procesar(bytes, n, u.ahora());
}

std::string basura_valida(size_t tramas) {
  std::string s;
  for (size_t i = 0; i < tramas; ++i) s += "$JYBSS,1, , , *\r\n";
  return s;
}

// --- Desborde de la UART ------------------------------------------------------------

void prueba_desborde_reproduce_el_defecto_anterior() {
  Banco b;
  poner_operando(b);
  // Se detiene el mundo: solo se alimenta la UART a mano.
  b.uart.marcha = false;
  b.uart.rx.clear();
  Interprete anterior = b.radar;  // misma historia hasta aquí
  const uint32_t validas0 = b.radar.contadores().tramas_validas;

  // Ciclo 1: llega la mitad de una trama. Ciclo 2: se desborda. Ciclo 3: llega el resto.
  b.uart.t += 10;
  b.uart.poner("$JYBSS,0,");
  atender_uart_anterior(anterior, b.uart);
  b.uart.t += 10;
  b.uart.poner(basura_valida(20));  // 340 bytes: más de un trozo
  atender_uart_anterior(anterior, b.uart);
  b.uart.t += 10;
  b.uart.poner(" , , *\r\n");
  atender_uart_anterior(anterior, b.uart);
  // El defecto: las dos mitades, que nunca fueron contiguas, forman una trama válida.
  EXIGIR(anterior.contadores().tramas_validas == validas0 + 1);
  EXIGIR(anterior.salud(b.uart.t) == sen0395::kSaludOk);
}

void prueba_desborde_no_une_la_linea_a_medias() {
  Banco b;
  poner_operando(b);
  b.uart.marcha = false;
  b.uart.rx.clear();
  const uint32_t validas0 = b.radar.contadores().tramas_validas;
  const uint32_t largas0 = b.radar.contadores().invalidas_largas;
  EXIGIR(b.salud() == sen0395::kSaludOk);

  b.uart.t += 10;
  b.uart.poner("$JYBSS,0,");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.salud() == sen0395::kSaludOk);  // media línea, sin pérdida todavía
  b.uart.t += 10;
  b.uart.poner(basura_valida(20));
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 1);
  EXIGIR(b.estado.bytes_descartados >= 340);
  EXIGIR(b.uart.rx.empty());  // drenada
  // El resultado anterior ya no vale, aunque tenía menos de 2,5 s.
  EXIGIR(b.salud() == sen0395::kSaludTramaInvalida);
  EXIGIR(b.radar.entrada(b.uart.t).estado == ble::EstadoRadar::Fallo);
  EXIGIR(b.radar.contadores().invalidas_largas == largas0 + 1);

  b.uart.t += 10;
  b.uart.poner(" , , *\r\n");
  radar::atender_uart(b.radar, b.uart, b.estado);
  // El resto suelto NO es una trama: ni válida ni saludable.
  EXIGIR(b.radar.contadores().tramas_validas == validas0);
  EXIGIR(b.salud() == sen0395::kSaludTramaInvalida);

  // Solo una trama íntegra NUEVA recupera la salud.
  b.uart.t += 10;
  b.uart.poner("$JYBSS,0, , , *\r\n");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.radar.contadores().tramas_validas == validas0 + 1);
  EXIGIR(b.salud() == sen0395::kSaludOk);
  EXIGIR(b.radar.entrada(b.uart.t).edad_ms <= 20);
}

void prueba_desborde_del_controlador() {
  Banco b;
  poner_operando(b);
  b.uart.marcha = false;
  b.uart.rx.clear();
  const uint32_t validas0 = b.radar.contadores().tramas_validas;
  // El controlador avisa de un desborde y en la UART queda una trama íntegra pero
  // posterior al hueco: no se sabe cuánto falta antes, así que no vale.
  b.uart.t += 10;
  b.uart.perdida = true;
  b.uart.poner("$JYBSS,1, , , *\r\n");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 1);
  EXIGIR(b.radar.contadores().tramas_validas == validas0);
  EXIGIR(b.salud() == sen0395::kSaludTramaInvalida);
  // El aviso se consume una vez: el ciclo siguiente ya es normal.
  b.uart.t += 10;
  b.uart.poner("$JYBSS,1, , , *\r\n");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 1);
  EXIGIR(b.salud() == sen0395::kSaludOk);
}

void prueba_desborde_acota_el_drenaje() {
  Banco b;
  poner_operando(b);
  b.uart.marcha = false;
  b.uart.rx.clear();
  b.uart.t += 10;
  std::string mucho;
  for (size_t i = 0; i < radar::kMaxDrenajePorCiclo * 2 + 100; ++i) mucho += 'x';
  b.uart.poner(mucho);
  radar::atender_uart(b.radar, b.uart, b.estado);
  // Un ciclo no se alarga sin límite: queda el resto, que el ciclo siguiente descarta.
  EXIGIR(!b.uart.rx.empty());
  EXIGIR(b.estado.bytes_descartados <= radar::kMaxDrenajePorCiclo + sen0395::kMaxBytesPorLlamada);
  b.uart.t += 10;
  radar::atender_uart(b.radar, b.uart, b.estado);
  b.uart.t += 10;
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.uart.rx.empty());
  EXIGIR(b.salud() == sen0395::kSaludTramaInvalida);
}

void prueba_desborde_en_configuracion() {
  // Un Done perdido en la configuración no confirma nada: vence por timeout y el
  // supervisor reaplica la configuración sin guardar.
  Banco b;
  b.uart.tick();
  radar::atender_uart(b.radar, b.uart, b.estado);  // sensorStop enviada
  EXIGIR(b.uart.contar("sensorStop") == 1);
  b.uart.t += 30;
  b.uart.perdida = true;  // la respuesta Done llega, pero con un desborde
  b.uart.tick();
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 1);
  EXIGIR(b.radar.fase() == Fase::Configurando);  // la respuesta se descartó con lo demás
}

void prueba_perdida_durante_la_lectura_no_une_la_linea() {
  // El desborde se avisa DESPUÉS de la consulta inicial, durante el primer leer():
  // los bytes de ese ciclo ya no se pueden fechar ni unir con la mitad anterior.
  Banco b;
  poner_operando(b);
  b.uart.marcha = false;
  b.uart.rx.clear();
  const uint32_t validas0 = b.radar.contadores().tramas_validas;
  b.uart.t += 10;
  b.uart.poner("$JYBSS,0,");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 0 && b.salud() == sen0395::kSaludOk);  // media línea, sin pérdida
  b.uart.t += 10;
  b.uart.poner(" , , *\r\n");
  b.uart.perder_al_leer = 1;
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(!b.uart.perdida);  // el aviso se consumió en este mismo ciclo, no en el siguiente
  EXIGIR(b.estado.perdidas == 1);
  EXIGIR(b.estado.bytes_descartados >= 8);
  EXIGIR(b.radar.contadores().tramas_validas == validas0);  // no se fabricó una trama
  EXIGIR(b.salud() == sen0395::kSaludTramaInvalida);
  EXIGIR(b.radar.entrada(b.uart.t).estado == ble::EstadoRadar::Fallo);
  // El ciclo siguiente ya es normal y solo una trama íntegra NUEVA recupera la salud.
  b.uart.t += 10;
  b.uart.poner("$JYBSS,0, , , *\r\n");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 1);
  EXIGIR(b.radar.contadores().tramas_validas == validas0 + 1);
  EXIGIR(b.salud() == sen0395::kSaludOk);
}

void prueba_perdida_durante_la_lectura_no_confirma_la_orden() {
  // Mitad de un Done en un ciclo y el resto en otro con un desborde durante su
  // lectura: no confirma sensorStop ni libera la orden siguiente.
  Banco b;
  b.uart.tick();
  radar::atender_uart(b.radar, b.uart, b.estado);  // sensorStop enviada
  EXIGIR(b.uart.contar("sensorStop") == 1);
  b.uart.respuestas_vaciar();
  b.uart.t += 5;
  b.uart.poner("Do");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 0);
  b.uart.t += 5;
  b.uart.poner("ne\r\n");
  b.uart.perder_al_leer = 1;
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(!b.uart.perdida);
  EXIGIR(b.estado.perdidas == 1);
  EXIGIR(b.radar.fase() == Fase::Configurando);
  EXIGIR(b.uart.contar("detRangeCfg") == 0);  // nada se envió con una confirmación falsa
  EXIGIR(b.uart.contar("sensorStop") == 1);
  // Un aviso por ciclo, no por lectura: el siguiente ciclo (sin pérdida) es normal.
  b.uart.t += 5;
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.estado.perdidas == 1);
}

// Cola de `relleno` LF seguida de una trama válida y un Done: lo que la UART
// acumula durante un hueco del bucle. Ninguno de sus bytes puede fechar nada.
std::string cola_vieja(size_t relleno) { return std::string(relleno, '\n') + "$JYBSS,1, , , *\r\nDone\r\n"; }

// Ofrece la cola y cicla hasta ver la UART vacía; luego comprueba que nada de ella
// valió: ni una trama (contador), ni salud sana, ni edad cero.
void comprobar_cola_descartada(Banco& b, size_t relleno, bool aviso_controlador) {
  const uint32_t validas0 = b.radar.contadores().tramas_validas;
  b.uart.t += 3000;  // el hueco
  b.uart.perdida = aviso_controlador;
  b.uart.poner(cola_vieja(relleno));
  for (int i = 0; i < 20 && !b.uart.rx.empty(); ++i) {
    radar::atender_uart(b.radar, b.uart, b.estado);
    b.uart.t += 2;
    EXIGIR(b.salud() != sen0395::kSaludOk);
    EXIGIR(b.radar.contadores().tramas_validas == validas0);
  }
  EXIGIR(b.uart.rx.empty());
  radar::atender_uart(b.radar, b.uart, b.estado);  // el ciclo que la ve vacía
  b.uart.t += 2;
  EXIGIR(b.salud() != sen0395::kSaludOk);
  EXIGIR(b.radar.contadores().tramas_validas == validas0);
  // Solo una trama íntegra NUEVA recupera la salud, con edad real.
  b.uart.poner("$JYBSS,0, , , *\r\n");
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.radar.contadores().tramas_validas == validas0 + 1);
  EXIGIR(b.salud() == sen0395::kSaludOk);
}

void prueba_cola_vieja_tras_drenaje_acotado() {
  // Tras un hueco, la UART acumula más de trozo + tope de drenaje: el primer ciclo
  // deja un resto. El resto, aunque quepa en un trozo y termine en una trama
  // válida y un Done, es cola vieja y no se entrega ni rejuvenece.
  const size_t base = sen0395::kMaxBytesPorLlamada + radar::kMaxDrenajePorCiclo;
  const size_t restos[] = {1, 17, 100, 256, 257, 4096, 4097, 8192, 9000};
  for (const bool aviso : {false, true}) {
    for (const size_t resto : restos) {
      Banco b;
      poner_operando(b);
      b.uart.marcha = false;
      b.uart.rx.clear();
      // 25 B de cola final (trama + Done): el relleno deja `resto` tras el 1.er ciclo.
      comprobar_cola_descartada(b, base + resto - 25, aviso);
    }
  }
}

void prueba_cola_justo_en_el_limite() {
  // Sin resto tras el primer ciclo (cabe en trozo + tope) la cola se descarta
  // igual por el camino de la pérdida: la frontera no deja pasar nada.
  const size_t base = sen0395::kMaxBytesPorLlamada + radar::kMaxDrenajePorCiclo;
  for (const size_t total : {base - 1, base, base + 1}) {
    Banco b;
    poner_operando(b);
    b.uart.marcha = false;
    b.uart.rx.clear();
    comprobar_cola_descartada(b, total - 25, false);
  }
}

void prueba_no_envia_orden_con_cola_vieja_pendiente() {
  Banco b;
  poner_operando(b);
  b.uart.marcha = false;
  b.uart.rx.clear();
  b.radar.reiniciar(false);  // hay una orden pendiente (sensorStop)
  const size_t ordenes0 = b.uart.ordenes.size();
  b.uart.t += 3000;
  b.uart.poner(cola_vieja(sen0395::kMaxBytesPorLlamada + radar::kMaxDrenajePorCiclo + 5000));
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(!b.uart.rx.empty());                   // quedó cola
  EXIGIR(b.uart.ordenes.size() == ordenes0);    // y no se escribió la orden encima de ella
  // Sigue sin salir mientras quede cola (la cola restante se drena en varios ciclos).
  for (int i = 0; i < 5 && !b.uart.rx.empty(); ++i) {
    b.uart.t += 2;
    radar::atender_uart(b.radar, b.uart, b.estado);
    if (!b.uart.rx.empty()) EXIGIR(b.uart.ordenes.size() == ordenes0);
  }
  EXIGIR(b.uart.rx.empty());
  // Con la UART vacía, la orden sale (a más tardar en el ciclo que la ve vacía).
  b.uart.t += 2;
  radar::atender_uart(b.radar, b.uart, b.estado);
  EXIGIR(b.uart.ordenes.size() == ordenes0 + 1);
  EXIGIR(b.uart.ordenes.back() == "sensorStop");
}

void prueba_cola_vieja_no_confirma_la_orden() {
  // Un Done viejo al final de la cola no confirma la orden nueva (fase de configuración).
  Banco b;
  b.uart.tick();
  radar::atender_uart(b.radar, b.uart, b.estado);  // sensorStop enviada
  EXIGIR(b.uart.contar("sensorStop") == 1);
  b.uart.respuestas_vaciar();
  b.uart.t += 100;  // dentro del plazo de la orden: solo un Done viejo podría confirmarla
  b.uart.poner(cola_vieja(sen0395::kMaxBytesPorLlamada + radar::kMaxDrenajePorCiclo + 20));
  for (int i = 0; i < 10; ++i) {
    radar::atender_uart(b.radar, b.uart, b.estado);
    b.uart.t += 2;
  }
  EXIGIR(b.uart.rx.empty());
  EXIGIR(b.radar.fase() == Fase::Configurando);  // ningún Done de la cola avanzó la secuencia
  EXIGIR(b.uart.contar("detRangeCfg") == 0);
}

void prueba_supervisor_no_reinicia_con_cola_sin_vaciar() {
  Banco b;
  poner_operando(b);
  b.uart.modo = SimUart::Modo::Mudo;
  b.uart.marcha = false;
  // Solo se ciclan reloj y vigilancia; en cada ciclo hay una cola mayor que el tope
  // de drenaje: el reinicio no puede ocurrir mientras haya cola sin vaciar.
  const std::string cola = cola_vieja(radar::kMaxDrenajePorCiclo * 2 + 100);
  const uint32_t t0 = b.uart.t;
  while (b.uart.t - t0 < 40000) {
    b.uart.tick();
    b.uart.rx.clear();
    b.uart.poner(cola);
    EXIGIR(!b.supervisor.vigilar(b.radar, b.uart));
  }
  EXIGIR(b.supervisor.reintentos() == 0);
  // Con la UART al fin vacía, reinicia en el ciclo siguiente.
  b.uart.rx.clear();
  b.uart.tick();
  EXIGIR(b.supervisor.vigilar(b.radar, b.uart));
  EXIGIR(b.supervisor.reintentos() == 1);
}


// --- Recuperación -------------------------------------------------------------------

void prueba_arranque_con_radar_mudo_se_recupera() {
  // Defecto anterior: tras un timeout de configuración el intérprete quedaba en
  // salud 4 hasta reiniciar la placa, aunque el radar despertara después.
  Banco b;
  b.uart.modo = SimUart::Modo::Mudo;
  b.correr(sen0395::Configuracion().respuesta_max_ms + 100);
  EXIGIR(b.radar.fase() == Fase::Fallo);
  EXIGIR(b.salud() == sen0395::kSaludFalloRadar);
  // Sin supervisor, el fallo es terminal (así quedaba el firmware anterior).
  {
    Interprete solo;
    SimUart u;
    u.modo = SimUart::Modo::Mudo;
    radar::EstadoUart e;
    while (u.t < 5000) {
      u.tick();
      radar::atender_uart(solo, u, e);
    }
    u.modo = SimUart::Modo::Normal;
    u.marcha = true;
    u.proxima_trama = u.t + 1000;
    while (u.t < 60000) {
      u.tick();
      radar::atender_uart(solo, u, e);
    }
    EXIGIR(solo.salud(u.t) == sen0395::kSaludFalloRadar);
  }
  // El radar despierta: con supervisor se recupera solo.
  b.uart.modo = SimUart::Modo::Normal;
  const int64_t ms = b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 60000);
  EXIGIR(ms >= 0);
  EXIGIR(b.supervisor.reintentos() >= 1);
  // El arranque nunca llegó a guardar nada (sensorStop no se contestó): el radar no
  // tiene NUESTRA configuración y no arrancaría sin ella. La primera recuperación
  // que contesta la guarda, una sola vez.
  EXIGIR(b.uart.contar("saveCfg") == 1);
  EXIGIR(b.uart.escrituras_flash == 1);
  // Ya guardada, una segunda recuperación no vuelve a escribir la flash.
  b.correr(sen0395::kEstabilizacionMinMs + 3000);
  EXIGIR(reiniciar_radar_y_recuperar(b, 3000) == 1);
  EXIGIR(b.uart.escrituras_flash == 1);
}

void prueba_radar_reinicia_y_pierde_la_configuracion() {
  Banco b;
  poner_operando(b);
  EXIGIR(b.uart.contar("saveCfg") == 1);  // el arranque guardó una vez
  const size_t ordenes0 = b.uart.ordenes.size();
  b.correr(3000);
  EXIGIR(b.salud() == sen0395::kSaludOk);

  b.uart.reiniciar_radar(3000);  // se apaga y vuelve sin emitir
  // Antes de que el supervisor actúe, la salud ya avisa (nunca presenta el dato viejo).
  const int64_t sin_datos = b.correr_hasta([&] { return b.salud() != sen0395::kSaludOk; }, 5000);
  EXIGIR(sin_datos >= 0 && sin_datos <= 2600);
  b.correr(4000);
  EXIGIR(b.uart.rx.size() > 0 || b.salud() != sen0395::kSaludOk);  // eco de arranque en la UART
  EXIGIR(b.salud() != sen0395::kSaludOk);

  // Pasados kSilencioReiniciaMs sin trama, el supervisor reaplica la configuración.
  uint32_t t_reinicio = 0;
  const int64_t ms = b.correr_hasta(
      [&] {
        if (t_reinicio == 0 && b.reinicios_supervisor > 0) t_reinicio = b.uart.t;
        return b.reinicios_supervisor > 0;
      },
      20000);
  EXIGIR(ms >= 0);
  EXIGIR(b.radar.fase() == Fase::Configurando);
  EXIGIR(b.salud() == sen0395::kSaludIniciando);

  const uint32_t t0 = b.uart.t;
  const int64_t sano = b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 60000);
  EXIGIR(sano >= 0);
  // Estabilización de al menos 5 s antes de aceptar ninguna observación.
  EXIGIR(b.uart.t - t0 >= sen0395::kEstabilizacionMinMs);
  // Las órdenes de la recuperación: el radar conserva su flash y vuelve PARADO, así
  // que basta pararlo (`sensor stopped already` + Error es lo esperado, R1),
  // comprobar con getRange que su ventana sigue siendo la nuestra y arrancarlo.
  // Mandar rango y latencia otra vez lo dejaría con parámetros sin guardar y
  // rechazaría sensorStart (R2); sin saveCfg no gasta su flash.
  std::vector<std::string> nuevas(b.uart.ordenes.begin() + static_cast<long>(ordenes0), b.uart.ordenes.end());
  EXIGIR(nuevas.size() == 3);
  if (nuevas.size() == 3) {
    EXIGIR(nuevas[0] == "sensorStop");
    EXIGIR(nuevas[1] == "getRange");
    EXIGIR(nuevas[2] == "sensorStart");
  }
  EXIGIR(b.radar.contadores().rangos_distintos == 0);
  EXIGIR(b.uart.contar("saveCfg") == 1);  // sigue siendo la del arranque
  EXIGIR(b.uart.escrituras_flash == 1);
  EXIGIR(b.radar.contadores().errores_radar == 0);  // el Error de «ya parado» no es un fallo
  // La observación que sostiene la salud es posterior al reinicio.
  EXIGIR(b.radar.entrada(b.uart.t).edad_ms <= 20);
}

void prueba_el_reinicio_purga_la_uart() {
  Banco b;
  poner_operando(b);
  b.uart.modo = SimUart::Modo::Mudo;
  // Sin leer la UART (solo el reloj y la vigilancia), cada ciclo deja en ella restos
  // de la vida anterior del radar: respuestas y una trama que no valen.
  bool reinicio = false;
  for (int i = 0; i < 20000 && !reinicio; ++i) {
    b.uart.tick();
    b.uart.rx.clear();
    b.uart.poner("Done\r\nDone\r\n$JYBSS,1, , , *\r\n");
    reinicio = b.supervisor.vigilar(b.radar, b.uart);
  }
  EXIGIR(reinicio);
  EXIGIR(b.uart.rx.empty());  // purgada antes de reiniciar
  EXIGIR(b.radar.fase() == Fase::Configurando);
  EXIGIR(b.salud() == sen0395::kSaludIniciando);
  // Nada de lo viejo sostiene la salud: sigue iniciando hasta la observación nueva.
  b.uart.modo = SimUart::Modo::Normal;
  const uint32_t t1 = b.uart.t;
  EXIGIR(b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 60000) >= 0);
  EXIGIR(b.uart.t - t1 >= sen0395::kEstabilizacionMinMs);
}

void prueba_error_al_guardar_no_deja_sin_radar() {
  // El radar rechaza el primer saveCfg: el arranque falla (salud 4) con la
  // configuración aplicada y sin guardar. La recuperación repite la secuencia
  // completa (sin guardar, sensorStart se rechazaría) y esta vez guarda.
  Banco b;
  b.uart.modo = SimUart::Modo::ErrorAlGuardar;
  const int64_t ms = b.correr_hasta([&] { return b.radar.fase() == Fase::Fallo; }, 5000);
  EXIGIR(ms >= 0);
  EXIGIR(b.radar.motivo_fallo() == sen0395::MotivoFallo::RespuestaError);
  EXIGIR(b.salud() == sen0395::kSaludFalloRadar);
  const int64_t sano = b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 120000);
  EXIGIR(sano >= 0);
  EXIGIR(b.uart.contar("saveCfg") == 2);  // el fallido del arranque y el de la recuperación
  EXIGIR(b.uart.escrituras_flash == 1);
  EXIGIR(b.supervisor.reintentos() == 1);
  // Ya guardada, una recuperación posterior no escribe más.
  b.correr(5000);
  EXIGIR(reiniciar_radar_y_recuperar(b, 3000) == 1);
  EXIGIR(b.uart.escrituras_flash == 1);
  EXIGIR(b.uart.contar("saveCfg") == 2);
}

void prueba_recuperacion_ligera_con_error_repite_la_secuencia_completa() {
  // Defensa: si la flash del radar no conserva la configuración y sensorStart acaba
  // en Error, el reintento siguiente repite la secuencia completa y guarda.
  Banco b;
  poner_operando(b);
  EXIGIR(b.uart.escrituras_flash == 1);
  b.correr(3000);
  // Cuando el radar vuelve, lo hace con parámetros sin guardar: un sensorStart
  // ligero lo rechaza (`new parameter isn't save`).
  b.uart.sin_guardar_al_volver = true;
  EXIGIR(reiniciar_radar_y_recuperar(b, 3000) == 2);
  EXIGIR(b.uart.escrituras_flash == 2);  // una sola escritura más, en la secuencia completa
}

void prueba_reintentos_con_espera_creciente_y_acotados() {
  // Radar que siempre contesta Error: los reintentos se espacian y nunca guardan.
  Banco b;
  b.uart.modo = SimUart::Modo::ErrorSiempre;
  std::vector<uint32_t> instantes;
  const uint32_t t0 = b.uart.t;
  while (b.uart.t - t0 < 20u * 60u * 1000u) {
    if (b.ciclo()) instantes.push_back(b.uart.t - t0);
    EXIGIR(b.salud() != sen0395::kSaludOk);  // jamás presenta salud sana
  }
  EXIGIR(b.uart.contar("saveCfg") == 0);  // sensorStop ya recibe Error: nunca llega a guardar
  EXIGIR(instantes.size() >= 4);
  EXIGIR(instantes.size() <= 30);  // acotado: unos 18 en 20 minutos
  for (size_t i = 2; i < instantes.size(); ++i) {
    const uint32_t hueco = instantes[i] - instantes[i - 1];
    EXIGIR(hueco >= radar::kEsperaInicialMs);   // nunca más rápido que la espera inicial
    EXIGIR(hueco >= instantes[i - 1] - instantes[i - 2] || hueco >= radar::kEsperaMaximaMs);  // creciente hasta el tope
    EXIGIR(hueco <= radar::kEsperaMaximaMs + 3 * radar::kEsperaFalloMs);                     // y con tope
  }
}

void prueba_radar_desconectado_tambien_acotado() {
  // Cable suelto: el radar no contesta nada. Salud nunca sana; ninguna escritura a flash.
  Banco b;
  poner_operando(b);
  const int guardados = b.uart.contar("saveCfg");
  b.uart.modo = SimUart::Modo::Mudo;
  const uint32_t t0 = b.uart.t;
  while (b.uart.t - t0 < 10u * 60u * 1000u) {
    b.ciclo();
    if (b.uart.t - t0 > 2600) EXIGIR(b.salud() != sen0395::kSaludOk);
  }
  EXIGIR(b.uart.contar("saveCfg") == guardados);
  EXIGIR(b.supervisor.reintentos() >= 3);
  EXIGIR(b.supervisor.reintentos() <= 20);
  // Vuelve el cable: se recupera solo.
  b.uart.modo = SimUart::Modo::Normal;
  const int64_t ms = b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 5u * 60u * 1000u);
  EXIGIR(ms >= 0);
}

void prueba_el_contador_vuelve_a_cero_con_salud() {
  Banco b;
  b.uart.modo = SimUart::Modo::Mudo;
  b.correr(40000);
  EXIGIR(b.supervisor.intentos_seguidos() >= 2);
  b.uart.modo = SimUart::Modo::Normal;
  const int64_t ms = b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 120000);
  EXIGIR(ms >= 0);
  b.correr(radar::kSanoReseteaMs + 2000);
  EXIGIR(b.salud() == sen0395::kSaludOk);
  EXIGIR(b.supervisor.intentos_seguidos() == 0);

  // Un plazo del fallo anterior no puede bloquear otro fallo tras 2^31 ms.
  const uint32_t reintentos = b.supervisor.reintentos();
  b.uart.modo = SimUart::Modo::Mudo;
  b.uart.marcha = false;
  b.uart.rx.clear();
  b.uart.respuestas_vaciar();
  b.uart.t += 0x80020000u;
  radar::atender_uart(b.radar, b.uart, b.estado);
  b.uart.t += 2;
  b.uart.poner("$JYBSS,1, , , *\r\n");
  radar::atender_uart(b.radar, b.uart, b.estado);
  b.supervisor.vigilar(b.radar, b.uart);
  EXIGIR(b.salud() == sen0395::kSaludOk);
  b.correr(20000);
  EXIGIR(b.supervisor.reintentos() > reintentos);
}

void prueba_configuracion_invalida_no_se_reintenta() {
  sen0395::Configuracion malo;
  malo.ventana_inicio = 10;
  malo.ventana_fin = 5;
  SimUart u;
  Interprete r(malo);
  radar::SupervisorRadar s;
  radar::EstadoUart e;
  for (int i = 0; i < 100000; ++i) {
    u.tick();
    radar::atender_uart(r, u, e);
    EXIGIR(!s.vigilar(r, u));
  }
  EXIGIR(r.salud(u.t) == sen0395::kSaludConfigNoValida);
  EXIGIR(s.reintentos() == 0);
  EXIGIR(u.ordenes.empty());
}

// Envía la orden pendiente, comprueba que empieza por `esperada` y la confirma con `respuesta`.
void paso_de_configuracion(Interprete& r, uint32_t* t, const char* esperada, const char* respuesta) {
  uint8_t orden[sen0395::kLongitudOrdenMax];
  const size_t n = r.salida_pendiente(orden, sizeof(orden));
  EXIGIR(n > 0 && strncmp(reinterpret_cast<const char*>(orden), esperada, strlen(esperada)) == 0);
  r.salida_enviada(*t);
  *t += 10;
  r.procesar(reinterpret_cast<const uint8_t*>(respuesta), strlen(respuesta), *t);
}

// Respuesta real de getRange para la ventana por defecto (0 a 30 cm), con el eco y el indicador.
const char kRangoPorDefecto[] = "getRange\r\nResponse 0.000 0.300\r\nDone\r\nleapMMW:/>";

void esperar_purga(Interprete& r, uint32_t* t) {
  *t += r.configuracion().respuesta_max_ms * 3;  // la purga de la orden vieja
  r.procesar(nullptr, 0, *t);
}

void prueba_reiniciar_ligero_en_el_interprete() {
  // Tras guardar la configuración, reiniciar(false) solo para y arranca el radar.
  Interprete r;
  uint32_t t = 100;
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "detRangeCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "outputLatency", "Done\r\n");
  paso_de_configuracion(r, &t, "saveCfg", "save cfg complete\r\nDone\r\n");
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
  r.reiniciar(false);
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "sensor stopped already\r\nError\r\n");
  paso_de_configuracion(r, &t, "getRange", kRangoPorDefecto);
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
  EXIGIR(r.contadores().errores_radar == 0);
  EXIGIR(r.contadores().rangos_distintos == 0);
  // reiniciar() sin argumentos es el arranque: secuencia completa, con saveCfg.
  r.reiniciar();
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "detRangeCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "outputLatency", "Done\r\n");
  paso_de_configuracion(r, &t, "saveCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
}

void prueba_reiniciar_ligero_sin_configuracion_guardada_es_completo() {
  // El arranque no llegó a guardar (saveCfg dio Error): reiniciar(false) no puede
  // arrancar el radar sin parámetros, así que repite la secuencia completa.
  Interprete r;
  uint32_t t = 100;
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "detRangeCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "outputLatency", "Done\r\n");
  paso_de_configuracion(r, &t, "saveCfg", "Error\r\n");
  EXIGIR(r.fase() == Fase::Fallo);
  r.reiniciar(false);
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "detRangeCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "outputLatency", "Done\r\n");
  paso_de_configuracion(r, &t, "saveCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
  // Y ahora sí, la recuperación es ligera.
  r.reiniciar(false);
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "getRange", kRangoPorDefecto);
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
}

void prueba_error_en_recuperacion_ligera_olvida_lo_guardado() {
  // sensorStart rechazado tras una recuperación ligera: el radar no tiene lo que
  // se creía. La siguiente recuperación repite todo y guarda.
  Interprete r;
  uint32_t t = 100;
  for (const char* o : {"sensorStop", "detRangeCfg", "outputLatency", "saveCfg", "sensorStart"})
    paso_de_configuracion(r, &t, o, "Done\r\n");
  r.reiniciar(false);
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "getRange", kRangoPorDefecto);
  paso_de_configuracion(r, &t, "sensorStart", "new parameter isn't save, can't startSensor\r\nError\r\n");
  EXIGIR(r.fase() == Fase::Fallo);
  EXIGIR(r.motivo_fallo() == sen0395::MotivoFallo::RespuestaError);
  EXIGIR(r.contadores().errores_radar == 1);
  r.reiniciar(false);
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "detRangeCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "outputLatency", "Done\r\n");
  paso_de_configuracion(r, &t, "saveCfg", "Done\r\n");
}

// --- getRange en la recuperación ligera ------------------------------------------------

// Interprete que ya guardó su configuración y vuelve a reiniciarse en ligero, parado en
// sensorStop contestado; `t` queda listo para el siguiente paso.
void preparar_ligera(Interprete& r, uint32_t* t) {
  for (const char* o : {"sensorStop", "detRangeCfg", "outputLatency", "saveCfg", "sensorStart"})
    paso_de_configuracion(r, t, o, "Done\r\n");
  r.reiniciar(false);
  esperar_purga(r, t);
  paso_de_configuracion(r, t, "sensorStop", "Done\r\n");
}

// La respuesta de getRange no coincide: el MISMO intento sigue con la secuencia completa
// (rango, latencia, saveCfg, sensorStart) y cuenta un rango distinto, sin fallo ni Error.
void exigir_completa_tras(const char* respuesta, int errores_esperados = 0) {
  Interprete r;
  uint32_t t = 100;
  preparar_ligera(r, &t);
  paso_de_configuracion(r, &t, "getRange", respuesta);
  EXIGIR(r.fase() == Fase::Configurando);
  paso_de_configuracion(r, &t, "detRangeCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "outputLatency", "Done\r\n");
  paso_de_configuracion(r, &t, "saveCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
  EXIGIR(r.contadores().rangos_distintos == 1);
  EXIGIR(r.contadores().errores_radar == static_cast<uint32_t>(errores_esperados));
}

void exigir_ligera_tras(const char* respuesta) {
  Interprete r;
  uint32_t t = 100;
  preparar_ligera(r, &t);
  paso_de_configuracion(r, &t, "getRange", respuesta);
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");  // no hubo detRangeCfg, ni outputLatency, ni saveCfg
  EXIGIR(r.fase() == Fase::Estabilizando);
  EXIGIR(r.contadores().rangos_distintos == 0);
  EXIGIR(r.contadores().errores_radar == 0);
}

void prueba_getrange_coincide_arranca_sin_escribir() {
  // La respuesta real del banco (eco, Response, Done, indicador), sola y con las
  // variantes de formato que un decimal admite.
  exigir_ligera_tras(kRangoPorDefecto);
  exigir_ligera_tras("Response 0.000 0.300\r\nDone\r\n");
  exigir_ligera_tras("Response 0.000 0.30\r\nDone\r\n");
  exigir_ligera_tras("Response 0 0.3\r\nDone\r\n");
  exigir_ligera_tras("Response 0.000 0.2999\r\nDone\r\n");  // redondeo de float
  exigir_ligera_tras("Response 0.005 0.309\r\nDone\r\n");   // dentro de 10 mm
  exigir_ligera_tras("Response 0.000 0.300000\r\nDone\r\n");
  // Con otra ventana configurada se compara con ESA: índices 1 a 3 = 0,150 a 0,450 m.
  sen0395::Configuracion c;
  c.ventana_inicio = 1;
  c.ventana_fin = 3;
  Interprete r(c);
  uint32_t t = 100;
  for (const char* o : {"sensorStop", "detRangeCfg", "outputLatency", "saveCfg", "sensorStart"})
    paso_de_configuracion(r, &t, o, "Done\r\n");
  r.reiniciar(false);
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "getRange", "Response 0.150 0.450\r\nDone\r\n");
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
}

void prueba_getrange_distinto_repite_la_secuencia_completa() {
  exigir_completa_tras("getRange\r\nResponse 0.000 0.450\r\nDone\r\nleapMMW:/>");  // el 0 a 3 del banco
  exigir_completa_tras("Response 0.000 3.000\r\nDone\r\n");                    // de fábrica (0 a 20)
  exigir_completa_tras("Response 0.150 0.300\r\nDone\r\n");                    // otro inicio
  exigir_completa_tras("Response 0.000 0.320\r\nDone\r\n");                    // fuera de la tolerancia
  exigir_completa_tras("Response 0.000 0.289\r\nDone\r\n");
  exigir_completa_tras("Response 0.300 0.000\r\nDone\r\n");                    // al revés
}

void prueba_getrange_ilegible_repite_la_secuencia_completa() {
  // Sin Response, o con una que no es EXACTAMENTE `Response <m> <m>`: no se arranca.
  exigir_completa_tras("Done\r\n");
  exigir_completa_tras("getRange\r\nDone\r\nleapMMW:/>");
  for (const char* basura : {"Response\r\n", "Response \r\n", "Response 0.000\r\n", "Response 0.000 \r\n",
                             "Response 0.000 0.300 0.000\r\n", "Response 0.000 0.300x\r\n",
                             "Response  0.000 0.300\r\n", "Response 0.000  0.300\r\n", "Response -0.000 0.300\r\n",
                             "Response 0,000 0,300\r\n", "Response 0.000 0.\r\n", "Response .000 .300\r\n",
                             "Response 0.000 0.300e0\r\n", "Response nan nan\r\n", "Response 0x0 0x2\r\n",
                             "response 0.000 0.300\r\n", "Response 0.0000000 0.300\r\n", "Response 0000.000 0.300\r\n",
                             "Response 99999999999999999999 0.300\r\n", "Response ?? ??\r\n"}) {
    std::string r = basura;
    r += "Done\r\n";
    exigir_completa_tras(r.c_str());
  }
  // Una línea ilegible DESPUÉS de una buena la anula: no se arranca con una lectura dudosa.
  exigir_completa_tras("Response 0.000 0.300\r\nResponse basura\r\nDone\r\n");
  // Y una buena después de una mala la repone: vale la última.
  exigir_ligera_tras("Response basura\r\nResponse 0.000 0.300\r\nDone\r\n");
}

void prueba_getrange_error_repite_la_secuencia_completa() {
  // `Error` no es un fallo de la recuperación: no se puede comprobar, se guarda de nuevo.
  // No cuenta como error del radar ni mata el intento: cuenta como rango distinto.
  Interprete r;
  uint32_t t = 100;
  preparar_ligera(r, &t);
  paso_de_configuracion(r, &t, "getRange", "getRange\r\nError\r\n");
  EXIGIR(r.fase() == Fase::Configurando);
  paso_de_configuracion(r, &t, "detRangeCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "outputLatency", "Done\r\n");
  paso_de_configuracion(r, &t, "saveCfg", "Done\r\n");
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
  EXIGIR(r.contadores().rangos_distintos == 1);
  // Un Response bueno seguido de Error tampoco vale.
  exigir_completa_tras("Response 0.000 0.300\r\nError\r\n");
}

void prueba_getrange_con_tramas_y_prompt_intercalados() {
  // En el radar real llegan el eco, el indicador `leapMMW:/>` y, mientras no esté parado
  // del todo, tramas $JYBSS entre medias. Nada de eso es la respuesta ni la rompe.
  exigir_ligera_tras("$JYBSS,1, , , *\r\ngetRange\r\n$JYBSS,0, , , *\r\nResponse 0.000 0.300\r\n$JYBSS,1, , , *\r\nDone\r\nleapMMW:/>");
  exigir_ligera_tras("leapMMW:/>getRange\r\nResponse 0.000 0.300\r\nDone\r\nleapMMW:/>\r\n");
  exigir_completa_tras("$JYBSS,1, , , *\r\nResponse 0.000 0.450\r\n$JYBSS,0, , , *\r\nDone\r\n");
  // Una trama partida justo antes del Response lo deja ilegible: se escribe de nuevo.
  exigir_completa_tras("$JYBSS,1, ,Response 0.000 0.300\r\nDone\r\n");
}

void prueba_getrange_llega_en_trozos() {
  // Byte a byte, como una UART lenta: mismo resultado.
  Interprete r;
  uint32_t t = 100;
  preparar_ligera(r, &t);
  uint8_t orden[sen0395::kLongitudOrdenMax];
  EXIGIR(r.salida_pendiente(orden, sizeof(orden)) > 0 && memcmp(orden, "getRange", 8) == 0);
  r.salida_enviada(t);
  const char* resp = "getRange\r\nResponse 0.000 0.300\r\nDone\r\nleapMMW:/>";
  for (const char* c = resp; *c; ++c) {
    t += 1;
    r.procesar(reinterpret_cast<const uint8_t*>(c), 1, t);
  }
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
}

void prueba_getrange_sin_respuesta_vence_y_la_siguiente_sigue_ligera() {
  // getRange que no contesta: timeout normal. No se sabe si la flash está bien, pero
  // tampoco hay prueba de lo contrario: el intento siguiente vuelve a comprobarla.
  Interprete r;
  uint32_t t = 100;
  preparar_ligera(r, &t);
  uint8_t orden[sen0395::kLongitudOrdenMax];
  EXIGIR(r.salida_pendiente(orden, sizeof(orden)) > 0 && memcmp(orden, "getRange", 8) == 0);
  r.salida_enviada(t);
  t += r.configuracion().respuesta_max_ms + 1;
  r.procesar(nullptr, 0, t);
  EXIGIR(r.fase() == Fase::Fallo);
  EXIGIR(r.motivo_fallo() == sen0395::MotivoFallo::RespuestaTimeout);
  r.reiniciar(false);
  esperar_purga(r, &t);
  paso_de_configuracion(r, &t, "sensorStop", "Done\r\n");
  paso_de_configuracion(r, &t, "getRange", kRangoPorDefecto);
  paso_de_configuracion(r, &t, "sensorStart", "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
}

void prueba_getrange_no_se_envia_en_el_arranque_completo() {
  // El arranque (reiniciar(true)) y la recuperación sin configuración guardada no pasan por getRange.
  Interprete r;
  uint32_t t = 100;
  for (const char* o : {"sensorStop", "detRangeCfg", "outputLatency", "saveCfg", "sensorStart"})
    paso_de_configuracion(r, &t, o, "Done\r\n");
  r.reiniciar();
  esperar_purga(r, &t);
  for (const char* o : {"sensorStop", "detRangeCfg", "outputLatency", "saveCfg", "sensorStart"})
    paso_de_configuracion(r, &t, o, "Done\r\n");
  EXIGIR(r.fase() == Fase::Estabilizando);
}

// Con el radar simulado: un módulo sustituido (o una flash que perdió la configuración)
// con la placa encendida. La ventana guardada es otra: la recuperación NO lo arranca así,
// escribe la nuestra una vez y el radar acaba con ella.
void prueba_modulo_cambiado_se_reconfigura_en_la_recuperacion() {
  Banco b;
  poner_operando(b);
  EXIGIR(b.uart.escrituras_flash == 1);
  b.correr(3000);
  b.uart.rango_flash_ini = 0;  // flash de fábrica: 0 a 3 m
  b.uart.rango_flash_fin = 20;
  const size_t ordenes0 = b.uart.ordenes.size();
  EXIGIR(reiniciar_radar_y_recuperar(b, 3000) == 1);  // un solo intento: no hace falta uno fallido
  std::vector<std::string> nuevas(b.uart.ordenes.begin() + static_cast<long>(ordenes0), b.uart.ordenes.end());
  EXIGIR(nuevas.size() == 6);
  if (nuevas.size() == 6) {
    EXIGIR(nuevas[0] == "sensorStop");
    EXIGIR(nuevas[1] == "getRange");
    EXIGIR(nuevas[2] == "detRangeCfg -1 0 2");
    EXIGIR(nuevas[3].rfind("outputLatency", 0) == 0);
    EXIGIR(nuevas[4].rfind("saveCfg", 0) == 0);
    EXIGIR(nuevas[5] == "sensorStart");
  }
  EXIGIR(b.uart.escrituras_flash == 2);
  EXIGIR(b.uart.rango_flash_fin == 2);
  EXIGIR(b.radar.contadores().rangos_distintos == 1);
  EXIGIR(b.radar.contadores().errores_radar == 0);
  // Ya con la nuestra, la siguiente recuperación vuelve a ser ligera y no escribe.
  b.correr(5000);
  const size_t ordenes1 = b.uart.ordenes.size();
  EXIGIR(reiniciar_radar_y_recuperar(b, 3000) == 1);
  EXIGIR(b.uart.ordenes.size() - ordenes1 == 3);
  EXIGIR(b.uart.escrituras_flash == 2);
}

void prueba_getrange_basura_o_error_del_radar_simulado_se_reconfigura() {
  const char* respuestas[] = {"getRange\r\nError\r\n", "getRange\r\nResponse basura\r\nDone\r\n",
                              "$JYBSS,1, , , *\r\nResponse 0.000 0.450\r\n$JYBSS,0, , , *\r\nDone\r\n"};
  for (const char* r : respuestas) {
    Banco b;
    poner_operando(b);
    b.correr(3000);
    b.uart.getrange_crudo = r;
    EXIGIR(reiniciar_radar_y_recuperar(b, 3000) == 1);
    EXIGIR(b.uart.contar("getRange") == 1);
    EXIGIR(b.uart.escrituras_flash == 2);  // se guardó otra vez: no se confía en lo que no se pudo leer
    EXIGIR(b.salud() == sen0395::kSaludOk);
  }
  // Y con una lectura buena e intercalada, ligera y sin escribir.
  Banco b;
  poner_operando(b);
  b.correr(3000);
  b.uart.getrange_crudo = "$JYBSS,1, , , *\r\ngetRange\r\n$JYBSS,0, , , *\r\nResponse 0.000 0.300\r\nDone\r\nleapMMW:/>";
  EXIGIR(reiniciar_radar_y_recuperar(b, 3000) == 1);
  EXIGIR(b.uart.escrituras_flash == 1);
  EXIGIR(b.uart.contar("detRangeCfg") == 1);  // la del arranque
}

}  // namespace

int main() {
  prueba_desborde_reproduce_el_defecto_anterior();
  prueba_desborde_no_une_la_linea_a_medias();
  prueba_desborde_del_controlador();
  prueba_desborde_acota_el_drenaje();
  prueba_desborde_en_configuracion();
  prueba_perdida_durante_la_lectura_no_une_la_linea();
  prueba_perdida_durante_la_lectura_no_confirma_la_orden();
  prueba_cola_vieja_tras_drenaje_acotado();
  prueba_cola_justo_en_el_limite();
  prueba_no_envia_orden_con_cola_vieja_pendiente();
  prueba_cola_vieja_no_confirma_la_orden();
  prueba_supervisor_no_reinicia_con_cola_sin_vaciar();
  prueba_arranque_con_radar_mudo_se_recupera();
  prueba_radar_reinicia_y_pierde_la_configuracion();
  prueba_el_reinicio_purga_la_uart();
  prueba_error_al_guardar_no_deja_sin_radar();
  prueba_reintentos_con_espera_creciente_y_acotados();
  prueba_radar_desconectado_tambien_acotado();
  prueba_el_contador_vuelve_a_cero_con_salud();
  prueba_configuracion_invalida_no_se_reintenta();
  prueba_recuperacion_ligera_con_error_repite_la_secuencia_completa();
  prueba_reiniciar_ligero_en_el_interprete();
  prueba_reiniciar_ligero_sin_configuracion_guardada_es_completo();
  prueba_error_en_recuperacion_ligera_olvida_lo_guardado();
  prueba_getrange_coincide_arranca_sin_escribir();
  prueba_getrange_distinto_repite_la_secuencia_completa();
  prueba_getrange_ilegible_repite_la_secuencia_completa();
  prueba_getrange_error_repite_la_secuencia_completa();
  prueba_getrange_con_tramas_y_prompt_intercalados();
  prueba_getrange_llega_en_trozos();
  prueba_getrange_sin_respuesta_vence_y_la_siguiente_sigue_ligera();
  prueba_getrange_no_se_envia_en_el_arranque_completo();
  prueba_modulo_cambiado_se_reconfigura_en_la_recuperacion();
  prueba_getrange_basura_o_error_del_radar_simulado_se_reconfigura();
  printf("%d comprobaciones, %d fallos\n", g_casos, g_fallos);
  return g_fallos == 0 ? 0 : 1;
}

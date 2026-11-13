// Pruebas de integración del radar (EA-11 dentro de EA-12), en el portátil: el
// intérprete REAL de sen0395.h, la lectura de la UART y el supervisor de
// recuperación de enlace_radar.h, con un doble mínimo de la UART y del radar
// (bytes, reloj y respuestas Done/Error). Cubre:
//   - desborde de la UART: una línea a medias NO se une con lo que llegue después
//     (la lógica anterior fabricaba una trama válida con un SinBlanco falso), y el
//     resultado anterior deja de valer hasta una trama íntegra nueva;
//   - recuperación acotada: el radar se reinicia o se calla, la configuración
//     falla; purga de la UART, estabilización de al menos 5 s, observación nueva,
//     espera creciente y ninguna escritura de la flash del sensor al recuperar si
//     la configuración ya está guardada;
//   - un radar FIEL a lo medido en el banco del 12/11 (SimUart::fiel): arranca
//     parado y contesta `sensor stopped already` + `Error` a sensorStop (R1), y se
//     niega a arrancar con parámetros sin guardar (R2).
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
class SimUart : public radar::PuertoUart {
 public:
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
  // Radar fiel al SEN0395 del banco (12/11), en vez de «Done a todo». Arranca
  // parado; sensorStop con el radar parado contesta `sensor stopped already` y
  // `Error` (R1); detRangeCfg y outputLatency exigen el radar parado y dejan
  // parámetros sin guardar; sensorStart con parámetros sin guardar contesta
  // `new parameter isn't save, can't startSensor` y `Error` (R2); saveCfg los guarda.
  bool fiel = false;
  bool sin_guardar = false;
  int guardados = 0;  // saveCfg que escribieron la flash del radar
  // El cable del TX del radar (RX de la placa) está suelto: el radar recibe y
  // actúa, pero sus respuestas y tramas no llegan a la placa.
  bool tx_cortado = false;

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
      if (!tx_cortado) poner(respuestas_.front().texto);
      respuestas_.pop_front();
    }
    if (marcha && modo != Modo::Mudo && t >= proxima_trama) {
      if (!tx_cortado) poner(presencia ? "$JYBSS,1, , , *\r\n" : "$JYBSS,0, , , *\r\n");
      presencia = !presencia;
      proxima_trama += 1000;
    }
  }

  // El radar se reinicia: calla `mudo_ms` y vuelve SIN la configuración (no emite).
  void reiniciar_radar(uint32_t mudo_ms) {
    marcha = false;
    sin_guardar = false;  // lo aplicado sin guardar se pierde; la flash conserva lo guardado
    modo = Modo::Mudo;
    vuelve_ = t + mudo_ms;
    respuestas_.clear();
  }
  void revisar_vuelta() {
    if (vuelve_ != 0 && t >= vuelve_) {
      vuelve_ = 0;
      modo = Modo::Normal;
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
  void radar_fiel(const std::string& linea) {
    std::string r = "Done\r\n";
    if (linea == "sensorStop") {
      if (!marcha) r = "sensor stopped already\r\nError\r\n";
      marcha = false;
    } else if (linea.rfind("detRangeCfg", 0) == 0 || linea.rfind("outputLatency", 0) == 0) {
      if (marcha) r = "sensor is not stopped\r\nError\r\n";
      else sin_guardar = true;
    } else if (linea.rfind("saveCfg", 0) == 0) {
      sin_guardar = false;
      ++guardados;
      r = "save cfg complete\r\nDone\r\n";
    } else if (linea == "sensorStart") {
      if (sin_guardar) {
        r = "new parameter isn't save, can't startSensor\r\nError\r\n";
      } else if (marcha) {
        r = "sensor started already\r\nError\r\n";
      } else {
        marcha = true;
        proxima_trama = t + 1000;
      }
    }
    respuestas_.push_back({t + 20, r});
  }
  void radar_recibe(const std::string& linea) {
    ordenes.push_back(linea);
    if (modo == Modo::Mudo) return;
    if (fiel && modo == Modo::Normal) {
      radar_fiel(linea);
      return;
    }
    const bool es_guardar = linea.rfind("saveCfg", 0) == 0;
    const bool error = modo == Modo::ErrorSiempre || (modo == Modo::ErrorAlGuardar && es_guardar);
    if (!error && linea == "sensorStart") {
      marcha = true;
      proxima_trama = t + 1000;
    }
    if (linea == "sensorStop") marcha = false;
    respuestas_.push_back({t + 20, error ? "Error\r\n" : "Done\r\n"});
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
  b.radar.recuperar();  // hay una orden pendiente (sensorStop)
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
  // El arranque nunca guardó (sensorStop no se contestó): la primera configuración
  // que el radar acepta SÍ guarda, o no arrancaría (R2). Una vez, no en cada reintento.
  EXIGIR(b.uart.contar("saveCfg") == 1);
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
  // Las órdenes de la recuperación: parar y arrancar. Con la configuración ya
  // guardada no se reaplican rango y latencia (el radar no arrancaría sin saveCfg)
  // ni se guarda otra vez.
  std::vector<std::string> nuevas(b.uart.ordenes.begin() + static_cast<long>(ordenes0), b.uart.ordenes.end());
  EXIGIR(nuevas.size() == 2);
  if (nuevas.size() == 2) {
    EXIGIR(nuevas[0] == "sensorStop");
    EXIGIR(nuevas[1] == "sensorStart");
  }
  EXIGIR(b.uart.contar("saveCfg") == 1);  // sigue siendo la del arranque
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
  // El radar rechaza saveCfg: sin guardar no arranca (R2), así que el firmware no
  // puede darlo por sano. Reintenta la configuración completa con espera creciente
  // (cada saveCfg exige antes que el radar conteste a parar, rango y latencia) y, en
  // cuanto el radar guarda, se recupera.
  Banco b;
  b.uart.modo = SimUart::Modo::ErrorAlGuardar;
  const int64_t ms = b.correr_hasta([&] { return b.radar.fase() == Fase::Fallo; }, 5000);
  EXIGIR(ms >= 0);
  EXIGIR(b.radar.motivo_fallo() == sen0395::MotivoFallo::RespuestaError);
  EXIGIR(b.salud() == sen0395::kSaludFalloRadar);
  const uint32_t t0 = b.uart.t;
  while (b.uart.t - t0 < 10u * 60u * 1000u) {
    b.ciclo();
    EXIGIR(b.salud() != sen0395::kSaludOk);
  }
  EXIGIR(b.uart.contar("saveCfg") >= 4);
  EXIGIR(b.uart.contar("saveCfg") <= 20);  // acotado por la espera creciente
  b.uart.modo = SimUart::Modo::Normal;
  EXIGIR(b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 120000) >= 0);
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

void prueba_recuperar_en_el_interprete() {
  Interprete r;
  uint8_t orden[sen0395::kLongitudOrdenMax];
  const char* completa[] = {"sensorStop", "detRangeCfg", "outputLatency", "saveCfg", "sensorStart"};
  const char* ligera[] = {"sensorStop", "sensorStart"};
  uint32_t t = 100;
  for (const char* esperada : completa) {
    const size_t n = r.salida_pendiente(orden, sizeof(orden));
    EXIGIR(n > 0 && strncmp(reinterpret_cast<const char*>(orden), esperada, strlen(esperada)) == 0);
    r.salida_enviada(t);
    t += 10;
    r.procesar(reinterpret_cast<const uint8_t*>("Done\r\n"), 6, t);
  }
  EXIGIR(r.fase() == Fase::Estabilizando);
  // Con la configuración guardada, recuperar() solo para y arranca.
  r.recuperar();
  t += r.configuracion().respuesta_max_ms * 3;
  r.procesar(nullptr, 0, t);
  for (const char* esperada : ligera) {
    const size_t n = r.salida_pendiente(orden, sizeof(orden));
    EXIGIR(n > 0 && strncmp(reinterpret_cast<const char*>(orden), esperada, strlen(esperada)) == 0);
    r.salida_enviada(t);
    t += 10;
    r.procesar(reinterpret_cast<const uint8_t*>("Done\r\n"), 6, t);
  }
  EXIGIR(r.fase() == Fase::Estabilizando);
  // reiniciar() es el arranque: configura todo y guarda, aunque ya esté guardado.
  r.reiniciar();
  t += r.configuracion().respuesta_max_ms * 3;
  r.procesar(nullptr, 0, t);
  r.salida_enviada(t);  // sensorStop
  t += 10;
  r.procesar(reinterpret_cast<const uint8_t*>("Done\r\n"), 6, t);
  r.salida_pendiente(orden, sizeof(orden));
  r.salida_enviada(t);
  t += 10;
  r.procesar(reinterpret_cast<const uint8_t*>("Done\r\n"), 6, t);
  r.salida_pendiente(orden, sizeof(orden));
  r.salida_enviada(t);
  t += 10;
  r.procesar(reinterpret_cast<const uint8_t*>("Done\r\n"), 6, t);
  const size_t n = r.salida_pendiente(orden, sizeof(orden));
  EXIGIR(n > 0 && strncmp(reinterpret_cast<const char*>(orden), "saveCfg", 7) == 0);
}

// --- Radar fiel al del banco (12/11) --------------------------------------------------

void prueba_radar_ya_parado_al_arrancar() {
  // R1: el radar arranca parado y contesta a sensorStop `sensor stopped already` +
  // `Error`. Antes, eso era un fallo (salud 4) en todos los arranques.
  Banco b;
  b.uart.fiel = true;
  poner_operando(b);
  EXIGIR(b.supervisor.reintentos() == 0);
  EXIGIR(b.radar.contadores().errores_radar == 0);
  EXIGIR(b.uart.ordenes.size() == 5);
  EXIGIR(b.uart.guardados == 1);
  EXIGIR(!b.uart.sin_guardar);
}

void prueba_cable_del_tx_suelto_se_recupera() {
  // R2, paso 6 del banco: se suelta el TX del radar (GPIO17) 20 s y se reconecta.
  // Antes, la recuperación reaplicaba rango y latencia sin guardar y el radar
  // contestaba `new parameter isn't save, can't startSensor` para siempre.
  Banco b;
  b.uart.fiel = true;
  poner_operando(b);
  EXIGIR(b.uart.guardados == 1);
  b.uart.tx_cortado = true;
  EXIGIR(b.correr_hasta([&] { return b.salud() == sen0395::kSaludSinDatos; }, 3000) >= 0);  // salud 2
  b.correr(20000);
  EXIGIR(b.salud() != sen0395::kSaludOk);
  EXIGIR(b.supervisor.reintentos() >= 1);
  b.uart.tx_cortado = false;
  const int64_t ms = b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 30000);
  EXIGIR(ms >= 0);  // salud 0 en 30 s tras reconectar, sin reiniciar la placa
  EXIGIR(b.uart.guardados == 1);                // la recuperación no escribió la flash
  EXIGIR(b.uart.contar("detRangeCfg") == 1);    // ni reaplicó rango (solo el del arranque)
  EXIGIR(b.uart.contar("outputLatency") == 1);  // ni latencia
  EXIGIR(!b.uart.sin_guardar);
}

void prueba_radar_que_se_reinicia_solo_vuelve_con_su_configuracion() {
  // R3 (causa fuera de alcance) y R1+R2: el radar se reinicia, vuelve parado con
  // la configuración que guardó, y el firmware lo arranca sin tocar su flash.
  Banco b;
  b.uart.fiel = true;
  poner_operando(b);
  const size_t ordenes0 = b.uart.ordenes.size();
  b.correr(3000);
  b.uart.reiniciar_radar(3000);
  const int64_t ms = b.correr_hasta([&] { return b.reinicios_supervisor > 0 && b.salud() == sen0395::kSaludOk; }, 90000);
  EXIGIR(ms >= 0);
  std::vector<std::string> nuevas(b.uart.ordenes.begin() + static_cast<long>(ordenes0), b.uart.ordenes.end());
  EXIGIR(nuevas.size() == 2);
  if (nuevas.size() == 2) {
    EXIGIR(nuevas[0] == "sensorStop");
    EXIGIR(nuevas[1] == "sensorStart");
  }
  EXIGIR(b.uart.guardados == 1);
}

void prueba_arranque_con_radar_apagado_guarda_una_vez() {
  // La placa arranca con el radar sin alimentar y este despierta después, parado y
  // sin nada guardado en esta ejecución: su primera configuración guarda (si no, no
  // arrancaría) y las siguientes recuperaciones ya no.
  Banco b;
  b.uart.fiel = true;
  b.uart.modo = SimUart::Modo::Mudo;
  b.correr(40000);
  EXIGIR(b.uart.guardados == 0);
  b.uart.modo = SimUart::Modo::Normal;
  EXIGIR(b.correr_hasta([&] { return b.salud() == sen0395::kSaludOk; }, 120000) >= 0);
  EXIGIR(b.uart.guardados == 1);
  EXIGIR(b.uart.contar("saveCfg") == 1);
}

void prueba_radar_que_se_reinicia_sin_parar_no_gasta_su_flash() {
  // Diez minutos con el radar reiniciándose cada ~20 s tras arrancar: decenas de
  // recuperaciones y ninguna escritura de su flash más allá de la del arranque.
  Banco b;
  b.uart.fiel = true;
  poner_operando(b);
  const uint32_t t0 = b.uart.t;
  uint32_t proximo = t0 + 20000;
  while (b.uart.t - t0 < 10u * 60u * 1000u) {
    if (b.uart.t >= proximo && b.uart.marcha) {
      b.uart.reiniciar_radar(500);
      proximo = b.uart.t + 20000;
    }
    b.ciclo();
  }
  EXIGIR(b.supervisor.reintentos() >= 3);
  EXIGIR(b.uart.guardados == 1);
  EXIGIR(b.uart.contar("saveCfg") == 1);
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
  prueba_recuperar_en_el_interprete();
  prueba_radar_ya_parado_al_arrancar();
  prueba_cable_del_tx_suelto_se_recupera();
  prueba_radar_que_se_reinicia_solo_vuelve_con_su_configuracion();
  prueba_arranque_con_radar_apagado_guarda_una_vez();
  prueba_radar_que_se_reinicia_sin_parar_no_gasta_su_flash();
  printf("%d comprobaciones, %d fallos\n", g_casos, g_fallos);
  return g_fallos == 0 ? 0 : 1;
}

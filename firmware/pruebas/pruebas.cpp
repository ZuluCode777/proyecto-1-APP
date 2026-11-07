// Pruebas del contrato BLE v1.0 en el portátil. Leen los mismos vectores que
// las pruebas de Swift (contratos/ble/vectores.txt y sesiones.txt).
// Uso: pruebas <directorio con vectores.txt y sesiones.txt>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "emisor_sintetico.h"
#include "trama_ble.h"

using namespace visionaria::ble;

namespace {

int g_casos = 0;
int g_fallos = 0;

void fallo(const std::string& donde, const std::string& detalle) {
  ++g_fallos;
  fprintf(stderr, "FALLO %s: %s\n", donde.c_str(), detalle.c_str());
}

void exigir(bool condicion, const std::string& donde, const std::string& detalle) {
  ++g_casos;
  if (!condicion) fallo(donde, detalle);
}

std::vector<std::string> separar(const std::string& linea, char sep) {
  std::vector<std::string> r;
  std::string t;
  std::istringstream ss(linea);
  if (sep == ' ') {
    while (ss >> t) r.push_back(t);
  } else {
    while (std::getline(ss, t, sep)) r.push_back(t);
  }
  return r;
}

bool leer_hex(const std::string& hex, std::vector<uint8_t>* bytes) {
  bytes->clear();
  if (hex == "-") return true;
  if (hex.size() % 2 != 0) return false;
  for (size_t i = 0; i < hex.size(); i += 2) {
    char* fin = nullptr;
    const std::string par = hex.substr(i, 2);
    const long v = strtol(par.c_str(), &fin, 16);
    if (*fin != '\0') return false;
    bytes->push_back(static_cast<uint8_t>(v));
  }
  return true;
}

std::string a_hex(const uint8_t* d, size_t n) {
  static const char* kDigitos = "0123456789abcdef";
  std::string s;
  for (size_t i = 0; i < n; ++i) {
    s += kDigitos[d[i] >> 4];
    s += kDigitos[d[i] & 0xF];
  }
  return s.empty() ? "-" : s;
}

typedef std::map<std::string, long long> Campos;

Campos campos(const Informacion& i) {
  Campos c;
  c["mayor"] = i.version_mayor;
  c["menor"] = i.version_menor;
  c["capacidades"] = i.capacidades;
  c["arranque"] = i.id_arranque;
  c["fwMayor"] = i.firmware_mayor;
  c["fwMenor"] = i.firmware_menor;
  c["fwRevision"] = i.firmware_revision;
  c["perfil"] = i.perfil;
  c["periodoMs"] = i.periodo_ms;
  c["caducidadMs"] = i.caducidad_ms;
  c["distMinMm"] = i.distancia_minima_mm;
  c["distMaxMm"] = i.distancia_maxima_mm;
  return c;
}

Campos campos(const Medicion& m) {
  Campos c;
  c["mayor"] = m.version_mayor;
  c["banderas"] = m.banderas;
  c["secuencia"] = m.secuencia;
  c["arranque"] = m.id_arranque;
  c["emisionMs"] = m.instante_ms;
  c["distanciaMm"] = m.distancia_mm;
  c["azimutCent"] = m.azimut_centesimas;
  c["edadRadarMs"] = m.edad_radar_ms;
  c["bateria"] = m.bateria;
  c["salud"] = m.salud;
  return c;
}

Campos leer_campos(const std::vector<std::string>& t, size_t desde) {
  Campos c;
  for (size_t i = desde; i < t.size(); ++i) {
    const size_t k = t[i].find('=');
    if (k != std::string::npos) c[t[i].substr(0, k)] = atoll(t[i].c_str() + k + 1);
  }
  return c;
}

void comparar(const Campos& obtenido, const Campos& esperado, const std::string& donde) {
  exigir(obtenido.size() == esperado.size(), donde, "cantidad de campos distinta");
  for (Campos::const_iterator it = esperado.begin(); it != esperado.end(); ++it) {
    Campos::const_iterator o = obtenido.find(it->first);
    exigir(o != obtenido.end() && o->second == it->second, donde, "campo " + it->first);
  }
}

std::vector<std::vector<std::string> > leer_lineas(const std::string& ruta) {
  std::vector<std::vector<std::string> > lineas;
  std::ifstream f(ruta.c_str());
  if (!f) {
    fallo(ruta, "no se pudo abrir");
    return lineas;
  }
  std::string linea;
  while (std::getline(f, linea)) {
    const size_t c = linea.find('#');
    if (c != std::string::npos) linea.erase(c);
    std::vector<std::string> t = separar(linea, ' ');
    if (!t.empty()) lineas.push_back(t);
  }
  return lineas;
}

// --- Vectores ---------------------------------------------------------------

void probar_info(const std::vector<std::string>& t, std::map<std::string, Informacion>* infos) {
  const std::string donde = "info " + t[1];
  std::vector<uint8_t> b;
  exigir(leer_hex(t[2], &b), donde, "hex inválido");
  Informacion i;
  const Error e = decodificar_informacion(b.data(), b.size(), &i);
  if (t[3] == "ok") {
    exigir(e == Error::Ninguno, donde, std::string("error inesperado ") + nombre(e));
    if (e != Error::Ninguno) return;
    comparar(campos(i), leer_campos(t, 4), donde);
    uint8_t salida[kLongitudTrama];
    exigir(codificar_informacion(i, salida) == Error::Ninguno, donde, "no codifica");
    exigir(a_hex(salida, kLongitudTrama) == t[2], donde, "codificación distinta de los vectores");
    (*infos)[t[1]] = i;
  } else {
    exigir(std::string(nombre(e)) == t[4], donde, std::string("esperaba ") + t[4] + " y fue " + nombre(e));
  }
}

void probar_med(const std::vector<std::string>& t, const std::map<std::string, Informacion>& infos) {
  const std::string donde = "med " + t[1];
  std::map<std::string, Informacion>::const_iterator ref = infos.find(t[2]);
  if (ref == infos.end()) return fallo(donde, "información de referencia desconocida " + t[2]);
  std::vector<uint8_t> b;
  exigir(leer_hex(t[3], &b), donde, "hex inválido");
  Medicion m;
  const Error e = decodificar_medicion(b.data(), b.size(), ref->second, &m);
  if (t[4] == "ok") {
    exigir(e == Error::Ninguno, donde, std::string("error inesperado ") + nombre(e));
    if (e != Error::Ninguno) return;
    comparar(campos(m), leer_campos(t, 5), donde);
    uint8_t salida[kLongitudTrama];
    exigir(codificar_medicion(m, ref->second, salida) == Error::Ninguno, donde, "no codifica");
    exigir(a_hex(salida, kLongitudTrama) == t[3], donde, "codificación distinta de los vectores");
  } else {
    exigir(std::string(nombre(e)) == t[5], donde, std::string("esperaba ") + t[5] + " y fue " + nombre(e));
  }
}

// emision <id> <info_ref> <seq0> <inicioMs> <pasoMs> <edadMs> <estado> <sim> <hex,hex,...>
void probar_emision(const std::vector<std::string>& t, const std::map<std::string, Informacion>& infos) {
  const std::string donde = "emision " + t[1];
  if (t.size() != 10) return fallo(donde, "formato");
  std::map<std::string, Informacion>::const_iterator ref = infos.find(t[2]);
  if (ref == infos.end()) return fallo(donde, "información desconocida");
  EntradaRadar entrada;
  entrada.edad_ms = static_cast<uint16_t>(atoi(t[6].c_str()));
  const std::vector<std::string> partes = separar(t[7], ':');
  if (partes[0] == "sinBlanco") {
    entrada.estado = EstadoRadar::SinBlanco;
  } else if (partes[0] == "presencia") {
    entrada.estado = EstadoRadar::Presencia;
  } else if (partes[0] == "objetivo") {
    entrada.estado = EstadoRadar::Objetivo;
    entrada.distancia_mm = static_cast<uint16_t>(atoi(partes[1].c_str()));
    if (partes[2] != "-") {
      entrada.tiene_azimut = true;
      entrada.azimut_centesimas = static_cast<int16_t>(atoi(partes[2].c_str()));
    }
  } else if (partes[0] == "fallo") {
    entrada.estado = EstadoRadar::Fallo;
    entrada.salud = static_cast<uint8_t>(atoi(partes[1].c_str()));
  } else {
    return fallo(donde, "estado desconocido " + partes[0]);
  }
  EmisorSintetico emisor(ref->second, t[8] == "1", static_cast<uint16_t>(atoi(t[3].c_str())));
  const uint32_t inicio = static_cast<uint32_t>(strtoull(t[4].c_str(), nullptr, 10));
  const uint32_t paso = static_cast<uint32_t>(strtoull(t[5].c_str(), nullptr, 10));
  const std::vector<std::string> esperadas = separar(t[9], ',');
  for (size_t k = 0; k < esperadas.size(); ++k) {
    uint8_t salida[kLongitudTrama];
    const Error e = emisor.generar(inicio + static_cast<uint32_t>(k) * paso, entrada, salida);
    exigir(e == Error::Ninguno, donde, std::string("emisor falló ") + nombre(e));
    exigir(a_hex(salida, kLongitudTrama) == esperadas[k], donde,
           "trama " + std::to_string(k) + " distinta de los vectores");
  }
}

void probar_vectores(const std::string& dir) {
  std::map<std::string, Informacion> infos;
  const std::vector<std::vector<std::string> > lineas = leer_lineas(dir + "/vectores.txt");
  exigir(!lineas.empty(), "vectores.txt", "vacío");
  for (size_t i = 0; i < lineas.size(); ++i)
    if (lineas[i][0] == "info" && lineas[i].size() >= 5) probar_info(lineas[i], &infos);
  for (size_t i = 0; i < lineas.size(); ++i) {
    const std::vector<std::string>& t = lineas[i];
    if (t[0] == "med" && t.size() >= 6) probar_med(t, infos);
    else if (t[0] == "emision") probar_emision(t, infos);
  }
}

// En sesiones.txt el C++ solo comprueba lo que le toca: que su decodificador
// coincide con "decod=" en cada Información, referencia y entrega.
void probar_sesiones(const std::string& dir) {
  const std::vector<std::vector<std::string> > lineas = leer_lineas(dir + "/sesiones.txt");
  exigir(!lineas.empty(), "sesiones.txt", "vacío");
  std::string escenario;
  bool tiene_info = false;
  Informacion contexto;
  int comprobadas = 0;
  for (size_t n = 0; n < lineas.size(); ++n) {
    const std::vector<std::string>& t = lineas[n];
    if (t[0] == "escenario") {
      escenario = t[1];
      tiene_info = false;
      continue;
    }
    const bool es_info = t[0] == "info";
    const bool es_trama = t[0] == "referencia" || t[0] == "entrega";
    if (!es_info && !es_trama) continue;
    const std::string donde = "sesiones " + escenario + " línea " + std::to_string(n);
    std::string hex, decod;
    for (size_t i = 1; i < t.size(); ++i) {
      if (t[i].compare(0, 6, "decod=") == 0) decod = t[i].substr(6);
    }
    hex = t[t[0] == "referencia" ? 3 : 2];
    std::vector<uint8_t> b;
    exigir(leer_hex(hex, &b), donde, "hex inválido");
    ++comprobadas;
    Error e;
    if (es_info) {
      Informacion i;
      e = decodificar_informacion(b.data(), b.size(), &i);
      if (e == Error::Ninguno) {
        contexto = i;
        tiene_info = true;
      }
    } else {
      if (!tiene_info) {
        fallo(donde, "trama sin Información previa en el escenario");
        continue;
      }
      Medicion m;
      e = decodificar_medicion(b.data(), b.size(), contexto, &m);
    }
    const std::string obtenido = e == Error::Ninguno ? "ok" : nombre(e);
    exigir(obtenido == decod, donde, "decod esperado " + decod + ", obtenido " + obtenido);
  }
  exigir(comprobadas > 0, "sesiones.txt", "sin tramas comprobadas");
}

// --- Pruebas directas -------------------------------------------------------

Informacion info_sen0395() {
  Informacion i;
  i.id_arranque = 0x11223344;
  i.perfil = 1;
  i.distancia_maxima_mm = 3000;
  return i;
}

void probar_ejemplo_del_informe() {
  // Ejemplo sintético de §8.3 de investigacion-hardware-ios.md.
  Informacion i;
  i.capacidades = kCapDistancia | kCapAzimut | kCapBateria;
  i.perfil = 2;
  i.distancia_minima_mm = 100;
  i.distancia_maxima_mm = 6000;
  Medicion m;
  m.banderas = 0x0F;
  m.secuencia = 42;
  m.id_arranque = 0x11223344;
  m.instante_ms = 1000;
  m.distancia_mm = 1200;
  m.azimut_centesimas = -3000;
  m.edad_radar_ms = 20;
  uint8_t s[kLongitudTrama];
  exigir(codificar_medicion(m, i, s) == Error::Ninguno, "ejemplo", "no codifica");
  exigir(a_hex(s, kLongitudTrama) == "010f2a0044332211e8030000b00448f41400ff00", "ejemplo",
         "bytes distintos del informe");
}

void probar_emisor() {
  const Informacion info = info_sen0395();
  EmisorSintetico e(info, false, 65535);
  EntradaRadar sano;
  sano.estado = EstadoRadar::Presencia;
  sano.edad_ms = 20;
  uint8_t a[kLongitudTrama], b[kLongitudTrama];
  exigir(e.generar(10, sano, a) == Error::Ninguno, "emisor", "primera");
  exigir(e.generar(110, sano, b) == Error::Ninguno, "emisor", "segunda");
  exigir(e.siguiente_secuencia() == 1, "emisor", "la secuencia no vuelve a cero módulo 65536");

  // UART a 1 Hz: edad 800 ms supera la caducidad. Nunca sale como vigente.
  EntradaRadar vieja = sano;
  vieja.edad_ms = 800;
  Medicion m;
  exigir(e.generar(210, vieja, a) == Error::Ninguno, "emisor", "vencida");
  exigir(decodificar_medicion(a, kLongitudTrama, info, &m) == Error::Ninguno, "emisor", "decodifica");
  exigir((m.banderas & (kBanResultado | kBanBlanco)) == 0 && m.edad_radar_ms == 800, "emisor",
         "una edad de 800 ms no debe publicarse como resultado vigente");
  // En el límite exacto sí es vigente; un milisegundo más, no.
  vieja.edad_ms = 500;
  e.generar(310, vieja, a);
  decodificar_medicion(a, kLongitudTrama, info, &m);
  exigir((m.banderas & kBanResultado) != 0, "emisor", "edad 500 debe ser vigente");
  vieja.edad_ms = 501;
  e.generar(410, vieja, a);
  decodificar_medicion(a, kLongitudTrama, info, &m);
  exigir((m.banderas & kBanResultado) == 0, "emisor", "edad 501 no debe ser vigente");

  // Sin edad conocida nunca hay resultado.
  EntradaRadar sin_edad;
  sin_edad.estado = EstadoRadar::Presencia;
  e.generar(510, sin_edad, a);
  decodificar_medicion(a, kLongitudTrama, info, &m);
  exigir(m.banderas == 0 && m.edad_radar_ms == kEdadDesconocida, "emisor", "edad desconocida");

  // Fallo exige salud 1..6 y no deja ningún resultado.
  EntradaRadar f;
  f.estado = EstadoRadar::Fallo;
  const uint16_t antes = e.siguiente_secuencia();
  exigir(e.generar(610, f, a) == Error::SaludInvalida, "emisor", "fallo sin salud");
  exigir(e.siguiente_secuencia() == antes, "emisor", "la secuencia solo avanza si hay trama");
  f.salud = 2;
  exigir(e.generar(710, f, a) == Error::Ninguno, "emisor", "fallo");
  decodificar_medicion(a, kLongitudTrama, info, &m);
  exigir(m.salud == 2 && (m.banderas & 0x0F) == 0 && m.distancia_mm == kDistanciaDesconocida, "emisor",
         "fallo sin medidas");

  // Capacidad ausente: la distancia no se publica ni siquiera si la entrada la trae.
  EntradaRadar o;
  o.estado = EstadoRadar::Objetivo;
  o.distancia_mm = 1200;
  o.edad_ms = 10;
  e.generar(810, o, a);
  decodificar_medicion(a, kLongitudTrama, info, &m);
  exigir(m.banderas == (kBanResultado | kBanBlanco) && m.distancia_mm == kDistanciaDesconocida,
         "emisor", "sin capacidad de distancia");

  // Reinicio: arranque nuevo, secuencia en cero; el mismo identificador no vale.
  exigir(!e.reiniciar(0x11223344), "emisor", "mismo arranque");
  exigir(e.reiniciar(0xAABBCCDD) && e.siguiente_secuencia() == 0, "emisor", "reinicio");
  e.generar(0, sano, a);
  decodificar_medicion(a, kLongitudTrama, e.informacion(), &m);
  exigir(m.id_arranque == 0xAABBCCDD && m.secuencia == 0, "emisor", "trama tras reinicio");

  // Simulación activa el bit 5.
  EmisorSintetico s(info, true);
  s.generar(0, sano, a);
  decodificar_medicion(a, kLongitudTrama, info, &m);
  exigir((m.banderas & kBanSimulacion) != 0, "emisor", "bit de simulación");
}

void probar_nombres() {
  for (uint8_t i = 1; i <= static_cast<uint8_t>(Error::ValorFueraDeRango); ++i) {
    const Error e = static_cast<Error>(i);
    exigir(error_desde_nombre(nombre(e)) == e, "nombres", nombre(e));
  }
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    fprintf(stderr, "uso: %s <directorio de contratos/ble>\n", argv[0]);
    return 2;
  }
  probar_ejemplo_del_informe();
  probar_nombres();
  probar_emisor();
  probar_vectores(argv[1]);
  probar_sesiones(argv[1]);
  printf("%d comprobaciones, %d fallos\n", g_casos, g_fallos);
  return g_fallos == 0 ? 0 : 1;
}

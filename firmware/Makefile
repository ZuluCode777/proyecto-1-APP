# Pruebas en el portátil o en CI; no necesita placa ni Arduino.
#   make probar            compila y ejecuta contra ../contratos/ble
CXX ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -Werror -pedantic -O1
FUENTES := accesorio/trama_ble.cpp accesorio/emisor_sintetico.cpp pruebas/pruebas.cpp
FUENTES_SEN := accesorio/trama_ble.cpp accesorio/emisor_sintetico.cpp accesorio/sen0395.cpp pruebas/pruebas_sen0395.cpp
VECTORES ?= ../contratos/ble

.PHONY: probar limpiar

probar: build/pruebas build/pruebas_sen0395
	./build/pruebas $(VECTORES)
	./build/pruebas_sen0395

build/pruebas: $(FUENTES) accesorio/trama_ble.h accesorio/emisor_sintetico.h
	mkdir -p build
	$(CXX) $(CXXFLAGS) -Iaccesorio -o $@ $(FUENTES)

build/pruebas_sen0395: $(FUENTES_SEN) accesorio/trama_ble.h accesorio/emisor_sintetico.h accesorio/sen0395.h
	mkdir -p build
	$(CXX) $(CXXFLAGS) -Iaccesorio -o $@ $(FUENTES_SEN)

limpiar:
	rm -rf build

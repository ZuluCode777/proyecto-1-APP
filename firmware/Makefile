# Pruebas en el portátil o en CI; no necesita placa ni Arduino.
#   make probar            compila y ejecuta contra ../contratos/ble
CXX ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -Werror -pedantic -O1
FUENTES := accesorio/trama_ble.cpp accesorio/emisor_sintetico.cpp pruebas/pruebas.cpp
VECTORES ?= ../contratos/ble

.PHONY: probar limpiar

probar: build/pruebas
	./build/pruebas $(VECTORES)

build/pruebas: $(FUENTES) accesorio/trama_ble.h accesorio/emisor_sintetico.h
	mkdir -p build
	$(CXX) $(CXXFLAGS) -Iaccesorio -o $@ $(FUENTES)

limpiar:
	rm -rf build

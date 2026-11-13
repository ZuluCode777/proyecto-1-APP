// Puente de banco: USB <-> UART1 del SEN0395, para probar órdenes a mano (con `orden_radar.py`).
// Pines del cableado del banco del 12/11 (RX 17, TX 18; ver R8 en el informe del 12/11): cámbialos si tu cableado es otro.
void setup() {
  Serial.begin(115200);
  Serial1.begin(115200, SERIAL_8N1, 17, 18);
}
void loop() {
  while (Serial.available()) Serial1.write(Serial.read());
  while (Serial1.available()) Serial.write(Serial1.read());
}

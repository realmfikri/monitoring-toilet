// --- waterSensor.cpp ---
#include "waterSensor.h"

void setupWaterSensor() {
  pinMode(waterSensorPin, INPUT_PULLUP);
}

String getWaterData() {
  String data = "--- Deteksi Genangan Air ---\n";
  if (digitalRead(waterSensorPin) == LOW) {
    data += "Status: Genangan air terdeteksi.";
  } else {
    data += "Status: Lantai kering.";
  }
  return data;
}
// --- waterSensor.h ---
#ifndef WATER_SENSOR_H
#define WATER_SENSOR_H

#include <Arduino.h>

const int waterSensorPin = 13;

void setupWaterSensor();
String getWaterData();

#endif
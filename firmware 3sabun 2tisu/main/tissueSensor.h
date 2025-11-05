// --- tissuesensor.h ---
#ifndef TISSUE_SENSOR_H
#define TISSUE_SENSOR_H

#include <Arduino.h>

const int tissueSensorPin1 = 18; 
const int tissueSensorPin2 = 5;  

void setupTissueSensor();
String getTissueData();

#endif
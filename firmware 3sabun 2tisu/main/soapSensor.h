// --- soapSensor.h ---
#ifndef SOAP_SENSOR_H
#define SOAP_SENSOR_H

#include <Arduino.h>

// Sensor Sabun 1
const int trigPin1 = 12; 
const int echoPin1 = 14; 

// Sensor Sabun 2 (DIPINDAHKAN DARI 25 & 26)
const int trigPin2 = 16; // PIN BARU
const int echoPin2 = 17; // PIN BARU

// Sensor Sabun 3
const int trigPin3 = 27; 
const int echoPin3 = 33; 

void setupSoapSensor();
long getDistance(int trigPin, int echoPin); 
String getSoapData();

#endif
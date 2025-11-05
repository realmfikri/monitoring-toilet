// --- soapSensor.cpp ---
#include "soapSensor.h"

void setupSoapSensor() {
    // Setup Sensor Sabun 1
    pinMode(trigPin1, OUTPUT);
    pinMode(echoPin1, INPUT);
    // Setup Sensor Sabun 2 (Menggunakan pin 16 & 17 yang baru)
    pinMode(trigPin2, OUTPUT);
    pinMode(echoPin2, INPUT);
    // Setup Sensor Sabun 3
    pinMode(trigPin3, OUTPUT);
    pinMode(echoPin3, INPUT);
}

long getDistance(int trigPin, int echoPin) {
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    long duration = pulseIn(echoPin, HIGH);
    long distanceCm = duration * 0.0343 / 2;
    return distanceCm;
}

String getSoapData() {
    long distance1 = getDistance(trigPin1, echoPin1);
    long distance2 = getDistance(trigPin2, echoPin2);
    long distance3 = getDistance(trigPin3, echoPin3);
    
    // Logika Status Ketersediaan Sabun
    String status1 = (distance1 > 10) ? "Habis" : "Aman";
    String status2 = (distance2 > 10) ? "Habis" : "Aman";
    String status3 = (distance3 > 10) ? "Habis" : "Aman";

    String data = "--- Ketersediaan Sabun ---\n";
    data += "Sabun 1 | Jarak: " + String(distance1) + " cm | Status: " + status1 + "\n";
    data += "Sabun 2 | Jarak: " + String(distance2) + " cm | Status: " + status2 + "\n";
    data += "Sabun 3 | Jarak: " + String(distance3) + " cm | Status: " + status3;
    
    return data;
}
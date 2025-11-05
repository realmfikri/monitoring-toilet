// --- tissuesensor.cpp ---
#include "tissueSensor.h"

void setupTissueSensor() {
    pinMode(tissueSensorPin1, INPUT_PULLUP);
    pinMode(tissueSensorPin2, INPUT_PULLUP);
}

String getTissueData() {
    String data = "--- Ketersediaan Tisu ---\n";
    
    if (digitalRead(tissueSensorPin1) == LOW) {
        data += "Status 1: Tisu Habis!";
    } else {
        data += "Status 1: Tisu Tersedia.";
    }
    
    if (digitalRead(tissueSensorPin2) == LOW) {
        data += "\nStatus 2: Tisu Habis!";
    } else {
        data += "\nStatus 2: Tisu Tersedia.";
    }
    return data;
}
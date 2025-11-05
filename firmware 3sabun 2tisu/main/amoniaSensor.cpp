// --- amoniaSensor.cpp ---
#include "amoniaSensor.h"
#include <math.h>

// Definisi variabel Global
float R0 = 0.0;
bool sedangKalibrasi = true;
unsigned long lastCalibrationTime = 0;

// Variabel Buffer untuk Averaging 5 Menit
float amoniaPPMBuffer = 0.0;
int bufferCount = 0;
unsigned long lastAveragingTime = 0;

void setupAmoniaSensor() {
    pinMode(gasPinLantai1, INPUT);
    lastAveragingTime = millis();
}

void kalibrasiAmoniaSensor() {
    const int maxPembacaan = 30;
    float rsLama = 0;
    float totalRs = 0;
    int stabilCount = 0;

    Serial.println("🔥 Memulai Kalibrasi Sensor TGS2602...");
    displayStatus("Kalibrasi..."); // Status Kalibrasi Dimulai

    for (int i = 0; i < maxPembacaan; i++) {
        extern const int ledPin; 
        digitalWrite(ledPin, HIGH);
        delay(300);
        digitalWrite(ledPin, LOW);
        delay(300);

        int adc = analogRead(gasPinLantai1);
        float Vout = (adc / 4095.0) * Vcc;
        float Rs = ((Vcc - Vout) / Vout) * RL;
        
        if (i > 0) {
            float delta = abs(Rs - rsLama) / rsLama;
            if (delta < 0.02) stabilCount++;
            else stabilCount = 0;
        }
        totalRs += Rs;
        rsLama = Rs;
        if (stabilCount >= 5) {
            R0 = totalRs / (i + 1);
            sedangKalibrasi = false;
            Serial.println("✅ Kalibrasi selesai!");
            displayStatus("Online"); 
            lastCalibrationTime = millis();
            return;
        }
    }
    R0 = totalRs / maxPembacaan;
    sedangKalibrasi = false;
    Serial.println("✅ Kalibrasi selesai!");
    displayStatus("Online"); 
    lastCalibrationTime = millis();
}

void autoKalibrasiAmoniaSensor() {
    if (!sedangKalibrasi && millis() - lastCalibrationTime >= calibrationInterval) {
        sedangKalibrasi = true;
        Serial.println("Mulai kalibrasi ulang otomatis...");
        displayStatus("Auto Kalibrasi");
        kalibrasiAmoniaSensor();
    }
}

float getPPM(float ratio, float a, float b) {
    float log_ppm = a * log10(ratio) + b;
    return pow(10, log_ppm);
}

// FUNGSI BARU: Mengumpulkan data ke buffer
void updateAmoniaBuffer() {
    if (sedangKalibrasi) return; // Jangan ambil data saat kalibrasi
    
    int adc = analogRead(gasPinLantai1);
    float Vout = (adc / 4095.0) * Vcc;
    float Rs = ((Vcc - Vout) / Vout) * RL;
    
    if (R0 == 0.0) return; 
    
    float ratio = Rs / R0;
    float ppm_NH3 = getPPM(ratio, NH3_Curve[0], NH3_Curve[1]);
    
    amoniaPPMBuffer += ppm_NH3;
    bufferCount++;
    
    // TIDAK menampilkan status bau di OLED
}

// FUNGSI BARU: Menghitung rata-rata dari buffer (dipanggil oleh main.ino)
float getAveragedPPM() {
    unsigned long now = millis();
    float averagedPPM = 0.0;
    
    if (now - lastAveragingTime >= AVERAGING_INTERVAL) {
        if (bufferCount > 0) {
            averagedPPM = amoniaPPMBuffer / bufferCount;
        }
        
        // Reset Buffer
        amoniaPPMBuffer = 0.0;
        bufferCount = 0;
        lastAveragingTime = now;
        
        return averagedPPM; 
    }
    
    if (bufferCount > 0) {
        return amoniaPPMBuffer / bufferCount;
    }
    
    return 0.0;
}


// LOGIKA LIKERT BARU (Skala 3)
int konversiKeLikert(float ppm) {
    if (ppm < 0) ppm = 0;
    
    // Rumus Regresi: SCORE = -32.6821 + 29.8214 * PPM
    float score = REG_INTERCEPT + REG_SLOPE * ppm;
    
    // Batasan Skala:
    if (score <= 1.5) return 1; // 1 = Bagus
    else if (score <= 2.5) return 2; // 2 = Normal
    else return 3; // 3 = Kritis
}

String getAmoniaData() {
    float ppm_NH3 = getAveragedPPM(); // Ambil PPM yang sudah dirata-rata
    int skor = konversiKeLikert(ppm_NH3);

    String statusBau;
    if (skor == 1) statusBau = "Bagus";
    else if (skor == 2) statusBau = "Normal";
    else statusBau = "Kritis";

    String data = "--- Deteksi Gas (NH₃) ---\n";
    data += "→ NH₃: " + String(ppm_NH3, 2) + " ppm (5-min Avg)\n";
    data += "→ Skor bau: " + String(skor) + "/3\n";
    data += "→ Interpretasi: " + statusBau;
    return data;
}
// --- main.ino ---
// Sertakan library utama
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <math.h>

// Sertakan file header untuk display (dengan I2C kustom dan styling minimalis)
#include "display.h" 

// Sertakan file header untuk setiap modul sensor
#include "amoniaSensor.h" 
#include "waterSensor.h"
#include "soapSensor.h"
#include "tissueSensor.h"

// PIN UNTUK MENGAKTIFKAN KEMBALI ACCESS POINT (GPIO 0)
const int AP_BUTTON_PIN = 0; 

// === WiFi & Jaringan ===
const char* wifiSetupApName = "ToiletSetup";
const char* wifiSetupApPassword = "monitor123";
unsigned long lastReconnectAttempt = 0;
const unsigned long reconnectInterval = 30000UL;

// === Server Web Lokal ===
const char* serverURL = "http://192.168.8.30:3000/data";

// Buffer INTERNAL untuk menyimpan nilai Device ID
char tempDeviceId[40] = {0}; 

// Deklarasi objek parameter untuk WiFiManager. 
// Nilai yang tersimpan akan dimuat ke tempDeviceId secara internal oleh WiFiManager.
WiFiManagerParameter custom_device_id("deviceid", "Device ID (e.g. toilet-lantai-2)", tempDeviceId, 40); 

// === PIN & Variabel Global Utama ===
const int ledPin = 2; // LED Indikator Status
unsigned long lastWebUpdateTime = 0;
const unsigned long webUpdateInterval = 1000UL; // Kirim data tiap 1 detik

// Deklarasi fungsi-fungsi
void kirimDataKeServer();
void ensureWifiConnection();
String getAmoniaDataJson();
String getWaterDataJson();
String getSoapDataJson();
String getTissueDataJson();
void saveConfigCallback();
void checkAndStartAP();

// FUNGSI CALLBACK: Dipanggil saat konfigurasi custom field disimpan
void saveConfigCallback() {
  Serial.println("Konfigurasi Device ID baru disimpan!");
  // FIX: Nilai sudah tersimpan ke buffer internal. Hanya perlu verifikasi.
  Serial.print("Device ID yang disimpan: ");
  Serial.println(custom_device_id.getValue());
}

// FUNGSI BARU: Mengecek tombol dan memulai Access Point
void checkAndStartAP() {
    if (digitalRead(AP_BUTTON_PIN) == LOW) {
        unsigned long startTime = millis();
        while (digitalRead(AP_BUTTON_PIN) == LOW) {
            if (millis() - startTime > 3000) {
                Serial.println("\n*** TOMBOL DITEKAN LAMA. MEMULAI AP MANUAL ***");
                displayStatus("START AP");
                
                WiFiManager wifiManager;
                
                extern WiFiManagerParameter custom_device_id;
                wifiManager.addParameter(&custom_device_id);
                
                bool res = wifiManager.startConfigPortal(wifiSetupApName, wifiSetupApPassword);

                if (res) {
                    Serial.println("Berhasil keluar dari portal dan terhubung.");
                    displayRunningStatus(WiFi.localIP().toString(), custom_device_id.getValue());
                } else {
                    Serial.println("Gagal keluar dari portal.");
                    displayStatus("AP Gagal");
                }
                
                return; 
            }
            delay(100); 
        }
    }
}

// === Setup ===
void setup() {
    Serial.begin(115200);
    pinMode(ledPin, OUTPUT);
    digitalWrite(ledPin, LOW);
    
    // Setup pin tombol
    pinMode(AP_BUTTON_PIN, INPUT_PULLUP); 

    setupDisplay(); 

    setupAmoniaSensor();
    setupWaterSensor();
    setupSoapSensor();
    setupTissueSensor();

    WiFi.mode(WIFI_STA);
    WiFiManager wifiManager;
    wifiManager.setTimeout(180);

    // Tambahkan parameter Device ID dan set callback
    wifiManager.addParameter(&custom_device_id);
    wifiManager.setSaveConfigCallback(saveConfigCallback);

    Serial.println("Menyiapkan koneksi WiFi...");
    displayStatus("Hubungkan WiFi"); 

    // Mencoba koneksi otomatis.
    if (!wifiManager.autoConnect(wifiSetupApName, wifiSetupApPassword)) {
        Serial.println("❌ Gagal konek WiFi. Menghapus kredensial dan reboot.");
        displayStatus("Gagal Konek"); 
        delay(3000);
        wifiManager.resetSettings();
        delay(1000);
        ESP.restart();
    }

    Serial.println("✅ Terhubung ke WiFi");
    Serial.print("SSID: ");
    Serial.println(WiFi.SSID());
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    
    // Tampilkan Running Status Minimalis: Device ID, Status Online, dan IP
    displayRunningStatus(WiFi.localIP().toString(), custom_device_id.getValue());

    digitalWrite(ledPin, HIGH);
    delay(1000);
    digitalWrite(ledPin, LOW);

    kalibrasiAmoniaSensor(); 
}

// === Loop Utama ===
void loop() {
    checkAndStartAP();
    
    ensureWifiConnection();

    updateAmoniaBuffer(); 

    if (millis() - lastWebUpdateTime >= webUpdateInterval) {
        lastWebUpdateTime = millis();
        kirimDataKeServer();
    }

    autoKalibrasiAmoniaSensor();
    
    if (WiFi.status() == WL_CONNECTED) {
        extern bool sedangKalibrasi;
        if (!sedangKalibrasi) {
            displayRunningStatus(WiFi.localIP().toString(), custom_device_id.getValue());
        }
    }
    delay(100);
}

// === Fungsi Jaringan & Komunikasi ===

void ensureWifiConnection() {
    if (WiFi.status() == WL_CONNECTED) {
        return;
    }

    unsigned long now = millis();
    if (now - lastReconnectAttempt < reconnectInterval) {
        return;
    }

    lastReconnectAttempt = now;
    Serial.println("WiFi terputus, mencoba menyambung ulang...");
    displayStatus("Re-Konek...");
    digitalWrite(ledPin, HIGH);
    WiFi.reconnect();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("WiFi tersambung kembali");
        displayRunningStatus(WiFi.localIP().toString(), custom_device_id.getValue());
        digitalWrite(ledPin, LOW);
    }
}

void kirimDataKeServer() {
    if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        http.begin(serverURL);
        http.addHeader("Content-Type", "application/json");
        
        StaticJsonDocument<768> doc; 
        doc["deviceID"] = custom_device_id.getValue(); 
        doc["amonia"] = getAmoniaDataJson();
        doc["air"] = getWaterDataJson();
        doc["sabun"] = getSoapDataJson();
        doc["tisu"] = getTissueDataJson();
        doc["espStatus"] = "active";

        String jsonString;
        serializeJson(doc, jsonString);
        
        int httpResponseCode = http.POST(jsonString);

        if (httpResponseCode > 0) {
            Serial.printf("[HTTP] POST... code: %d\n", httpResponseCode);
            String payload = http.getString();
        } else {
            Serial.printf("[HTTP] POST... failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
        }
        http.end();
    }
}

// === Fungsi JSON Payload Sensor (Tetap Sama) ===

String getAmoniaDataJson() {
    extern float getAveragedPPM();
    extern int konversiKeLikert(float ppm);
    
    float ppm_NH3 = getAveragedPPM(); 
    int skor = konversiKeLikert(ppm_NH3);

    String statusBau;
    if (skor == 1) statusBau = "Bagus";
    else if (skor == 2) statusBau = "Normal";
    else statusBau = "Kritis";

    StaticJsonDocument<200> doc;
    doc["ppm"] = String(ppm_NH3, 2);
    doc["score"] = skor;
    doc["status"] = statusBau;

    String jsonString;
    serializeJson(doc, jsonString);
    return jsonString;
}

String getWaterDataJson() {
    extern const int waterSensorPin; 
    String status;
    if (digitalRead(waterSensorPin) == LOW) {
        status = "Genangan air terdeteksi.";
    } else {
        status = "Lantai kering.";
    }
    StaticJsonDocument<100> doc;
    doc["status"] = status;
    String jsonString;
    serializeJson(doc, jsonString);
    return jsonString;
}

String getSoapDataJson() {
    extern const int trigPin1, echoPin1, trigPin2, echoPin2, trigPin3, echoPin3;
    extern long getDistance(int trigPin, int echoPin);
    
    long distance1 = getDistance(trigPin1, echoPin1);
    long distance2 = getDistance(trigPin2, echoPin2);
    long distance3 = getDistance(trigPin3, echoPin3);
    
    String status1 = (distance1 <= 1) ? "N/A" : ((distance1 > 10) ? "Habis" : "Aman");
    String status2 = (distance2 <= 1) ? "N/A" : ((distance2 > 10) ? "Habis" : "Aman");
    String status3 = (distance3 <= 1) ? "N/A" : ((distance3 > 10) ? "Habis" : "Aman");

    long dist1 = (distance1 <= 1) ? -1 : distance1;
    long dist2 = (distance2 <= 1) ? -1 : distance2;
    long dist3 = (distance3 <= 1) ? -1 : distance3;
    
    StaticJsonDocument<300> doc;
    
    JsonObject sabun1 = doc.createNestedObject("sabun1");
    sabun1["distance"] = dist1; 
    sabun1["status"] = status1;
    
    JsonObject sabun2 = doc.createNestedObject("sabun2");
    sabun2["distance"] = dist2;
    sabun2["status"] = status2;
    
    JsonObject sabun3 = doc.createNestedObject("sabun3");
    sabun3["distance"] = dist3;
    sabun3["status"] = status3;
    
    String jsonString;
    serializeJson(doc, jsonString);
    return jsonString;
}

String getTissueDataJson() {
    extern const int tissueSensorPin1, tissueSensorPin2;
    
    int read1 = digitalRead(tissueSensorPin1);
    int read2 = digitalRead(tissueSensorPin2);
    
    String status1 = (read1 == LOW) ? "Habis" : "Tersedia";
    String status2 = (read2 == LOW) ? "Habis" : "Tersedia";

    StaticJsonDocument<200> doc;
    
    JsonObject tisu1 = doc.createNestedObject("tisu1");
    tisu1["status"] = status1; 
    
    JsonObject tisu2 = doc.createNestedObject("tisu2");
    tisu2["status"] = status2;

    String jsonString;
    serializeJson(doc, jsonString);
    return jsonString;
}
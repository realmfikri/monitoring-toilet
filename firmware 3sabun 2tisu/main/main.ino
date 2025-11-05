// --- main.ino ---
// Sertakan library utama
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include <FS.h>
#include <SPIFFS.h>
#include <cstring>

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

// === Konfigurasi Server ===
const char* defaultApiBaseUrl = "https://toilet-api-dev.example.com";
const char* configFilePath = "/config.json";

char tempDeviceId[40] = {0};
char apiBaseUrl[128] = "https://toilet-api-dev.example.com";
char apiKey[80] = {0};

bool shouldSaveConfig = false;
bool configLoadedFromFS = false;
bool spiffsMounted = false;

const char* rootCACertificate = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
SjELMAkGA1UEBhMCVVMxFjAUBgNVBAoTDUxldCdzIEVuY3J5cHQxIzAhBgNVBAMT
GkxldCdzIEVuY3J5cHQgQXV0aG9yaXR5MB4XDTIxMDQxMzEzMTM0N1oXDTMyMDQx
MzEzMTM0N1owSjELMAkGA1UEBhMCVVMxFjAUBgNVBAoTDUxldCdzIEVuY3J5cHQx
IzAhBgNVBAMTGkxldCdzIEVuY3J5cHQgQXV0aG9yaXR5MIICIjANBgkqhkiG9w0B
AQEFAAOCAg8AMIICCgKCAgEA7ahH2PV9K2VwQeWLb8Y/voI8pkXeM+7wNX5n9DnE
Wk24fR4um7b+Mh+QfKt0/jS920STTHV80bkkSgPyB8uvKMuPNsa1Z0hPfMe5A/VQ
JhGkZLOJrd/qlFX/njb3VRXvyzTqwvtOhqQhR69AE2T18DUfKZN5j9dOOXw6CEp+
5/+1+R8qXt0g/vPX1ZLc6vMzuh/XLN31rYcYysVhSuocqH2aV0y2U2hX7MQK7GJS
z6Jak5Jc+0UX2OS6zm1p5WxmL8tYOMaSjIgJ5rbfJzCbZ4IXwZjlGAIvMCa/78aP
NjclS1bZKnJiGAsDYQwOoj7k6Crgn2nMW1zlxwqHJ5532diGg+EHu0ooChBjO8PK
HD3lFfyxS/pFKL+w35ofHnND9pUEdZsrXbPw1Bsk6DhLdn6S92fl7D53hL+XN4Zz
16XOWTe90rRAN6ye1YMwnsG3OIRHe9LtVZ7DI+xZHI9/ERFuk8sMVaAoJT86nAdJ
7LGUcVbDyudRpvAJhu7V6XUie5Wh3E1nCGoDDte5YmdnPePMA0MavCfoUJ29/rrX
w6Ni01X/fI23qWGNnb4MzWE9usFiqSvGSEk7h5pWHB1+ZfmV/QGOa3DXvDEdEbgC
F6dbnh2JEiU6BqzJXbXrIuAyG9gme6pzuxbU7jSFBWyD0H28Y3s/j4K1IPuxDLxd
AvYAY7NdM/6uF9MCAwEAAaNCMEAwDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB/wQF
MAMBAf8wHQYDVR0OBBYEFBQusxe3WFbLrlAJQOYfr52LFMLGMA0GCSqGSIb3DQEB
CwUAA4ICAQAf8K8Y3fCA3D9NehQOJBNB1LsY5GApGXKk2b7xGTCK7Q0w3AV/Q93v
9VEC0hLnLwhzwmAATbIZCkJ0s9Ia4DmL6dV8QZLMzrb2sXwRDq0sik+qTHSxQBik
Bpm3b9+p5/O8nzYVPGQr6bh7Q0b81229fuyWeZzdjvDjDygGhz0QHFBBSzKaR9mE
J2H7N1mZZQAf+JfbxuZq70kCcen6/DMEkPcU847BvX7xY+nau73NNvgxLCE2Jd/g
TOMSXBJtNx9X6r8ahJLPPr8oN9q0PnZESFQbjS5tOMcEYoe0VayfM7Xgj1s0PGRB
MGhXRCVw2SfwlaPBDafc/5+3yoUxX7X3d7h//1VSK8Ur0H6vXZFZEwOs3N5wqZ4E
YBBXItq0F6G47hzKbz2Dtz0CkvK8Hy9+LO60F0NF7i3ZfQJ+E+XYYLFXqs28VWz2
CMaO6IcG2Z6w3kNjEcNWef39/C4R2tQeM+c/fi91tIez3pCrJ4Ly+E8d4Z3Vqn0G
dyB/m4Gqsc7VcRbP5t6dv3Vv4Y20N6l0e6MN2eUVx/FuWRz11FXAs8MVXJ8bY64v
QU87E+G1U0et3NdH7mZ2pGpQSQ04xMGrm8V8eoyye3N2WBci2W0slZJi/1QGxUL/
rc3vDLEh49D8Q0g4Y6k9FMsFww37YHpn6V+2G3P39UO44ywQA8oYbg==
-----END CERTIFICATE-----
)EOF";

// Deklarasi objek parameter untuk WiFiManager.
// Nilai yang tersimpan akan dimuat ke tempDeviceId secara internal oleh WiFiManager.
WiFiManagerParameter custom_device_id("deviceid", "Device ID (e.g. toilet-lantai-2)", tempDeviceId, 40);
WiFiManagerParameter custom_api_base_url("api_base_url", "API Base URL (https://...)", apiBaseUrl, sizeof(apiBaseUrl));
WiFiManagerParameter custom_api_key("api_key", "API Key", apiKey, sizeof(apiKey));

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
bool loadConfigFromFS();
bool saveConfigToFS();
void updateLocalConfigFromParameters();
void copyParam(char* destination, size_t length, const char* source);
void signalErrorPattern();
String buildApiEndpoint(const String& baseUrl);

// FUNGSI CALLBACK: Dipanggil saat konfigurasi custom field disimpan
void saveConfigCallback() {
  Serial.println("Konfigurasi baru disimpan melalui portal!");
  shouldSaveConfig = true;
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
                wifiManager.addParameter(&custom_api_base_url);
                wifiManager.addParameter(&custom_api_key);
                wifiManager.setSaveConfigCallback(saveConfigCallback);

                bool res = wifiManager.startConfigPortal(wifiSetupApName, wifiSetupApPassword);

                if (res) {
                    Serial.println("Berhasil keluar dari portal dan terhubung.");
                    updateLocalConfigFromParameters();
                    if (!spiffsMounted) {
                        spiffsMounted = SPIFFS.begin(true);
                    }
                    if ((shouldSaveConfig || !configLoadedFromFS) && spiffsMounted) {
                        if (saveConfigToFS()) {
                            shouldSaveConfig = false;
                            configLoadedFromFS = true;
                        }
                    }
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

    spiffsMounted = SPIFFS.begin(true);
    if (spiffsMounted) {
        configLoadedFromFS = loadConfigFromFS();
        if (configLoadedFromFS) {
            custom_device_id.setValue(tempDeviceId, sizeof(tempDeviceId));
            custom_api_base_url.setValue(apiBaseUrl, sizeof(apiBaseUrl));
            custom_api_key.setValue(apiKey, sizeof(apiKey));
        } else {
            // Pastikan parameter memuat nilai default meski belum ada file config.
            custom_device_id.setValue(tempDeviceId, sizeof(tempDeviceId));
            custom_api_base_url.setValue(apiBaseUrl, sizeof(apiBaseUrl));
            custom_api_key.setValue(apiKey, sizeof(apiKey));
        }
    } else {
        Serial.println("⚠️ Gagal mount SPIFFS. Konfigurasi tidak dapat dimuat.");
    }

    WiFi.mode(WIFI_STA);
    WiFiManager wifiManager;
    wifiManager.setTimeout(180);

    // Tambahkan parameter Device ID dan set callback
    wifiManager.addParameter(&custom_device_id);
    wifiManager.addParameter(&custom_api_base_url);
    wifiManager.addParameter(&custom_api_key);
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

    updateLocalConfigFromParameters();
    if (!spiffsMounted) {
        spiffsMounted = SPIFFS.begin(true);
    }
    if ((shouldSaveConfig || !configLoadedFromFS) && spiffsMounted) {
        if (saveConfigToFS()) {
            shouldSaveConfig = false;
            configLoadedFromFS = true;
        }
    }

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
    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    String baseUrl = String(custom_api_base_url.getValue());
    baseUrl.trim();
    if (baseUrl.length() == 0) {
        baseUrl = String(defaultApiBaseUrl);
    }

    String endpoint = buildApiEndpoint(baseUrl);
    if (endpoint.length() == 0) {
        Serial.println("[HTTP] Endpoint kosong atau tidak valid. Kiriman dibatalkan.");
        signalErrorPattern();
        return;
    }

    String apiKeyHeader = String(custom_api_key.getValue());
    apiKeyHeader.trim();

    const int maxAttempts = 3;
    bool requestSucceeded = false;

    for (int attempt = 1; attempt <= maxAttempts; ++attempt) {
        WiFiClientSecure client;
        client.setCACert(rootCACertificate);
        client.setTimeout(15000);
        client.setHandshakeTimeout(15);

        HTTPClient http;

        if (!http.begin(client, endpoint)) {
            Serial.printf("[HTTP] Gagal memulai koneksi ke %s (percobaan %d/%d)\n", endpoint.c_str(), attempt, maxAttempts);
        } else {
            http.addHeader("Content-Type", "application/json");
            if (apiKeyHeader.length() > 0) {
                http.addHeader("X-API-Key", apiKeyHeader);
            } else {
                Serial.println("[HTTP] ⚠️ API key kosong. Permintaan kemungkinan ditolak server.");
            }

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
                if (httpResponseCode == 200) {
                    Serial.printf("[HTTP] POST berhasil dengan kode: %d\n", httpResponseCode);
                    requestSucceeded = true;
                } else {
                    String responseBody = http.getString();
                    Serial.printf("[HTTP] POST mengembalikan kode: %d. Respons: %s\n", httpResponseCode, responseBody.c_str());
                }
            } else {
                Serial.printf("[HTTP] POST gagal, error: %s\n", http.errorToString(httpResponseCode).c_str());
            }
        }

        http.end();

        if (requestSucceeded) {
            digitalWrite(ledPin, LOW);
            break;
        }

        signalErrorPattern();
        if (attempt < maxAttempts) {
            unsigned long backoff = 1000UL << (attempt - 1); // 1s, 2s, 4s
            delay(backoff);
        }
    }
}

bool loadConfigFromFS() {
    if (!spiffsMounted) {
        Serial.println("SPIFFS belum dimount; melewati pemuatan konfigurasi.");
        return false;
    }

    if (!SPIFFS.exists(configFilePath)) {
        Serial.println("Config belum tersedia di SPIFFS. Menggunakan default.");
        return false;
    }

    File configFile = SPIFFS.open(configFilePath, "r");
    if (!configFile) {
        Serial.println("Gagal membuka file konfigurasi.");
        return false;
    }

    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, configFile);
    configFile.close();

    if (error) {
        Serial.println("Gagal membaca konfigurasi, menggunakan default.");
        return false;
    }

    if (doc.containsKey("device_id")) {
        copyParam(tempDeviceId, sizeof(tempDeviceId), doc["device_id"]);
    }
    if (doc.containsKey("api_base_url")) {
        copyParam(apiBaseUrl, sizeof(apiBaseUrl), doc["api_base_url"]);
    }
    if (doc.containsKey("api_key")) {
        copyParam(apiKey, sizeof(apiKey), doc["api_key"]);
    }

    Serial.println("Konfigurasi dimuat dari SPIFFS.");
    return true;
}

bool saveConfigToFS() {
    if (!spiffsMounted) {
        Serial.println("SPIFFS belum dimount; tidak dapat menyimpan konfigurasi.");
        return false;
    }

    StaticJsonDocument<256> doc;
    doc["device_id"] = strlen(tempDeviceId) > 0 ? tempDeviceId : custom_device_id.getValue();
    doc["api_base_url"] = strlen(apiBaseUrl) > 0 ? apiBaseUrl : defaultApiBaseUrl;
    doc["api_key"] = apiKey;

    File configFile = SPIFFS.open(configFilePath, "w");
    if (!configFile) {
        Serial.println("Gagal membuka file konfigurasi untuk ditulis.");
        return false;
    }

    if (serializeJson(doc, configFile) == 0) {
        Serial.println("Gagal menulis konfigurasi ke file.");
        configFile.close();
        return false;
    }

    configFile.close();
    Serial.println("Konfigurasi tersimpan ke SPIFFS.");
    return true;
}

void updateLocalConfigFromParameters() {
    copyParam(tempDeviceId, sizeof(tempDeviceId), custom_device_id.getValue());
    copyParam(apiBaseUrl, sizeof(apiBaseUrl), custom_api_base_url.getValue());
    copyParam(apiKey, sizeof(apiKey), custom_api_key.getValue());
}

void copyParam(char* destination, size_t length, const char* source) {
    if (!destination || length == 0) {
        return;
    }

    if (!source) {
        destination[0] = '\0';
        return;
    }

    strncpy(destination, source, length - 1);
    destination[length - 1] = '\0';
}

void signalErrorPattern() {
    const int blinkCount = 3;
    for (int i = 0; i < blinkCount; ++i) {
        digitalWrite(ledPin, HIGH);
        delay(120);
        digitalWrite(ledPin, LOW);
        delay(120);
    }
}

String buildApiEndpoint(const String& baseUrl) {
    if (baseUrl.length() == 0) {
        return "";
    }

    String sanitized = baseUrl;
    sanitized.trim();

    if (sanitized.startsWith("http://")) {
        Serial.println("[HTTP] Basis URL harus menggunakan HTTPS. Menggunakan default.");
        return buildApiEndpoint(String(defaultApiBaseUrl));
    }

    if (!sanitized.startsWith("https://")) {
        Serial.println("[HTTP] Basis URL tidak menyertakan skema. Menambahkan https:// otomatis.");
        String normalized = String("https://") + sanitized;
        return buildApiEndpoint(normalized);
    }

    if (sanitized.endsWith("/data")) {
        return sanitized;
    }

    if (sanitized.endsWith("/data/")) {
        return sanitized.substring(0, sanitized.length() - 1);
    }

    if (sanitized.endsWith("/")) {
        return sanitized + "data";
    }

    return sanitized + "/data";
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
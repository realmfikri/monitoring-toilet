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
#include "esp_wifi.h"
#include "esp_wpa2.h"

// Kompatibilitas: pada beberapa versi core ESP32 (khususnya IDF v5.x) tipe
// esp_wpa2_config_t tidak diekspor lagi ketika WPA2 Enterprise tidak diaktifkan
// secara eksplisit. Definisi minimal berikut memastikan kode tetap dapat
// dikompilasi sambil mengikuti nilai default API lama.
#ifndef WPA2_CONFIG_INIT_DEFAULT
typedef struct {
    bool disable_time_check;  // default: true (abaikan validasi waktu sertifikat)
} esp_wpa2_config_t;

#define WPA2_CONFIG_INIT_DEFAULT() \
    {                            \
        .disable_time_check = true \
    }
#endif

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
const char* wifiSetupApPassword = "setup123";
unsigned long lastReconnectAttempt = 0;
const unsigned long reconnectInterval = 30000UL;

// === Konfigurasi Server ===
const char* defaultApiBaseUrl = "https://toilet-api.muhamadfikri.com";
const char* configFilePath = "/config.json";

char tempDeviceId[40] = {0};
char apiBaseUrl[128] = "https://toilet-api.muhamadfikri.com";
char apiKey[80] = {0};
char eapSsid[64] = {0};
char eapIdentity[64] = {0};
char eapPassword[64] = {0};

bool shouldSaveConfig = false;
bool configLoadedFromFS = false;
bool spiffsMounted = false;

const char* rootCACertificate = R"EOF(
-----BEGIN CERTIFICATE-----
MIIDejCCAmKgAwIBAgIQf+UwvzMTQ77dghYQST2KGzANBgkqhkiG9w0BAQsFADBX
MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEQMA4GA1UE
CxMHUm9vdCBDQTEbMBkGA1UEAxMSR2xvYmFsU2lnbiBSb290IENBMB4XDTIzMTEx
NTAzNDMyMVoXDTI4MDEyODAwMDA0MlowRzELMAkGA1UEBhMCVVMxIjAgBgNVBAoT
GUdvb2dsZSBUcnVzdCBTZXJ2aWNlcyBMTEMxFDASBgNVBAMTC0dUUyBSb290IFI0
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE83Rzp2iLYK5DuDXFgTB7S0md+8Fhzube
Rr1r1WEYNa5A3XP3iZEwWus87oV8okB2O6nGuEfYKueSkWpz6bFyOZ8pn6KY019e
WIZlD6GEZQbR3IvJx3PIjGov5cSr0R2Ko4H/MIH8MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDwYDVR0TAQH/BAUwAwEB/zAd
BgNVHQ4EFgQUgEzW63T/STaj1dj8tT7FavCUHYwwHwYDVR0jBBgwFoAUYHtmGkUN
l8qJUC99BM00qP/8/UswNgYIKwYBBQUHAQEEKjAoMCYGCCsGAQUFBzAChhpodHRw
Oi8vaS5wa2kuZ29vZy9nc3IxLmNydDAtBgNVHR8EJjAkMCKgIKAehhxodHRwOi8v
Yy5wa2kuZ29vZy9yL2dzcjEuY3JsMBMGA1UdIAQMMAowCAYGZ4EMAQIBMA0GCSqG
SIb3DQEBCwUAA4IBAQAYQrsPBtYDh5bjP2OBDwmkoWhIDDkic574y04tfzHpn+cJ
odI2D4SseesQ6bDrarZ7C30ddLibZatoKiws3UL9xnELz4ct92vID24FfVbiI1hY
+SW6FoVHkNeWIP0GCbaM4C6uVdF5dTUsMVs/ZbzNnIdCp5Gxmx5ejvEau8otR/Cs
kGN+hr/W5GvT1tMBjgWKZ1i4//emhA1JG1BbPzoLJQvyEotc03lXjTaCzv8mEbep
8RqZ7a2CPsgRbuvTPBwcOMBBmuFeU88+FSBX6+7iP0il8b4Z0QFqIwwMHfs/L6K1
vepuoxtGzi4CZ68zJpiq1UvSqTbFJjtbD4seiMHl
-----END CERTIFICATE-----
)EOF";



// Deklarasi objek parameter untuk WiFiManager.
// Nilai yang tersimpan akan dimuat ke tempDeviceId secara internal oleh WiFiManager.
WiFiManagerParameter custom_device_id("deviceid", "Device ID (e.g. toilet-lantai-2)", tempDeviceId, 40);
WiFiManagerParameter custom_api_base_url("api_base_url", "API Base URL (https://...)", apiBaseUrl, sizeof(apiBaseUrl));
WiFiManagerParameter custom_api_key("api_key", "API Key", apiKey, sizeof(apiKey));
WiFiManagerParameter custom_eap_ssid("eap_ssid", "Enterprise SSID (PEAP)", eapSsid, sizeof(eapSsid));
WiFiManagerParameter custom_eap_identity("eap_identity", "Enterprise Identity/Username", eapIdentity, sizeof(eapIdentity));
WiFiManagerParameter custom_eap_password("eap_password", "Enterprise Password", eapPassword, sizeof(eapPassword));

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
bool connectToEnterpriseNetwork(const char* ssid, const char* identity, const char* password, unsigned long timeoutMs);

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
                wifiManager.addParameter(&custom_eap_ssid);
                wifiManager.addParameter(&custom_eap_identity);
                wifiManager.addParameter(&custom_eap_password);
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
            custom_eap_ssid.setValue(eapSsid, sizeof(eapSsid));
            custom_eap_identity.setValue(eapIdentity, sizeof(eapIdentity));
            custom_eap_password.setValue(eapPassword, sizeof(eapPassword));
        } else {
            // Pastikan parameter memuat nilai default meski belum ada file config.
            custom_device_id.setValue(tempDeviceId, sizeof(tempDeviceId));
            custom_api_base_url.setValue(apiBaseUrl, sizeof(apiBaseUrl));
            custom_api_key.setValue(apiKey, sizeof(apiKey));
            custom_eap_ssid.setValue(eapSsid, sizeof(eapSsid));
            custom_eap_identity.setValue(eapIdentity, sizeof(eapIdentity));
            custom_eap_password.setValue(eapPassword, sizeof(eapPassword));
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
    wifiManager.addParameter(&custom_eap_ssid);
    wifiManager.addParameter(&custom_eap_identity);
    wifiManager.addParameter(&custom_eap_password);
    wifiManager.setSaveConfigCallback(saveConfigCallback);

    Serial.println("Menyiapkan koneksi WiFi...");
    displayStatus("Hubungkan WiFi");

    String enterpriseIdentity = String(custom_eap_identity.getValue());
    enterpriseIdentity.trim();

    bool connected = false;

    if (enterpriseIdentity.length() > 0) {
        String enterpriseSsid = String(custom_eap_ssid.getValue());
        String enterprisePassword = String(custom_eap_password.getValue());

        Serial.println("Mode WPA2-Enterprise terdeteksi. Mencoba koneksi PEAP...");
        displayStatus("Konek EAP...");

        connected = connectToEnterpriseNetwork(enterpriseSsid.c_str(), enterpriseIdentity.c_str(), enterprisePassword.c_str(), 20000UL);

        if (!connected) {
            Serial.println("❌ Koneksi EAP gagal. Membuka portal konfigurasi.");
            displayStatus("EAP gagal");
            bool res = wifiManager.startConfigPortal(wifiSetupApName, wifiSetupApPassword);
            if (!res) {
                Serial.println("❌ Gagal keluar dari portal konfigurasi setelah EAP gagal. Reboot.");
                displayStatus("AP Gagal");
                delay(2000);
                ESP.restart();
            }
            connected = true; // jika portal berhasil, dianggap terhubung ke WiFi
        }
    } else {
        // Mencoba koneksi otomatis untuk WPA2-Personal.
        if (!wifiManager.autoConnect(wifiSetupApName, wifiSetupApPassword)) {
            Serial.println("❌ Gagal konek WiFi. Menghapus kredensial dan reboot.");
            displayStatus("Gagal Konek");
            delay(3000);
            wifiManager.resetSettings();
            delay(1000);
            ESP.restart();
        }
        connected = true;
    }

    if (connected && WiFi.status() == WL_CONNECTED) {
        Serial.println("✅ Terhubung ke WiFi");
        Serial.print("SSID: ");
        Serial.println(WiFi.SSID());
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());
    }

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
            http.addHeader("Origin", "https://toilet-app.muhamadfikri.com");
            http.addHeader("X-API-Key", apiKeyHeader);

            if (apiKeyHeader.length() > 0) {
                http.addHeader("X-API-Key", apiKeyHeader);
            } else {
                Serial.println("[HTTP] ⚠️ API key kosong. Permintaan kemungkinan ditolak server.");
            }

            StaticJsonDocument<768> doc;
            doc["deviceID"] = custom_device_id.getValue();
            doc["amonia"] = getAmoniaDataJson();
            doc["waterPuddleJson"] = getWaterDataJson();
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

    StaticJsonDocument<512> doc;
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
    if (doc.containsKey("eap_ssid")) {
        copyParam(eapSsid, sizeof(eapSsid), doc["eap_ssid"]);
    }
    if (doc.containsKey("eap_identity")) {
        copyParam(eapIdentity, sizeof(eapIdentity), doc["eap_identity"]);
    }
    if (doc.containsKey("eap_password")) {
        copyParam(eapPassword, sizeof(eapPassword), doc["eap_password"]);
    }

    Serial.println("Konfigurasi dimuat dari SPIFFS.");
    return true;
}

bool saveConfigToFS() {
    if (!spiffsMounted) {
        Serial.println("SPIFFS belum dimount; tidak dapat menyimpan konfigurasi.");
        return false;
    }

    StaticJsonDocument<512> doc;
    doc["device_id"] = strlen(tempDeviceId) > 0 ? tempDeviceId : custom_device_id.getValue();
    doc["api_base_url"] = strlen(apiBaseUrl) > 0 ? apiBaseUrl : defaultApiBaseUrl;
    doc["api_key"] = apiKey;
    doc["eap_ssid"] = eapSsid;
    doc["eap_identity"] = eapIdentity;
    doc["eap_password"] = eapPassword;

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
    copyParam(eapSsid, sizeof(eapSsid), custom_eap_ssid.getValue());
    copyParam(eapIdentity, sizeof(eapIdentity), custom_eap_identity.getValue());
    copyParam(eapPassword, sizeof(eapPassword), custom_eap_password.getValue());
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

bool connectToEnterpriseNetwork(const char* ssid, const char* identity, const char* password, unsigned long timeoutMs) {
    if (!ssid || strlen(ssid) == 0 || !identity || strlen(identity) == 0) {
        Serial.println("SSID atau identitas EAP kosong.");
        return false;
    }

    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);

    esp_wifi_sta_wpa2_ent_clear_identity();
    esp_wifi_sta_wpa2_ent_clear_password();
    esp_wifi_sta_wpa2_ent_clear_username();

    esp_wifi_sta_wpa2_ent_set_identity((uint8_t *)identity, strlen(identity));
    esp_wifi_sta_wpa2_ent_set_username((uint8_t *)identity, strlen(identity));
    if (password && strlen(password) > 0) {
        esp_wifi_sta_wpa2_ent_set_password((uint8_t *)password, strlen(password));
    }

    // Jangan gunakan sertifikat CA untuk memaksa koneksi tanpa verifikasi server.
    esp_wifi_sta_wpa2_ent_set_ca_cert(nullptr, 0);

    esp_wpa2_config_t config = WPA2_CONFIG_INIT_DEFAULT();
    esp_err_t enableStatus = esp_wifi_sta_wpa2_ent_enable(&config);
    if (enableStatus != ESP_OK) {
        Serial.printf("Gagal mengaktifkan WPA2-Enterprise: %d\n", enableStatus);
        return false;
    }

    WiFi.begin(ssid);

    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < timeoutMs) {
        delay(500);
        Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Timeout koneksi WPA2-Enterprise.");
        return false;
    }

    return true;
}

// === Fungsi JSON Payload Sensor (Tetap Sama) ===

String getAmoniaDataJson() {
    extern float getAveragedPPM();

    float ppm_NH3 = getAveragedPPM();

    StaticJsonDocument<64> doc;
    doc["ppm"] = ppm_NH3;

    String jsonString;
    serializeJson(doc, jsonString);
    return jsonString;
}

String getWaterDataJson() {
    extern const int waterSensorPin;

    StaticJsonDocument<64> doc;
    doc["digital"] = digitalRead(waterSensorPin);

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

    long dist1 = (distance1 <= 1) ? -1 : distance1;
    long dist2 = (distance2 <= 1) ? -1 : distance2;
    long dist3 = (distance3 <= 1) ? -1 : distance3;

    StaticJsonDocument<192> doc;

    JsonObject sabun1 = doc.createNestedObject("sabun1");
    sabun1["distance"] = dist1;

    JsonObject sabun2 = doc.createNestedObject("sabun2");
    sabun2["distance"] = dist2;

    JsonObject sabun3 = doc.createNestedObject("sabun3");
    sabun3["distance"] = dist3;

    String jsonString;
    serializeJson(doc, jsonString);
    return jsonString;
}

String getTissueDataJson() {
    extern const int tissueSensorPin1, tissueSensorPin2;

    StaticJsonDocument<128> doc;

    JsonObject tisu1 = doc.createNestedObject("tisu1");
    tisu1["digital"] = digitalRead(tissueSensorPin1);

    JsonObject tisu2 = doc.createNestedObject("tisu2");
    tisu2["digital"] = digitalRead(tissueSensorPin2);

    String jsonString;
    serializeJson(doc, jsonString);
    return jsonString;
}
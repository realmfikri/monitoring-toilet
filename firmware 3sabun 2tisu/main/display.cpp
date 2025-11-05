// --- display.cpp ---
#include "display.h"

// Ini adalah SATU-SATUNYA tempat di mana 'display' didefinisikan/dialokasikan memori:
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1); 

// Variabel status global untuk layar (internal file ini)
static String currentStatus = "Memulai...";

void setupDisplay() {
    // KONEKSI I2C KHUSUS: Wire.begin(SDA, SCL);
    Wire.begin(OLED_SDA, OLED_SCL); 

    // INISIALISASI LAYAR 128x64
    if(!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) { 
        Serial.println("❌ SSD1306 alokasi Gagal");
        for(;;); 
    }
    // Tampilkan status awal
    displayStatus("Memulai...");
}

// FUNGSI UTAMA STATUS (Digunakan untuk tahapan Setup, Konek, Kalibrasi)
void displayStatus(String status) {
    if (status != currentStatus) {
        currentStatus = status;
        
        display.clearDisplay();
        display.setTextColor(SSD1306_WHITE);

        // Pesan Status Utama: Ukuran 3 (Kritis)
        display.setTextSize(2);
        int statusY = 32; 
        display.setCursor(0, statusY); 
        display.println(status); 
        
        display.display(); 
    }
}

// FUNGSI RUNNING STATUS (Digunakan untuk mode Online Normal)
void displayRunningStatus(String ipAddress, String deviceID) {
    // Fungsi ini tidak menggunakan currentStatus check
    
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);

    // Baris 1: Device ID
    display.setTextSize(1); 
    display.setCursor(0, 0);
    display.print("ID: ");
    display.println(deviceID);
    
    // Baris 2: IP Address
    display.setCursor(0, 10);
    display.print("IP: ");
    display.println(ipAddress);
    
    // Garis Pemisah
    display.drawFastHLine(0, 22, SCREEN_WIDTH, SSD1306_WHITE);

    // Baris 3 & 4 (Pesan Ringkas/Online Status)
    display.setTextSize(2); 
    display.setCursor(0, 30);
    display.println("ONLINE &"); 
    
    display.setCursor(0, 48);
    display.println("BERJALAN");
    
    display.display();
}


// FUNGSI BARU: Menampilkan status Access Point (Portal Setup)
void displayPortalStatus(String apName, String apIP) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);

    // Baris 1: Judul
    display.setTextSize(2); 
    display.setCursor(0, 0);
    display.println("AP SETUP");
    display.drawFastHLine(0, 18, SCREEN_WIDTH, SSD1306_WHITE);

    // Baris 2: SSID
    display.setTextSize(1); 
    display.setCursor(0, 25);
    display.print("SSID: ");
    display.println(apName); 

    // Baris 3: IP Portal
    display.setCursor(0, 35);
    display.print("Portal: ");
    display.println(apIP); 
    
    // Baris 4: Instruksi
    display.setCursor(0, 50);
    display.println("Akses 192.168.4.1");

    display.display();
}
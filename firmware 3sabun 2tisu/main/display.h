// --- display.h ---
#ifndef DISPLAY_H
#define DISPLAY_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// PIN DAN UKURAN LAYAR
#define SCREEN_WIDTH 128 // BARU: 128
#define SCREEN_HEIGHT 64 // BARU: 64
#define OLED_SDA 26
#define OLED_SCL 25

// Alamat I2C umum
#define OLED_ADDR 0x3C 

// Deklarasi extern untuk objek display (FIX: Mencegah multiple definition)
extern Adafruit_SSD1306 display; 

// Deklarasi fungsi yang akan dipanggil dari luar
void setupDisplay();
void displayStatus(String status);
void displayRunningStatus(String ipAddress, String deviceID);
void displayPortalStatus(String apName, String apIP); // FUNGSI BARU UNTUK SETUP PORTAL

#endif
// --- amoniaSensor.h ---
#ifndef AMONIA_SENSOR_H
#define AMONIA_SENSOR_H

#include <Arduino.h>
#include <UniversalTelegramBot.h>

// Deklarasi fungsi display dari display.h
void displayStatus(String status); 

extern UniversalTelegramBot bot;
extern const int ledPin;
extern String lastChatId;

const int gasPinLantai1 = 35;
const float Vcc = 5.0;
const float RL = 4700.0;
const float NH3_Curve[2] = {-2.3447, 0.0670};

// Persamaan Regresi Likert BARU (3-Skala)
const float REG_INTERCEPT = -0.805;
const float REG_SLOPE = 1.989;

// Interval Kalibrasi Tetap
const unsigned long calibrationInterval = 2UL * 60UL * 60UL * 1000UL;

// Variabel untuk Averaging (5 Menit)
const unsigned long AVERAGING_INTERVAL = 5UL * 60UL * 1000UL; 
extern float amoniaPPMBuffer;
extern int bufferCount;
extern unsigned long lastAveragingTime;

// Deklarasi variabel
extern float R0;
extern bool sedangKalibrasi;
extern unsigned long lastCalibrationTime;

// Deklarasi fungsi-fungsi
void setupAmoniaSensor();
void kalibrasiAmoniaSensor();
void autoKalibrasiAmoniaSensor();
float getPPM(float ratio, float a, float b);
void updateAmoniaBuffer(); 
float getAveragedPPM(); 
int konversiKeLikert(float ppm);
String getAmoniaData();

#endif

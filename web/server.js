// --- server.js ---
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

let latestData = {};
let lastHistoricalSaveTime = {}; 
let deviceStatus = {};

// === Konfigurasi Dinamis ===
const configFile = path.join(__dirname, 'config.json');
let config = {};

// Default Config DENGAN 3 PARAMETER WAKTU MENIT
const DEFAULT_CONFIG = {
    historicalIntervalMinutes: 5, 
    maxReminders: 3, 
    reminderIntervalMinutes: 10, 
    
    get historicalIntervalMs() { return this.historicalIntervalMinutes * 60 * 1000; },
    get reminderIntervalMs() { return this.reminderIntervalMinutes * 60 * 1000; },
    get maxAlertDurationMs() { 
        return this.maxReminders * this.reminderIntervalMs;
    }
};

// Fungsi untuk memuat/membuat konfigurasi
function loadConfig() {
    try {
        const data = fs.readFileSync(configFile);
        config = JSON.parse(data);
        config = {...DEFAULT_CONFIG, ...config}; 
        // Hitung ulang nilai MS
        config.historicalIntervalMs = config.historicalIntervalMinutes * 60 * 1000;
        config.reminderIntervalMs = config.reminderIntervalMinutes * 60 * 1000;
        config.maxAlertDurationMs = config.maxReminders * config.reminderIntervalMs;
    } catch (err) {
        console.log('File config.json tidak ditemukan, menggunakan default dan membuat file baru.');
        config = DEFAULT_CONFIG;
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    }
}
loadConfig(); 

function saveConfig() {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

// === Konfigurasi Telegram Bot & Petugas ===
const BOT_TOKEN = '8154762651:AAFNUc_t80yLk9ljtKiOe8lRkPYyzoH967s';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const petugasFile = path.join(__dirname, 'petugas.json');

let petugas = {};
try {
    const data = fs.readFileSync(petugasFile);
    petugas = JSON.parse(data);
} catch (err) {
    console.log('File petugas.json tidak ditemukan, membuat objek kosong.');
}

function savePetugas() {
    fs.writeFileSync(petugasFile, JSON.stringify(petugas, null, 2));
}

// Fungsi untuk membaca data historis dari file tertentu
function readHistoryFile(deviceID) {
    const dataFilePath = path.join(__dirname, `history_${deviceID}.json`);
    try {
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

function getActiveAlerts(deviceID, soapStatusConfirmed, tissue) {
    let alerts = [];
    
    if (soapStatusConfirmed === 'critical') {
        alerts.push(`SABUN HAMPIR HABIS`);
    }
    
    const tissueData = JSON.parse(tissue);
    const statusTisu1 = tissueData.tisu1.status;
    const statusTisu2 = tissueData.tisu2.status;
    
    if (statusTisu1 === "Habis" || statusTisu2 === "Habis") {
        alerts.push(`TISU HAMPIR HABIS`);
    }
    
    return alerts;
}

// Endpoint untuk mendapatkan konfigurasi
app.get('/api/config', (req, res) => {
    res.json({
        historicalIntervalMinutes: config.historicalIntervalMinutes,
        maxReminders: config.maxReminders,
        reminderIntervalMinutes: config.reminderIntervalMinutes 
    });
});

// Endpoint untuk mengatur dan menyimpan konfigurasi
app.post('/api/config', (req, res) => {
    const newConfig = req.body;
    
    const newHistInterval = parseInt(newConfig.historicalIntervalMinutes);
    const newReminders = parseInt(newConfig.maxReminders);
    const newRemInterval = parseInt(newConfig.reminderIntervalMinutes); 

    if (newHistInterval >= 1 && newReminders >= 0 && newRemInterval >= 1) {
        config.historicalIntervalMinutes = newHistInterval;
        config.maxReminders = newReminders;
        config.reminderIntervalMinutes = newRemInterval; 
        
        // Hitung ulang MS
        config.historicalIntervalMs = newHistInterval * 60 * 1000;
        config.reminderIntervalMs = newRemInterval * 60 * 1000;
        config.maxAlertDurationMs = newReminders * config.reminderIntervalMs; 

        saveConfig();
        console.log('✅ Konfigurasi berhasil diubah:', config);
        res.status(200).send('Konfigurasi berhasil disimpan.');
    } else {
        res.status(400).send('Input interval harus >= 1 menit dan reminder >= 0.');
    }
});


// Handler untuk pesan dari Telegram
bot.on('message', (msg) => {
    const chatID = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        bot.sendMessage(chatID, "👋 Selamat datang! Silakan pilih lantai Anda.\nKetik nomor lantai (misal: 1, 2, 3, dst.)");
    } else if (text.match(/^\d+$/)) {
        const lantai = parseInt(text);
        petugas[chatID] = { lantai: lantai };
        savePetugas();
        bot.sendMessage(chatID, `📍 Anda terdaftar sebagai petugas untuk Lantai ${lantai}.`);
    } else if (text === '/end') {
        if (petugas[chatID]) {
            delete petugas[chatID];
            savePetugas();
            bot.sendMessage(chatID, "Terima kasih. Pendaftaran Anda telah diakhiri.");
        } else {
            bot.sendMessage(chatID, "Anda belum terdaftar. Gunakan /start untuk mendaftar.");
        }
    } else if (text === '/data') {
        if (!petugas[chatID]) {
            bot.sendMessage(chatID, "🚫 Anda belum terdaftar. Gunakan /start untuk mendaftar lantai.");
            return;
        }
        
        const deviceID = `toilet-lantai-${petugas[chatID].lantai}`;
        const data = latestData[deviceID];
        
        if (!data) {
            bot.sendMessage(chatID, `🚫 Data untuk ${deviceID.toUpperCase().replace('-', ' ')} belum tersedia. Mohon pastikan ESP terhubung.`);
            return;
        }

        const amonia = JSON.parse(data.amonia);
        const water = JSON.parse(data.air);
        const soap = JSON.parse(data.sabun);
        const tissue = JSON.parse(data.tisu);
        const timestamp = new Date(data.timestamp).toLocaleString();

        const isAnySoapCritical = soap.sabun1.status === "Habis" || soap.sabun2.status === "Habis" || soap.sabun3.status === "Habis";
        const isAnyTissueCritical = tissue.tisu1.status === "Habis" || tissue.tisu2.status === "Habis";
        
        const soapStatusKeseluruhan = isAnySoapCritical ? "HAMPIR HABIS" : "Aman";
        const tissueStatusKeseluruhan = isAnyTissueCritical ? "HAMPIR HABIS" : "Tersedia";


        const dataToSend = `
            LAPORAN STATUS ${deviceID.toUpperCase().replace('-', ' ')} (REAL-TIME: ${timestamp}):
            Bau: ${amonia.status} (${amonia.ppm} ppm)
            Genangan Air: ${water.status}
            Sabun: ${soapStatusKeseluruhan}
            Tisu: ${tissueStatusKeseluruhan}
        `;
        bot.sendMessage(chatID, dataToSend);
    } else {
        bot.sendMessage(chatID, "Maaf, perintah tidak dikenali. Gunakan /start untuk memulai atau /data untuk mendapatkan laporan.");
    }
});

// Endpoint untuk menerima data dari ESP32
app.post('/data', (req, res) => {
    const sensorData = req.body;
    const deviceID = sensorData.deviceID;
    const lantai = parseInt(deviceID.split('-')[2]);
    const now = Date.now();

    if (deviceID) {
        // 1. Perbarui data latestData untuk dashboard web
        latestData[deviceID] = {
            ...sensorData,
            timestamp: new Date().toISOString(),
            espStatus: 'active',
            lastActive: now
        };

        // Inisialisasi status perangkat jika belum ada
        if (!deviceStatus[deviceID]) {
            deviceStatus[deviceID] = {
                isAlert: false,
                alertStartTime: 0,
                lastAlertSentTime: 0,
                isRecoverySent: true,
                soapStatusConfirmed: 'safe',
                soapPendingStartTime: 0 
            };
        }
        let status = deviceStatus[deviceID];
        
        const amonia = JSON.parse(sensorData.amonia);
        const water = JSON.parse(sensorData.air);
        const soap = JSON.parse(sensorData.sabun); 
        const tissue = sensorData.tisu;
        
        const isAnySoapCritical = soap.sabun1.status === "Habis" || soap.sabun2.status === "Habis" || soap.sabun3.status === "Habis";
        
        // --- LOGIKA DEBOUNCE SABUN (5 Detik) ---
        if (isAnySoapCritical) {
            if (status.soapStatusConfirmed !== 'critical' && status.soapStatusConfirmed !== 'pending') {
                status.soapStatusConfirmed = 'pending';
                status.soapPendingStartTime = now;
            } else if (status.soapStatusConfirmed === 'pending' && (now - status.soapPendingStartTime) >= 5000) {
                status.soapStatusConfirmed = 'critical';
            }
        } else {
            status.soapStatusConfirmed = 'safe';
            status.soapPendingStartTime = 0;
        }

        const activeAlerts = getActiveAlerts(deviceID, status.soapStatusConfirmed, tissue);
        const isCurrentlyAlert = activeAlerts.length > 0;
        
        // 2. Logika Peringatan (Accident) dan Recovery
        
        if (isCurrentlyAlert) {
            // -- KONDISI A: MASALAH BERLANGSUNG --
            if (!status.isAlert) {
                // Pemicu 1: Masalah BARU terdeteksi
                status.isAlert = true;
                status.alertStartTime = now;
                status.lastAlertSentTime = now;
                status.isRecoverySent = false;
                sendTelegramAlert(deviceID, latestData[deviceID], lantai, activeAlerts, "accident_new");
                
            // LOGIKA REMINDER BARU: Menggunakan Reminder Interval dan Batas Total
            } else if (config.maxReminders > 0 && 
                       now - status.lastAlertSentTime >= config.reminderIntervalMs && 
                       (now - status.alertStartTime) < config.maxAlertDurationMs) { 
                // Pemicu 2: Masalah BERULANG (Reminder)
                status.lastAlertSentTime = now;
                sendTelegramAlert(deviceID, latestData[deviceID], lantai, activeAlerts, "accident_repeat");
            }

        } else if (status.isAlert && !isCurrentlyAlert) {
            // -- KONDISI B: MASALAH DIATASI (RECOVERY) --
            status.isAlert = false;
            status.alertStartTime = 0;
            status.lastAlertSentTime = 0;

            if (!status.isRecoverySent) {
                status.isRecoverySent = true;
                sendTelegramAlert(deviceID, latestData[deviceID], lantai, [], "recovery");
            }
        }
        
        // 3. Logika Simpan Data Historis & Laporan Rutin
        if (!lastHistoricalSaveTime[deviceID] || (now - lastHistoricalSaveTime[deviceID] > config.historicalIntervalMs)) {
            
            const dataFilePath = path.join(__dirname, `history_${deviceID}.json`);
            let history = readHistoryFile(deviceID);
            
            const dataToSaveAndSend = latestData[deviceID];
            history.push(dataToSaveAndSend);

            if (history.length > 1000) {
                history.shift();
            }

            fs.writeFile(dataFilePath, JSON.stringify(history, null, 2), (err) => {
                if (err) {
                    console.error("Error writing to file:", err);
                } else {
                    lastHistoricalSaveTime[deviceID] = now;
                    console.log(`[Historical Log] Data saved for ${deviceID}`);
                    
                    // Pemicu 4: Laporan RUTIN (setiap historicalIntervalMs)
                    if (!isCurrentlyAlert) {
                         sendTelegramAlert(deviceID, dataToSaveAndSend, lantai, [], "routine");
                    }
                }
            });
        }
        
        res.status(200).send(`Data from ${deviceID} received successfully.`);
    } else {
        res.status(400).send('Device ID is missing.');
    }
});

// Fungsi untuk mengirim notifikasi Telegram
function sendTelegramAlert(deviceID, sensorData, lantai, activeAlerts, type) {
    const amonia = JSON.parse(sensorData.amonia);
    const water = JSON.parse(sensorData.air);
    const soap = JSON.parse(sensorData.sabun);
    const tissue = JSON.parse(sensorData.tisu);
    const timestamp = new Date(sensorData.timestamp).toLocaleString();
    
    const isAnySoapCritical = soap.sabun1.status === "Habis" || soap.sabun2.status === "Habis" || soap.sabun3.status === "Habis";
    const isAnyTissueCritical = tissue.tisu1.status === "Habis" || tissue.tisu2.status === "Habis";
    
    const soapStatusKeseluruhan = isAnySoapCritical ? "HAMPIR HABIS" : "Aman";
    const tissueStatusKeseluruhan = isAnyTissueCritical ? "HAMPIR HABIS" : "Tersedia";


    Object.keys(petugas).forEach(chatID => {
        if (petugas[chatID].lantai === lantai) {
            let message = '';
            
            const isNormal = !isAnySoapCritical && !isAnyTissueCritical;
            
            if (type === "accident_new") {
                message = `🚨 MASALAH BARU TERDETEKSI di ${deviceID.toUpperCase().replace('-', ' ')} (${timestamp})!\n\n${activeAlerts.join('\n')}\n`;
            } else if (type === "accident_repeat") {
                message = `🔔 PENGINGAT (MASALAH BELUM TERATASI) di ${deviceID.toUpperCase().replace('-', ' ')} (${timestamp})!\n\n${activeAlerts.join('\n')}\n`;
            } else if (type === "recovery") {
                message = `✅MASALAH SUDAH DIATASI di ${deviceID.toUpperCase().replace('-', ' ')} (${timestamp})!\n\nStatus Sabun dan Tisu kembali normal.\n`;
            } else if (type === "routine" && isNormal) { 
                 message = `📋 Laporan Rutin Harian dari ${deviceID.toUpperCase().replace('-', ' ')} (${timestamp}) - Status Aman.\n`;
            }

            if (message) {
                 let statusDetails = `
                    Bau: ${amonia.status} (${amonia.ppm} ppm)
                    Genangan Air: ${water.status}
                    Sabun: ${soapStatusKeseluruhan}
                    Tisu: ${tissueStatusKeseluruhan}
                `;
                bot.sendMessage(chatID, message + statusDetails);
            }
        }
    });
}

app.get('/api/latest', (req, res) => {
    const now = Date.now();
    for (const deviceID in latestData) {
        if (now - latestData[deviceID].lastActive > 30000) {
            latestData[deviceID].espStatus = "inactive";
        }
    }
    res.json(latestData);
});

app.get('/api/history', async (req, res) => {
    try {
        const historyFiles = fs.readdirSync(__dirname).filter(file => file.startsWith('history_') && file.endsWith('.json'));
        let allHistory = {};

        for (const file of historyFiles) {
            const deviceID = file.replace('history_', '').replace('.json', '');
            allHistory[deviceID] = readHistoryFile(deviceID);
        }

        res.json(allHistory);
    } catch (err) {
        console.error("Error reading historical data:", err);
        res.status(500).send("No historical data available.");
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log("Waiting for data from ESP32s...");
});
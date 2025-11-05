// --- script.js ---
// Fungsi pembantu untuk memvalidasi nilai jarak
function getSafeDistance(distance) {
    if (typeof distance === 'number' && isFinite(distance) && distance !== -1) {
        return `${distance} cm`;
    }
    return 'Data tidak ada';
}

// Fungsi pembantu untuk memvalidasi nilai status
function getSafeStatus(status) {
    if (status && status !== "" && status !== "N/A") {
        return status;
    }
    return "Data tidak ada";
}

let historicalIntervalId; 

// Fungsi untuk memuat nilai konfigurasi yang tersimpan ke dalam formulir
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        // Memuat 3 properti konfigurasi
        document.getElementById('historicalInterval').value = config.historicalIntervalMinutes;
        document.getElementById('maxReminders').value = config.maxReminders;
        document.getElementById('reminderInterval').value = config.reminderIntervalMinutes; 
    } catch (error) {
        console.error("Error loading configuration:", error);
    }
}

// Fungsi untuk mengirim konfigurasi baru ke server
async function saveConfig() {
    // Ambil 3 properti konfigurasi
    const historicalInterval = document.getElementById('historicalInterval').value;
    const maxReminders = document.getElementById('maxReminders').value;
    const reminderInterval = document.getElementById('reminderInterval').value; 
    const messageElement = document.getElementById('configMessage');

    const newConfig = {
        historicalIntervalMinutes: parseInt(historicalInterval),
        maxReminders: parseInt(maxReminders),
        reminderIntervalMinutes: parseInt(reminderInterval) 
    };

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });

        if (response.ok) {
            messageElement.innerText = '✅ Konfigurasi berhasil disimpan. Perubahan diterapkan pada log historis dan pengulangan alert.';
            messageElement.style.color = 'green';
            
            const newIntervalMs = newConfig.historicalIntervalMinutes * 60 * 1000;
            clearInterval(historicalIntervalId);
            historicalIntervalId = setInterval(loadHistoricalData, newIntervalMs);
            loadHistoricalData(); 
        } else {
            const errorText = await response.text();
            messageElement.innerText = `❌ Gagal menyimpan konfigurasi: ${errorText}`;
            messageElement.style.color = 'red';
        }
    } catch (error) {
        console.error("Error saving configuration:", error);
        messageElement.innerText = '❌ Error koneksi saat menyimpan konfigurasi.';
        messageElement.style.color = 'red';
    }
}


// Fungsi untuk memuat dan menampilkan kartu data real-time
async function loadRealtimeData() {
    try {
        const response = await fetch('/api/latest');
        const allDeviceData = await response.json();
        const mainContainer = document.getElementById('main-container');

        document.querySelectorAll('.device-section-container').forEach(section => {
            const deviceId = section.dataset.deviceId;
            if (!allDeviceData[deviceId]) {
                section.remove();
            }
        });

        // --- UPDATE STATUS GLOBAL ---
        const espStatusElement = document.getElementById('globalStatus');
        const activeESPs = Object.values(allDeviceData).filter(data => data.espStatus === 'active').length;
        const totalESPs = Object.keys(allDeviceData).length;
        
        espStatusElement.innerText = `${activeESPs} ESP aktif dari ${totalESPs} total`;
        espStatusElement.style.color = activeESPs > 0 ? 'green' : 'red';
        if (totalESPs === 0) {
            espStatusElement.innerText = `Tidak ada ESP terdeteksi.`;
            espStatusElement.style.color = 'red';
        }
        // --- AKHIR UPDATE STATUS GLOBAL ---


        for (const deviceID in allDeviceData) {
            const latestData = allDeviceData[deviceID];
            let deviceSection = document.querySelector(`.device-section-container[data-device-id="${deviceID}"]`);

            if (!deviceSection) {
                deviceSection = document.createElement('div');
                deviceSection.className = 'device-section-container';
                deviceSection.dataset.deviceId = deviceID;
                mainContainer.appendChild(deviceSection);
            }

            const espStatusText = latestData.espStatus === 'active' ? 'Aktif' : 'Tidak Aktif';
            const espStatusColor = latestData.espStatus === 'active' ? 'green' : 'red';

            const amonia = JSON.parse(latestData.amonia);
            const water = JSON.parse(latestData.air);
            const soap = JSON.parse(latestData.sabun);
            const tissue = JSON.parse(latestData.tisu);

            // LOGIKA PENGGABUNGAN STATUS TISU
            const statusTisu1 = getSafeStatus(tissue.tisu1.status);
            const statusTisu2 = getSafeStatus(tissue.tisu2.status);
            
            const isTissueCritical = statusTisu1 === "Habis" || statusTisu2 === "Habis";
            const isTissueNA = statusTisu1 === "Data tidak ada" && statusTisu2 === "Data tidak ada";
            
            let tissueStatusGabungan;
            if (isTissueNA) {
                tissueStatusGabungan = "Data tidak ada";
            } else if (isTissueCritical) {
                tissueStatusGabungan = 'Habis!';
            } else {
                tissueStatusGabungan = 'Tersedia';
            }
            
            // LOGIKA PENGGABUNGAN STATUS SABUN
            const statusSabun1 = getSafeStatus(soap.sabun1.status);
            const statusSabun2 = getSafeStatus(soap.sabun2.status);
            const statusSabun3 = getSafeStatus(soap.sabun3.status);
            
            const isSoapCritical = statusSabun1 === "Habis" || statusSabun2 === "Habis" || statusSabun3 === "Habis";
            const isSoapNA = soap.sabun1.distance === -1 && soap.sabun2.distance === -1 && soap.sabun3.distance === -1;
            
            let soapStatusGabungan;
            if (isSoapNA) {
                soapStatusGabungan = "Data tidak ada";
            } else if (isSoapCritical) {
                soapStatusGabungan = 'Hampir Habis!';
            } else {
                soapStatusGabungan = 'Aman';
            }
            
            // Detail untuk Sabun
            const soapDetails = `
                <p><strong>S1:</strong> ${getSafeDistance(soap.sabun1.distance)}</p>
                <p><strong>S2:</strong> ${getSafeDistance(soap.sabun2.distance)}</p>
                <p><strong>S3:</strong> ${getSafeDistance(soap.sabun3.distance)}</p>
            `;
            
            // Detail untuk Tisu
            const tissueDetails = `
                <p><strong>T1:</strong> ${statusTisu1}</p>
                <p><strong>T2:</strong> ${statusTisu2}</p>
            `;
            
            const amoniaPpm = isFinite(amonia.ppm) ? `${amonia.ppm} ppm` : 'Data tidak ada';
            const amoniaScore = isFinite(amonia.score) ? `${amonia.score}/5` : 'Data tidak ada';
            const amoniaStatus = amonia.status || 'Data tidak ada';
            const waterStatus = water.status || 'Data tidak ada';
            

            let realtimeDiv = deviceSection.querySelector('.realtime-content');
            if (!realtimeDiv) {
                realtimeDiv = document.createElement('div');
                realtimeDiv.className = 'realtime-content';
                deviceSection.appendChild(realtimeDiv);
            }
            realtimeDiv.innerHTML = `
                <h2>${deviceID.toUpperCase().replace('-', ' ')}</h2>
                <h3 style="color:${espStatusColor}">Status ESP: ${espStatusText}</h3>
                <div class="top-row">
                    <div class="card" style="background-color: ${amonia.score >= 4 ? '#ffdddd' : '#f8f9fa'}">
                        <h2>Amonia</h2>
                        <p><strong>NH₃:</strong> ${amoniaPpm}</p>
                        <p><strong>Skor Bau:</strong> ${amoniaScore}</p>
                        <p><strong>Interpretasi:</strong> ${amoniaStatus}</p>
                    </div>
                    <div class="card" style="background-color: ${waterStatus.includes('terdeteksi') ? '#ffdddd' : '#f8f9fa'}">
                        <h2>Genangan Air</h2>
                        <p><strong>Status:</strong> ${waterStatus}</p>
                    </div>
                    <div class="card" style="background-color: ${isTissueCritical ? '#ffdddd' : '#f8f9fa'}">
                        <h2>Tisu (Status Gabungan: ${tissueStatusGabungan})</h2>
                        ${tissueDetails}
                    </div>
                    <div class="card" style="background-color: ${isSoapCritical ? '#ffdddd' : '#f8f9fa'}">
                        <h2>Sabun (Status Gabungan: ${soapStatusGabungan})</h2>
                        ${soapDetails}
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error("Error fetching real-time data:", error);
        document.getElementById('globalStatus').innerText = "Gagal terhubung ke server";
        document.getElementById('globalStatus').style.color = 'red';
    }
}

// Fungsi untuk memuat dan menampilkan data historis ke tabel
async function loadHistoricalData() {
    try {
        const historyResponse = await fetch('/api/history');
        const historyData = await historyResponse.json();
        const mainContainer = document.getElementById('main-container');

        for (const deviceID in historyData) {
            const deviceHistory = historyData[deviceID] || [];
            
            let deviceSection = document.querySelector(`.device-section-container[data-device-id="${deviceID}"]`);
            if (!deviceSection) {
                deviceSection = document.createElement('div');
                deviceSection.className = 'device-section-container';
                deviceSection.dataset.deviceId = deviceID;
                mainContainer.appendChild(deviceSection);
            }
            
            let historicalTableContainer = deviceSection.querySelector('.table-container');
            if (historicalTableContainer) {
                historicalTableContainer.remove();
            }

            historicalTableContainer = document.createElement('div');
            historicalTableContainer.className = 'table-container';
            historicalTableContainer.innerHTML = `
                <h2>Data Historis - ${deviceID.toUpperCase().replace('-', ' ')}</h2>
                <button class="downloadButton" data-device-id="${deviceID}">Unduh Data Lengkap</button>
                <table class="historyTable">
                    <thead>
                        <tr>
                            <th>Waktu</th>
                            <th>Amonia (ppm)</th>
                            <th>Skor Bau</th>
                            <th>Genangan Air</th>
                            <th>Ketersediaan Sabun (Gabungan)</th>
                            <th>Ketersediaan Tisu (Gabungan)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${deviceHistory.slice(-24).reverse().map(data => {
                            try {
                                const amonia = JSON.parse(data.amonia);
                                const water = JSON.parse(data.air);
                                const soap = JSON.parse(data.sabun);
                                const tissue = JSON.parse(data.tisu);
                                
                                // LOGIKA GABUNGAN UNTUK TABEL HISTORIS
                                const statusSabun1 = getSafeStatus(soap.sabun1.status);
                                const statusSabun2 = getSafeStatus(soap.sabun2.status);
                                const statusSabun3 = getSafeStatus(soap.sabun3.status);
                                
                                const isSoapCritical = statusSabun1 === "Habis" || statusSabun2 === "Habis" || statusSabun3 === "Habis";
                                const isSoapNA = soap.sabun1.distance === -1 && soap.sabun2.distance === -1 && soap.sabun3.distance === -1;

                                let soapStatusRow;
                                if (isSoapNA) {
                                    soapStatusRow = "Data tidak ada";
                                } else if (isSoapCritical) {
                                    soapStatusRow = 'Hampir Habis';
                                } else {
                                    soapStatusRow = 'Aman';
                                }

                                const statusTisu1 = getSafeStatus(tissue.tisu1.status);
                                const statusTisu2 = getSafeStatus(tissue.tisu2.status);
                                
                                const isTissueCritical = statusTisu1 === "Habis" || statusTisu2 === "Habis";
                                const isTissueNA = statusTisu1 === "Data tidak ada" && statusTisu2 === "Data tidak ada";

                                let tissueStatusRow;
                                if (isTissueNA) {
                                    tissueStatusRow = "Data tidak ada";
                                } else if (isTissueCritical) {
                                    tissueStatusRow = 'Habis';
                                } else {
                                    tissueStatusRow = 'Tersedia';
                                }
                                // END LOGIKA GABUNGAN
                                
                                const amoniaPpmRow = isFinite(amonia.ppm) ? `${amonia.ppm} ppm` : 'Data tidak ada';
                                const amoniaScoreRow = isFinite(amonia.score) ? `${amonia.score}/5` : 'Data tidak ada';
                                const waterStatusRow = water.status || 'Data tidak ada';

                                return `
                                    <tr>
                                        <td>${new Date(data.timestamp).toLocaleString()}</td>
                                        <td>${amoniaPpmRow}</td>
                                        <td>${amoniaScoreRow}</td>
                                        <td>${waterStatusRow}</td>
                                        <td>${soapStatusRow}</td>
                                        <td>${tissueStatusRow}</td>
                                    </tr>
                                `;
                            } catch (e) {
                                console.error("Error parsing historical data row:", e);
                                return `<tr><td colspan="6">Data tidak valid atau rusak</td></tr>`;
                            }
                        }).join('')}
                    </tbody>
                </table>
            `;
            
            deviceSection.appendChild(historicalTableContainer);
            
            const downloadButton = historicalTableContainer.querySelector('.downloadButton');
            downloadButton.addEventListener('click', async (event) => {
                const deviceID = event.target.dataset.deviceId;
                const response = await fetch('/api/history');
                const historyData = await response.json();
                const csvString = convertToCsv({ [deviceID]: historyData[deviceID] });
                const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = `data_sensor_toilet_${deviceID}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        };
    } catch (error) {
        console.error("Error fetching historical data:", error);
    }
}

function convertToCsv(data) {
    const headers = ["Perangkat", "Waktu", "Amonia (ppm)", "Skor Bau", "Genangan Air", "Ketersediaan Sabun (Gabungan)", "Ketersediaan Tisu (Gabungan)"];
    const csvRows = [headers.join(',')];

    for (const deviceID in data) {
        data[deviceID].forEach(item => {
            try {
                const amonia = JSON.parse(item.amonia);
                const water = JSON.parse(item.air);
                const soap = JSON.parse(item.sabun);
                const tissue = JSON.parse(item.tisu);
    
                // LOGIKA GABUNGAN UNTUK CSV
                const statusSabun1 = getSafeStatus(soap.sabun1.status);
                const statusSabun2 = getSafeStatus(soap.sabun2.status);
                const statusSabun3 = getSafeStatus(soap.sabun3.status);
                
                const isSoapCritical = statusSabun1 === "Habis" || statusSabun2 === "Habis" || statusSabun3 === "Habis";
                const isSoapNA = soap.sabun1.distance === -1 && soap.sabun2.distance === -1 && soap.sabun3.distance === -1;

                let soapStatusCSV;
                if (isSoapNA) {
                    soapStatusCSV = "Data tidak ada";
                } else if (isSoapCritical) {
                    soapStatusCSV = 'Hampir Habis';
                } else {
                    soapStatusCSV = 'Aman';
                }

                const statusTisu1 = getSafeStatus(tissue.tisu1.status);
                const statusTisu2 = getSafeStatus(tissue.tisu2.status);
                
                const isTissueCritical = statusTisu1 === "Habis" || statusTisu2 === "Habis";
                const isTissueNA = statusTisu1 === "Data tidak ada" && statusTisu2 === "Data tidak ada";

                let tissueStatusCSV;
                if (isTissueNA) {
                    tissueStatusCSV = "Data tidak ada";
                } else if (isTissueCritical) {
                    tissueStatusCSV = 'Habis';
                } else {
                    tissueStatusCSV = 'Tersedia';
                }
                // END LOGIKA GABUNGAN

                const rowData = [
                    `"${deviceID}"`,
                    `"${new Date(item.timestamp).toLocaleString()}"`,
                    `"${isFinite(amonia.ppm) ? amonia.ppm + ' ppm' : 'Data tidak ada'}"`,
                    `"${isFinite(amonia.score) ? amonia.score + '/5' : 'Data tidak ada'}"`,
                    `"${water.status || 'Data tidak ada'}"`,
                    `"${soapStatusCSV}"`,
                    `"${tissueStatusCSV}"`
                ];
                csvRows.push(rowData.join(','));
            } catch (e) {
                console.error("Error converting row to CSV:", e);
            }
        });
    }
    return csvRows.join('\n');
}

document.addEventListener('DOMContentLoaded', () => {
    // Muat konfigurasi saat DOMContentLoaded
    loadConfig().then(() => {
        // Ambil nilai interval dari input setelah konfigurasi dimuat
        const initialIntervalMinutes = (document.getElementById('historicalInterval') ? parseInt(document.getElementById('historicalInterval').value) : 5);
        const initialIntervalMs = initialIntervalMinutes * 60 * 1000;

        loadRealtimeData();
        loadHistoricalData(); 
        
        // Perbarui data real-time setiap 1 detik
        setInterval(loadRealtimeData, 1000);
        
        // Set interval historis awal (akan direset jika konfigurasi diubah)
        historicalIntervalId = setInterval(loadHistoricalData, initialIntervalMs);
        
        // Setup event listener untuk tombol simpan
        document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
    });
});
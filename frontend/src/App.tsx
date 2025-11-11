import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import DeviceSection from './components/DeviceSection';
import LoginForm from './components/LoginForm';
import { AuthenticatedUser, useAuth } from './auth/AuthContext';
import { buildApiUrl } from './api';
import { Config, HistoryDataMap, LatestDataMap } from './types';

type ConfigMessage = { type: 'success' | 'error'; text: string } | null;

export default function App() {
  const { token, user, logout } = useAuth();
  const [config, setConfig] = useState<Config | null>(null);
  const [configForm, setConfigForm] = useState({
    historicalIntervalMinutes: '5',
    reminderIntervalMinutes: '10',
    maxReminders: '3'
  });
  const [configMessage, setConfigMessage] = useState<ConfigMessage>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [latestData, setLatestData] = useState<LatestDataMap>({});
  const [historyData, setHistoryData] = useState<HistoryDataMap>({});
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  const handleLogout = useCallback(() => {
    setConfig(null);
    setLatestData({});
    setHistoryData({});
    setConfigMessage(null);
    logout();
  }, [logout]);

  const handleUnauthorized = useCallback(() => {
    setSessionMessage('Sesi berakhir. Silakan login ulang.');
    handleLogout();
  }, [handleLogout]);

  const handleLogoutClick = useCallback(() => {
    setSessionMessage('Anda telah keluar dari sistem.');
    handleLogout();
  }, [handleLogout]);

  const loadConfig = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetch(buildApiUrl('/api/config'), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data: Config = await response.json();
      setConfig(data);
      setConfigForm({
        historicalIntervalMinutes: String(data.historicalIntervalMinutes),
        reminderIntervalMinutes: String(data.reminderIntervalMinutes),
        maxReminders: String(data.maxReminders)
      });
    } catch (error) {
      console.error('Error loading configuration:', error);
      setConfigMessage({ type: 'error', text: 'Gagal memuat konfigurasi.' });
    }
  }, [token, handleUnauthorized]);

  const loadRealtimeData = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetch(buildApiUrl('/api/latest'), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data: LatestDataMap = await response.json();
      setLatestData(data);
    } catch (error) {
      console.error('Error fetching real-time data:', error);
    }
  }, [token, handleUnauthorized]);

  const loadHistoryData = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetch(buildApiUrl('/api/history'), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data: HistoryDataMap = await response.json();
      setHistoryData(data);
    } catch (error) {
      console.error('Error fetching historical data:', error);
    }
  }, [token, handleUnauthorized]);

  useEffect(() => {
    if (!token) {
      return;
    }
    loadConfig();
  }, [token, loadConfig]);

  useEffect(() => {
    if (!token) {
      return;
    }
    loadRealtimeData();
    const intervalId = window.setInterval(loadRealtimeData, 1000);
    return () => window.clearInterval(intervalId);
  }, [token, loadRealtimeData]);

  useEffect(() => {
    if (!token || !config) {
      return;
    }
    loadHistoryData();
    const intervalMs = Math.max(config.historicalIntervalMinutes, 1) * 60 * 1000;
    const intervalId = window.setInterval(loadHistoryData, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [token, config, loadHistoryData]);

  useEffect(() => {
    if (token) {
      setSessionMessage(null);
    }
  }, [token]);

  const handleConfigInputChange = (field: keyof typeof configForm) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setConfigForm(prev => ({ ...prev, [field]: event.target.value }));
  };

  const handleConfigSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingConfig(true);
    setConfigMessage(null);
    if (!token) {
      setConfigMessage({ type: 'error', text: 'Sesi login tidak valid. Silakan masuk kembali.' });
      setIsSavingConfig(false);
      return;
    }
    try {
      const payload = {
        historicalIntervalMinutes: Number.parseInt(configForm.historicalIntervalMinutes, 10),
        reminderIntervalMinutes: Number.parseInt(configForm.reminderIntervalMinutes, 10),
        maxReminders: Number.parseInt(configForm.maxReminders, 10)
      };

      const response = await fetch(buildApiUrl('/api/config'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setConfig(payload);
      setConfigMessage({
        type: 'success',
        text: '✅ Konfigurasi berhasil disimpan. Perubahan diterapkan pada log historis dan pengulangan alert.'
      });
    } catch (error) {
      console.error('Error saving configuration:', error);
      setConfigMessage({
        type: 'error',
        text: '❌ Gagal menyimpan konfigurasi. Pastikan nilai valid.'
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const deviceIds = useMemo(() => {
    const ids = new Set<string>();
    Object.keys(latestData).forEach(id => ids.add(id));
    Object.keys(historyData).forEach(id => ids.add(id));
    return Array.from(ids).sort();
  }, [latestData, historyData]);

  const userRoleLabel = useMemo(() => {
    if (!user) {
      return '';
    }
    const labels: Record<AuthenticatedUser['role'], string> = {
      SUPERVISOR: 'Supervisor',
      OPERATOR: 'Operator'
    };
    return labels[user.role] ?? user.role;
  }, [user]);

  const globalStatus = useMemo(() => {
    const devices = Object.values(latestData);
    const totalDevices = devices.length;
    if (totalDevices === 0) {
      return { text: 'Tidak ada ESP terdeteksi.', color: 'red' };
    }
    const activeDevices = devices.filter(device => device.espStatus === 'active').length;
    return {
      text: `${activeDevices} ESP aktif dari ${totalDevices} total`,
      color: activeDevices > 0 ? 'green' : 'red'
    };
  }, [latestData]);

  const handleDownloadHistory = useCallback(
    (deviceId: string) => {
      const deviceHistory = historyData[deviceId] ?? [];
      const csvRows = convertHistoryToCsv(deviceId, deviceHistory);
      const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `data_sensor_toilet_${deviceId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    [historyData]
  );

  if (!token) {
    return (
      <div className="app-container">
        <h1>TOILET MONITORING SYSTEM</h1>
        {sessionMessage && <p className="session-message">{sessionMessage}</p>}
        <LoginForm />
      </div>
    );
  }

  return (
    <div className="app-container">
      <h1>TOILET MONITORING SYSTEM</h1>

      <div className="auth-banner">
        <div className="auth-details">
          <span>
            Masuk sebagai <strong>{user?.email ?? 'Pengguna'}</strong>
            {user ? ` • ${userRoleLabel}` : ''}
          </span>
        </div>
        <button type="button" onClick={handleLogoutClick} className="logout-button">
          Keluar
        </button>
      </div>

      <div id="header-controls">
        <div className="control-card">
          <h2>Status Koneksi</h2>
          <h3 style={{ color: globalStatus.color }}>{globalStatus.text}</h3>
        </div>

        <div className="control-card">
          <h2>⚙️ Pengaturan Waktu & Notifikasi</h2>
          <form id="config-form" onSubmit={handleConfigSubmit}>
            <label htmlFor="historicalInterval">Interval Log &amp; Laporan Rutin (Menit, min 1):</label>
            <input
              type="number"
              id="historicalInterval"
              min={1}
              value={configForm.historicalIntervalMinutes}
              onChange={handleConfigInputChange('historicalIntervalMinutes')}
            />

            <label htmlFor="reminderInterval">Interval Waktu Pengulangan Reminder (Menit, min 1):</label>
            <input
              type="number"
              id="reminderInterval"
              min={1}
              value={configForm.reminderIntervalMinutes}
              onChange={handleConfigInputChange('reminderIntervalMinutes')}
            />

            <label htmlFor="maxReminders">Jumlah Reminder (setelah Alert Awal, min 0):</label>
            <input
              type="number"
              id="maxReminders"
              min={0}
              value={configForm.maxReminders}
              onChange={handleConfigInputChange('maxReminders')}
            />

            <button id="saveConfigBtn" type="submit" disabled={isSavingConfig}>
              {isSavingConfig ? 'Menyimpan...' : 'Simpan Konfigurasi'}
            </button>
            {configMessage && (
              <p id="configMessage" style={{ color: configMessage.type === 'success' ? 'green' : 'red' }}>
                {configMessage.text}
              </p>
            )}
          </form>
        </div>
      </div>

      <hr />

      <div id="main-container">
        {deviceIds.length === 0 ? (
          <p className="empty-state">Belum ada data perangkat untuk ditampilkan.</p>
        ) : (
          deviceIds.map(deviceId => (
            <DeviceSection
              key={deviceId}
              deviceId={deviceId}
              data={latestData[deviceId]}
              history={historyData[deviceId] ?? []}
              onDownloadHistory={() => handleDownloadHistory(deviceId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function convertHistoryToCsv(deviceId: string, history: HistoryDataMap[string]): string {
  const headers = [
    'Perangkat',
    'Waktu',
    'Amonia (ppm)',
    'Skor Bau',
    'Genangan Air',
    'Ketersediaan Sabun (Gabungan)',
    'Ketersediaan Tisu (Gabungan)'
  ];
  const rows = [headers.join(',')];

  history.forEach(entry => {
    try {
      const amonia = JSON.parse(entry.amonia);
      const water = JSON.parse(entry.air);
      const soap = JSON.parse(entry.sabun);
      const tissue = JSON.parse(entry.tisu);

      const soapStatuses = [soap.sabun1?.status, soap.sabun2?.status, soap.sabun3?.status];
      const soapDistances = [soap.sabun1?.distance, soap.sabun2?.distance, soap.sabun3?.distance];
      const allSoapMissing = soapDistances.every((distance: number) => typeof distance === 'number' && distance === -1);
      const soapCritical = soapStatuses.includes('Habis');
      const soapLabel = allSoapMissing ? 'Data tidak ada' : soapCritical ? 'Hampir Habis' : 'Aman';

      const tissueStatuses = [tissue.tisu1?.status, tissue.tisu2?.status].map((status: string) =>
        !status || status === 'N/A' ? 'Data tidak ada' : status
      );
      const allTissueMissing = tissueStatuses.every((status: string) => status === 'Data tidak ada');
      const tissueCritical = tissueStatuses.includes('Habis');
      const tissueLabel = allTissueMissing ? 'Data tidak ada' : tissueCritical ? 'Habis' : 'Tersedia';

      rows.push(
        [
          `"${deviceId}"`,
          `"${new Date(entry.timestamp).toLocaleString()}"`,
          `"${Number.isFinite(amonia.ppm) ? `${amonia.ppm} ppm` : 'Data tidak ada'}"`,
          `"${Number.isFinite(amonia.score) ? `${amonia.score}/5` : 'Data tidak ada'}"`,
          `"${water.status || 'Data tidak ada'}"`,
          `"${soapLabel}"`,
          `"${tissueLabel}"`
        ].join(',')
      );
    } catch (error) {
      console.error('Error converting history row to CSV:', error);
    }
  });

  return rows.join('\n');
}

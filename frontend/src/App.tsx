import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeviceSection from './components/DeviceSection';
import LoginForm from './components/LoginForm';
import { AuthenticatedUser, useAuth } from './auth/AuthContext';
import { buildApiUrl, buildWsUrl } from './api';
import { Config, DeviceHistoryResponse, HistoryDataMap, LatestDataMap, LatestDeviceSnapshot } from './types';

type ConfigMessage = { type: 'success' | 'error'; text: string } | null;

interface DeviceHistoryMeta {
  nextCursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
}

export default function App() {
  const { token, user, logout } = useAuth();
  const [config, setConfig] = useState<Config | null>(null);
  const [configForm, setConfigForm] = useState({
    historicalIntervalMinutes: '5',
    reminderIntervalMinutes: '10',
    maxReminders: '3',
    soapEmptyThresholdCm: '10',
    tissueEmptyValue: '0',
    ammoniaGoodMax: '1.5',
    ammoniaWarningMax: '3'
  });
  const [configMessage, setConfigMessage] = useState<ConfigMessage>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [latestData, setLatestData] = useState<LatestDataMap>({});
  const [historyData, setHistoryData] = useState<HistoryDataMap>({});
  const [historyStatus, setHistoryStatus] = useState<Record<string, DeviceHistoryMeta>>({});
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const deviceIdsRef = useRef<string[]>([]);
  const historyStatusRef = useRef<Record<string, DeviceHistoryMeta>>({});

  const handleLogout = useCallback(() => {
    setConfig(null);
    setLatestData({});
    setHistoryData({});
    setHistoryStatus({});
    deviceIdsRef.current = [];
    historyStatusRef.current = {};
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
        maxReminders: String(data.maxReminders),
        soapEmptyThresholdCm: String(data.soapEmptyThresholdCm),
        tissueEmptyValue: String(data.tissueEmptyValue),
        ammoniaGoodMax: String(data.ammoniaLimits.goodMax),
        ammoniaWarningMax: String(data.ammoniaLimits.warningMax)
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

  const fetchHistoryForDevice = useCallback(
    async (deviceId: string, cursor?: string | null, append = false) => {
      if (!token) {
        return;
      }

      const previousMeta = historyStatusRef.current[deviceId];
      const loadingMeta: DeviceHistoryMeta = {
        nextCursor: previousMeta?.nextCursor ?? null,
        hasMore: previousMeta?.hasMore ?? false,
        isLoading: true
      };
      historyStatusRef.current = {
        ...historyStatusRef.current,
        [deviceId]: loadingMeta
      };
      setHistoryStatus(prev => ({
        ...prev,
        [deviceId]: loadingMeta
      }));

      try {
        const params = new URLSearchParams();
        params.set('deviceId', deviceId);
        params.set('limit', '25');
        if (cursor) {
          params.set('cursor', cursor);
        }

        const response = await fetch(buildApiUrl(`/api/history?${params.toString()}`), {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (response.status === 401 || response.status === 403) {
          const previousMeta = historyStatusRef.current[deviceId];
          const updatedMeta: DeviceHistoryMeta = {
            nextCursor: previousMeta?.nextCursor ?? null,
            hasMore: previousMeta?.hasMore ?? false,
            isLoading: false
          };
          historyStatusRef.current = {
            ...historyStatusRef.current,
            [deviceId]: updatedMeta
          };
          setHistoryStatus(prev => ({
            ...prev,
            [deviceId]: updatedMeta
          }));
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data: DeviceHistoryResponse = await response.json();

        setHistoryData(prev => {
          const existingEntries = prev[deviceId] ?? [];
          const nextEntries = append
            ? [...existingEntries, ...data.entries]
            : (() => {
                if (existingEntries.length === 0) {
                  return data.entries;
                }
                const seenTimestamps = new Set(data.entries.map(entry => entry.timestamp));
                const preserved = existingEntries.filter(entry => !seenTimestamps.has(entry.timestamp));
                return [...data.entries, ...preserved];
              })();
          return { ...prev, [deviceId]: nextEntries };
        });

        const successMeta: DeviceHistoryMeta = {
          nextCursor: data.nextCursor,
          hasMore: data.hasMore,
          isLoading: false
        };
        historyStatusRef.current = {
          ...historyStatusRef.current,
          [deviceId]: successMeta
        };
        setHistoryStatus(prev => ({
          ...prev,
          [deviceId]: successMeta
        }));
      } catch (error) {
        console.error('Error fetching historical data:', error);
        const previousMeta = historyStatusRef.current[deviceId];
        const fallbackMeta: DeviceHistoryMeta = {
          nextCursor: previousMeta?.nextCursor ?? null,
          hasMore: previousMeta?.hasMore ?? false,
          isLoading: false
        };
        historyStatusRef.current = {
          ...historyStatusRef.current,
          [deviceId]: fallbackMeta
        };
        setHistoryStatus(prev => ({
          ...prev,
          [deviceId]: fallbackMeta
        }));
      }
    },
    [token, handleUnauthorized]
  );

  useEffect(() => {
    historyStatusRef.current = historyStatus;
  }, [historyStatus]);

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

    let websocket: WebSocket | null = null;
    let reconnectTimeoutId: number | null = null;
    let shouldReconnect = true;

    const connect = () => {
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
      }

      const url = new URL(buildWsUrl('/ws/latest'));
      url.searchParams.set('token', token);

      const socket = new WebSocket(url.toString());
      websocket = socket;

      socket.addEventListener('message', event => {
        if (typeof event.data !== 'string') {
          return;
        }

        try {
          const message = JSON.parse(event.data) as
            | { type: 'init'; payload: LatestDataMap }
            | { type: 'snapshot'; payload: LatestDeviceSnapshot };

          if (message.type === 'init') {
            setLatestData(message.payload);
          } else if (message.type === 'snapshot') {
            const snapshot = message.payload;
            setLatestData(prev => ({ ...prev, [snapshot.deviceID]: snapshot }));
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      socket.addEventListener('close', event => {
        websocket = null;
        if (event.code === 4401) {
          shouldReconnect = false;
          if (reconnectTimeoutId !== null) {
            window.clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = null;
          }
          handleUnauthorized();
          return;
        }

        if (shouldReconnect) {
          reconnectTimeoutId = window.setTimeout(connect, 2000);
        }
      });

      socket.addEventListener('error', event => {
        console.error('WebSocket error:', event);
        socket.close();
      });
    };

    loadRealtimeData();
    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId);
      }
      websocket?.close();
    };
  }, [token, loadRealtimeData, handleUnauthorized]);

  useEffect(() => {
    if (!token || !config) {
      return;
    }

    const refreshHistory = () => {
      deviceIdsRef.current.forEach(deviceId => {
        const status = historyStatusRef.current[deviceId];
        if (status?.isLoading) {
          return;
        }
        void fetchHistoryForDevice(deviceId);
      });
    };

    refreshHistory();
    const intervalMs = Math.max(config.historicalIntervalMinutes, 1) * 60 * 1000;
    const intervalId = window.setInterval(refreshHistory, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [token, config, fetchHistoryForDevice]);

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
      const payload: Config = {
        historicalIntervalMinutes: Number.parseInt(configForm.historicalIntervalMinutes, 10),
        reminderIntervalMinutes: Number.parseInt(configForm.reminderIntervalMinutes, 10),
        maxReminders: Number.parseInt(configForm.maxReminders, 10),
        soapEmptyThresholdCm: Number.parseFloat(configForm.soapEmptyThresholdCm),
        tissueEmptyValue: Number.parseInt(configForm.tissueEmptyValue, 10),
        ammoniaLimits: {
          goodMax: Number.parseFloat(configForm.ammoniaGoodMax),
          warningMax: Number.parseFloat(configForm.ammoniaWarningMax)
        }
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

  useEffect(() => {
    deviceIdsRef.current = deviceIds;
  }, [deviceIds]);

  useEffect(() => {
    if (!token) {
      return;
    }
    deviceIds.forEach(deviceId => {
      const hasHistory = historyData[deviceId] !== undefined;
      const status = historyStatusRef.current[deviceId];
      if (!hasHistory && !status?.isLoading) {
        void fetchHistoryForDevice(deviceId);
      }
    });
  }, [token, deviceIds, fetchHistoryForDevice, historyData]);

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

  const isSupervisor = user?.role === 'SUPERVISOR';

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

  const resolveDisplayName = useCallback(
    (deviceId: string): string | null => {
      const latestName = normalizeDisplayName(latestData[deviceId]?.displayName);
      if (latestName) {
        return latestName;
      }
      const historyEntries = historyData[deviceId];
      if (historyEntries) {
        for (let index = historyEntries.length - 1; index >= 0; index -= 1) {
          const candidate = normalizeDisplayName(historyEntries[index]?.displayName);
          if (candidate) {
            return candidate;
          }
        }
      }
      return null;
    },
    [latestData, historyData]
  );

  const handleLoadMoreHistory = useCallback(
    (deviceId: string) => {
      const meta = historyStatus[deviceId];
      if (!meta || !meta.hasMore || meta.isLoading || !meta.nextCursor) {
        return;
      }
      void fetchHistoryForDevice(deviceId, meta.nextCursor, true);
    },
    [fetchHistoryForDevice, historyStatus]
  );

  const handleDownloadHistory = useCallback(
    (deviceId: string) => {
      const deviceHistory = historyData[deviceId] ?? [];
      const csvRows = convertHistoryToCsv(deviceId, deviceHistory, resolveDisplayName(deviceId));
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
    [historyData, resolveDisplayName]
  );

  const handleRenameDevice = useCallback(
    async (deviceId: string, newDisplayName: string | null) => {
      if (!token) {
        setSessionMessage('Sesi login tidak valid. Silakan login ulang.');
        handleLogout();
        throw new Error('Sesi login tidak valid.');
      }

      try {
        const response = await fetch(buildApiUrl(`/api/device/${encodeURIComponent(deviceId)}/rename`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ displayName: newDisplayName })
        });

        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          throw new Error('Sesi berakhir. Silakan login ulang.');
        }

        if (response.status === 404) {
          throw new Error('Perangkat tidak ditemukan.');
        }

        if (!response.ok) {
          throw new Error(await response.text());
        }

        setLatestData(prev => {
          const next = { ...prev };
          if (next[deviceId]) {
            next[deviceId] = { ...next[deviceId], displayName: newDisplayName };
          }
          return next;
        });

        setHistoryData(prev => {
          const next = { ...prev };
          const entries = next[deviceId];
          if (entries) {
            next[deviceId] = entries.map(entry => ({ ...entry, displayName: newDisplayName }));
          }
          return next;
        });
      } catch (error) {
        console.error('Error updating device name:', error);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Gagal memperbarui nama perangkat.');
      }
    },
    [token, handleUnauthorized, handleLogout, setLatestData, setHistoryData, setSessionMessage]
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

            <label htmlFor="soapThreshold">Ambang Sabun Kosong (cm):</label>
            <input
              type="number"
              id="soapThreshold"
              min={0}
              step="0.1"
              value={configForm.soapEmptyThresholdCm}
              onChange={handleConfigInputChange('soapEmptyThresholdCm')}
            />

            <label htmlFor="tissueEmptyValue">Nilai Digital Tisu Saat Habis (0 atau 1):</label>
            <input
              type="number"
              id="tissueEmptyValue"
              min={0}
              max={1}
              value={configForm.tissueEmptyValue}
              onChange={handleConfigInputChange('tissueEmptyValue')}
            />

            <label htmlFor="ammoniaGood">Ambang Amonia (ppm) - Batas Aman:</label>
            <input
              type="number"
              id="ammoniaGood"
              min={0}
              step="0.1"
              value={configForm.ammoniaGoodMax}
              onChange={handleConfigInputChange('ammoniaGoodMax')}
            />

            <label htmlFor="ammoniaWarning">Ambang Amonia (ppm) - Batas Peringatan:</label>
            <input
              type="number"
              id="ammoniaWarning"
              min={0}
              step="0.1"
              value={configForm.ammoniaWarningMax}
              onChange={handleConfigInputChange('ammoniaWarningMax')}
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
          deviceIds.map(deviceId => {
            const historyMeta = historyStatus[deviceId];
            return (
              <DeviceSection
                key={deviceId}
                deviceId={deviceId}
                data={latestData[deviceId]}
                history={historyData[deviceId] ?? []}
                displayName={resolveDisplayName(deviceId)}
                canRename={isSupervisor}
                onRename={isSupervisor ? handleRenameDevice : undefined}
                onDownloadHistory={() => handleDownloadHistory(deviceId)}
                onLoadMoreHistory={historyMeta?.hasMore ? () => handleLoadMoreHistory(deviceId) : undefined}
                hasMoreHistory={historyMeta?.hasMore ?? false}
                isLoadingHistory={historyMeta?.isLoading ?? false}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function convertHistoryToCsv(
  deviceId: string,
  history: HistoryDataMap[string],
  displayName?: string | null
): string {
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

  const defaultLabel = normalizeDisplayName(displayName) ?? deviceId;

  [...history].reverse().forEach(entry => {
    try {
      const amonia = JSON.parse(entry.amonia);
      const water = JSON.parse(entry.waterPuddleJson);
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

      const entryLabel = normalizeDisplayName(entry.displayName) ?? defaultLabel;

      rows.push(
        [
          `"${entryLabel}"`,
          `"${new Date(entry.timestamp).toLocaleString()}"`,
          `"${Number.isFinite(amonia.ppm) ? `${amonia.ppm} ppm` : 'Data tidak ada'}"`,
          `"${Number.isFinite(amonia.score) ? `${amonia.score}/3` : 'Data tidak ada'}"`,
          `"${
            typeof water.digital === 'number' && water.digital !== -1
              ? `${water.status || 'Data tidak ada'} (${water.digital})`
              : water.status || 'Data tidak ada'
          }"`,
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

function normalizeDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

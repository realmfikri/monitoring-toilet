import { ReactNode, useCallback, useMemo, useState } from 'react';
import { FaPumpSoap, FaToiletPaper, FaWater, FaWind } from 'react-icons/fa6';
import {
  AmmoniaSensorData,
  DEFAULT_SENSOR_CONFIG,
  DeviceSensorConfig,
  LatestDeviceSnapshot,
  SensorKey,
  SENSOR_KEYS,
  SoapSensorData,
  TissueSensorData,
  WaterSensorData
} from '../types';

interface DeviceSectionProps {
  deviceId: string;
  data?: LatestDeviceSnapshot;
  history: LatestDeviceSnapshot[];
  onDownloadHistory: () => void;
  displayName?: string | null;
  canRename?: boolean;
  onRename?: (deviceId: string, newName: string | null) => Promise<void>;
  sensorConfig?: DeviceSensorConfig;
  canManageSensors?: boolean;
  onLoadSensorSettings?: () => Promise<DeviceSensorConfig>;
  onSaveSensorSettings?: (config: DeviceSensorConfig) => Promise<void>;
  onLoadMoreHistory?: () => void;
  hasMoreHistory?: boolean;
  isLoadingHistory?: boolean;
}

interface AggregatedSoapStatus {
  cardLabel: string;
  historyLabel: string;
  critical: boolean;
  details: string[];
}

interface AggregatedTissueStatus {
  cardLabel: string;
  historyLabel: string;
  critical: boolean;
  details: string[];
}

type EspStatus = 'active' | 'inactive';

type SensorSeverity = 'normal' | 'warning' | 'critical';

interface StatusBadgeProps {
  status: EspStatus;
  label: string;
}

interface SensorCardStat {
  label: string;
  value: string;
}

interface SensorCardProps {
  title: string;
  stats?: SensorCardStat[];
  severity?: SensorSeverity;
  details?: string[];
  icon?: ReactNode;
  iconClassName?: string;
}

const StatusBadge = ({ status, label }: StatusBadgeProps) => (
  <div className={`status-badge status-badge--${status}`}>
    <span className="status-badge__dot" />
    <span className="status-badge__label">{label}</span>
  </div>
);

const SensorCard = ({
  title,
  stats = [],
  severity = 'normal',
  details = [],
  icon,
  iconClassName
}: SensorCardProps) => (
  <div className={`sensor-card severity-${severity}`}>
    <div className="sensor-card__title-row">
      <h3>{title}</h3>
      {icon ? (
        <div className={`sensor-card__icon ${iconClassName ?? ''}`.trim()}>{icon}</div>
      ) : null}
    </div>
    {stats.length > 0 ? (
      <div className="sensor-card__stats">
        {stats.map(stat => (
          <div className="sensor-card__stat" key={stat.label}>
            <span className="sensor-card__value">{stat.value}</span>
            <span className="sensor-card__label">{stat.label.toUpperCase()}</span>
          </div>
        ))}
      </div>
    ) : null}
    {details.length > 0 ? (
      <ul className="sensor-card__details">
        {details.map(detail => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    ) : null}
  </div>
);

const DEFAULT_AMMONIA: AmmoniaSensorData = { ppm: null, score: null, status: 'Data tidak ada' };
const DEFAULT_WATER: WaterSensorData = { digital: -1, status: 'Data tidak ada' };
const DEFAULT_SOAP: SoapSensorData = {
  sabun1: { distance: -1, status: 'Data tidak ada' },
  sabun2: { distance: -1, status: 'Data tidak ada' },
  sabun3: { distance: -1, status: 'Data tidak ada' }
};
const DEFAULT_TISSUE: TissueSensorData = {
  tisu1: { digital: -1, status: 'Data tidak ada' },
  tisu2: { digital: -1, status: 'Data tidak ada' }
};

export default function DeviceSection({
  deviceId,
  data,
  history,
  onDownloadHistory,
  displayName: displayNameProp,
  canRename = false,
  onRename,
  sensorConfig,
  canManageSensors = false,
  onLoadSensorSettings,
  onSaveSensorSettings,
  onLoadMoreHistory,
  hasMoreHistory = false,
  isLoadingHistory = false
}: DeviceSectionProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSensorModalOpen, setIsSensorModalOpen] = useState(false);
  const [sensorConfigDraft, setSensorConfigDraft] = useState<DeviceSensorConfig | null>(null);
  const [sensorConfigError, setSensorConfigError] = useState<string | null>(null);
  const [isSavingSensors, setIsSavingSensors] = useState(false);
  const formattedDeviceId = formatDeviceDisplayId(deviceId);
  const effectiveDisplayName = (displayNameProp ?? data?.displayName ?? null) ?? formattedDeviceId;
  const effectiveSensorConfig = sensorConfig ?? DEFAULT_SENSOR_CONFIG;

  const realtime = useMemo(() => {
    if (!data) {
      return null;
    }
    const amonia = safeParse<AmmoniaSensorData>(data.amonia, DEFAULT_AMMONIA);
    const water = safeParse<WaterSensorData>(data.waterPuddleJson, DEFAULT_WATER);
    const soap = safeParse<SoapSensorData>(data.sabun, DEFAULT_SOAP);
    const tissue = safeParse<TissueSensorData>(data.tisu, DEFAULT_TISSUE);

    return {
      amonia,
      water,
      soap,
      tissue,
      soapSummary: aggregateSoapStatus(soap, effectiveSensorConfig),
      tissueSummary: aggregateTissueStatus(tissue, effectiveSensorConfig),
      timestamp: new Date(data.timestamp).toLocaleString(),
      espStatusText: data.espStatus === 'active' ? 'Aktif' : 'Tidak Aktif',
      espStatus: data.espStatus === 'active' ? 'active' : 'inactive'
    };
  }, [data, effectiveSensorConfig]);

  const historyRows = useMemo(() => history, [history]);

  const handleRenameClick = useCallback(async () => {
    if (!canRename || !onRename) {
      return;
    }
    const currentName = displayNameProp ?? data?.displayName ?? '';
    const input = window.prompt(
      'Masukkan nama tampilan perangkat (kosongkan untuk menghapus).',
      currentName ?? ''
    );
    if (input === null) {
      return;
    }
    const trimmed = input.trim();
    const newName = trimmed.length > 0 ? trimmed : null;
    try {
      await onRename(deviceId, newName);
      window.alert('Nama perangkat berhasil diperbarui.');
    } catch (error) {
      console.error('Error renaming device:', error);
      window.alert('Gagal memperbarui nama perangkat. Silakan coba lagi.');
    }
  }, [canRename, onRename, deviceId, displayNameProp, data?.displayName]);

  const toggleHistoryDrawer = useCallback(() => {
    setIsHistoryOpen(prev => !prev);
  }, []);

  const handleManageSensorsClick = useCallback(async () => {
    if (!canManageSensors || !onSaveSensorSettings) {
      return;
    }

    setSensorConfigError(null);

    try {
      const latestConfig = (onLoadSensorSettings ? await onLoadSensorSettings() : null) ?? effectiveSensorConfig;
      setSensorConfigDraft(latestConfig);
      setIsSensorModalOpen(true);
    } catch (error) {
      console.error('Error loading sensor settings:', error);
      setSensorConfigError('Gagal memuat pengaturan sensor.');
    }
  }, [canManageSensors, onLoadSensorSettings, onSaveSensorSettings, effectiveSensorConfig]);

  const handleCloseSensorModal = useCallback(() => {
    setIsSensorModalOpen(false);
    setSensorConfigError(null);
  }, []);

  const handleToggleSensor = useCallback(
    (key: SensorKey) => {
      setSensorConfigDraft(prev => {
        const base = prev ?? effectiveSensorConfig;
        return { ...base, [key]: !base[key] };
      });
    },
    [effectiveSensorConfig]
  );

  const handleSaveSensors = useCallback(async () => {
    if (!sensorConfigDraft || !onSaveSensorSettings) {
      return;
    }

    setIsSavingSensors(true);
    setSensorConfigError(null);

    try {
      await onSaveSensorSettings(sensorConfigDraft);
      setIsSensorModalOpen(false);
    } catch (error) {
      console.error('Error saving sensor settings:', error);
      setSensorConfigError('Gagal menyimpan pengaturan sensor.');
    } finally {
      setIsSavingSensors(false);
    }
  }, [sensorConfigDraft, onSaveSensorSettings]);

  const soapEnabled = hasEnabledSoap(effectiveSensorConfig);
  const tissueEnabled = hasEnabledTissue(effectiveSensorConfig);
  const activeSensorConfig = sensorConfigDraft ?? effectiveSensorConfig;

  const renderSensorCard = useCallback(
    (enabled: boolean, card: ReactNode, title: string) =>
      enabled ? (
        card
      ) : (
        <div className="sensor-card sensor-card--disabled">
          <div className="sensor-card__title-row">
            <h3>{title}</h3>
          </div>
          <p className="sensor-card__disabled-label">Sensor dinonaktifkan</p>
        </div>
      ),
    []
  );

  const header = (
    <div className="device-header">
        <div className="device-header__title">
          <h2>{effectiveDisplayName}</h2>
          {canRename && onRename ? (
            <button type="button" className="renameButton" onClick={handleRenameClick}>
              Ganti Nama
            </button>
          ) : null}
          {canManageSensors && onSaveSensorSettings ? (
            <button type="button" className="renameButton" onClick={handleManageSensorsClick}>
              Kelola Sensor
            </button>
          ) : null}
        </div>
        {realtime ? (
          <StatusBadge status={realtime.espStatus} label={`ESP ${realtime.espStatusText}`} />
        ) : null}
      </div>
  );

  return (
    <section className="device-section-container" data-device-id={deviceId}>
      {realtime ? (
          <div className="realtime-content">
            {header}
            <div className="top-row">
              {renderSensorCard(
                effectiveSensorConfig.amonia,
                (
                  <SensorCard
                    title="Amonia"
                    icon={<FaWind />}
                    iconClassName="sensor-card__icon--ammonia"
                    severity={getAmoniaSeverity(realtime.amonia.score)}
                    stats={[
                      { label: 'NH₃', value: formatPpm(realtime.amonia.ppm) },
                      { label: 'Skor Bau', value: formatScore(realtime.amonia.score) }
                    ]}
                    details={[`Interpretasi: ${realtime.amonia.status || 'Data tidak ada'}`]}
                  />
                ),
                'Amonia'
              )}
              {renderSensorCard(
                effectiveSensorConfig.water,
                (
                  <SensorCard
                    title="Genangan Air"
                    icon={<FaWater />}
                    iconClassName="sensor-card__icon--water"
                    severity={realtime.water.status.toLowerCase().includes('terdeteksi') ? 'critical' : 'normal'}
                    details={[`Status: ${realtime.water.status || 'Data tidak ada'}`]}
                  />
                ),
                'Genangan Air'
              )}
              {renderSensorCard(
                tissueEnabled,
                (
                  <SensorCard
                    title={`Tisu (${realtime.tissueSummary.cardLabel})`}
                    icon={<FaToiletPaper />}
                    iconClassName="sensor-card__icon--tissue"
                    severity={realtime.tissueSummary.critical ? 'critical' : 'normal'}
                    stats={[{ label: 'Slot', value: realtime.tissueSummary.cardLabel }]}
                    details={realtime.tissueSummary.details}
                  />
                ),
                'Tisu'
              )}
              {renderSensorCard(
                soapEnabled,
                (
                  <SensorCard
                    title={`Sabun (${realtime.soapSummary.cardLabel})`}
                    icon={<FaPumpSoap />}
                    iconClassName="sensor-card__icon--soap"
                    severity={realtime.soapSummary.critical ? 'critical' : 'normal'}
                    stats={[{ label: 'Dispenser', value: realtime.soapSummary.cardLabel }]}
                    details={realtime.soapSummary.details}
                  />
                ),
                'Sabun'
              )}
            </div>
          </div>
        ) : (
          <div className="realtime-content">
            {header}
            <p>Data real-time belum tersedia.</p>
          </div>
        )}

        {isSensorModalOpen && (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal__header">
                <h3>Pengaturan Sensor</h3>
                <button type="button" className="modal__close" onClick={handleCloseSensorModal}>
                  ✕
                </button>
              </div>
              <div className="modal__body">
                {SENSOR_KEYS.map(key => (
                  <label key={key} className="sensor-toggle">
                    <input
                      type="checkbox"
                      checked={activeSensorConfig[key]}
                      onChange={() => handleToggleSensor(key)}
                    />
                    <span>{getSensorLabel(key)}</span>
                  </label>
                ))}
                {sensorConfigError ? <p className="modal__error">{sensorConfigError}</p> : null}
              </div>
              <div className="modal__footer">
                <button
                  type="button"
                  className="renameButton"
                  onClick={handleSaveSensors}
                  disabled={isSavingSensors}
                >
                  {isSavingSensors ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={handleCloseSensorModal}
                  disabled={isSavingSensors}
                >
                  Batal
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="history-toggle-bar">
          <button
            type="button"
          className={`drawer-toggle ${isHistoryOpen ? 'open' : ''}`}
          onClick={toggleHistoryDrawer}
        >
          {isHistoryOpen ? 'Sembunyikan Riwayat' : 'Riwayat & Unduhan'}
        </button>
      </div>
      <div className={`history-drawer ${isHistoryOpen ? 'open' : ''}`}>
        <div className="history-drawer__panel">
          <div className="history-drawer__actions">
            <h2>Data Historis - {effectiveDisplayName}</h2>
            <button className="downloadButton" onClick={onDownloadHistory}>
              Unduh Data Lengkap
            </button>
          </div>
          <div className="history-drawer__table table-container">
            <table className="historyTable">
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
                {historyRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Belum ada data historis.</td>
                  </tr>
                ) : (
                  historyRows.map((snapshot, index) => {
                    try {
                      const summary = interpretSnapshot(snapshot, effectiveSensorConfig);
                      return (
                        <tr key={`${snapshot.timestamp}-${index}`}>
                          <td>{new Date(snapshot.timestamp).toLocaleString()}</td>
                          <td>{formatPpm(summary.amonia.ppm)}</td>
                          <td>{formatScore(summary.amonia.score)}</td>
                          <td>{formatWaterStatus(summary.water)}</td>
                          <td>{summary.soapSummary.historyLabel}</td>
                          <td>{summary.tissueSummary.historyLabel}</td>
                        </tr>
                      );
                    } catch (error) {
                      console.error('Error parsing historical data row:', error);
                      return (
                        <tr key={`${snapshot.timestamp}-${index}`}>
                          <td colSpan={6}>Data tidak valid atau rusak.</td>
                        </tr>
                      );
                    }
                  })
                )}
              </tbody>
            </table>
          </div>
          {hasMoreHistory && onLoadMoreHistory ? (
            <div className="history-drawer__footer">
              <button
                type="button"
                className="loadMoreButton"
                onClick={onLoadMoreHistory}
                disabled={isLoadingHistory}
              >
                {isLoadingHistory ? 'Memuat...' : 'Muat lebih banyak'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function interpretSnapshot(snapshot: LatestDeviceSnapshot, sensorConfig: DeviceSensorConfig = DEFAULT_SENSOR_CONFIG) {
  const amonia = safeParse<AmmoniaSensorData>(snapshot.amonia, DEFAULT_AMMONIA);
  const water = safeParse<WaterSensorData>(snapshot.waterPuddleJson, DEFAULT_WATER);
  const soap = safeParse<SoapSensorData>(snapshot.sabun, DEFAULT_SOAP);
  const tissue = safeParse<TissueSensorData>(snapshot.tisu, DEFAULT_TISSUE);

  return {
    amonia,
    water,
    soapSummary: aggregateSoapStatus(soap, sensorConfig),
    tissueSummary: aggregateTissueStatus(tissue, sensorConfig)
  };
}

function formatDeviceDisplayId(deviceId: string): string {
  return deviceId.toUpperCase().replace(/-/g, ' ');
}

function aggregateSoapStatus(soap: SoapSensorData, sensorConfig: DeviceSensorConfig): AggregatedSoapStatus {
  const enabledSlots = [
    { label: 'S1', slot: soap.sabun1, enabled: sensorConfig.sabun1 },
    { label: 'S2', slot: soap.sabun2, enabled: sensorConfig.sabun2 },
    { label: 'S3', slot: soap.sabun3, enabled: sensorConfig.sabun3 }
  ].filter(entry => entry.enabled);

  if (enabledSlots.length === 0) {
    return {
      cardLabel: 'Dinonaktifkan',
      historyLabel: 'Dinonaktifkan',
      critical: false,
      details: ['Semua sensor sabun dinonaktifkan']
    };
  }

  const statuses = enabledSlots.map(entry => getSafeStatus(entry.slot.status));
  const distances = enabledSlots.map(entry => entry.slot.distance);
  const allUnavailable = distances.every(distance => typeof distance === 'number' && distance === -1);
  const critical = statuses.includes('Habis');

  const cardLabel = allUnavailable ? 'Data tidak ada' : critical ? 'Hampir Habis!' : 'Aman';
  const historyLabel = allUnavailable ? 'Data tidak ada' : critical ? 'Hampir Habis' : 'Aman';

  const details = enabledSlots.map(entry => `${entry.label}: ${formatDistance(entry.slot.distance)}`);

  return { cardLabel, historyLabel, critical, details };
}

function aggregateTissueStatus(tissue: TissueSensorData, sensorConfig: DeviceSensorConfig): AggregatedTissueStatus {
  const slots = [
    { label: 'T1', slot: tissue.tisu1, enabled: sensorConfig.tisu1 },
    { label: 'T2', slot: tissue.tisu2, enabled: sensorConfig.tisu2 }
  ].filter(entry => entry.enabled);

  if (slots.length === 0) {
    return {
      cardLabel: 'Dinonaktifkan',
      historyLabel: 'Dinonaktifkan',
      critical: false,
      details: ['Semua sensor tisu dinonaktifkan']
    };
  }

  const statuses = slots.map(entry => getSafeStatus(entry.slot.status));
  const unavailable = statuses.every(status => status === 'Data tidak ada');
  const critical = statuses.includes('Habis');

  const cardLabel = unavailable ? 'Data tidak ada' : critical ? 'Habis!' : 'Tersedia';
  const historyLabel = unavailable ? 'Data tidak ada' : critical ? 'Habis' : 'Tersedia';
  const details = slots.map(entry => `${entry.label}: ${getSafeStatus(entry.slot.status)} (${formatDigital(entry.slot.digital)})`);

  return { cardLabel, historyLabel, critical, details };
}

function hasEnabledSoap(config: DeviceSensorConfig): boolean {
  return config.sabun1 || config.sabun2 || config.sabun3;
}

function hasEnabledTissue(config: DeviceSensorConfig): boolean {
  return config.tisu1 || config.tisu2;
}

function safeParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error('Failed to parse sensor payload:', error);
    return fallback;
  }
}

function getSafeStatus(status: string | undefined): string {
  if (!status || status === 'N/A') {
    return 'Data tidak ada';
  }
  return status;
}

function getSensorLabel(key: SensorKey): string {
  const labels: Record<SensorKey, string> = {
    amonia: 'Amonia',
    water: 'Genangan Air',
    sabun1: 'Sabun 1',
    sabun2: 'Sabun 2',
    sabun3: 'Sabun 3',
    tisu1: 'Tisu 1',
    tisu2: 'Tisu 2'
  };

  return labels[key] ?? key;
}

function formatDistance(distance: number | undefined): string {
  if (typeof distance === 'number' && Number.isFinite(distance) && distance !== -1) {
    return `${distance} cm`;
  }
  return 'Data tidak ada';
}

function formatDigital(value: number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value) && value !== -1) {
    return String(value);
  }
  return 'Data tidak ada';
}

function formatPpm(ppm: number | undefined): string {
  if (typeof ppm === 'number' && Number.isFinite(ppm)) {
    return `${ppm.toFixed(3)} ppm`;
  }
  return 'Data tidak ada';
}

function formatScore(score: number | undefined): string {
  if (typeof score === 'number' && Number.isFinite(score)) {
    return `${score}/3`;
  }
  return 'Data tidak ada';
}

function formatWaterStatus(water: WaterSensorData): string {
  const statusText = water.status || 'Data tidak ada';
  return statusText;
}

function getAmoniaSeverity(score: number | undefined): SensorSeverity {
  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score >= 4) {
      return 'critical';
    }
    if (score >= 3) {
      return 'warning';
    }
  }
  return 'normal';
}

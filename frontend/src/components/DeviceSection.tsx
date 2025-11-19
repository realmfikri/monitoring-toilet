import { ReactNode, useCallback, useMemo, useState } from 'react';
import { FaPumpSoap, FaToiletPaper, FaWater, FaWind } from 'react-icons/fa6';
import {
  AmmoniaSensorData,
  LatestDeviceSnapshot,
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
  stats: SensorCardStat[];
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
  stats,
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
    <div className="sensor-card__stats">
      {stats.map(stat => (
        <div className="sensor-card__stat" key={stat.label}>
          <span className="sensor-card__value">{stat.value}</span>
          <span className="sensor-card__label">{stat.label.toUpperCase()}</span>
        </div>
      ))}
    </div>
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
  onLoadMoreHistory,
  hasMoreHistory = false,
  isLoadingHistory = false
}: DeviceSectionProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const formattedDeviceId = formatDeviceDisplayId(deviceId);
  const effectiveDisplayName = (displayNameProp ?? data?.displayName ?? null) ?? formattedDeviceId;

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
      soapSummary: aggregateSoapStatus(soap),
      tissueSummary: aggregateTissueStatus(tissue),
      timestamp: new Date(data.timestamp).toLocaleString(),
      espStatusText: data.espStatus === 'active' ? 'Aktif' : 'Tidak Aktif',
      espStatus: data.espStatus === 'active' ? 'active' : 'inactive'
    };
  }, [data]);

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

  const header = (
    <div className="device-header">
      <div className="device-header__title">
        <h2>{effectiveDisplayName}</h2>
        {canRename && onRename ? (
          <button type="button" className="renameButton" onClick={handleRenameClick}>
            Ganti Nama
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
          <SensorCard
            title="Genangan Air"
            icon={<FaWater />}
            iconClassName="sensor-card__icon--water"
            severity={realtime.water.status.toLowerCase().includes('terdeteksi') ? 'critical' : 'normal'}
            stats={[{ label: 'Nilai Digital', value: formatDigital(realtime.water.digital) }]}
            details={[`Status: ${realtime.water.status || 'Data tidak ada'}`]}
          />
          <SensorCard
            title={`Tisu (${realtime.tissueSummary.cardLabel})`}
            icon={<FaToiletPaper />}
            iconClassName="sensor-card__icon--tissue"
            severity={realtime.tissueSummary.critical ? 'critical' : 'normal'}
            stats={[{ label: 'Slot', value: realtime.tissueSummary.cardLabel }]}
            details={realtime.tissueSummary.details}
          />
          <SensorCard
            title={`Sabun (${realtime.soapSummary.cardLabel})`}
            icon={<FaPumpSoap />}
            iconClassName="sensor-card__icon--soap"
            severity={realtime.soapSummary.critical ? 'critical' : 'normal'}
            stats={[{ label: 'Dispenser', value: realtime.soapSummary.cardLabel }]}
            details={realtime.soapSummary.details}
            />
          </div>
        </div>
      ) : (
        <div className="realtime-content">
          {header}
          <p>Data real-time belum tersedia.</p>
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
                      const summary = interpretSnapshot(snapshot);
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

function interpretSnapshot(snapshot: LatestDeviceSnapshot) {
  const amonia = safeParse<AmmoniaSensorData>(snapshot.amonia, DEFAULT_AMMONIA);
  const water = safeParse<WaterSensorData>(snapshot.waterPuddleJson, DEFAULT_WATER);
  const soap = safeParse<SoapSensorData>(snapshot.sabun, DEFAULT_SOAP);
  const tissue = safeParse<TissueSensorData>(snapshot.tisu, DEFAULT_TISSUE);

  return {
    amonia,
    water,
    soapSummary: aggregateSoapStatus(soap),
    tissueSummary: aggregateTissueStatus(tissue)
  };
}

function formatDeviceDisplayId(deviceId: string): string {
  return deviceId.toUpperCase().replace(/-/g, ' ');
}

function aggregateSoapStatus(soap: SoapSensorData): AggregatedSoapStatus {
  const statuses = [soap.sabun1.status, soap.sabun2.status, soap.sabun3.status].map(getSafeStatus);
  const distances = [soap.sabun1.distance, soap.sabun2.distance, soap.sabun3.distance];
  const allUnavailable = distances.every(distance => typeof distance === 'number' && distance === -1);
  const critical = statuses.includes('Habis');

  const cardLabel = allUnavailable ? 'Data tidak ada' : critical ? 'Hampir Habis!' : 'Aman';
  const historyLabel = allUnavailable ? 'Data tidak ada' : critical ? 'Hampir Habis' : 'Aman';

  const details = [
    `S1: ${formatDistance(soap.sabun1.distance)}`,
    `S2: ${formatDistance(soap.sabun2.distance)}`,
    `S3: ${formatDistance(soap.sabun3.distance)}`
  ];

  return { cardLabel, historyLabel, critical, details };
}

function aggregateTissueStatus(tissue: TissueSensorData): AggregatedTissueStatus {
  const slots = [tissue.tisu1, tissue.tisu2];
  const statuses = slots.map(slot => getSafeStatus(slot.status));
  const unavailable = statuses.every(status => status === 'Data tidak ada');
  const critical = statuses.includes('Habis');

  const cardLabel = unavailable ? 'Data tidak ada' : critical ? 'Habis!' : 'Tersedia';
  const historyLabel = unavailable ? 'Data tidak ada' : critical ? 'Habis' : 'Tersedia';
  const details = slots.map((slot, index) => `T${index + 1}: ${statuses[index]} (${formatDigital(slot.digital)})`);

  return { cardLabel, historyLabel, critical, details };
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
    return `${ppm} ppm`;
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
  const digitalText = formatDigital(water.digital);
  return digitalText === 'Data tidak ada' ? statusText : `${statusText} (${digitalText})`;
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

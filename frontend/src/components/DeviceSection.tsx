import { useCallback, useMemo } from 'react';
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
  onRename
}: DeviceSectionProps) {
  const formattedDeviceId = formatDeviceDisplayId(deviceId);
  const effectiveDisplayName = (displayNameProp ?? data?.displayName ?? null) ?? formattedDeviceId;

  const realtime = useMemo(() => {
    if (!data) {
      return null;
    }
    const amonia = safeParse<AmmoniaSensorData>(data.amonia, DEFAULT_AMMONIA);
    const water = safeParse<WaterSensorData>(data.air, DEFAULT_WATER);
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
      espStatusColor: data.espStatus === 'active' ? 'green' : 'red'
    };
  }, [data]);

  const recentHistory = useMemo(() => history.slice(-24).reverse(), [history]);

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

  const header = (
    <div className="device-header">
      <h2>{effectiveDisplayName}</h2>
      {canRename && onRename ? (
        <button type="button" className="renameButton" onClick={handleRenameClick}>
          Ganti Nama
        </button>
      ) : null}
    </div>
  );

  return (
    <section className="device-section-container" data-device-id={deviceId}>
      {realtime ? (
        <div className="realtime-content">
          {header}
          <h3 style={{ color: realtime.espStatusColor }}>Status ESP: {realtime.espStatusText}</h3>
          <div className="top-row">
            <div className="card" style={{ backgroundColor: realtime.amonia.score >= 4 ? '#ffdddd' : '#f8f9fa' }}>
              <h2>Amonia</h2>
              <p>
                <strong>NH₃:</strong> {formatPpm(realtime.amonia.ppm)}
              </p>
              <p>
                <strong>Skor Bau:</strong> {formatScore(realtime.amonia.score)}
              </p>
              <p>
                <strong>Interpretasi:</strong> {realtime.amonia.status || 'Data tidak ada'}
              </p>
            </div>
            <div
              className="card"
              style={{ backgroundColor: realtime.water.status.toLowerCase().includes('terdeteksi') ? '#ffdddd' : '#f8f9fa' }}
            >
              <h2>Genangan Air</h2>
              <p>
                <strong>Nilai Digital:</strong> {formatDigital(realtime.water.digital)}
              </p>
              <p>
                <strong>Status:</strong> {realtime.water.status || 'Data tidak ada'}
              </p>
            </div>
            <div className="card" style={{ backgroundColor: realtime.tissueSummary.critical ? '#ffdddd' : '#f8f9fa' }}>
              <h2>Tisu (Status Gabungan: {realtime.tissueSummary.cardLabel})</h2>
              {realtime.tissueSummary.details.map(detail => (
                <p key={detail}>{detail}</p>
              ))}
            </div>
            <div className="card" style={{ backgroundColor: realtime.soapSummary.critical ? '#ffdddd' : '#f8f9fa' }}>
              <h2>Sabun (Status Gabungan: {realtime.soapSummary.cardLabel})</h2>
              {realtime.soapSummary.details.map(detail => (
                <p key={detail}>{detail}</p>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="realtime-content">
          {header}
          <p>Data real-time belum tersedia.</p>
        </div>
      )}

      <div className="table-container">
        <h2>Data Historis - {effectiveDisplayName}</h2>
        <button className="downloadButton" onClick={onDownloadHistory}>
          Unduh Data Lengkap
        </button>
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
            {recentHistory.length === 0 ? (
              <tr>
                <td colSpan={6}>Belum ada data historis.</td>
              </tr>
            ) : (
              recentHistory.map((snapshot, index) => {
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
    </section>
  );
}

function interpretSnapshot(snapshot: LatestDeviceSnapshot) {
  const amonia = safeParse<AmmoniaSensorData>(snapshot.amonia, DEFAULT_AMMONIA);
  const water = safeParse<WaterSensorData>(snapshot.air, DEFAULT_WATER);
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

export interface AmmoniaLimitsConfig {
  goodMax: number;
  warningMax: number;
}

export interface Config {
  historicalIntervalMinutes: number;
  maxReminders: number;
  reminderIntervalMinutes: number;
}

export type EspStatus = 'active' | 'inactive';

export interface LatestDeviceSnapshot {
  deviceID: string;
  displayName: string | null;
  amonia: string;
  waterPuddleJson: string;
  sabun: string;
  tisu: string;
  timestamp: string;
  espStatus: EspStatus;
  lastActive: number;
  sensorConfig?: DeviceSensorConfig;
}

export interface AmmoniaSensorData {
  ppm: number | null;
  score: number | null;
  status: string;
}

export interface WaterSensorData {
  digital: number;
  status: string;
}

export interface SoapSensorSlot {
  distance: number;
  status: string;
}

export interface SoapSensorData {
  sabun1: SoapSensorSlot;
  sabun2: SoapSensorSlot;
  sabun3: SoapSensorSlot;
}

export interface TissueSensorData {
  tisu1: TissueSensorSlot;
  tisu2: TissueSensorSlot;
}

export interface TissueSensorSlot {
  digital: number;
  status: string;
}

export type LatestDataMap = Record<string, LatestDeviceSnapshot>;
export type HistoryDataMap = Record<string, LatestDeviceSnapshot[]>;

export const SENSOR_KEYS = ['amonia', 'water', 'sabun1', 'sabun2', 'sabun3', 'tisu1', 'tisu2'] as const;
export type SensorKey = (typeof SENSOR_KEYS)[number];
export type DeviceSensorConfig = Record<SensorKey, boolean>;
export const DEFAULT_SENSOR_CONFIG: DeviceSensorConfig = {
  amonia: true,
  water: true,
  sabun1: true,
  sabun2: true,
  sabun3: true,
  tisu1: true,
  tisu2: true
};

export interface DeviceSettingsResponse {
  deviceId: string;
  sensorConfig: DeviceSensorConfig;
}

export interface DeviceHistoryResponse {
  deviceId: string;
  entries: LatestDeviceSnapshot[];
  nextCursor: string | null;
  hasMore: boolean;
}

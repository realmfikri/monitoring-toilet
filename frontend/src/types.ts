export interface AmmoniaLimitsConfig {
  goodMax: number;
  warningMax: number;
}

export interface Config {
  historicalIntervalMinutes: number;
  maxReminders: number;
  reminderIntervalMinutes: number;
  soapEmptyThresholdCm: number;
  tissueEmptyValue: number;
  ammoniaLimits: AmmoniaLimitsConfig;
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

export interface DeviceHistoryResponse {
  deviceId: string;
  entries: LatestDeviceSnapshot[];
  nextCursor: string | null;
  hasMore: boolean;
}

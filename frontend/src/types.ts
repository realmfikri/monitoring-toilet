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
  air: string;
  sabun: string;
  tisu: string;
  timestamp: string;
  espStatus: EspStatus;
  lastActive: number;
}

export interface AmmoniaSensorData {
  ppm: number;
  score: number;
  status: string;
}

export interface WaterSensorData {
  status: string;
}

export interface SensorStatusSlot {
  distance?: number;
  status: string;
}

export interface SoapSensorData {
  sabun1: SensorStatusSlot;
  sabun2: SensorStatusSlot;
  sabun3: SensorStatusSlot;
}

export interface TissueSensorData {
  tisu1: SensorStatusSlot;
  tisu2: SensorStatusSlot;
}

export type LatestDataMap = Record<string, LatestDeviceSnapshot>;
export type HistoryDataMap = Record<string, LatestDeviceSnapshot[]>;

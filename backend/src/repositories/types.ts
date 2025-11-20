export interface SnapshotRecord {
  deviceId: string;
  displayName: string | null;
  amonia: string;
  waterPuddleJson: string;
  sabun: string;
  tisu: string;
  timestamp: Date;
  espStatus: PersistedEspStatus;
  lastActive: Date;
}

export type PersistedEspStatus = 'active' | 'inactive';

export interface ConfigOverrideRecord {
  historicalIntervalMinutes: number;
  maxReminders: number;
  reminderIntervalMinutes: number;
}

export interface SubscriberRecord {
  chatId: string;
  lantai: number;
}

export type SensorKey = 'amonia' | 'water' | 'sabun1' | 'sabun2' | 'sabun3' | 'tisu1' | 'tisu2';
export type DeviceSensorConfig = Record<SensorKey, boolean>;

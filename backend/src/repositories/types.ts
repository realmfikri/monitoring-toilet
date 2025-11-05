export interface SnapshotRecord {
  deviceId: string;
  amonia: string;
  air: string;
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

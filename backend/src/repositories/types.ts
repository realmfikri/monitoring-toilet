export interface SnapshotRecord {
  deviceId: string;
  displayName: string | null;
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
  soapEmptyThresholdCm: number;
  tissueEmptyValue: number;
  ammoniaLimits: {
    goodMax: number;
    warningMax: number;
  };
}

export interface SubscriberRecord {
  chatId: string;
  lantai: number;
}

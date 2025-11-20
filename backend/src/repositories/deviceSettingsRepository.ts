import { PrismaClient, Prisma } from '@prisma/client';

import { DeviceSensorConfig } from './types';

export class DeviceSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(deviceId: string): Promise<DeviceSensorConfig | null> {
    const record = await this.prisma.deviceSettings.findUnique({ where: { deviceId } });
    if (!record) {
      return null;
    }

    if (typeof record.sensorConfig !== 'object' || record.sensorConfig === null || Array.isArray(record.sensorConfig)) {
      return null;
    }

    return record.sensorConfig as DeviceSensorConfig;
  }

  async upsert(deviceId: string, sensorConfig: DeviceSensorConfig): Promise<void> {
    const payload: Prisma.JsonObject = sensorConfig;
    await this.prisma.deviceSettings.upsert({
      where: { deviceId },
      update: { sensorConfig: payload },
      create: { deviceId, sensorConfig: payload }
    });
  }

  async list(): Promise<Record<string, DeviceSensorConfig>> {
    const rows = await this.prisma.deviceSettings.findMany();
    const settings: Record<string, DeviceSensorConfig> = {};

    rows.forEach(row => {
      if (typeof row.sensorConfig === 'object' && row.sensorConfig !== null && !Array.isArray(row.sensorConfig)) {
        settings[row.deviceId] = row.sensorConfig as DeviceSensorConfig;
      }
    });

    return settings;
  }
}

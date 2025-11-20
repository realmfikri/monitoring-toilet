import { PrismaClient, Prisma } from '@prisma/client';

import { ConfigOverrideRecord } from './types';

const CONFIG_KEY = 'global';

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

export class ConfigOverrideRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<ConfigOverrideRecord | null> {
    const row = await this.prisma.configOverride.findUnique({ where: { key: CONFIG_KEY } });
    if (!row) {
      return null;
    }

    if (typeof row.value !== 'object' || row.value === null || Array.isArray(row.value)) {
      return null;
    }

    const raw = row.value as Record<string, unknown>;
    const historical = parseNumber(raw.historicalIntervalMinutes);
    const reminders = parseNumber(raw.maxReminders);
    const reminderInterval = parseNumber(raw.reminderIntervalMinutes);
    if (historical === null || reminders === null || reminderInterval === null) {
      return null;
    }

    return {
      historicalIntervalMinutes: historical,
      maxReminders: reminders,
      reminderIntervalMinutes: reminderInterval
    };
  }

  async set(config: ConfigOverrideRecord): Promise<void> {
    const serializedConfig: Prisma.JsonObject = {
      historicalIntervalMinutes: config.historicalIntervalMinutes,
      maxReminders: config.maxReminders,
      reminderIntervalMinutes: config.reminderIntervalMinutes
    };

    await this.prisma.configOverride.upsert({
      where: { key: CONFIG_KEY },
      update: { value: serializedConfig },
      create: {
        key: CONFIG_KEY,
        value: serializedConfig
      }
    });
  }
}

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

const parseAmmoniaLimits = (
  value: unknown
): ConfigOverrideRecord['ammoniaLimits'] | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const goodMax = parseNumber(raw.goodMax);
  const warningMax = parseNumber(raw.warningMax);

  if (goodMax === null || warningMax === null || warningMax <= goodMax) {
    return null;
  }

  return {
    goodMax,
    warningMax
  };
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
    const soapEmptyThreshold = parseNumber(raw.soapEmptyThresholdCm);
    const tissueEmptyValue = parseNumber(raw.tissueEmptyValue);
    const ammoniaLimits = parseAmmoniaLimits(raw.ammoniaLimits);

    if (
      historical === null ||
      reminders === null ||
      reminderInterval === null ||
      soapEmptyThreshold === null ||
      tissueEmptyValue === null ||
      !Number.isInteger(tissueEmptyValue) ||
      (tissueEmptyValue !== 0 && tissueEmptyValue !== 1) ||
      ammoniaLimits === null
    ) {
      return null;
    }

    return {
      historicalIntervalMinutes: historical,
      maxReminders: reminders,
      reminderIntervalMinutes: reminderInterval,
      soapEmptyThresholdCm: soapEmptyThreshold,
      tissueEmptyValue,
      ammoniaLimits
    };
  }

  async set(config: ConfigOverrideRecord): Promise<void> {
    const serializedConfig: Prisma.JsonObject = {
      historicalIntervalMinutes: config.historicalIntervalMinutes,
      maxReminders: config.maxReminders,
      reminderIntervalMinutes: config.reminderIntervalMinutes,
      soapEmptyThresholdCm: config.soapEmptyThresholdCm,
      tissueEmptyValue: config.tissueEmptyValue,
      ammoniaLimits: config.ammoniaLimits
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

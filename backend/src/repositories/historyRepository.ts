import { PrismaClient } from '@prisma/client';

import { SnapshotRecord } from './types';

const defaultString = (value: string | null): string => value ?? '';

const mapRowToSnapshot = (row: {
  deviceId: string;
  displayName: string | null;
  amonia: string | null;
  air: string | null;
  sabun: string | null;
  tisu: string | null;
  timestamp: Date;
  espStatus: SnapshotRecord['espStatus'];
  lastActive: Date;
}): SnapshotRecord => ({
  deviceId: row.deviceId,
  displayName: row.displayName,
  amonia: defaultString(row.amonia),
  air: defaultString(row.air),
  sabun: defaultString(row.sabun),
  tisu: defaultString(row.tisu),
  timestamp: row.timestamp,
  espStatus: row.espStatus,
  lastActive: row.lastActive
});

export class HistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(snapshot: SnapshotRecord): Promise<void> {
    await this.prisma.deviceHistory.create({
      data: {
        deviceId: snapshot.deviceId,
        displayName: snapshot.displayName,
        amonia: snapshot.amonia,
        air: snapshot.air,
        sabun: snapshot.sabun,
        tisu: snapshot.tisu,
        timestamp: snapshot.timestamp,
        espStatus: snapshot.espStatus,
        lastActive: snapshot.lastActive
      }
    });
  }

  async findByDevice(deviceId: string): Promise<SnapshotRecord[]> {
    const rows = (await this.prisma.deviceHistory.findMany({
      where: { deviceId },
      orderBy: { timestamp: 'asc' }
    })) as Array<{
      deviceId: string;
      displayName: string | null;
      amonia: string | null;
      air: string | null;
      sabun: string | null;
      tisu: string | null;
      timestamp: Date;
      espStatus: SnapshotRecord['espStatus'];
      lastActive: Date;
    }>;
    return rows.map(mapRowToSnapshot);
  }

  async findAllGrouped(): Promise<Map<string, SnapshotRecord[]>> {
    const rows = (await this.prisma.deviceHistory.findMany({
      orderBy: [{ deviceId: 'asc' }, { timestamp: 'asc' }]
    })) as Array<{
      deviceId: string;
      displayName: string | null;
      amonia: string | null;
      air: string | null;
      sabun: string | null;
      tisu: string | null;
      timestamp: Date;
      espStatus: SnapshotRecord['espStatus'];
      lastActive: Date;
    }>;
    const grouped = new Map<string, SnapshotRecord[]>();
    for (const row of rows) {
      const snapshot = mapRowToSnapshot(row);
      if (!grouped.has(snapshot.deviceId)) {
        grouped.set(snapshot.deviceId, []);
      }
      grouped.get(snapshot.deviceId)!.push(snapshot);
    }
    return grouped;
  }

  async getLatestTimestamps(): Promise<Record<string, Date>> {
    const rows = await this.prisma.deviceHistory.groupBy({
      by: ['deviceId'] as const,
      _max: { timestamp: true }
    });

    const result: Record<string, Date> = {};
    for (const row of rows) {
      const timestamp = row._max?.timestamp;
      if (timestamp) {
        result[row.deviceId] = timestamp;
      }
    }
    return result;
  }
}

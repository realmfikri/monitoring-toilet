import { Prisma, PrismaClient } from '@prisma/client';

import { SnapshotRecord } from './types';

const defaultString = (value: string | null): string => value ?? '';

type HistoryRow = {
  id: bigint;
  deviceId: string;
  displayName: string | null;
  amonia: string | null;
  waterPuddleJson: string | null;
  sabun: string | null;
  tisu: string | null;
  timestamp: Date;
  espStatus: SnapshotRecord['espStatus'];
  lastActive: Date;
};

const mapRowToSnapshot = (row: HistoryRow): SnapshotRecord => ({
  deviceId: row.deviceId,
  displayName: row.displayName,
  amonia: defaultString(row.amonia),
  waterPuddleJson: defaultString(row.waterPuddleJson),
  sabun: defaultString(row.sabun),
  tisu: defaultString(row.tisu),
  timestamp: row.timestamp,
  espStatus: row.espStatus,
  lastActive: row.lastActive
});

export class HistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(snapshot: SnapshotRecord): Promise<void> {
    const data: Prisma.DeviceHistoryUncheckedCreateInput = {
      deviceId: snapshot.deviceId,
      displayName: snapshot.displayName ?? null,
      amonia: snapshot.amonia,
      waterPuddleJson: snapshot.waterPuddleJson,
      sabun: snapshot.sabun,
      tisu: snapshot.tisu,
      timestamp: snapshot.timestamp,
      espStatus: snapshot.espStatus,
      lastActive: snapshot.lastActive
    };

    await this.prisma.deviceHistory.create({ data });
  }

  async findByDevice(deviceId: string): Promise<SnapshotRecord[]> {
    const rows = await this.prisma.deviceHistory.findMany({
      where: { deviceId },
      orderBy: { timestamp: 'asc' },
      select: {
        id: true,
        deviceId: true,
        displayName: true,
        amonia: true,
        waterPuddleJson: true,
        sabun: true,
        tisu: true,
        timestamp: true,
        espStatus: true,
        lastActive: true
      }
    });
    return rows.map(mapRowToSnapshot);
  }

  async findPaginatedByDevice(
    deviceId: string,
    limit: number,
    cursor?: bigint
  ): Promise<{ entries: SnapshotRecord[]; nextCursor: bigint | null }> {
    const rows = await this.prisma.deviceHistory.findMany({
      where: {
        deviceId,
        ...(cursor ? { id: { lt: cursor } } : {})
      },
      orderBy: [
        { timestamp: 'desc' },
        { id: 'desc' }
      ],
      take: limit,
      select: {
        id: true,
        deviceId: true,
        displayName: true,
        amonia: true,
        waterPuddleJson: true,
        sabun: true,
        tisu: true,
        timestamp: true,
        espStatus: true,
        lastActive: true
      }
    });

    const entries = rows.map(mapRowToSnapshot);
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    return { entries, nextCursor };
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

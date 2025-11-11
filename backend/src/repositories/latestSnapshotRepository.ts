import { PrismaClient } from '@prisma/client';

import { PersistedEspStatus, SnapshotRecord } from './types';

const defaultString = (value: string | null): string => value ?? '';

export class LatestSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(snapshot: SnapshotRecord): Promise<void> {
    await this.prisma.deviceLatestSnapshot.upsert({
      where: { deviceId: snapshot.deviceId },
      update: {
        displayName: snapshot.displayName ?? null,
        amonia: snapshot.amonia,
        waterPuddleJson: snapshot.waterPuddleJson,
        sabun: snapshot.sabun,
        tisu: snapshot.tisu,
        timestamp: snapshot.timestamp,
        espStatus: snapshot.espStatus,
        lastActive: snapshot.lastActive
      },
      create: {
        deviceId: snapshot.deviceId,
        displayName: snapshot.displayName ?? null,
        amonia: snapshot.amonia,
        waterPuddleJson: snapshot.waterPuddleJson,
        sabun: snapshot.sabun,
        tisu: snapshot.tisu,
        timestamp: snapshot.timestamp,
        espStatus: snapshot.espStatus,
        lastActive: snapshot.lastActive
      }
    });
  }

  async updateStatus(deviceId: string, espStatus: PersistedEspStatus): Promise<void> {
    await this.prisma.deviceLatestSnapshot.update({
      where: { deviceId },
      data: { espStatus }
    });
  }

  async findAll(): Promise<SnapshotRecord[]> {
    const rows = await this.prisma.deviceLatestSnapshot.findMany({
      select: {
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

    return rows.map(row => ({
      deviceId: row.deviceId,
      displayName: row.displayName,
      amonia: defaultString(row.amonia),
      waterPuddleJson: defaultString(row.waterPuddleJson),
      sabun: defaultString(row.sabun),
      tisu: defaultString(row.tisu),
      timestamp: row.timestamp,
      espStatus: row.espStatus === 'inactive' ? 'inactive' : 'active',
      lastActive: row.lastActive
    }));
  }
}

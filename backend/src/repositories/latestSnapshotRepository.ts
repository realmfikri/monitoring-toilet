import { PrismaClient } from '@prisma/client';

import { PersistedEspStatus, SnapshotRecord } from './types';

const defaultString = (value: string | null): string => value ?? '';

export class LatestSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(snapshot: SnapshotRecord): Promise<void> {
    await this.prisma.deviceLatestSnapshot.upsert({
      where: { deviceId: snapshot.deviceId },
      update: {
        amonia: snapshot.amonia,
        air: snapshot.air,
        sabun: snapshot.sabun,
        tisu: snapshot.tisu,
        timestamp: snapshot.timestamp,
        espStatus: snapshot.espStatus,
        lastActive: snapshot.lastActive
      },
      create: {
        deviceId: snapshot.deviceId,
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

  async updateStatus(deviceId: string, espStatus: PersistedEspStatus): Promise<void> {
    await this.prisma.deviceLatestSnapshot.update({
      where: { deviceId },
      data: { espStatus }
    });
  }

  async findAll(): Promise<SnapshotRecord[]> {
    const rows = await this.prisma.deviceLatestSnapshot.findMany();
    const typedRows = rows as Array<{
      deviceId: string;
      amonia: string | null;
      air: string | null;
      sabun: string | null;
      tisu: string | null;
      timestamp: Date;
      espStatus: string;
      lastActive: Date;
    }>;

    return typedRows.map(row => ({
      deviceId: row.deviceId,
      amonia: defaultString(row.amonia),
      air: defaultString(row.air),
      sabun: defaultString(row.sabun),
      tisu: defaultString(row.tisu),
      timestamp: row.timestamp,
      espStatus: row.espStatus === 'inactive' ? 'inactive' : 'active',
      lastActive: row.lastActive
    }));
  }
}

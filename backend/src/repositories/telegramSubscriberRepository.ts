import { PrismaClient } from '@prisma/client';

import { SubscriberRecord } from './types';

export class TelegramSubscriberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<SubscriberRecord[]> {
    const rows = (await this.prisma.telegramSubscriber.findMany()) as Array<{ chatId: string; lantai: number }>;
    return rows.map(row => ({ chatId: row.chatId, lantai: row.lantai }));
  }

  async upsert(chatId: string, lantai: number): Promise<void> {
    await this.prisma.telegramSubscriber.upsert({
      where: { chatId },
      update: { lantai },
      create: { chatId, lantai }
    });
  }

  async delete(chatId: string): Promise<void> {
    try {
      await this.prisma.telegramSubscriber.delete({ where: { chatId } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2025') {
        throw error;
      }
    }
  }
}

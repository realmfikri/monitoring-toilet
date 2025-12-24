import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import bcrypt from 'bcrypt';
import cors from 'cors';
import type { CorsOptions } from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import type { JwtPayload, Secret, SignOptions } from 'jsonwebtoken';
import TelegramBot from 'node-telegram-bot-api';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import { z } from 'zod';

import { WebSocketServer, WebSocket } from 'ws';

import type { $Enums } from '@prisma/client';

import { appConfig, getConfiguredApiKeys, isAllowedOrigin, isValidApiKey } from './config';
import { prisma } from './database/prismaClient';
import { accessLogger, appLogger } from './logger';
import { ConfigOverrideRepository } from './repositories/configOverrideRepository';
import { DeviceSettingsRepository } from './repositories/deviceSettingsRepository';
import { HistoryRepository } from './repositories/historyRepository';
import { LatestSnapshotRepository } from './repositories/latestSnapshotRepository';
import { TelegramSubscriberRepository } from './repositories/telegramSubscriberRepository';
import type { DeviceSensorConfig, SensorKey, SnapshotRecord } from './repositories/types';

type UserRole = $Enums.UserRole;

interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      clientIp?: string;
      requestId: string;
      user?: AuthenticatedUser;
    }
  }
}

type EspStatus = 'active' | 'inactive';
type SoapStatus = 'safe' | 'pending' | 'critical';
type AlertType = 'accident_new' | 'accident_repeat' | 'recovery' | 'routine';

interface ConfigBase {
  historicalIntervalMinutes: number;
  maxReminders: number;
  reminderIntervalMinutes: number;
}

interface Config extends ConfigBase {
  historicalIntervalMs: number;
  reminderIntervalMs: number;
  maxAlertDurationMs: number;
}

type DeviceSensorConfigMap = Record<string, DeviceSensorConfig>;

interface PetugasAssignment {
  lantai: number;
}

const rawSensorPayloadSchema = z.object({
  deviceID: z.string().trim().min(1, 'deviceID is required'),
  amonia: z.unknown().optional(),
  waterPuddleJson: z.unknown().optional(),
  sabun: z.unknown().optional(),
  tisu: z.unknown().optional()
});

type RawSensorPayload = z.infer<typeof rawSensorPayloadSchema>;

interface LatestDeviceSnapshot {
  deviceID: string;
  displayName: string | null;
  amonia: string;
  waterPuddleJson: string;
  sabun: string;
  tisu: string;
  timestamp: string;
  espStatus: EspStatus;
  lastActive: number;
  sensorConfig?: DeviceSensorConfig;
}

interface DeviceStatus {
  isAlert: boolean;
  alertStartTime: number;
  lastAlertSentTime: number;
  isRecoverySent: boolean;
  soapStatusConfirmed: SoapStatus;
  soapPendingStartTime: number;
}

interface AmmoniaSensorData {
  ppm: number | null;
  score: number | null;
  status: string;
}

interface WaterSensorData {
  digital: number;
  status: string;
}

interface SoapSlot {
  distance: number;
  status: string;
}

interface SoapSensorData {
  sabun1: SoapSlot;
  sabun2: SoapSlot;
  sabun3: SoapSlot;
}

interface TissueSlot {
  digital: number;
  status: string;
}

interface TissueSensorData {
  tisu1: TissueSlot;
  tisu2: TissueSlot;
}

interface RawAmmoniaPayload {
  ppm: number | null;
}

interface RawWaterPayload {
  digital: number | null;
}

interface RawSoapSlotPayload {
  distance: number | null;
}

interface RawSoapPayload {
  sabun1: RawSoapSlotPayload;
  sabun2: RawSoapSlotPayload;
  sabun3: RawSoapSlotPayload;
}

interface RawTissueSlotPayload {
  digital: number | null;
}

interface RawTissuePayload {
  tisu1: RawTissueSlotPayload;
  tisu2: RawTissueSlotPayload;
}

interface NormalizedSensorPayload {
  deviceID: string;
  amonia: RawAmmoniaPayload;
  waterPuddleJson: RawWaterPayload;
  sabun: RawSoapPayload;
  tisu: RawTissuePayload;
}

interface ComputedSensorSnapshot {
  amonia: AmmoniaSensorData;
  waterPuddle: WaterSensorData;
  sabun: SoapSensorData;
  tisu: TissueSensorData;
}

const SENSOR_KEYS: SensorKey[] = ['amonia', 'water', 'sabun1', 'sabun2', 'sabun3', 'tisu1', 'tisu2'];
const DEFAULT_SENSOR_CONFIG: DeviceSensorConfig = {
  amonia: true,
  water: true,
  sabun1: true,
  sabun2: true,
  sabun3: true,
  tisu1: true,
  tisu2: true
};

const SOAP_EMPTY_THRESHOLD_CM = 10;
const TISSUE_EMPTY_VALUE = 0;
const AMMONIA_SCORE_INTERCEPT = -0.805;
const AMMONIA_SCORE_SLOPE = 1.989;
const AMMONIA_MIN_SCORE = 1;
const AMMONIA_MAX_SCORE = 3;

const SOAP_DEBOUNCE_MS = 5000;
const ESP_INACTIVE_THRESHOLD_MS = 30000;
const INACTIVITY_CHECK_INTERVAL_MS = 5000;

const latestSnapshotRepository = new LatestSnapshotRepository(prisma);
const WEBSOCKET_PING_INTERVAL_MS = 30000;
const historyRepository = new HistoryRepository(prisma);
const subscriberRepository = new TelegramSubscriberRepository(prisma);
const configRepository = new ConfigOverrideRepository(prisma);
const deviceSettingsRepository = new DeviceSettingsRepository(prisma);

const DEFAULT_CONFIG_BASE: ConfigBase = {
  historicalIntervalMinutes: 5,
  maxReminders: 3,
  reminderIntervalMinutes: 10
};

const DEFAULT_CONFIG = deriveConfig(DEFAULT_CONFIG_BASE);

let config: Config = DEFAULT_CONFIG;
let petugas: Record<string, PetugasAssignment> = {};
const deviceSensorSettings: DeviceSensorConfigMap = {};

interface DeviceMuteEntry {
  mutedUntil: number;
  lantai: number;
  setByName: string;
  setByChatId: string;
  reason: string;
}

interface PendingAlertAction {
  deviceID: string;
  lantai: number;
  chatId: string;
  messageId: number;
  sentAt: number;
  alertType: AlertType;
  text: string;
}

interface DeviceAcknowledgement {
  ackedBy: string;
  ackedByChatId: string;
  ackedAt: number;
  lantai: number;
  source: 'inline' | 'command';
}

const deviceMuteState = new Map<string, DeviceMuteEntry>();
const pendingAlertActions = new Map<string, PendingAlertAction>();
const deviceAcknowledgements = new Map<string, DeviceAcknowledgement>();

const latestData: Record<string, LatestDeviceSnapshot> = {};
const websocketClients = new Set<WebSocket>();
const lastHistoricalSaveTime: Record<string, number> = {};
const deviceStatuses: Record<string, DeviceStatus> = {};

const app = express();
const server = createServer(app);

setInterval(() => {
  markInactiveDevices().catch(error => {
    appLogger.warn({ err: error }, 'Failed to update inactive device statuses');
  });
}, INACTIVITY_CHECK_INTERVAL_MS);

function broadcastLatestSnapshot(snapshot: LatestDeviceSnapshot): void {
  if (websocketClients.size === 0) {
    return;
  }

  const message = JSON.stringify({ type: 'snapshot', payload: snapshot });
  websocketClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function updateLatestData(
  deviceID: string,
  updater: (previous: LatestDeviceSnapshot | undefined) => LatestDeviceSnapshot
): LatestDeviceSnapshot {
  const updated = updater(latestData[deviceID]);
  latestData[deviceID] = updated;
  broadcastLatestSnapshot(updated);
  return updated;
}

async function markInactiveDevices(now = Date.now()): Promise<void> {
  const updates: Promise<void>[] = [];

  Object.values(latestData).forEach(entry => {
    if (now - entry.lastActive > ESP_INACTIVE_THRESHOLD_MS && entry.espStatus !== 'inactive') {
      updateLatestData(entry.deviceID, previous => ({
        ...previous!,
        espStatus: 'inactive'
      }));
      updates.push(latestSnapshotRepository.updateStatus(entry.deviceID, 'inactive'));
    }
  });

  if (updates.length > 0) {
    const results = await Promise.allSettled(updates);
    results.forEach(result => {
      if (result.status === 'rejected') {
        appLogger.warn({ err: result.reason }, 'Failed to persist inactive status update');
      }
    });
  }
}

const configuredApiKeys = getConfiguredApiKeys();
const authSecret: Secret = appConfig.auth.secret;
const authTokenExpiration: NonNullable<SignOptions['expiresIn']> = appConfig.auth.tokenExpiration;
if (configuredApiKeys.length === 0) {
  appLogger.warn('No API keys configured. The /data endpoint will reject all submissions.');
} else {
  appLogger.info({ environment: appConfig.environment, apiKeys: configuredApiKeys.length }, 'API keys loaded');
}

app.set('trust proxy', appConfig.trustProxy);

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      if (appConfig.allowRequestsWithoutOrigin) {
        callback(null, true);
      } else {
        callback(new Error('Origin header is required.'));
      }
      return;
    }

    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed.`));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

const requestMetadataMiddleware: express.RequestHandler = (req, _res, next) => {
  const cfConnectingIpHeader = req.headers['cf-connecting-ip'];
  let clientIp: string | undefined;

  if (Array.isArray(cfConnectingIpHeader)) {
    clientIp = cfConnectingIpHeader[0];
  } else if (typeof cfConnectingIpHeader === 'string') {
    clientIp = cfConnectingIpHeader.split(',')[0]?.trim();
  }

  if (!clientIp && !appConfig.requireCloudflareAuth) {
    clientIp = req.ip;
  }

  if (clientIp) {
    req.clientIp = clientIp;
    req.headers['x-forwarded-for'] = clientIp;
  }

  next();
};

const httpLogger = pinoHttp<Request, Response>({
  logger: accessLogger,
  genReqId: request => {
    const reqWithContext = request as Request;
    const cfRayHeader = reqWithContext.headers['cf-ray'];
    const headerValue = Array.isArray(cfRayHeader) ? cfRayHeader[0] : cfRayHeader;
    const fromHeader = headerValue?.split(',')[0]?.trim();
    const requestId = fromHeader && fromHeader.length > 0 ? fromHeader : randomUUID();
    reqWithContext.requestId = requestId;
    return requestId;
  },
  customProps: (request, response) => {
    const reqWithContext = request as Request;
    const resWithContext = response as Response & { responseTime?: number };
    const latency =
      typeof resWithContext.responseTime === 'number' ? Number(resWithContext.responseTime.toFixed(3)) : undefined;
    return {
      requestId: reqWithContext.requestId,
      clientIp: reqWithContext.clientIp ?? reqWithContext.ip,
      deviceId: resWithContext.locals.deviceId,
      outcome: resWithContext.statusCode >= 500 ? 'error' : resWithContext.statusCode >= 400 ? 'rejected' : 'success',
      latencyMs: latency
    };
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) {
      return 'error';
    }
    if (res.statusCode >= 400) {
      return 'warn';
    }
    return 'info';
  },
  customSuccessMessage: req => `${req.method} ${req.url} completed`,
  customErrorMessage: req => `${req.method} ${req.url} errored`,
  wrapSerializers: true
});

app.use(requestMetadataMiddleware);
app.use(httpLogger);

const cloudflareAuthMiddleware: express.RequestHandler = (req, res, next) => {
  if (appConfig.requireCloudflareAuth && !req.clientIp) {
    req.log.warn({ requestId: req.requestId }, 'Rejected request without Cloudflare authentication');
    res.status(403).json({ error: 'Requests must pass through Cloudflare Authenticated Origin Pulls.' });
    return;
  }

  next();
};

app.use(cloudflareAuthMiddleware);

const requestRateLimiter = rateLimit({
  windowMs: appConfig.rateLimit.windowMs,
  max: appConfig.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.clientIp ?? req.ip ?? req.socket.remoteAddress ?? 'unknown',
  message: 'Too many requests. Please try again later.'
});

app.use(requestRateLimiter);
app.use(express.json({ limit: '1mb' }));

const configUpdateSchema = z.object({
  historicalIntervalMinutes: z.coerce.number().int().min(1, 'historicalIntervalMinutes must be an integer >= 1.'),
  maxReminders: z.coerce.number().int().min(0, 'maxReminders must be an integer >= 0.'),
  reminderIntervalMinutes: z.coerce.number().int().min(1, 'reminderIntervalMinutes must be an integer >= 1.')
});

const sensorConfigSchema = z.object({
  sensorConfig: z.object({
    amonia: z.coerce.boolean(),
    water: z.coerce.boolean(),
    sabun1: z.coerce.boolean(),
    sabun2: z.coerce.boolean(),
    sabun3: z.coerce.boolean(),
    tisu1: z.coerce.boolean(),
    tisu2: z.coerce.boolean()
  })
});

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required.' })
    .min(1, 'Email is required.')
    .trim()
    .email('Email must be valid.')
    .transform(value => value.toLowerCase()),
  password: z.string({ required_error: 'Password is required.' }).min(1, 'Password is required.')
});

const renameDeviceSchema = z.object({
  displayName: z
    .union([z.string(), z.null()])
    .transform(value => {
      if (value === null) {
        return null;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      return trimmed;
    })
    .refine(value => value === null || value.length <= 100, {
      message: 'Display name must be at most 100 characters.'
    })
});

async function verifyUserCredentials(email: string, password: string): Promise<AuthenticatedUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role
  };
}

async function authenticateToken(token: string): Promise<AuthenticatedUser | null> {
  const decoded = jwt.verify(token, authSecret) as JwtPayload;
  const userId = decoded.sub;

  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role
  };
}

const authenticateRequest: express.RequestHandler = (req, res, next) => {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();

  authenticateToken(token)
    .then(user => {
      if (!user) {
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
      }

      req.user = user;
      next();
    })
    .catch(error => {
      req.log.warn({ err: error }, 'Failed to authenticate request');
      res.status(401).json({ error: 'Authentication failed.' });
    });
};

const requireSupervisor: express.RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  if (req.user.role !== 'SUPERVISOR') {
    res.status(403).json({ error: 'Supervisor privileges required.' });
    return;
  }

  next();
};

const requireApiKey: express.RequestHandler = (req, res, next) => {
  const apiKey = req.get('x-api-key');
  if (!isValidApiKey(apiKey)) {
    res.status(401).json({ error: 'Invalid API key.' });
    return;
  }
  next();
};

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

type HeartbeatWebSocket = WebSocket & { isAlive?: boolean };

const wss = new WebSocketServer({ server, path: '/ws/latest' });

const websocketHeartbeatInterval = setInterval(() => {
  wss.clients.forEach(client => {
    const socket = client as HeartbeatWebSocket;

    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      websocketClients.delete(socket);
      return;
    }

    if (socket.isAlive === false) {
      websocketClients.delete(socket);
      socket.terminate();
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.isAlive = false;
    socket.ping();
  });
}, WEBSOCKET_PING_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(websocketHeartbeatInterval);
});

wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
  (async () => {
    try {
      if (!request.url) {
        socket.close(1008, 'Invalid request.');
        return;
      }

      const parsedUrl = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const token = parsedUrl.searchParams.get('token');

      if (!token) {
        socket.close(4401, 'Authentication required.');
        return;
      }

      let user: AuthenticatedUser | null = null;
      try {
        user = await authenticateToken(token);
      } catch (error) {
        appLogger.warn({ err: error }, 'Failed to authenticate WebSocket connection');
        socket.close(1011, 'Authentication error.');
        return;
      }

      if (!user) {
        socket.close(4401, 'Authentication failed.');
        return;
      }

      const heartbeatSocket = socket as HeartbeatWebSocket;
      heartbeatSocket.isAlive = true;

      websocketClients.add(socket);

      if (Object.keys(latestData).length > 0) {
        socket.send(JSON.stringify({ type: 'init', payload: latestData }));
      }

      socket.on('close', () => {
        websocketClients.delete(socket);
      });

      socket.on('pong', () => {
        heartbeatSocket.isAlive = true;
      });

      socket.on('error', (error: Error) => {
        appLogger.warn({ err: error }, 'WebSocket error');
      });
    } catch (error) {
      appLogger.error({ err: error }, 'Unexpected WebSocket setup error');
      socket.close(1011, 'Unexpected error.');
    }
  })().catch(error => {
    appLogger.error({ err: error }, 'Unhandled WebSocket connection error');
    socket.close(1011, 'Unexpected error.');
  });
});

const telegramBot = createTelegramBot(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_POLLING === 'false');
const telegramLogger = appLogger.child({ subsystem: 'telegram' });

if (telegramBot) {
  telegramBot.on('message', async msg => {
    const chatID = msg.chat.id.toString();
    const rawText = msg.text ?? '';
    const text = rawText.trim();
    const assignment = petugas[chatID];
    const userDisplayName = getTelegramUserDisplayName(msg.from);

    if (text.startsWith('/maintenance')) {
      if (!assignment) {
        await telegramBot
          .sendMessage(msg.chat.id, '🚫 Anda belum terdaftar. Gunakan /start untuk mendaftar lantai.')
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send maintenance not-registered notice'));
        return;
      }

      const parts = text.split(/\s+/);
      if (parts.length < 3) {
        await telegramBot
          .sendMessage(msg.chat.id, 'Penggunaan: /maintenance <lantai> <menit>.')
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send maintenance usage notice'));
        return;
      }

      const lantaiArg = Number.parseInt(parts[1], 10);
      const minutesArg = Number.parseInt(parts[2], 10);
      if (Number.isNaN(lantaiArg) || Number.isNaN(minutesArg) || lantaiArg <= 0 || minutesArg <= 0) {
        await telegramBot
          .sendMessage(msg.chat.id, '⚠️ Nilai lantai atau menit tidak valid.')
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send maintenance invalid arguments notice'));
        return;
      }

      if (assignment.lantai !== lantaiArg) {
        await telegramBot
          .sendMessage(msg.chat.id, `Perintah ini hanya dapat digunakan untuk Lantai ${assignment.lantai}.`)
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send maintenance floor mismatch notice'));
        return;
      }

      const deviceID = getDeviceIdForFloor(lantaiArg);
      const muteEntry = muteDevice(deviceID, lantaiArg, minutesArg, userDisplayName, chatID, 'maintenance');
      telegramLogger.info(
        { chatID, deviceId: deviceID, lantai: lantaiArg, mutedUntil: muteEntry.mutedUntil, minutes: minutesArg },
        'Device muted via /maintenance command'
      );

      const mutedUntilText = new Date(muteEntry.mutedUntil).toLocaleString();
      try {
        await telegramBot.sendMessage(
          msg.chat.id,
          `🔕 Notifikasi untuk Lantai ${lantaiArg} dimatikan selama ${minutesArg} menit (hingga ${mutedUntilText}).`
        );
      } catch (error) {
        telegramLogger.error({ err: error, chatID }, 'Failed to send maintenance confirmation');
      }
      return;
    }

    if (text.startsWith('/ack')) {
      if (!assignment) {
        await telegramBot
          .sendMessage(msg.chat.id, '🚫 Anda belum terdaftar. Gunakan /start untuk mendaftar lantai.')
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send ack not-registered notice'));
        return;
      }

      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await telegramBot
          .sendMessage(msg.chat.id, 'Penggunaan: /ack <lantai>.')
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send ack usage notice'));
        return;
      }

      const lantaiArg = Number.parseInt(parts[1], 10);
      if (Number.isNaN(lantaiArg) || lantaiArg <= 0) {
        await telegramBot
          .sendMessage(msg.chat.id, '⚠️ Nilai lantai tidak valid.')
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send ack invalid arguments notice'));
        return;
      }

      if (assignment.lantai !== lantaiArg) {
        await telegramBot
          .sendMessage(msg.chat.id, `Perintah ini hanya dapat digunakan untuk Lantai ${assignment.lantai}.`)
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send ack floor mismatch notice'));
        return;
      }

      const deviceID = getDeviceIdForFloor(lantaiArg);
      const acknowledged = await acknowledgeDeviceAlert(
        telegramBot,
        deviceID,
        lantaiArg,
        userDisplayName,
        chatID,
        'command',
        telegramLogger
      );

      if (!acknowledged) {
        await telegramBot
          .sendMessage(msg.chat.id, `ℹ️ Tidak ada alert aktif untuk Lantai ${lantaiArg} atau sudah diambil petugas lain.`)
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send ack no-alert notice'));
        return;
      }

      try {
        await telegramBot.sendMessage(
          msg.chat.id,
          `✅ ${userDisplayName} akan menangani alert di Lantai ${lantaiArg}. Terima kasih!`
        );
      } catch (error) {
        telegramLogger.error({ err: error, chatID }, 'Failed to send ack confirmation');
      }
      return;
    }

    if (text === '/start') {
      void telegramBot
        .sendMessage(msg.chat.id, '👋 Selamat datang! Silakan pilih lantai Anda.\nKetik nomor lantai (misal: 1, 2, 3, dst.)')
        .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send /start instructions'));
      return;
    }

    if (/^\d+$/.test(text)) {
      const lantai = Number.parseInt(text, 10);
      try {
        await subscriberRepository.upsert(chatID, lantai);
        petugas[chatID] = { lantai };
        await telegramBot.sendMessage(msg.chat.id, `📍 Anda terdaftar sebagai petugas untuk Lantai ${lantai}.`);
      } catch (error) {
        telegramLogger.error({ err: error, chatID, lantai }, 'Failed to persist Telegram subscription');
        void telegramBot
          .sendMessage(msg.chat.id, '⚠️ Gagal menyimpan pilihan lantai Anda. Silakan coba lagi nanti.')
          .catch(err => telegramLogger.error({ err, chatID }, 'Failed to send subscription error notification'));
      }
      return;
    }

    if (text === '/end') {
      if (petugas[chatID]) {
        try {
          await subscriberRepository.delete(chatID);
          delete petugas[chatID];
          await telegramBot.sendMessage(msg.chat.id, 'Terima kasih. Pendaftaran Anda telah diakhiri.');
        } catch (error) {
          telegramLogger.error({ err: error, chatID }, 'Failed to remove Telegram subscription');
          void telegramBot
            .sendMessage(msg.chat.id, '⚠️ Gagal menghapus pendaftaran Anda. Mohon coba lagi nanti.')
            .catch(err => telegramLogger.error({ err, chatID }, 'Failed to send unsubscribe error notification'));
        }
      } else {
        void telegramBot
          .sendMessage(msg.chat.id, 'Anda belum terdaftar. Gunakan /start untuk mendaftar.')
          .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send not-registered notice'));
      }
      return;
    }

    if (text === '/data') {
      if (!assignment) {
        telegramBot.sendMessage(msg.chat.id, '🚫 Anda belum terdaftar. Gunakan /start untuk mendaftar lantai.');
        return;
      }

      const deviceID = `toilet-lantai-${assignment.lantai}`;
      const data = latestData[deviceID];
      if (!data) {
        telegramBot.sendMessage(
          msg.chat.id,
          `🚫 Data untuk ${deviceID.toUpperCase().replace('-', ' ')} belum tersedia. Mohon pastikan ESP terhubung.`
        );
        return;
      }

      const amonia = parseJson<AmmoniaSensorData>(data.amonia, { ppm: NaN, score: NaN, status: 'Data tidak ada' }, telegramLogger);
      const water = parseJson<WaterSensorData>(
        data.waterPuddleJson,
        { digital: -1, status: 'Data tidak ada' },
        telegramLogger
      );
      const soap = parseJson<SoapSensorData>(data.sabun, defaultSoapData(), telegramLogger);
      const tissue = parseJson<TissueSensorData>(data.tisu, defaultTissueData(), telegramLogger);
      const timestamp = new Date(data.timestamp).toLocaleString();

      const isAnySoapCritical =
        soap.sabun1.status === 'Habis' || soap.sabun2.status === 'Habis' || soap.sabun3.status === 'Habis';
      const isAnyTissueCritical = tissue.tisu1.status === 'Habis' || tissue.tisu2.status === 'Habis';

      const soapStatusKeseluruhan = isAnySoapCritical ? 'HAMPIR HABIS' : 'Aman';
      const tissueStatusKeseluruhan = isAnyTissueCritical ? 'HAMPIR HABIS' : 'Tersedia';

      const payload = [
        `LAPORAN STATUS ${deviceID.toUpperCase().replace('-', ' ')} (REAL-TIME: ${timestamp}):`,
        `Bau: ${amonia.status} (${Number.isFinite(amonia.ppm) ? `${amonia.ppm} ppm` : 'Data tidak ada'})`,
        `Genangan Air: ${water.status}`,
        `Sabun: ${soapStatusKeseluruhan}`,
        `Tisu: ${tissueStatusKeseluruhan}`
      ].join('\n');

      telegramBot.sendMessage(msg.chat.id, payload);
      return;
    }

    void telegramBot
      .sendMessage(msg.chat.id, 'Maaf, perintah tidak dikenali. Gunakan /start untuk memulai atau /data untuk laporan.')
      .catch(error => telegramLogger.error({ err: error, chatID }, 'Failed to send unknown command notice'));
  });

  telegramBot.on('callback_query', async query => {
    const data = query.data ?? '';
    if (!data.startsWith('ack:')) {
      return;
    }

    const ackId = data.slice(4);
    const pending = pendingAlertActions.get(ackId);

    if (!pending) {
      await telegramBot
        .answerCallbackQuery(query.id, { text: 'Alert sudah tidak tersedia atau telah ditangani.' })
        .catch(error => telegramLogger.error({ err: error }, 'Failed to answer callback for missing alert'));
      return;
    }

    const ackedByName = getTelegramUserDisplayName(query.from);
    const ackedByChatId = query.from.id.toString();

    const acknowledged = await acknowledgeDeviceAlert(
      telegramBot,
      pending.deviceID,
      pending.lantai,
      ackedByName,
      ackedByChatId,
      'inline',
      telegramLogger
    );

    const responseText = acknowledged
      ? `✅ ${ackedByName} akan menangani alert di Lantai ${pending.lantai}.`
      : 'Alert sudah tidak tersedia atau telah ditangani.';

    await telegramBot
      .answerCallbackQuery(query.id, { text: responseText })
      .catch(error => telegramLogger.error({ err: error, chatID: ackedByChatId }, 'Failed to answer acknowledgement callback'));
  });
}

app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/readyz', (_req: Request, res: Response) => {
  const ready = telegramBot ? 'ready' : 'degraded';
  res.status(ready === 'ready' ? 200 : 503).json({
    status: ready,
    telegram: telegramBot ? 'connected' : 'disabled',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/login', async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid login payload.', details: parseResult.error.flatten() });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const user = await verifyUserCredentials(email, password);
    if (!user) {
      res.status(401).json({ error: 'Email atau password salah.' });
      return;
    }

    const signOptions: SignOptions = {
      expiresIn: authTokenExpiration,
      subject: user.id
    };

    const token = jwt.sign({ email: user.email, role: user.role }, authSecret, signOptions);

    res.status(200).json({
      token,
      user: {
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    req.log.error({ err: error, email }, 'Failed to authenticate user');
    res.status(500).json({ error: 'Gagal memproses login. Silakan coba lagi.' });
  }
});

app.get('/api/config', authenticateRequest, (_req: Request, res: Response) => {
  res.json({
    historicalIntervalMinutes: config.historicalIntervalMinutes,
    maxReminders: config.maxReminders,
    reminderIntervalMinutes: config.reminderIntervalMinutes
  });
});

app.post('/api/config', authenticateRequest, requireSupervisor, async (req: Request, res: Response) => {
  const parseResult = configUpdateSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid configuration payload.', details: parseResult.error.flatten() });
    return;
  }

  const { historicalIntervalMinutes, maxReminders, reminderIntervalMinutes } = parseResult.data;
  const baseConfig: ConfigBase = {
    historicalIntervalMinutes,
    maxReminders,
    reminderIntervalMinutes
  };

  try {
    await configRepository.set(baseConfig);
    config = deriveConfig(baseConfig);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    req.log.error({ err: error }, 'Failed to persist configuration overrides');
    res.status(500).json({ error: 'Failed to persist configuration overrides.' });
  }
});

app.get('/api/device/:deviceId/settings', authenticateRequest, async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  try {
    const sensorConfig = await getDeviceSensorConfig(deviceId);
    res.status(200).json({ deviceId, sensorConfig });
  } catch (error) {
    req.log.error({ err: error, deviceId }, 'Failed to load device settings');
    res.status(500).json({ error: 'Failed to load device settings.' });
  }
});

app.post(
  '/api/device/:deviceId/settings',
  authenticateRequest,
  requireSupervisor,
  async (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const parseResult = sensorConfigSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid sensor configuration payload.', details: parseResult.error.flatten() });
      return;
    }

    const normalizedConfig = normalizeSensorConfig(parseResult.data.sensorConfig);

    try {
      await deviceSettingsRepository.upsert(deviceId, normalizedConfig);
      deviceSensorSettings[deviceId] = normalizedConfig;

      if (latestData[deviceId]) {
        updateLatestData(deviceId, previous => ({ ...previous!, sensorConfig: normalizedConfig }));
      }

      res.status(200).json({ status: 'ok', deviceId, sensorConfig: normalizedConfig });
    } catch (error) {
      req.log.error({ err: error, deviceId }, 'Failed to persist device settings');
      res.status(500).json({ error: 'Failed to persist device settings.' });
    }
  }
);

app.post('/data', requireApiKey, async (req: Request, res: Response) => {
  const parseResult = rawSensorPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid sensor payload.', details: parseResult.error.flatten() });
    return;
  }

  const payload = parseResult.data;
  const deviceID = payload.deviceID;
  res.locals.deviceId = deviceID;

  const now = Date.now();
  const normalized = normalizeSensorPayload(payload, req.log);
  const computedSnapshot = computeSensorSnapshot(normalized);
  const sensorConfig = await getDeviceSensorConfig(deviceID);
  const serializedSnapshot = serializeComputedSnapshot(computedSnapshot);

  const latestSnapshot = updateLatestData(deviceID, previous => ({
    deviceID,
    amonia: serializedSnapshot.amonia,
    waterPuddleJson: serializedSnapshot.waterPuddleJson,
    sabun: serializedSnapshot.sabun,
    tisu: serializedSnapshot.tisu,
    displayName: previous?.displayName ?? null,
    timestamp: new Date().toISOString(),
    espStatus: 'active',
    lastActive: now,
    sensorConfig
  }));

  if (!deviceStatuses[deviceID]) {
    deviceStatuses[deviceID] = {
      isAlert: false,
      alertStartTime: 0,
      lastAlertSentTime: 0,
      isRecoverySent: true,
      soapStatusConfirmed: 'safe',
      soapPendingStartTime: 0
    };
  }

  const status = deviceStatuses[deviceID];
  const lantai = extractFloorFromDeviceID(deviceID);

  const latestSnapshotRecord = toSnapshotRecord(latestSnapshot);
  try {
    await latestSnapshotRepository.upsert(latestSnapshotRecord);
  } catch (error) {
    req.log.error({ err: error, deviceId: deviceID }, '[Latest Snapshot] Failed to persist data');
  }

  const soap = computedSnapshot.sabun;
  const tissue = computedSnapshot.tisu;

  const soapMonitoringEnabled = isAnySensorEnabled(sensorConfig, ['sabun1', 'sabun2', 'sabun3']);

  const isAnySoapCritical = soapMonitoringEnabled && isSoapCritical(soap);

  if (isAnySoapCritical) {
    if (status.soapStatusConfirmed === 'safe') {
      status.soapStatusConfirmed = 'pending';
      status.soapPendingStartTime = now;
    } else if (status.soapStatusConfirmed === 'pending' && now - status.soapPendingStartTime >= SOAP_DEBOUNCE_MS) {
      status.soapStatusConfirmed = 'critical';
    }
  } else {
    status.soapStatusConfirmed = 'safe';
    status.soapPendingStartTime = 0;
  }

  const activeAlerts = getActiveAlerts(deviceID, status.soapStatusConfirmed, tissue, sensorConfig);
  const isAlerting = activeAlerts.length > 0;

  if (isAlerting) {
    if (!status.isAlert) {
      const muteEntry = getActiveMuteEntry(deviceID);
      if (muteEntry) {
        req.log.info(
          {
            deviceId: deviceID,
            lantai,
            mutedUntil: muteEntry.mutedUntil,
            mutedBy: muteEntry.setByChatId,
            mutedByName: muteEntry.setByName,
            reason: muteEntry.reason
          },
          'Skipping accident_new alert because device is muted'
        );
      } else {
        status.isAlert = true;
        status.alertStartTime = now;
        status.lastAlertSentTime = now;
        status.isRecoverySent = false;
        sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, activeAlerts, 'accident_new', sensorConfig, {
          logger: req.log,
          requestId: req.requestId
        });
      }
    } else if (
      config.maxReminders > 0 &&
      now - status.lastAlertSentTime >= config.reminderIntervalMs &&
      now - status.alertStartTime < config.maxAlertDurationMs
    ) {
      const muteEntry = getActiveMuteEntry(deviceID);
      if (muteEntry) {
        req.log.info(
          {
            deviceId: deviceID,
            lantai,
            mutedUntil: muteEntry.mutedUntil,
            mutedBy: muteEntry.setByChatId,
            mutedByName: muteEntry.setByName,
            reason: muteEntry.reason
          },
          'Skipping accident_repeat alert because device is muted'
        );
      } else {
        status.lastAlertSentTime = now;
        sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, activeAlerts, 'accident_repeat', sensorConfig, {
          logger: req.log,
          requestId: req.requestId
        });
      }
    }
  } else if (status.isAlert) {
    status.isAlert = false;
    status.alertStartTime = 0;
    status.lastAlertSentTime = 0;

    if (!status.isRecoverySent) {
      status.isRecoverySent = true;
      const muteEntry = getActiveMuteEntry(deviceID);
      if (muteEntry) {
        req.log.info(
          {
            deviceId: deviceID,
            lantai,
            mutedUntil: muteEntry.mutedUntil,
            mutedBy: muteEntry.setByChatId,
            mutedByName: muteEntry.setByName,
            reason: muteEntry.reason
          },
          'Skipping recovery alert because device is muted'
        );
      } else {
        sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, [], 'recovery', sensorConfig, {
          logger: req.log,
          requestId: req.requestId
        });
      }
    }
  }

  const lastSave = lastHistoricalSaveTime[deviceID] ?? 0;
  if (now - lastSave > config.historicalIntervalMs) {
    try {
      await historyRepository.record(latestSnapshotRecord);
      lastHistoricalSaveTime[deviceID] = now;
      if (!isAlerting) {
        const muteEntry = getActiveMuteEntry(deviceID);
        if (muteEntry) {
        req.log.info(
          {
            deviceId: deviceID,
            lantai,
            mutedUntil: muteEntry.mutedUntil,
            mutedBy: muteEntry.setByChatId,
            mutedByName: muteEntry.setByName,
            reason: muteEntry.reason
          },
          'Skipping routine alert because device is muted'
        );
        } else {
          sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, [], 'routine', sensorConfig, {
            logger: req.log,
            requestId: req.requestId
          });
        }
      }
    } catch (err) {
      req.log.error({ err, deviceId: deviceID }, '[Historical Log] Failed to write data');
    }
  }

  res.status(200).send(`Data from ${deviceID} received successfully.`);
});

app.get('/api/latest', authenticateRequest, async (_req: Request, res: Response) => {
  const now = Date.now();
  await markInactiveDevices(now);

  res.json(latestData);
});

const historyQuerySchema = z.object({
  deviceId: z.string().trim().min(1, 'deviceId is required'),
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().optional()
});

app.get('/api/history', authenticateRequest, async (req: Request, res: Response) => {
  const parseResult = historyQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid query parameters.', details: parseResult.error.flatten() });
    return;
  }

  const { deviceId, cursor } = parseResult.data;
  const limit = parseResult.data.limit ?? 25;

  let cursorValue: bigint | undefined;
  if (cursor) {
    try {
      cursorValue = BigInt(cursor);
    } catch (error) {
      res.status(400).json({ error: 'Invalid cursor parameter.' });
      return;
    }
  }

  try {
    const { entries, nextCursor } = await historyRepository.findPaginatedByDevice(deviceId, limit, cursorValue);
    const responsePayload = {
      deviceId,
      entries: entries.map(toLatestDeviceSnapshot),
      nextCursor: nextCursor ? nextCursor.toString() : null,
      hasMore: Boolean(nextCursor)
    };

    res.json(responsePayload);
  } catch (error) {
    req.log.error({ err: error, deviceId }, 'Error reading historical data');
    res.status(500).send('No historical data available.');
  }
});

app.post(
  '/api/device/:deviceId/rename',
  authenticateRequest,
  requireSupervisor,
  async (req: Request, res: Response) => {
    const { deviceId } = req.params;
    const parseResult = renameDeviceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid display name payload.', details: parseResult.error.flatten() });
      return;
    }

    const { displayName } = parseResult.data;

    try {
      await prisma.deviceLatestSnapshot.update({
        where: { deviceId },
        data: { displayName }
      });

      if (latestData[deviceId]) {
        updateLatestData(deviceId, previous => ({
          ...previous!,
          displayName
        }));
      }

      res.status(200).json({ status: 'ok', deviceId, displayName });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Device not found.' });
        return;
      }

      req.log.error({ err: error, deviceId }, 'Failed to update device display name');
      res.status(500).json({ error: 'Failed to update device display name.' });
    }
  }
);

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err.message === 'Origin header is required.' || err.message.includes('is not allowed')) {
    res.status(403).json({ error: err.message });
    return;
  }
  next(err);
});

bootstrap()
  .then(() => {
    server.listen(port, host, () => {
      appLogger.info(
        { host, port, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}` },
        'Server is running'
      );
      appLogger.info('Waiting for data from ESP32s...');
    });
  })
  .catch(error => {
    appLogger.error({ err: error }, 'Failed to initialize the server');
    process.exit(1);
  });

function deriveConfig(input: ConfigBase): Config {
  return {
    ...input,
    historicalIntervalMs: input.historicalIntervalMinutes * 60 * 1000,
    reminderIntervalMs: input.reminderIntervalMinutes * 60 * 1000,
    maxAlertDurationMs: input.maxReminders * input.reminderIntervalMinutes * 60 * 1000
  };
}

function normalizeSensorPayload(payload: RawSensorPayload, logger: Logger): NormalizedSensorPayload {
  return {
    deviceID: payload.deviceID,
    amonia: normalizeAmmoniaPayload(payload.amonia, logger),
    waterPuddleJson: normalizeWaterPayload(payload.waterPuddleJson, logger),
    sabun: normalizeSoapPayload(payload.sabun, logger),
    tisu: normalizeTissuePayload(payload.tisu, logger)
  };
}

function computeSensorSnapshot(payload: NormalizedSensorPayload): ComputedSensorSnapshot {
  return {
    amonia: computeAmmoniaStatus(payload.amonia),
    waterPuddle: computeWaterStatus(payload.waterPuddleJson),
    sabun: computeSoapStatus(payload.sabun, SOAP_EMPTY_THRESHOLD_CM),
    tisu: computeTissueStatus(payload.tisu, TISSUE_EMPTY_VALUE)
  };
}

function serializeComputedSnapshot(
  snapshot: ComputedSensorSnapshot
): Pick<LatestDeviceSnapshot, 'amonia' | 'waterPuddleJson' | 'sabun' | 'tisu'> {
  return {
    amonia: JSON.stringify(snapshot.amonia),
    waterPuddleJson: JSON.stringify(snapshot.waterPuddle),
    sabun: JSON.stringify(snapshot.sabun),
    tisu: JSON.stringify(snapshot.tisu)
  };
}

function isSoapCritical(soap: SoapSensorData): boolean {
  return (
    soap.sabun1.status === 'Habis' || soap.sabun2.status === 'Habis' || soap.sabun3.status === 'Habis'
  );
}

function normalizeAmmoniaPayload(value: unknown, logger: Logger): RawAmmoniaPayload {
  if (typeof value === 'number') {
    return { ppm: Number.isFinite(value) ? value : null };
  }

  const objectValue = parseJsonObject(value, logger);
  if (!objectValue) {
    return { ppm: null };
  }

  const ppm = toFiniteNumber(objectValue.ppm ?? objectValue.value);
  return { ppm };
}

function normalizeWaterPayload(value: unknown, logger: Logger): RawWaterPayload {
  if (typeof value === 'number') {
    return { digital: normalizeDigitalValue(value) };
  }

  const objectValue = parseJsonObject(value, logger);
  if (!objectValue) {
    return { digital: null };
  }

  const digital = toFiniteNumber(objectValue.digital ?? objectValue.value);
  return { digital: digital === null ? null : normalizeDigitalValue(digital) };
}

function normalizeSoapPayload(value: unknown, logger: Logger): RawSoapPayload {
  const objectValue = parseJsonObject(value, logger) ?? {};

  return {
    sabun1: normalizeSoapSlot(objectValue.sabun1, logger),
    sabun2: normalizeSoapSlot(objectValue.sabun2, logger),
    sabun3: normalizeSoapSlot(objectValue.sabun3, logger)
  };
}

function normalizeSoapSlot(value: unknown, logger: Logger): RawSoapSlotPayload {
  if (typeof value === 'number') {
    return { distance: Number.isFinite(value) ? value : null };
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return { distance: Number.isFinite(parsed) ? parsed : null };
  }

  const objectValue = parseJsonObject(value, logger);
  if (!objectValue) {
    return { distance: null };
  }

  const distance = toFiniteNumber(objectValue.distance ?? objectValue.distanceCm ?? objectValue.value);
  return { distance };
}

function normalizeTissuePayload(value: unknown, logger: Logger): RawTissuePayload {
  const objectValue = parseJsonObject(value, logger) ?? {};

  return {
    tisu1: normalizeTissueSlot(objectValue.tisu1, logger),
    tisu2: normalizeTissueSlot(objectValue.tisu2, logger)
  };
}

function normalizeTissueSlot(value: unknown, logger: Logger): RawTissueSlotPayload {
  if (typeof value === 'number') {
    return { digital: normalizeDigitalValue(value) };
  }

  const objectValue = parseJsonObject(value, logger);
  if (!objectValue) {
    return { digital: null };
  }

  const digital = toFiniteNumber(objectValue.digital ?? objectValue.value);
  return { digital: digital === null ? null : normalizeDigitalValue(digital) };
}

function deriveAmmoniaScore(ppm: number): number {
  const estimatedScore = Math.round(AMMONIA_SCORE_INTERCEPT + AMMONIA_SCORE_SLOPE * ppm);
  return Math.max(AMMONIA_MIN_SCORE, Math.min(AMMONIA_MAX_SCORE, estimatedScore));
}

function computeAmmoniaStatus(payload: RawAmmoniaPayload): AmmoniaSensorData {
  if (payload.ppm === null || !Number.isFinite(payload.ppm)) {
    return { ppm: null, score: null, status: 'Data tidak ada' };
  }

  const ppm = Math.max(payload.ppm, 0);
  const score = deriveAmmoniaScore(ppm);
  const status = score === 1 ? 'Bagus' : score === 2 ? 'Normal' : 'Kritis';

  return { ppm, score, status };
}

function computeWaterStatus(payload: RawWaterPayload): WaterSensorData {
  if (payload.digital === null || !Number.isFinite(payload.digital)) {
    return { digital: -1, status: 'Data tidak ada' };
  }

  const digital = payload.digital <= 0 ? 0 : 1;
  return {
    digital,
    status: digital === 0 ? 'Genangan air terdeteksi.' : 'Lantai kering.'
  };
}

function computeSoapStatus(payload: RawSoapPayload, thresholdCm: number): SoapSensorData {
  return {
    sabun1: computeSoapSlotStatus(payload.sabun1, thresholdCm),
    sabun2: computeSoapSlotStatus(payload.sabun2, thresholdCm),
    sabun3: computeSoapSlotStatus(payload.sabun3, thresholdCm)
  };
}

function computeSoapSlotStatus(payload: RawSoapSlotPayload, thresholdCm: number): SoapSlot {
  if (payload.distance === null || !Number.isFinite(payload.distance) || payload.distance < 0) {
    return { distance: -1, status: 'Data tidak ada' };
  }

  const distance = Math.round(payload.distance);
  if (distance < 0) {
    return { distance: -1, status: 'Data tidak ada' };
  }

  if (distance > thresholdCm) {
    return { distance, status: 'Habis' };
  }

  return { distance, status: 'Aman' };
}

function computeTissueStatus(payload: RawTissuePayload, emptyValue: number): TissueSensorData {
  return {
    tisu1: computeTissueSlotStatus(payload.tisu1, emptyValue),
    tisu2: computeTissueSlotStatus(payload.tisu2, emptyValue)
  };
}

function computeTissueSlotStatus(payload: RawTissueSlotPayload, emptyValue: number): TissueSlot {
  if (payload.digital === null || !Number.isFinite(payload.digital)) {
    return { digital: -1, status: 'Data tidak ada' };
  }

  const digital = payload.digital <= 0 ? 0 : 1;
  return {
    digital,
    status: digital === emptyValue ? 'Habis' : 'Tersedia'
  };
}

function parseJsonObject(value: unknown, logger: Logger): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to parse sensor payload JSON');
    }
  }

  return null;
}

function toFiniteNumber(value: unknown): number | null {
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
}

function normalizeDigitalValue(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  return value <= 0 ? 0 : 1;
}

function extractFloorFromDeviceID(deviceID: string): number {
  const parts = deviceID.split('-');
  if (parts.length >= 3) {
    const maybeNumber = Number.parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(maybeNumber)) {
      return maybeNumber;
    }
  }
  return 0;
}

function toSnapshotRecord(snapshot: LatestDeviceSnapshot): SnapshotRecord {
  return {
    deviceId: snapshot.deviceID,
    displayName: snapshot.displayName ?? null,
    amonia: snapshot.amonia,
    waterPuddleJson: snapshot.waterPuddleJson,
    sabun: snapshot.sabun,
    tisu: snapshot.tisu,
    timestamp: new Date(snapshot.timestamp),
    espStatus: snapshot.espStatus === 'inactive' ? 'inactive' : 'active',
    lastActive: new Date(snapshot.lastActive)
  };
}

function toLatestDeviceSnapshot(record: SnapshotRecord): LatestDeviceSnapshot {
  const sensorConfig = normalizeSensorConfig(deviceSensorSettings[record.deviceId] ?? DEFAULT_SENSOR_CONFIG);
  deviceSensorSettings[record.deviceId] = sensorConfig;

  return {
    deviceID: record.deviceId,
    displayName: record.displayName,
    amonia: record.amonia,
    waterPuddleJson: record.waterPuddleJson,
    sabun: record.sabun,
    tisu: record.tisu,
    timestamp: record.timestamp.toISOString(),
    espStatus: record.espStatus,
    lastActive: record.lastActive.getTime(),
    sensorConfig
  };
}

function normalizeSensorConfig(config: Partial<DeviceSensorConfig>): DeviceSensorConfig {
  const normalized: DeviceSensorConfig = { ...DEFAULT_SENSOR_CONFIG };
  SENSOR_KEYS.forEach(key => {
    const value = config[key];
    normalized[key] = typeof value === 'boolean' ? value : DEFAULT_SENSOR_CONFIG[key];
  });
  return normalized;
}

async function getDeviceSensorConfig(deviceID: string): Promise<DeviceSensorConfig> {
  const existing = deviceSensorSettings[deviceID];
  if (existing) {
    return existing;
  }

  const stored = await deviceSettingsRepository.get(deviceID);
  const normalized = normalizeSensorConfig(stored ?? DEFAULT_SENSOR_CONFIG);
  deviceSensorSettings[deviceID] = normalized;
  return normalized;
}

function isAnySensorEnabled(config: DeviceSensorConfig, keys: SensorKey[]): boolean {
  return keys.some(key => config[key]);
}

function getActiveAlerts(
  _deviceID: string,
  soapStatusConfirmed: SoapStatus,
  tissue: TissueSensorData,
  sensorConfig: DeviceSensorConfig
): string[] {
  const alerts: string[] = [];

  if (isAnySensorEnabled(sensorConfig, ['sabun1', 'sabun2', 'sabun3']) && soapStatusConfirmed === 'critical') {
    alerts.push('SABUN HAMPIR HABIS');
  }

  const statusTisu1 = tissue.tisu1.status;
  const statusTisu2 = tissue.tisu2.status;

  if (
    (sensorConfig.tisu1 && statusTisu1 === 'Habis') ||
    (sensorConfig.tisu2 && statusTisu2 === 'Habis')
  ) {
    alerts.push('TISU HAMPIR HABIS');
  }

  return alerts;
}

function getDeviceIdForFloor(lantai: number): string {
  return `toilet-lantai-${lantai}`;
}

function getActiveMuteEntry(deviceID: string): DeviceMuteEntry | undefined {
  const entry = deviceMuteState.get(deviceID);
  if (!entry) {
    return undefined;
  }

  if (entry.mutedUntil <= Date.now()) {
    deviceMuteState.delete(deviceID);
    return undefined;
  }

  return entry;
}

function isDeviceMuted(deviceID: string): boolean {
  return Boolean(getActiveMuteEntry(deviceID));
}

function muteDevice(
  deviceID: string,
  lantai: number,
  minutes: number,
  setByName: string,
  setByChatId: string,
  reason: string
): DeviceMuteEntry {
  const mutedUntil = Date.now() + minutes * 60 * 1000;
  const entry: DeviceMuteEntry = { mutedUntil, lantai, setByName, setByChatId, reason };
  deviceMuteState.set(deviceID, entry);
  return entry;
}

async function acknowledgeDeviceAlert(
  bot: TelegramBot,
  deviceID: string,
  lantai: number,
  ackedByName: string,
  ackedByChatId: string,
  source: 'inline' | 'command',
  logger: Logger
): Promise<boolean> {
  const ackedAt = Date.now();
  const relatedEntries = Array.from(pendingAlertActions.entries()).filter(([, entry]) => entry.deviceID === deviceID);
  const acknowledgementSuffix = `\n\n✅ Diambil oleh ${ackedByName} pada ${new Date(ackedAt).toLocaleString()}.`;

  let updatedAny = false;
  const editPromises = relatedEntries.map(([ackId, entry]) =>
    bot
      .editMessageText(`${entry.text}${acknowledgementSuffix}`, {
        chat_id: Number(entry.chatId),
        message_id: entry.messageId,
        reply_markup: { inline_keyboard: [] }
      })
      .then(() => {
        pendingAlertActions.delete(ackId);
        updatedAny = true;
      })
      .catch(error => {
        logger.error(
          { err: error, chatId: entry.chatId, messageId: entry.messageId, deviceId: deviceID },
          'Failed to update alert message after acknowledgement'
        );
      })
  );

  await Promise.all(editPromises);

  deviceAcknowledgements.set(deviceID, { ackedBy: ackedByName, ackedByChatId, ackedAt, lantai, source });
  logger.info(
    { deviceId: deviceID, lantai, ackedByChatId, ackedByName, source, ackedAt, updatedAny },
    'Alert acknowledged by petugas'
  );

  if (relatedEntries.length === 0) {
    return false;
  }

  return true;
}

function getTelegramUserDisplayName(user?: TelegramBot.User): string {
  if (!user) {
    return 'Petugas';
  }

  const nameParts = [user.first_name, user.last_name].filter(part => Boolean(part && part.trim().length > 0));
  if (nameParts.length > 0) {
    return nameParts.join(' ').trim();
  }

  if (user.username) {
    return user.username;
  }

  return `ID ${user.id}`;
}

function sendTelegramAlert(
  bot: TelegramBot | null,
  deviceID: string,
  sensorData: LatestDeviceSnapshot,
  lantai: number,
  activeAlerts: string[],
  type: AlertType,
  sensorConfig: DeviceSensorConfig,
  context: { logger?: Logger; requestId?: string } = {}
) {
  if (!bot) {
    return;
  }

  if (lantai <= 0) {
    return;
  }

  const logger = context.logger ?? appLogger;
  const amonia = parseJson<AmmoniaSensorData>(sensorData.amonia, { ppm: null, score: null, status: 'Data tidak ada' }, logger);
  const water = parseJson<WaterSensorData>(
    sensorData.waterPuddleJson,
    { digital: -1, status: 'Data tidak ada' },
    logger
  );
  const soap = parseJson<SoapSensorData>(sensorData.sabun, defaultSoapData(), logger);
  const tissue = parseJson<TissueSensorData>(sensorData.tisu, defaultTissueData(), logger);
  const timestamp = new Date(sensorData.timestamp).toLocaleString();

  const normalizedSensorConfig = normalizeSensorConfig(sensorData.sensorConfig ?? sensorConfig);
  const soapEnabled = isAnySensorEnabled(normalizedSensorConfig, ['sabun1', 'sabun2', 'sabun3']);
  const tissueEnabled = isAnySensorEnabled(normalizedSensorConfig, ['tisu1', 'tisu2']);
  const ammoniaEnabled = normalizedSensorConfig.amonia;
  const waterEnabled = normalizedSensorConfig.water;

  const isAnySoapCritical = soapEnabled && isSoapCritical(soap);
  const isAnyTissueCritical =
    tissueEnabled &&
    ((normalizedSensorConfig.tisu1 && tissue.tisu1.status === 'Habis') ||
      (normalizedSensorConfig.tisu2 && tissue.tisu2.status === 'Habis'));

  const soapStatusKeseluruhan = soapEnabled ? (isAnySoapCritical ? 'HAMPIR HABIS' : 'Aman') : 'Dinonaktifkan';
  const tissueStatusKeseluruhan = tissueEnabled ? (isAnyTissueCritical ? 'HAMPIR HABIS' : 'Tersedia') : 'Dinonaktifkan';

  Object.entries(petugas).forEach(([chatID, assignment]) => {
    if (assignment.lantai !== lantai) {
      return;
    }

    let message = '';
    const title = deviceID.toUpperCase().replace('-', ' ');
    switch (type) {
      case 'accident_new':
        message = `🚨 MASALAH BARU TERDETEKSI di ${title} (${timestamp})!\n\n${activeAlerts.join('\n')}\n`;
        break;
      case 'accident_repeat':
        message = `🔔 PENGINGAT (MASALAH BELUM TERATASI) di ${title} (${timestamp})!\n\n${activeAlerts.join('\n')}\n`;
        break;
      case 'recovery':
        message = `✅MASALAH SUDAH DIATASI di ${title} (${timestamp})!\n\nStatus Sabun dan Tisu kembali normal.\n`;
        break;
      case 'routine':
        if (!isAnySoapCritical && !isAnyTissueCritical) {
          message = `📋 Laporan Rutin Harian dari ${title} (${timestamp}) - Status Aman.\n`;
        }
        break;
      default:
        break;
    }

    if (!message) {
      return;
    }

  const formatSoapDistance = (slot: SoapSlot): string =>
    typeof slot.distance === 'number' && Number.isFinite(slot.distance) && slot.distance !== -1
      ? `${slot.distance} cm`
      : 'N/A';

  const formatDigitalValue = (value: number): string => (value === -1 || !Number.isFinite(value) ? 'N/A' : String(value));

    const enabledSoapSlots = (
      [
        ['S1', soap.sabun1, normalizedSensorConfig.sabun1],
        ['S2', soap.sabun2, normalizedSensorConfig.sabun2],
        ['S3', soap.sabun3, normalizedSensorConfig.sabun3]
      ] as Array<[string, SoapSlot, boolean]>
    ).filter(([, , enabled]) => enabled);

    const enabledTissueSlots = (
      [
        ['T1', tissue.tisu1, normalizedSensorConfig.tisu1],
        ['T2', tissue.tisu2, normalizedSensorConfig.tisu2]
      ] as Array<[string, TissueSlot, boolean]>
    ).filter(([, , enabled]) => enabled);

    const soapSlotText =
      enabledSoapSlots.length > 0
        ? enabledSoapSlots.map(([label, slot]) => `${label}: ${slot.status}/${formatSoapDistance(slot)}`).join(', ')
        : 'Dinonaktifkan';

    const tissueSlotText =
      enabledTissueSlots.length > 0
        ? enabledTissueSlots.map(([label, slot]) => `${label}: ${slot.status}/${formatDigitalValue(slot.digital)}`).join(', ')
        : 'Dinonaktifkan';

    const statusDetails = [
      ammoniaEnabled
        ? `Bau: ${amonia.status} (${Number.isFinite(amonia.ppm) ? `${amonia.ppm} ppm` : 'Data tidak ada'})`
        : 'Bau: Dinonaktifkan',
      waterEnabled
        ? `Genangan Air: ${water.status} (digital: ${formatDigitalValue(water.digital)})`
        : 'Genangan Air: Dinonaktifkan',
      `Sabun: ${soapStatusKeseluruhan}${soapSlotText ? ` (${soapSlotText})` : ''}`,
      `Tisu: ${tissueStatusKeseluruhan}${tissueSlotText ? ` (${tissueSlotText})` : ''}`
    ].join('\n');

    const requestSuffix = context.requestId ? `\nRequest ID: ${context.requestId}` : '';

    const includeAckButton = type === 'accident_new' || type === 'accident_repeat';
    const ackId = includeAckButton ? randomUUID() : null;
    const sendOptions: TelegramBot.SendMessageOptions = {};
    if (includeAckButton && ackId) {
      sendOptions.reply_markup = {
        inline_keyboard: [[{ text: 'Saya akan tangani', callback_data: `ack:${ackId}` }]]
      };
    }

    const fullMessage = `${message}${statusDetails}${requestSuffix}`;

    bot
      .sendMessage(Number(chatID), fullMessage, sendOptions)
      .then(sentMessage => {
        if (includeAckButton && ackId) {
          pendingAlertActions.set(ackId, {
            deviceID,
            lantai,
            chatId: chatID,
            messageId: sentMessage.message_id,
            sentAt: Date.now(),
            alertType: type,
            text: fullMessage
          });
        }
      })
      .catch(error => {
        logger.error({ err: error, chatID, deviceId: deviceID, requestId: context.requestId }, 'Failed to send Telegram message');
      });
  });
}

function parseJson<T>(value: string, fallback: T, logger: Logger = appLogger): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error({ err: error }, 'Failed to parse JSON payload');
    return fallback;
  }
}

function defaultSoapData(): SoapSensorData {
  return {
    sabun1: { distance: -1, status: 'Data tidak ada' },
    sabun2: { distance: -1, status: 'Data tidak ada' },
    sabun3: { distance: -1, status: 'Data tidak ada' }
  };
}

function defaultTissueData(): TissueSensorData {
  return {
    tisu1: { digital: -1, status: 'Data tidak ada' },
    tisu2: { digital: -1, status: 'Data tidak ada' }
  };
}

async function bootstrap(): Promise<void> {
  try {
    const storedConfig = await configRepository.get();
    config = deriveConfig(storedConfig ?? DEFAULT_CONFIG_BASE);

    const storedSettings = await deviceSettingsRepository.list();
    Object.entries(storedSettings).forEach(([deviceId, sensorConfig]) => {
      deviceSensorSettings[deviceId] = normalizeSensorConfig(sensorConfig);
    });

    const subscribers = await subscriberRepository.list();
    petugas = {};
    subscribers.forEach(subscriber => {
      petugas[subscriber.chatId] = { lantai: subscriber.lantai };
    });

    const snapshots = await latestSnapshotRepository.findAll();
    const now = Date.now();
    const statusUpdates: Promise<void>[] = [];

    snapshots.forEach(record => {
      const snapshot = toLatestDeviceSnapshot(record);
      if (now - snapshot.lastActive > ESP_INACTIVE_THRESHOLD_MS && snapshot.espStatus !== 'inactive') {
        snapshot.espStatus = 'inactive';
        statusUpdates.push(latestSnapshotRepository.updateStatus(record.deviceId, 'inactive'));
      }
      latestData[record.deviceId] = snapshot;
    });

    if (statusUpdates.length > 0) {
      await Promise.allSettled(statusUpdates);
    }

    const historyTimestamps = await historyRepository.getLatestTimestamps();
    Object.entries(historyTimestamps).forEach(([deviceId, timestamp]) => {
      lastHistoricalSaveTime[deviceId] = timestamp.getTime();
    });
  } catch (error) {
    appLogger.error({ err: error }, 'Bootstrap initialization failed');
    throw error;
  }
}

function createTelegramBot(token: string | undefined, disablePolling: boolean): TelegramBot | null {
  if (!token) {
    appLogger.warn('TELEGRAM_BOT_TOKEN tidak disetel. Notifikasi Telegram dinonaktifkan.');
    return null;
  }

  try {
    const bot = new TelegramBot(token, { polling: !disablePolling });
    return bot;
  } catch (error) {
    appLogger.error({ err: error }, 'Gagal menginisialisasi Telegram bot, notifikasi dinonaktifkan');
    return null;
  }
}

import { randomUUID } from 'node:crypto';
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

import type { $Enums } from '@prisma/client';

import { appConfig, getConfiguredApiKeys, isAllowedOrigin, isValidApiKey } from './config';
import { prisma } from './database/prismaClient';
import { accessLogger, appLogger } from './logger';
import { ConfigOverrideRepository } from './repositories/configOverrideRepository';
import { HistoryRepository } from './repositories/historyRepository';
import { LatestSnapshotRepository } from './repositories/latestSnapshotRepository';
import { TelegramSubscriberRepository } from './repositories/telegramSubscriberRepository';
import type { SnapshotRecord } from './repositories/types';

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

interface PetugasAssignment {
  lantai: number;
}

const rawSensorPayloadSchema = z.object({
  deviceID: z.string().trim().min(1, 'deviceID is required'),
  amonia: z.unknown().optional(),
  air: z.unknown().optional(),
  sabun: z.unknown().optional(),
  tisu: z.unknown().optional()
});

type RawSensorPayload = z.infer<typeof rawSensorPayloadSchema>;

interface LatestDeviceSnapshot {
  deviceID: string;
  displayName: string | null;
  amonia: string;
  air: string;
  sabun: string;
  tisu: string;
  timestamp: string;
  espStatus: EspStatus;
  lastActive: number;
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
  ppm: number;
  score: number;
  status: string;
}

interface WaterSensorData {
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
  status: string;
}

interface TissueSensorData {
  tisu1: TissueSlot;
  tisu2: TissueSlot;
}

const SOAP_DEBOUNCE_MS = 5000;
const ESP_INACTIVE_THRESHOLD_MS = 30000;

const latestSnapshotRepository = new LatestSnapshotRepository(prisma);
const historyRepository = new HistoryRepository(prisma);
const subscriberRepository = new TelegramSubscriberRepository(prisma);
const configRepository = new ConfigOverrideRepository(prisma);

const DEFAULT_CONFIG_BASE: ConfigBase = {
  historicalIntervalMinutes: 5,
  maxReminders: 3,
  reminderIntervalMinutes: 10
};

const DEFAULT_CONFIG = deriveConfig(DEFAULT_CONFIG_BASE);

let config: Config = DEFAULT_CONFIG;
let petugas: Record<string, PetugasAssignment> = {};

const latestData: Record<string, LatestDeviceSnapshot> = {};
const lastHistoricalSaveTime: Record<string, number> = {};
const deviceStatuses: Record<string, DeviceStatus> = {};

const app = express();

const configuredApiKeys = getConfiguredApiKeys();
const authSecret: Secret = appConfig.auth.secret;
const authTokenExpiration = appConfig.auth.tokenExpiration;
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

const authenticateRequest: express.RequestHandler = (req, res, next) => {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();

  (async () => {
    try {
      const decoded = jwt.verify(token, authSecret) as JwtPayload;
      const userId = decoded.sub;

      if (!userId) {
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(401).json({ error: 'Invalid authentication token.' });
        return;
      }

      req.user = {
        id: user.id,
        email: user.email,
        role: user.role
      };

      next();
    } catch (error) {
      req.log.warn({ err: error }, 'Failed to authenticate request');
      res.status(401).json({ error: 'Authentication failed.' });
    }
  })().catch(error => {
    req.log.error({ err: error }, 'Unexpected authentication error');
    res.status(500).json({ error: 'Internal server error.' });
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

const telegramBot = createTelegramBot(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_POLLING === 'false');
const telegramLogger = appLogger.child({ subsystem: 'telegram' });

if (telegramBot) {
  telegramBot.on('message', async msg => {
    const chatID = msg.chat.id.toString();
    const text = msg.text ?? '';

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
      const assignment = petugas[chatID];
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
      const water = parseJson<WaterSensorData>(data.air, { status: 'Data tidak ada' }, telegramLogger);
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
  const existingDisplayName = latestData[deviceID]?.displayName ?? null;

  latestData[deviceID] = {
    ...normalized,
    displayName: existingDisplayName,
    timestamp: new Date().toISOString(),
    espStatus: 'active',
    lastActive: now
  };

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

  const latestSnapshotRecord = toSnapshotRecord(latestData[deviceID]);
  try {
    await latestSnapshotRepository.upsert(latestSnapshotRecord);
  } catch (error) {
    req.log.error({ err: error, deviceId: deviceID }, '[Latest Snapshot] Failed to persist data');
  }

  const amonia = parseJson<AmmoniaSensorData>(normalized.amonia, { ppm: NaN, score: NaN, status: 'Data tidak ada' }, req.log);
  const soap = parseJson<SoapSensorData>(normalized.sabun, defaultSoapData(), req.log);
  const tissue = normalized.tisu;

  const isAnySoapCritical =
    soap.sabun1.status === 'Habis' || soap.sabun2.status === 'Habis' || soap.sabun3.status === 'Habis';

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

  const activeAlerts = getActiveAlerts(deviceID, status.soapStatusConfirmed, tissue, req.log);
  const isAlerting = activeAlerts.length > 0;

  if (isAlerting) {
    if (!status.isAlert) {
      status.isAlert = true;
      status.alertStartTime = now;
      status.lastAlertSentTime = now;
      status.isRecoverySent = false;
      sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, activeAlerts, 'accident_new', {
        logger: req.log,
        requestId: req.requestId
      });
    } else if (
      config.maxReminders > 0 &&
      now - status.lastAlertSentTime >= config.reminderIntervalMs &&
      now - status.alertStartTime < config.maxAlertDurationMs
    ) {
      status.lastAlertSentTime = now;
      sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, activeAlerts, 'accident_repeat', {
        logger: req.log,
        requestId: req.requestId
      });
    }
  } else if (status.isAlert) {
    status.isAlert = false;
    status.alertStartTime = 0;
    status.lastAlertSentTime = 0;

    if (!status.isRecoverySent) {
      status.isRecoverySent = true;
      sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, [], 'recovery', {
        logger: req.log,
        requestId: req.requestId
      });
    }
  }

  const lastSave = lastHistoricalSaveTime[deviceID] ?? 0;
  if (now - lastSave > config.historicalIntervalMs) {
    try {
      await historyRepository.record(latestSnapshotRecord);
      lastHistoricalSaveTime[deviceID] = now;
      if (!isAlerting) {
        sendTelegramAlert(telegramBot, deviceID, latestData[deviceID], lantai, [], 'routine', {
          logger: req.log,
          requestId: req.requestId
        });
      }
    } catch (err) {
      req.log.error({ err, deviceId: deviceID }, '[Historical Log] Failed to write data');
    }
  }

  res.status(200).send(`Data from ${deviceID} received successfully.`);
});

app.get('/api/latest', authenticateRequest, async (_req: Request, res: Response) => {
  const now = Date.now();
  const updates: Promise<void>[] = [];

  Object.values(latestData).forEach(entry => {
    if (now - entry.lastActive > ESP_INACTIVE_THRESHOLD_MS && entry.espStatus !== 'inactive') {
      entry.espStatus = 'inactive';
      updates.push(latestSnapshotRepository.updateStatus(entry.deviceID, 'inactive'));
    }
  });

  if (updates.length > 0) {
    await Promise.allSettled(updates);
  }

  res.json(latestData);
});

app.get('/api/history', authenticateRequest, async (req: Request, res: Response) => {
  try {
    const groupedHistory = await historyRepository.findAllGrouped();
    const allHistory: Record<string, LatestDeviceSnapshot[]> = {};

    for (const [deviceId, entries] of groupedHistory.entries()) {
      allHistory[deviceId] = entries.map(toLatestDeviceSnapshot);
    }

    res.json(allHistory);
  } catch (error) {
    req.log.error({ err: error }, 'Error reading historical data');
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
        latestData[deviceId] = {
          ...latestData[deviceId],
          displayName
        };
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
    app.listen(port, host, () => {
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

function normalizeSensorPayload(
  payload: RawSensorPayload,
  logger: Logger
): Omit<LatestDeviceSnapshot, 'timestamp' | 'espStatus' | 'lastActive' | 'displayName'> {
  return {
    deviceID: payload.deviceID,
    amonia: stringifyIfNeeded(payload.amonia, logger),
    air: stringifyIfNeeded(payload.air, logger),
    sabun: stringifyIfNeeded(payload.sabun, logger),
    tisu: stringifyIfNeeded(payload.tisu, logger)
  };
}

function stringifyIfNeeded(value: unknown, logger: Logger): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    logger.error({ err: error }, 'Failed to stringify sensor payload, defaulting to empty object');
    return '{}';
  }
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
    air: snapshot.air,
    sabun: snapshot.sabun,
    tisu: snapshot.tisu,
    timestamp: new Date(snapshot.timestamp),
    espStatus: snapshot.espStatus === 'inactive' ? 'inactive' : 'active',
    lastActive: new Date(snapshot.lastActive)
  };
}

function toLatestDeviceSnapshot(record: SnapshotRecord): LatestDeviceSnapshot {
  return {
    deviceID: record.deviceId,
    displayName: record.displayName,
    amonia: record.amonia,
    air: record.air,
    sabun: record.sabun,
    tisu: record.tisu,
    timestamp: record.timestamp.toISOString(),
    espStatus: record.espStatus,
    lastActive: record.lastActive.getTime()
  };
}

function getActiveAlerts(
  deviceID: string,
  soapStatusConfirmed: SoapStatus,
  tissueRaw: string,
  logger: Logger = appLogger
): string[] {
  const alerts: string[] = [];

  if (soapStatusConfirmed === 'critical') {
    alerts.push('SABUN HAMPIR HABIS');
  }

  const tissue = parseJson<TissueSensorData>(tissueRaw, defaultTissueData(), logger);
  const statusTisu1 = tissue.tisu1.status;
  const statusTisu2 = tissue.tisu2.status;

  if (statusTisu1 === 'Habis' || statusTisu2 === 'Habis') {
    alerts.push('TISU HAMPIR HABIS');
  }

  return alerts;
}

function sendTelegramAlert(
  bot: TelegramBot | null,
  deviceID: string,
  sensorData: LatestDeviceSnapshot,
  lantai: number,
  activeAlerts: string[],
  type: AlertType,
  context: { logger?: Logger; requestId?: string } = {}
) {
  if (!bot) {
    return;
  }

  if (lantai <= 0) {
    return;
  }

  const logger = context.logger ?? appLogger;
  const amonia = parseJson<AmmoniaSensorData>(sensorData.amonia, { ppm: NaN, score: NaN, status: 'Data tidak ada' }, logger);
  const water = parseJson<WaterSensorData>(sensorData.air, { status: 'Data tidak ada' }, logger);
  const soap = parseJson<SoapSensorData>(sensorData.sabun, defaultSoapData(), logger);
  const tissue = parseJson<TissueSensorData>(sensorData.tisu, defaultTissueData(), logger);
  const timestamp = new Date(sensorData.timestamp).toLocaleString();

  const isAnySoapCritical =
    soap.sabun1.status === 'Habis' || soap.sabun2.status === 'Habis' || soap.sabun3.status === 'Habis';
  const isAnyTissueCritical = tissue.tisu1.status === 'Habis' || tissue.tisu2.status === 'Habis';

  const soapStatusKeseluruhan = isAnySoapCritical ? 'HAMPIR HABIS' : 'Aman';
  const tissueStatusKeseluruhan = isAnyTissueCritical ? 'HAMPIR HABIS' : 'Tersedia';

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

    const statusDetails = [
      `Bau: ${amonia.status} (${Number.isFinite(amonia.ppm) ? `${amonia.ppm} ppm` : 'Data tidak ada'})`,
      `Genangan Air: ${water.status}`,
      `Sabun: ${soapStatusKeseluruhan}`,
      `Tisu: ${tissueStatusKeseluruhan}`
    ].join('\n');

    const requestSuffix = context.requestId ? `\nRequest ID: ${context.requestId}` : '';

    bot
      .sendMessage(Number(chatID), `${message}${statusDetails}${requestSuffix}`)
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
    tisu1: { status: 'Data tidak ada' },
    tisu2: { status: 'Data tidak ada' }
  };
}

async function bootstrap(): Promise<void> {
  try {
    const storedConfig = await configRepository.get();
    config = deriveConfig(storedConfig ?? DEFAULT_CONFIG_BASE);

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

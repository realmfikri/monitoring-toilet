import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';

const logDir = process.env.LOG_DIR ?? path.join(process.cwd(), 'logs');
mkdirSync(logDir, { recursive: true });

const accessLogPath = process.env.ACCESS_LOG_PATH ?? path.join(logDir, 'access.log');
const errorLogPath = process.env.ERROR_LOG_PATH ?? path.join(logDir, 'error.log');
const appLogPath = process.env.APP_LOG_PATH ?? path.join(logDir, 'app.log');

const accessTargets = [
  {
    target: 'pino/file',
    level: process.env.ACCESS_LOG_LEVEL ?? 'info',
    options: { destination: accessLogPath, mkdir: true }
  }
];

if (process.env.LOG_TO_STDOUT !== 'false') {
  accessTargets.push({
    target: 'pino/file',
    level: process.env.ACCESS_LOG_LEVEL ?? 'info',
    options: { destination: process.stdout.fd as unknown as string, mkdir: false }
  });
}

export const accessLogger = pino(
  {
    level: process.env.ACCESS_LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'monitoring-toilet-backend', stream: 'access' }
  },
  pino.transport({ targets: accessTargets })
);

const appTargets = [
  {
    target: 'pino/file',
    level: process.env.LOG_LEVEL ?? 'info',
    options: { destination: appLogPath, mkdir: true }
  },
  {
    target: 'pino/file',
    level: 'error',
    options: { destination: errorLogPath, mkdir: true }
  }
];

if (process.env.LOG_TO_STDOUT !== 'false') {
  appTargets.push({
    target: 'pino/file',
    level: process.env.LOG_LEVEL ?? 'info',
    options: { destination: process.stdout.fd as unknown as string, mkdir: false }
  });
}

export const appLogger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'monitoring-toilet-backend', stream: 'application' }
  },
  pino.transport({ targets: appTargets })
);

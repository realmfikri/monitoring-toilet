import fs from 'fs';
import path from 'path';

import dotenv from 'dotenv';
import { z } from 'zod';

const nodeEnv = process.env.NODE_ENV || 'development';
const envFileName = `.env.${nodeEnv}`;
const envFilePath = path.resolve(process.cwd(), envFileName);
if (fs.existsSync(envFilePath)) {
  dotenv.config({ path: envFilePath });
} else {
  dotenv.config();
}

type Environment = 'development' | 'production' | string;

const envSchema = z.enum(['development', 'production']).catch('development');

const normalizedEnv = envSchema.parse((process.env.NODE_ENV ?? 'development').toLowerCase());

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const environmentSpecificOrigins =
  normalizedEnv === 'production'
    ? parseList(process.env.CORS_ALLOWED_ORIGINS_PRODUCTION)
    : parseList(process.env.CORS_ALLOWED_ORIGINS_DEVELOPMENT);

const fallbackOrigins = parseList(process.env.CORS_ALLOWED_ORIGINS);
const allowedOriginsList = environmentSpecificOrigins.length > 0 ? environmentSpecificOrigins : fallbackOrigins;

const environmentSpecificApiKeys =
  normalizedEnv === 'production'
    ? parseList(process.env.API_KEYS_PRODUCTION)
    : parseList(process.env.API_KEYS_DEVELOPMENT);

const fallbackApiKeys = parseList(process.env.API_KEYS);
const apiKeysList = environmentSpecificApiKeys.length > 0 ? environmentSpecificApiKeys : fallbackApiKeys;

const defaultRateLimitWindowMs = normalizedEnv === 'production' ? 60_000 : 60_000;
const defaultRateLimitMax = normalizedEnv === 'production' ? 120 : 300;

const rateLimitWindowMs = parsePositiveInt(
  normalizedEnv === 'production' ? process.env.RATE_LIMIT_WINDOW_MS_PRODUCTION : process.env.RATE_LIMIT_WINDOW_MS_DEVELOPMENT,
  defaultRateLimitWindowMs
);

const rateLimitMax = parsePositiveInt(
  normalizedEnv === 'production' ? process.env.RATE_LIMIT_MAX_PRODUCTION : process.env.RATE_LIMIT_MAX_DEVELOPMENT,
  defaultRateLimitMax
);

const apiKeys = new Set(apiKeysList);
const allowedOrigins = new Set(allowedOriginsList);

const authSecret = process.env.AUTH_SECRET || (normalizedEnv === 'production' ? undefined : 'development-secret');
if (!authSecret) {
  throw new Error('AUTH_SECRET must be set in production environments.');
}

const tokenExpiration = process.env.AUTH_TOKEN_EXPIRATION || '12h';

export interface AppConfig {
  environment: Environment;
  allowedOrigins: readonly string[];
  rateLimit: {
    windowMs: number;
    max: number;
  };
  requireCloudflareAuth: boolean;
  allowRequestsWithoutOrigin: boolean;
  trustProxy: boolean;
  auth: {
    secret: string;
    tokenExpiration: string;
  };
}

export const appConfig: AppConfig = {
  environment: normalizedEnv,
  allowedOrigins: allowedOriginsList,
  rateLimit: {
    windowMs: rateLimitWindowMs,
    max: rateLimitMax
  },
  requireCloudflareAuth: normalizedEnv === 'production' ? process.env.REQUIRE_CLOUDFLARE_AUTH !== 'false' : process.env.REQUIRE_CLOUDFLARE_AUTH === 'true',
  allowRequestsWithoutOrigin: normalizedEnv !== 'production',
  trustProxy: true,
  auth: {
    secret: authSecret,
    tokenExpiration
  }
};

export function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.has(origin);
}

export function isValidApiKey(key: string | null | undefined): boolean {
  if (!key) {
    return false;
  }
  return apiKeys.has(key);
}

export function getConfiguredApiKeys(): string[] {
  return Array.from(apiKeys);
}

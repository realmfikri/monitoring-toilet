-- CreateEnum
CREATE TYPE "EspStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "DeviceLatestSnapshot" (
    "deviceId" TEXT PRIMARY KEY,
    "amonia" TEXT,
    "air" TEXT,
    "sabun" TEXT,
    "tisu" TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "espStatus" "EspStatus" NOT NULL,
    "lastActive" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CreateTable
CREATE TABLE "DeviceHistory" (
    "id" BIGSERIAL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "amonia" TEXT,
    "air" TEXT,
    "sabun" TEXT,
    "tisu" TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "espStatus" "EspStatus" NOT NULL,
    "lastActive" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "DeviceHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "DeviceLatestSnapshot"("deviceId") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "TelegramSubscriber" (
    "chatId" TEXT PRIMARY KEY,
    "lantai" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CreateTable
CREATE TABLE "ConfigOverride" (
    "key" TEXT PRIMARY KEY,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CreateIndex
CREATE INDEX "DeviceHistory_deviceId_timestamp_idx" ON "DeviceHistory"("deviceId", "timestamp");

-- Retention policy: keep history for 30 days or the latest 1000 rows per device
CREATE OR REPLACE FUNCTION prune_device_history() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM "DeviceHistory"
  WHERE "deviceId" = NEW."deviceId"
    AND (
      "timestamp" < NOW() - INTERVAL '30 days'
      OR "id" NOT IN (
        SELECT "id" FROM "DeviceHistory"
        WHERE "deviceId" = NEW."deviceId"
        ORDER BY "timestamp" DESC
        LIMIT 1000
      )
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_history_retention
AFTER INSERT ON "DeviceHistory"
FOR EACH ROW
EXECUTE FUNCTION prune_device_history();

-- Trigger to keep updatedAt in sync
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_latest_snapshot_set_updated
BEFORE UPDATE ON "DeviceLatestSnapshot"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER telegram_subscriber_set_updated
BEFORE UPDATE ON "TelegramSubscriber"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER config_override_set_updated
BEFORE UPDATE ON "ConfigOverride"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

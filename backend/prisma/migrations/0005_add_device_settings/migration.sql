-- Create DeviceSettings table for per-device sensor toggles
CREATE TABLE IF NOT EXISTS "DeviceSettings" (
    "deviceId" TEXT PRIMARY KEY,
    "sensorConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Keep updatedAt in sync on updates
CREATE OR REPLACE FUNCTION device_settings_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS device_settings_set_updated_at_trigger ON "DeviceSettings";
CREATE TRIGGER device_settings_set_updated_at_trigger
BEFORE UPDATE ON "DeviceSettings"
FOR EACH ROW
EXECUTE FUNCTION device_settings_set_updated_at();

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPERVISOR', 'OPERATOR');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "User_email_key" UNIQUE ("email")
);

-- Trigger to keep updatedAt in sync
CREATE TRIGGER user_set_updated
BEFORE UPDATE ON "User"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

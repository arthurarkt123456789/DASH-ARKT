import { prisma } from "./db";

export async function ensureSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LedgerEntryLine" (
      "id"            BIGINT PRIMARY KEY,
      "label"         TEXT NOT NULL DEFAULT '',
      "debit"         DOUBLE PRECISION NOT NULL,
      "credit"        DOUBLE PRECISION NOT NULL,
      "date"          DATE NOT NULL,
      "accountNumber" TEXT NOT NULL,
      "createdAt"     TIMESTAMPTZ NOT NULL,
      "updatedAt"     TIMESTAMPTZ NOT NULL,
      "syncedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SyncLog" (
      "id"            SERIAL PRIMARY KEY,
      "startedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "finishedAt"    TIMESTAMPTZ,
      "linesUpserted" INTEGER NOT NULL DEFAULT 0,
      "error"         TEXT
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_ledger_date" ON "LedgerEntryLine"("date")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_ledger_account" ON "LedgerEntryLine"("accountNumber")`
  );
}

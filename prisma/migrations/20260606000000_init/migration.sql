CREATE TABLE "LedgerEntryLine" (
    "id" BIGINT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "debit" DOUBLE PRECISION NOT NULL,
    "credit" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntryLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncLog" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "linesUpserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerEntryLine_date_idx" ON "LedgerEntryLine"("date");
CREATE INDEX "LedgerEntryLine_accountNumber_idx" ON "LedgerEntryLine"("accountNumber");

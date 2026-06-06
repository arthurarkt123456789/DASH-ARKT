import { NextResponse } from "next/server";
import { fetchLedgerEntries } from "@/lib/pennylane";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/migrate";

// Exercice fiscal oct→sep
function getFiscalYears() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const fyStart = month >= 10 ? year : year - 1;
  return {
    start: `${fyStart - 1}-10-01`, // début N-1
    end: `${fyStart + 1}-09-30`,   // fin N
  };
}

const SYNC_SECRET = process.env.SYNC_SECRET;

export async function POST(req: Request) {
  if (SYNC_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${SYNC_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  await ensureSchema();
  const log = await prisma.syncLog.create({ data: {} });

  try {
    const { start, end } = getFiscalYears();
    const lines = await fetchLedgerEntries(start, end);

    // Upsert par batch de 100
    let upserted = 0;
    const BATCH = 100;
    for (let i = 0; i < lines.length; i += BATCH) {
      const batch = lines.slice(i, i + BATCH);
      await Promise.all(
        batch.map((l) =>
          prisma.ledgerEntryLine.upsert({
            where: { id: BigInt(l.id) },
            update: {
              debit: parseFloat(l.debit),
              credit: parseFloat(l.credit),
              label: l.label ?? "",
              updatedAt: new Date(l.updated_at),
              syncedAt: new Date(),
            },
            create: {
              id: BigInt(l.id),
              label: l.label ?? "",
              debit: parseFloat(l.debit),
              credit: parseFloat(l.credit),
              date: new Date(l.date),
              accountNumber: l.ledger_account.number,
              createdAt: new Date(l.created_at),
              updatedAt: new Date(l.updated_at),
            },
          })
        )
      );
      upserted += batch.length;
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), linesUpserted: upserted },
    });

    return NextResponse.json({ ok: true, linesUpserted: upserted, period: { start, end } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

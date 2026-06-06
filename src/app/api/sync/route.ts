import { NextResponse } from "next/server";
import { fetchLedgerEntries, fetchEntryLabels, fetchSupplierAccountLabels } from "@/lib/pennylane";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/migrate";

function getFiscalYears() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const fyStart = month >= 10 ? year : year - 1;
  return {
    start: `${fyStart - 1}-10-01`,
    end: `${fyStart + 1}-09-30`,
  };
}

const SYNC_SECRET = process.env.SYNC_SECRET;

export async function POST(req: Request) {
  try {
    if (SYNC_SECRET) {
      const auth = req.headers.get("authorization");
      if (auth !== `Bearer ${SYNC_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    await ensureSchema();

    const log = await prisma.syncLog.create({ data: {} });
    const { start, end } = getFiscalYears();
    const entryLabels = await fetchEntryLabels(start, end);
    await new Promise((r) => setTimeout(r, 2000));
    const supplierLabels = await fetchSupplierAccountLabels();
    await new Promise((r) => setTimeout(r, 2000));
    const lines = await fetchLedgerEntries(start, end);

    // Upsert supplier account labels (401xxx → nom fournisseur)
    for (const [number, label] of supplierLabels) {
      await prisma.$executeRaw`
        INSERT INTO "LedgerAccount" ("number", "label")
        VALUES (${number}, ${label})
        ON CONFLICT ("number") DO UPDATE SET "label" = ${label}
      `;
    }

    let upserted = 0;
    const BATCH = 50;
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
              entryLabel: entryLabels.get(l.ledger_entry.id) ?? "",
              updatedAt: new Date(l.updated_at),
              syncedAt: new Date(),
            },
            create: {
              id: BigInt(l.id),
              label: l.label ?? "",
              entryLabel: entryLabels.get(l.ledger_entry.id) ?? "",
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
    console.error("[sync] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

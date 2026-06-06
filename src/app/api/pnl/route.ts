import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildPnL } from "@/lib/pennylane";
import type { LedgerEntryLine } from "@/lib/pennylane";
import { ensureSchema } from "@/lib/migrate";

function getFiscalYears() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const fyStart = month >= 10 ? year : year - 1;
  return {
    current: { start: `${fyStart}-10-01`, end: `${fyStart + 1}-09-30` },
    previous: { start: `${fyStart - 1}-10-01`, end: `${fyStart}-09-30` },
  };
}

export async function GET() {
  try {
    await ensureSchema();
    const { current, previous } = getFiscalYears();

    const toLines = (rows: { id: bigint; label: string; debit: number; credit: number; date: Date; accountNumber: string }[]): LedgerEntryLine[] =>
      rows.map((r) => ({
        id: Number(r.id),
        label: r.label,
        debit: String(r.debit),
        credit: String(r.credit),
        date: r.date.toISOString().slice(0, 10),
        created_at: "",
        updated_at: "",
        ledger_account: { id: 0, number: r.accountNumber, url: "" },
      }));

    const [currentRows, previousRows, lastSync] = await Promise.all([
      prisma.ledgerEntryLine.findMany({
        where: { date: { gte: new Date(current.start), lte: new Date(current.end) } },
        select: { id: true, label: true, debit: true, credit: true, date: true, accountNumber: true },
      }),
      prisma.ledgerEntryLine.findMany({
        where: { date: { gte: new Date(previous.start), lte: new Date(previous.end) } },
        select: { id: true, label: true, debit: true, credit: true, date: true, accountNumber: true },
      }),
      prisma.syncLog.findFirst({
        where: { finishedAt: { not: null }, error: null },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true, linesUpserted: true },
      }),
    ]);

    if (currentRows.length === 0 && previousRows.length === 0) {
      return NextResponse.json({ error: "Aucune donnée en base. Lance /api/sync d'abord." }, { status: 404 });
    }

    return NextResponse.json({
      current: buildPnL(toLines(currentRows), current.start, current.end),
      previous: buildPnL(toLines(previousRows), previous.start, previous.end),
      lastSync,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

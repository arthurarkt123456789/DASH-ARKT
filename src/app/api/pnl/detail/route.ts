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

const toLines = (
  rows: { id: bigint; label: string; debit: number; credit: number; date: Date; accountNumber: string }[]
): LedgerEntryLine[] =>
  rows.map((r) => ({
    id: Number(r.id),
    label: r.label,
    debit: String(r.debit),
    credit: String(r.credit),
    date: r.date.toISOString().slice(0, 10),
    created_at: "",
    updated_at: "",
    ledger_account: { id: 0, number: r.accountNumber, url: "" },
    ledger_entry: { id: 0 },
  }));

// Returns monthly PnL data + per-supplier per-month 6xx amounts for client-side recalculation
export async function GET() {
  try {
    await ensureSchema();
    const { current, previous } = getFiscalYears();

    const startDate = new Date(current.start);
    const endDate = new Date(current.end);
    const prevStartDate = new Date(previous.start);
    const prevEndDate = new Date(previous.end);

    const supplierMonthlyQuery = (from: Date, to: Date) => prisma.$queryRaw<{ supplier_key: string; month: string; amount: number }[]>`
      SELECT
        l401."accountNumber"                                         AS supplier_key,
        TO_CHAR(DATE_TRUNC('month', l6."date"), 'YYYY-MM')          AS month,
        SUM(l6."debit" - l6."credit")::float                        AS amount
      FROM (
        SELECT DISTINCT "accountNumber", "entryLabel"
        FROM "LedgerEntryLine"
        WHERE "accountNumber" LIKE '401%'
          AND "entryLabel" != ''
          AND "date" >= ${from}::date
          AND "date" <= ${to}::date
      ) l401
      JOIN (
        SELECT DISTINCT id, "entryLabel", "debit", "credit", "date"
        FROM "LedgerEntryLine"
        WHERE ("accountNumber" LIKE '60%' OR "accountNumber" LIKE '61%' OR "accountNumber" LIKE '62%')
          AND "entryLabel" != ''
          AND "date" >= ${from}::date
          AND "date" <= ${to}::date
      ) l6 ON l6."entryLabel" = l401."entryLabel"
      GROUP BY l401."accountNumber", DATE_TRUNC('month', l6."date")
      HAVING SUM(l6."debit" - l6."credit") > 0
    `;

    const [currentRows, previousRows, supplierRows, prevSupplierRows] = await Promise.all([
      prisma.ledgerEntryLine.findMany({
        where: { date: { gte: startDate, lte: endDate } },
        select: { id: true, label: true, debit: true, credit: true, date: true, accountNumber: true },
      }),
      prisma.ledgerEntryLine.findMany({
        where: { date: { gte: prevStartDate, lte: prevEndDate } },
        select: { id: true, label: true, debit: true, credit: true, date: true, accountNumber: true },
      }),
      supplierMonthlyQuery(startDate, endDate),
      supplierMonthlyQuery(prevStartDate, prevEndDate),
    ]);

    const currentPnL = buildPnL(toLines(currentRows), current.start, current.end);
    const previousPnL = buildPnL(toLines(previousRows), previous.start, previous.end);

    const buildSupplierMap = (rows: { supplier_key: string; month: string; amount: number }[]) => {
      const map: Record<string, Record<string, number>> = {};
      for (const row of rows) {
        if (!map[row.supplier_key]) map[row.supplier_key] = {};
        map[row.supplier_key][row.month] = Number(row.amount);
      }
      return map;
    };

    return NextResponse.json({
      currentMonthly: currentPnL.monthly,
      previousMonthly: previousPnL.monthly,
      supplierMonthly: buildSupplierMap(supplierRows),
      previousSupplierMonthly: buildSupplierMap(prevSupplierRows),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

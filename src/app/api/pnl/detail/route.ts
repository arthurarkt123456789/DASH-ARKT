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

interface EntryRow {
  supplier_key: string;
  supplier_label: string;
  entry_label: string;
  month: string;
  amount: number;
}

// Per-invoice (entryLabel) per-month 6xx amounts, with supplier name
const entryQuery = (from: Date, to: Date) =>
  prisma.$queryRaw<EntryRow[]>`
    SELECT
      l401."accountNumber"                                        AS supplier_key,
      COALESCE(la."label", l401."accountNumber")                  AS supplier_label,
      l401."entryLabel"                                           AS entry_label,
      TO_CHAR(DATE_TRUNC('month', l6."date"), 'YYYY-MM')         AS month,
      SUM(l6."debit" - l6."credit")::float                       AS amount
    FROM (
      SELECT DISTINCT "accountNumber", "entryLabel"
      FROM "LedgerEntryLine"
      WHERE "accountNumber" LIKE '401%'
        AND "entryLabel" != ''
        AND "date" >= ${from}::date
        AND "date" <= ${to}::date
    ) l401
    LEFT JOIN "LedgerAccount" la ON la."number" = l401."accountNumber"
    JOIN "LedgerEntryLine" l6
      ON l6."entryLabel" = l401."entryLabel"
      AND (l6."accountNumber" LIKE '60%' OR l6."accountNumber" LIKE '61%' OR l6."accountNumber" LIKE '62%')
      AND l6."date" >= ${from}::date
      AND l6."date" <= ${to}::date
    GROUP BY l401."accountNumber", la."label", l401."entryLabel", DATE_TRUNC('month', l6."date")
    HAVING SUM(l6."debit" - l6."credit") > 0
  `;

function buildEntryMap(rows: EntryRow[]) {
  const map: Record<string, { supplierKey: string; supplierLabel: string; months: Record<string, number> }> = {};
  for (const row of rows) {
    if (!map[row.entry_label]) {
      map[row.entry_label] = { supplierKey: row.supplier_key, supplierLabel: row.supplier_label, months: {} };
    }
    map[row.entry_label].months[row.month] = Number(row.amount);
  }
  return map;
}

export async function GET() {
  try {
    await ensureSchema();
    const { current, previous } = getFiscalYears();

    const startDate = new Date(current.start);
    const endDate = new Date(current.end);
    const prevStartDate = new Date(previous.start);
    const prevEndDate = new Date(previous.end);

    const [currentRows, previousRows, entryRows, prevEntryRows, categoryRows] = await Promise.all([
      prisma.ledgerEntryLine.findMany({
        where: { date: { gte: startDate, lte: endDate } },
        select: { id: true, label: true, debit: true, credit: true, date: true, accountNumber: true },
      }),
      prisma.ledgerEntryLine.findMany({
        where: { date: { gte: prevStartDate, lte: prevEndDate } },
        select: { id: true, label: true, debit: true, credit: true, date: true, accountNumber: true },
      }),
      entryQuery(startDate, endDate),
      entryQuery(prevStartDate, prevEndDate),
      prisma.$queryRaw<{ key: string; category: string }[]>`SELECT "key", "category" FROM "EntryCategory"`,
    ]);

    const categories: Record<string, string> = {};
    for (const row of categoryRows) categories[row.key] = row.category;

    return NextResponse.json({
      currentMonthly: buildPnL(toLines(currentRows), current.start, current.end).monthly,
      previousMonthly: buildPnL(toLines(previousRows), previous.start, previous.end).monthly,
      entries: buildEntryMap(entryRows),
      previousEntries: buildEntryMap(prevEntryRows),
      categories,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

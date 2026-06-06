import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/migrate";

function getFiscalYear() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const fyStart = month >= 10 ? year : year - 1;
  return {
    start: `${fyStart}-10-01`,
    end: `${fyStart + 1}-09-30`,
  };
}

export interface AnalyseMonthly {
  month: string;
  ca: number;
  cogs: number;
  marge_brute: number;
  charges_ext: number;
  charges_dirigeant: number;
  masse_salariale: number;
  ebe_ajuste: number;
}

export async function GET() {
  try {
    await ensureSchema();

    const { start, end } = getFiscalYear();

    const rows = await prisma.$queryRaw<{
      entryLabel: string;
      accountNumber: string;
      debit: number;
      credit: number;
      date: Date;
    }[]>`
      SELECT "entryLabel", "accountNumber", "debit", "credit", "date"
      FROM "LedgerEntryLine"
      WHERE "date" >= ${new Date(start)}::date
        AND "date" <= ${new Date(end)}::date
        AND ("accountNumber" LIKE '6%' OR "accountNumber" LIKE '7%')
    `;

    const categories = await prisma.$queryRaw<{ key: string; category: string }[]>`
      SELECT "key", "category" FROM "SupplierCategory"
    `;

    const catMap = new Map<string, string>(categories.map((c) => [c.key, c.category]));

    // Build monthly map
    const monthMap = new Map<string, {
      ca: number;
      cogs: number;
      charges_ext: number;
      charges_dirigeant: number;
      masse_salariale: number;
    }>();

    for (const row of rows) {
      const month = row.date.toISOString().slice(0, 7);
      if (!monthMap.has(month)) {
        monthMap.set(month, { ca: 0, cogs: 0, charges_ext: 0, charges_dirigeant: 0, masse_salariale: 0 });
      }
      const m = monthMap.get(month)!;

      const num = row.accountNumber;
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;

      if (num.startsWith("7")) {
        // Revenue: positive = credit - debit
        m.ca += credit - debit;
      } else if (num.startsWith("64")) {
        // Charges de personnel (masse salariale)
        m.masse_salariale += debit - credit;
      } else if (num.startsWith("6")) {
        // Charges — categorise by supplier label
        const amount = debit - credit;
        const supplierCat = row.entryLabel ? catMap.get(row.entryLabel) : undefined;

        if (supplierCat === "cogs") {
          m.cogs += amount;
        } else if (supplierCat === "charges_dirigeant") {
          m.charges_dirigeant += amount;
        } else {
          // "charges_ext" (explicit) or uncategorised => charges_ext
          m.charges_ext += amount;
        }
      }
    }

    const monthly: AnalyseMonthly[] = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => {
        const marge_brute = m.ca - m.cogs;
        const ebe_ajuste = marge_brute - m.charges_ext - m.masse_salariale;
        return {
          month,
          ca: Math.round(m.ca),
          cogs: Math.round(m.cogs),
          marge_brute: Math.round(marge_brute),
          charges_ext: Math.round(m.charges_ext),
          charges_dirigeant: Math.round(m.charges_dirigeant),
          masse_salariale: Math.round(m.masse_salariale),
          ebe_ajuste: Math.round(ebe_ajuste),
        };
      });

    return NextResponse.json({ monthly });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/migrate";

function fiscalStart() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  return `${m >= 10 ? y : y - 1}-10-01`;
}

export async function GET() {
  try {
    await ensureSchema();

    const start = fiscalStart();

    // Un fournisseur = un compte 401xxx unique
    // Total = somme des montants 6xx des écritures où ce compte 401 apparaît
    const rows = await prisma.$queryRaw<{ account: string; label: string; total: number }[]>`
      SELECT
        l401."accountNumber"                                          AS account,
        COALESCE(la."label", l401."accountNumber")                    AS label,
        SUM(CASE WHEN l6."accountNumber" LIKE '6%'
                 THEN l6."debit" - l6."credit" ELSE 0 END)::float    AS total
      FROM "LedgerEntryLine" l401
      JOIN "LedgerEntryLine" l6
        ON  l401."entryLabel" = l6."entryLabel"
        AND l401."entryLabel" != ''
      LEFT JOIN "LedgerAccount" la
        ON  la."number" = l401."accountNumber"
      WHERE l401."accountNumber" LIKE '401%'
        AND l6."accountNumber"   LIKE '6%'
        AND l401."date" >= ${start}::date
      GROUP BY l401."accountNumber", la."label"
      HAVING SUM(CASE WHEN l6."accountNumber" LIKE '6%'
                      THEN l6."debit" - l6."credit" ELSE 0 END) > 0
      ORDER BY total DESC
    `;

    const categories = await prisma.$queryRaw<{ key: string; category: string }[]>`
      SELECT "key", "category" FROM "SupplierCategory"
    `;
    const catMap = new Map(categories.map((c) => [c.key, c.category]));

    const result = rows.map((r) => ({
      key: r.account,          // compte 401xxx — clé de catégorisation
      label: r.label,          // nom lisible du fournisseur
      total: Number(r.total),
      category: catMap.get(r.account) ?? null,
    }));

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    await ensureSchema();
    const { key, category } = await req.json() as { key: string; category: string };
    await prisma.$executeRaw`
      INSERT INTO "SupplierCategory" ("key", "category", "updatedAt")
      VALUES (${key}, ${category}, NOW())
      ON CONFLICT ("key") DO UPDATE SET "category" = ${category}, "updatedAt" = NOW()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

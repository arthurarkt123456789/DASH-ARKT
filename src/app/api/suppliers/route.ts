import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/migrate";

// Exercice fiscal courant oct→sep
function fiscalStart() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const fyStart = m >= 10 ? y : y - 1;
  return `${fyStart}-10-01`;
}

export async function GET() {
  try {
    await ensureSchema();

    const start = fiscalStart();

    // Vrais fournisseurs = entries qui ont au moins une ligne 401xxx
    // On récupère leurs entryLabels puis on somme les montants 6xx
    const rows = await prisma.$queryRaw<{ entryLabel: string; total: number }[]>`
      SELECT
        l."entryLabel",
        SUM(CASE WHEN l."accountNumber" LIKE '6%' THEN l."debit" - l."credit" ELSE 0 END)::float AS total
      FROM "LedgerEntryLine" l
      WHERE
        l."entryLabel" != ''
        AND l."date" >= ${start}::date
        AND l."entryLabel" IN (
          SELECT DISTINCT "entryLabel"
          FROM "LedgerEntryLine"
          WHERE "accountNumber" LIKE '401%'
            AND "entryLabel" != ''
        )
      GROUP BY l."entryLabel"
      HAVING SUM(CASE WHEN l."accountNumber" LIKE '6%' THEN l."debit" - l."credit" ELSE 0 END) > 0
      ORDER BY total DESC
    `;

    const categories = await prisma.$queryRaw<{ key: string; category: string }[]>`
      SELECT "key", "category" FROM "SupplierCategory"
    `;
    const catMap = new Map(categories.map((c) => [c.key, c.category]));

    const result = rows.map((r) => ({
      key: r.entryLabel,
      total: Number(r.total),
      category: catMap.get(r.entryLabel) ?? null,
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

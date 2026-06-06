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

    // Étape 1 : pour chaque compte 401xxx, récupère les entryLabels distincts
    // Étape 2 : pour chaque entryLabel, somme les lignes 6xx UNE SEULE FOIS (SUM sur lignes distinctes)
    // L'agrégation se fait sur les lignes 6xx directement, pas via JOIN (évite les doublons)
    const rows = await prisma.$queryRaw<{ account: string; label: string; total: number }[]>`
      SELECT
        sub."account",
        COALESCE(la."label", sub."account") AS label,
        sub.total::float                    AS total
      FROM (
        SELECT
          l401."accountNumber"                                       AS account,
          SUM(l6."debit" - l6."credit")                             AS total
        FROM (
          -- un compte 401 par entryLabel distinct
          SELECT DISTINCT "accountNumber", "entryLabel"
          FROM "LedgerEntryLine"
          WHERE "accountNumber" LIKE '401%'
            AND "entryLabel" != ''
            AND "date" >= ${start}::date
        ) l401
        -- lignes 6xx de ces écritures (chaque ligne 6xx comptée une seule fois)
        JOIN (
          SELECT DISTINCT id, "entryLabel", "debit", "credit"
          FROM "LedgerEntryLine"
          WHERE "accountNumber" LIKE '6%'
            AND "entryLabel" != ''
            AND "date" >= ${start}::date
        ) l6 ON l6."entryLabel" = l401."entryLabel"
        GROUP BY l401."accountNumber"
        HAVING SUM(l6."debit" - l6."credit") > 0
      ) sub
      LEFT JOIN "LedgerAccount" la ON la."number" = sub."account"
      ORDER BY sub.total DESC
    `;

    const categories = await prisma.$queryRaw<{ key: string; category: string }[]>`
      SELECT "key", "category" FROM "SupplierCategory"
    `;
    const catMap = new Map(categories.map((c) => [c.key, c.category]));

    return NextResponse.json(
      rows.map((r) => ({
        key: r.account,
        label: r.label,
        total: Number(r.total),
        category: catMap.get(r.account) ?? null,
      }))
    );
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

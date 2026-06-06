import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/migrate";

export async function GET() {
  try {
    await ensureSchema();

    const rows = await prisma.$queryRaw<{ entryLabel: string; accountNumber: string }[]>`
      SELECT DISTINCT "entryLabel", "accountNumber"
      FROM "LedgerEntryLine"
      WHERE "accountNumber" LIKE '6%' AND "entryLabel" != ''
      ORDER BY "entryLabel"
    `;

    const categories = await prisma.$queryRaw<{ key: string; category: string }[]>`
      SELECT "key", "category" FROM "SupplierCategory"
    `;

    const catMap = new Map<string, string>(categories.map((c) => [c.key, c.category]));

    // Group by entryLabel, collect unique accountNumbers
    const supplierMap = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!supplierMap.has(row.entryLabel)) {
        supplierMap.set(row.entryLabel, new Set());
      }
      supplierMap.get(row.entryLabel)!.add(row.accountNumber);
    }

    const result = Array.from(supplierMap.entries()).map(([key, accounts]) => ({
      key,
      category: catMap.get(key) ?? null,
      accounts: Array.from(accounts).sort(),
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

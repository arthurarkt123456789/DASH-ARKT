import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSchema } from "@/lib/migrate";

export async function PATCH(req: Request) {
  try {
    await ensureSchema();
    const { key, category } = await req.json() as { key: string; category: string };
    await prisma.$executeRaw`
      INSERT INTO "EntryCategory" ("key", "category", "updatedAt")
      VALUES (${key}, ${category}, NOW())
      ON CONFLICT ("key") DO UPDATE SET "category" = ${category}, "updatedAt" = NOW()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

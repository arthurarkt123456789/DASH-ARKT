import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL;
  const dbConfigured = !!dbUrl;
  const dbMasked = dbUrl
    ? dbUrl.replace(/:\/\/[^@]+@/, "://***@")
    : "not set";

  let dbConnected = false;
  let dbError = "";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    dbConfigured,
    dbMasked,
    dbConnected,
    dbError: dbError || null,
    pennylaneKey: !!process.env.PENNYLANE_API_KEY,
  });
}

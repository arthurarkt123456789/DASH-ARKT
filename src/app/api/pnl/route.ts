import { NextResponse } from "next/server";
import { fetchLedgerEntries, buildPnL } from "@/lib/pennylane";

// Exercice fiscal ARKT : 1er octobre → 30 septembre
function getFiscalYears() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1; // 1-indexed

  // Si on est avant octobre, l'exercice en cours a commencé l'année civile précédente
  const currentFYStart = month >= 10 ? year : year - 1;

  return {
    current: {
      start: `${currentFYStart}-10-01`,
      end: `${currentFYStart + 1}-09-30`,
    },
    previous: {
      start: `${currentFYStart - 1}-10-01`,
      end: `${currentFYStart}-09-30`,
    },
  };
}

export async function GET() {
  try {
    const { current, previous } = getFiscalYears();

    const [currentEntries, previousEntries] = await Promise.all([
      fetchLedgerEntries(current.start, current.end),
      fetchLedgerEntries(previous.start, previous.end),
    ]);

    const currentPnL = buildPnL(currentEntries, current.start, current.end);
    const previousPnL = buildPnL(previousEntries, previous.start, previous.end);

    return NextResponse.json({
      current: currentPnL,
      previous: previousPnL,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const BASE_URL = "https://app.pennylane.com/api/external/v2";

function getHeaders() {
  const apiKey = process.env.PENNYLANE_API_KEY;
  if (!apiKey) throw new Error("PENNYLANE_API_KEY is not set");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function fetchPennylane<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: getHeaders(),
    next: { revalidate: 900 },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pennylane API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LedgerEntryLine {
  id: number;
  label: string;
  debit: string;
  credit: string;
  date: string;
  created_at: string;
  updated_at: string;
  ledger_account: {
    id: number;
    number: string;
    url: string;
  };
}

interface LedgerEntryLinesResponse {
  items: LedgerEntryLine[];
  has_more: boolean;
  next_cursor: string | null;
}

// ─── Fetch all ledger entry lines for a date range (cursor pagination) ────────

export async function fetchLedgerEntries(
  startDate: string,
  endDate: string
): Promise<LedgerEntryLine[]> {
  const lines: LedgerEntryLine[] = [];
  let cursor: string | undefined;

  while (true) {
    const params: Record<string, string> = {
      date_from: startDate,
      date_to: endDate,
      limit: "100",
    };
    if (cursor) params["cursor"] = cursor;

    const data = await fetchPennylane<LedgerEntryLinesResponse>("/ledger_entry_lines", params);
    lines.push(...data.items);

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return lines;
}

// ─── P&L categorisation (Plan Comptable Général) ──────────────────────────────

export type PnLCategory =
  | "ca"
  | "autres_produits_exploit"
  | "achats_charges_ext"
  | "impots_taxes"
  | "charges_personnel"
  | "dotations_amort"
  | "autres_charges_exploit"
  | "charges_financieres"
  | "produits_financiers"
  | "charges_except"
  | "produits_except"
  | "impot_societes"
  | "other";

function categorize(num: string): PnLCategory {
  const p2 = num.slice(0, 2);
  const p1 = num.slice(0, 1);

  if (p2 === "70") return "ca";
  if (p1 === "7") {
    if (p2 === "76") return "produits_financiers";
    if (p2 === "77") return "produits_except";
    return "autres_produits_exploit";
  }
  if (p2 === "60" || p2 === "61" || p2 === "62") return "achats_charges_ext";
  if (p2 === "63") return "impots_taxes";
  if (p2 === "64") return "charges_personnel";
  if (p2 === "68") return "dotations_amort";
  if (p2 === "66") return "charges_financieres";
  if (p2 === "67") return "charges_except";
  if (p2 === "69") return "impot_societes";
  if (p1 === "6") return "autres_charges_exploit";
  return "other";
}

// ─── Build P&L ────────────────────────────────────────────────────────────────

export interface PnLReport {
  period: { start: string; end: string };
  ca: number;
  autres_produits: number;
  total_produits: number;
  achats_charges_ext: number;
  impots_taxes: number;
  charges_personnel: number;
  dotations_amort: number;
  autres_charges: number;
  total_charges: number;
  resultat_exploitation: number;
  produits_financiers: number;
  charges_financieres: number;
  resultat_financier: number;
  produits_except: number;
  charges_except: number;
  resultat_exceptionnel: number;
  impot_societes: number;
  resultat_net: number;
  lines: { accountNumber: string; category: PnLCategory; amount: number }[];
}

export function buildPnL(entries: LedgerEntryLine[], start: string, end: string): PnLReport {
  const lineMap = new Map<string, { category: PnLCategory; amount: number }>();

  for (const entry of entries) {
    const num = entry.ledger_account.number;
    const cat = categorize(num);
    if (cat === "other") continue;

    const debit = parseFloat(entry.debit) || 0;
    const credit = parseFloat(entry.credit) || 0;

    // Revenue (7xx): net = credit - debit
    // Expense (6xx): net = debit - credit
    const isRevenue = num.startsWith("7");
    const amount = isRevenue ? credit - debit : debit - credit;

    if (!lineMap.has(num)) lineMap.set(num, { category: cat, amount: 0 });
    lineMap.get(num)!.amount += amount;
  }

  const lines = Array.from(lineMap.entries()).map(([accountNumber, v]) => ({
    accountNumber,
    ...v,
  }));

  const sum = (...cats: PnLCategory[]) =>
    lines.filter((l) => cats.includes(l.category)).reduce((a, l) => a + l.amount, 0);

  const ca = sum("ca");
  const autres_produits = sum("autres_produits_exploit");
  const total_produits = ca + autres_produits;

  const achats_charges_ext = sum("achats_charges_ext");
  const impots_taxes = sum("impots_taxes");
  const charges_personnel = sum("charges_personnel");
  const dotations_amort = sum("dotations_amort");
  const autres_charges = sum("autres_charges_exploit");
  const total_charges = achats_charges_ext + impots_taxes + charges_personnel + dotations_amort + autres_charges;

  const resultat_exploitation = total_produits - total_charges;

  const produits_financiers = sum("produits_financiers");
  const charges_financieres = sum("charges_financieres");
  const resultat_financier = produits_financiers - charges_financieres;

  const produits_except = sum("produits_except");
  const charges_except = sum("charges_except");
  const resultat_exceptionnel = produits_except - charges_except;

  const impot_societes = sum("impot_societes");
  const resultat_net = resultat_exploitation + resultat_financier + resultat_exceptionnel - impot_societes;

  return {
    period: { start, end },
    ca, autres_produits, total_produits,
    achats_charges_ext, impots_taxes, charges_personnel, dotations_amort, autres_charges, total_charges,
    resultat_exploitation,
    produits_financiers, charges_financieres, resultat_financier,
    produits_except, charges_except, resultat_exceptionnel,
    impot_societes, resultat_net,
    lines,
  };
}

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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPennylane<T>(path: string, params?: Record<string, string>, retries = 4): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: getHeaders(),
    next: { revalidate: 900 },
  });
  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get("retry-after") ?? "2", 10);
    await delay((retryAfter + 1) * 1000);
    return fetchPennylane<T>(path, params, retries - 1);
  }
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
  ledger_entry: { id: number };
}

interface LedgerEntriesListResponse {
  items: { id: number; label: string }[];
  has_more: boolean;
  next_cursor: string | null;
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

// ─── Fetch all ledger entry labels for a date range (cursor pagination) ───────

export async function fetchEntryLabels(
  startDate: string,
  endDate: string
): Promise<Map<number, string>> {
  const labels = new Map<number, string>();
  let cursor: string | undefined;

  while (true) {
    const params: Record<string, string> = {
      date_from: startDate,
      date_to: endDate,
      limit: "100",
    };
    if (cursor) params["cursor"] = cursor;

    const data = await fetchPennylane<LedgerEntriesListResponse>("/ledger_entries", params);
    for (const item of data.items) {
      labels.set(item.id, item.label);
    }

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
    await new Promise((r) => setTimeout(r, 200));
  }

  return labels;
}

// ─── Fetch 401xxx account labels (nom des fournisseurs) ───────────────────────

interface LedgerAccountsResponse {
  items: { id: number; number: string; label: string }[];
  has_more: boolean;
  next_cursor: string | null;
}

export async function fetchSupplierAccountLabels(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | undefined;

  while (true) {
    const params: Record<string, string> = { limit: "100" };
    if (cursor) params["cursor"] = cursor;

    const data = await fetchPennylane<LedgerAccountsResponse>("/ledger_accounts", params);
    for (const item of data.items) {
      if (item.number.startsWith("401")) {
        map.set(item.number, item.label);
      }
    }

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
    await new Promise((r) => setTimeout(r, 200));
  }

  return map;
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

export interface MonthlyPnL {
  month: string; // "YYYY-MM"
  ca: number;
  achats_charges_ext: number;
  charges_personnel: number;
  total_produits: number;
  total_charges: number;
  ebe: number;
  resultat_exploitation: number;
}

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
  ebe: number;
  resultat_exploitation: number;
  produits_financiers: number;
  charges_financieres: number;
  resultat_financier: number;
  produits_except: number;
  charges_except: number;
  resultat_exceptionnel: number;
  impot_societes: number;
  is_estime: number;
  resultat_net: number;
  lines: { accountNumber: string; category: PnLCategory; amount: number }[];
  monthly: MonthlyPnL[];
}

function estimateIS(resultatAvantIS: number): number {
  if (resultatAvantIS <= 0) return 0;
  if (resultatAvantIS <= 42500) return resultatAvantIS * 0.15;
  return 42500 * 0.15 + (resultatAvantIS - 42500) * 0.25;
}

export function buildPnL(entries: LedgerEntryLine[], start: string, end: string): PnLReport {
  const lineMap = new Map<string, { category: PnLCategory; amount: number }>();
  const monthMap = new Map<string, { ca: number; achats_charges_ext: number; charges_personnel: number; impots_taxes: number; dotations_amort: number; autres_charges: number; autres_produits: number }>();

  for (const entry of entries) {
    const num = entry.ledger_account.number;
    const cat = categorize(num);
    if (cat === "other") continue;

    const debit = parseFloat(entry.debit) || 0;
    const credit = parseFloat(entry.credit) || 0;
    const isRevenue = num.startsWith("7");
    const amount = isRevenue ? credit - debit : debit - credit;

    if (!lineMap.has(num)) lineMap.set(num, { category: cat, amount: 0 });
    lineMap.get(num)!.amount += amount;

    // Monthly grouping (exploitation only)
    const month = entry.date.slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, { ca: 0, achats_charges_ext: 0, charges_personnel: 0, impots_taxes: 0, dotations_amort: 0, autres_charges: 0, autres_produits: 0 });
    const m = monthMap.get(month)!;
    if (cat === "ca") m.ca += amount;
    else if (cat === "autres_produits_exploit") m.autres_produits += amount;
    else if (cat === "achats_charges_ext") m.achats_charges_ext += amount;
    else if (cat === "impots_taxes") m.impots_taxes += amount;
    else if (cat === "charges_personnel") m.charges_personnel += amount;
    else if (cat === "dotations_amort") m.dotations_amort += amount;
    else if (cat === "autres_charges_exploit") m.autres_charges += amount;
  }

  const lines = Array.from(lineMap.entries()).map(([accountNumber, v]) => ({ accountNumber, ...v }));
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

  // EBE = CA + autres produits - charges externes - impôts - personnel (hors amort)
  const ebe = ca + autres_produits - achats_charges_ext - impots_taxes - charges_personnel;

  const resultat_exploitation = total_produits - total_charges;

  const produits_financiers = sum("produits_financiers");
  const charges_financieres = sum("charges_financieres");
  const resultat_financier = produits_financiers - charges_financieres;

  const produits_except = sum("produits_except");
  const charges_except = sum("charges_except");
  const resultat_exceptionnel = produits_except - charges_except;

  const impot_societes = sum("impot_societes");
  const resultat_avant_is = resultat_exploitation + resultat_financier + resultat_exceptionnel;
  const is_estime = impot_societes === 0 ? estimateIS(resultat_avant_is) : impot_societes;
  const resultat_net = resultat_avant_is - impot_societes;

  // Build sorted monthly array
  const monthly: MonthlyPnL[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => {
      const tp = m.ca + m.autres_produits;
      const tc = m.achats_charges_ext + m.impots_taxes + m.charges_personnel + m.dotations_amort + m.autres_charges;
      return {
        month,
        ca: m.ca,
        achats_charges_ext: m.achats_charges_ext,
        charges_personnel: m.charges_personnel,
        total_produits: tp,
        total_charges: tc,
        ebe: m.ca + m.autres_produits - m.achats_charges_ext - m.impots_taxes - m.charges_personnel,
        resultat_exploitation: tp - tc,
      };
    });

  return {
    period: { start, end },
    ca, autres_produits, total_produits,
    achats_charges_ext, impots_taxes, charges_personnel, dotations_amort, autres_charges, total_charges,
    ebe,
    resultat_exploitation,
    produits_financiers, charges_financieres, resultat_financier,
    produits_except, charges_except, resultat_exceptionnel,
    impot_societes, is_estime, resultat_net,
    lines,
    monthly,
  };
}

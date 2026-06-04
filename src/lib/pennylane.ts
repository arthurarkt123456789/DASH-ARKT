const BASE_URL = "https://app.pennylane.com/api/external/v1";

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
    next: { revalidate: 900 }, // 15 min cache
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pennylane API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  date: string;
  label: string;
  account_number: string;
  account_name: string;
  currency_amount: string;
  direction: "credit" | "debit";
  currency: string;
}

interface LedgerEntriesResponse {
  ledger_entries: LedgerEntry[];
  meta?: {
    next_cursor?: string;
    total_count?: number;
    current_page?: number;
    total_pages?: number;
  };
  // cursor-based pagination fallback
  next_cursor?: string;
}

// ─── Fetch all ledger entries for a date range (handles pagination) ────────────

export async function fetchLedgerEntries(
  startDate: string,
  endDate: string
): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  let cursor: string | undefined;
  let page = 1;

  while (true) {
    const params: Record<string, string> = {
      "filter[min_date]": startDate,
      "filter[max_date]": endDate,
    };

    if (cursor) {
      params["cursor"] = cursor;
    } else {
      params["page"] = String(page);
    }

    const data = await fetchPennylane<LedgerEntriesResponse>(
      "/ledger_entries",
      params
    );

    const batch = data.ledger_entries ?? [];
    entries.push(...batch);

    // Handle cursor-based pagination
    const nextCursor = data.next_cursor ?? data.meta?.next_cursor;
    if (nextCursor) {
      cursor = nextCursor;
      continue;
    }

    // Handle page-based pagination
    const totalPages = data.meta?.total_pages;
    if (totalPages && page < totalPages) {
      page++;
      continue;
    }

    break;
  }

  return entries;
}

// ─── Plan Comptable Général — classification ───────────────────────────────────

export type PnLCategory =
  | "ca"                    // 70x — Chiffre d'affaires
  | "autres_produits_exploit" // 71x-79x — Autres produits d'exploitation
  | "achats_charges_ext"    // 60x-62x — Achats & charges externes
  | "impots_taxes"          // 63x — Impôts et taxes
  | "charges_personnel"     // 64x — Charges de personnel
  | "dotations_amort"       // 68x — Dotations aux amortissements
  | "autres_charges_exploit" // 65x-67x, 69x — Autres charges d'exploitation
  | "produits_financiers"   // 76x — Produits financiers
  | "charges_financieres"   // 66x — Charges financières
  | "produits_except"       // 77x — Produits exceptionnels
  | "charges_except"        // 67x — Charges exceptionnelles
  | "impot_societes"        // 69x — Impôt sur les sociétés
  | "other";

function categorize(accountNumber: string): PnLCategory {
  const prefix2 = accountNumber.slice(0, 2);
  const prefix3 = accountNumber.slice(0, 3);
  const prefix1 = accountNumber.slice(0, 1);

  if (prefix2 === "70") return "ca";
  if (prefix1 === "7") return "autres_produits_exploit";

  if (prefix2 === "60" || prefix2 === "61" || prefix2 === "62") return "achats_charges_ext";
  if (prefix2 === "63") return "impots_taxes";
  if (prefix2 === "64") return "charges_personnel";
  if (prefix2 === "68") return "dotations_amort";
  if (prefix2 === "65" || prefix2 === "66" || prefix2 === "67" || prefix2 === "69") {
    if (prefix2 === "66") return "charges_financieres";
    if (prefix2 === "67") return "charges_except";
    if (prefix2 === "69") return "impot_societes";
    return "autres_charges_exploit";
  }

  void prefix3; // unused but reserved for finer categorisation
  return "other";
}

// ─── Build P&L from ledger entries ────────────────────────────────────────────

export interface PnLLine {
  label: string;
  amount: number;
}

export interface PnLReport {
  period: { start: string; end: string };

  // Produits
  ca: number;
  autres_produits: number;
  total_produits: number;

  // Charges
  achats_charges_ext: number;
  impots_taxes: number;
  charges_personnel: number;
  dotations_amort: number;
  autres_charges: number;
  total_charges: number;

  // Résultats
  resultat_exploitation: number;
  charges_financieres: number;
  resultat_financier: number;
  produits_except: number;
  charges_except: number;
  resultat_exceptionnel: number;
  impot_societes: number;
  resultat_net: number;

  // Detail lines per account
  lines: { accountNumber: string; accountName: string; category: PnLCategory; amount: number }[];
}

export function buildPnL(entries: LedgerEntry[], start: string, end: string): PnLReport {
  const lineMap = new Map<string, { accountName: string; category: PnLCategory; amount: number }>();

  for (const entry of entries) {
    const raw = parseFloat(entry.currency_amount ?? "0");
    if (isNaN(raw)) continue;

    // In French accounting, credit = positive for revenue (7xx), debit = positive for expenses (6xx)
    const isRevenue = entry.account_number.startsWith("7");
    const isExpense = entry.account_number.startsWith("6");

    let amount: number;
    if (isRevenue) {
      amount = entry.direction === "credit" ? raw : -raw;
    } else if (isExpense) {
      amount = entry.direction === "debit" ? raw : -raw;
    } else {
      continue; // ignore balance sheet accounts (1-5, 8)
    }

    const key = entry.account_number;
    if (!lineMap.has(key)) {
      lineMap.set(key, {
        accountName: entry.account_name,
        category: categorize(key),
        amount: 0,
      });
    }
    lineMap.get(key)!.amount += amount;
  }

  const lines = Array.from(lineMap.entries()).map(([accountNumber, v]) => ({
    accountNumber,
    ...v,
  }));

  const sum = (cat: PnLCategory | PnLCategory[]) => {
    const cats = Array.isArray(cat) ? cat : [cat];
    return lines
      .filter((l) => cats.includes(l.category))
      .reduce((acc, l) => acc + l.amount, 0);
  };

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

  const charges_financieres = sum("charges_financieres");
  const produits_financiers = sum("produits_financiers");
  const resultat_financier = produits_financiers - charges_financieres;

  const produits_except = sum("produits_except");
  const charges_except = sum("charges_except");
  const resultat_exceptionnel = produits_except - charges_except;

  const impot_societes = sum("impot_societes");
  const resultat_net = resultat_exploitation + resultat_financier + resultat_exceptionnel - impot_societes;

  return {
    period: { start, end },
    ca,
    autres_produits,
    total_produits,
    achats_charges_ext,
    impots_taxes,
    charges_personnel,
    dotations_amort,
    autres_charges,
    total_charges,
    resultat_exploitation,
    charges_financieres,
    resultat_financier,
    produits_except,
    charges_except,
    resultat_exceptionnel,
    impot_societes,
    resultat_net,
    lines,
  };
}

"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { MonthlyPnL } from "@/lib/pennylane";

const LineChart = dynamic(() => import("recharts").then((m) => m.LineChart), { ssr: false });
const BarChart = dynamic(() => import("recharts").then((m) => m.BarChart), { ssr: false });
const Line = dynamic(() => import("recharts").then((m) => m.Line), { ssr: false });
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const Legend = dynamic(() => import("recharts").then((m) => m.Legend), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });
const ReferenceLine = dynamic(() => import("recharts").then((m) => m.ReferenceLine), { ssr: false });

interface EntryDetail {
  supplierKey: string;
  supplierLabel: string;
  months: Record<string, number>; // "YYYY-MM" → amount
}

const CATEGORY_OPTIONS = [
  { value: "", label: "— Charges Externes (défaut)" },
  { value: "cogs", label: "COGS" },
  { value: "charges_dirigeant", label: "Charges dirigeants" },
];

function fmt(n: number, compact = false) {
  if (compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr", "05": "Mai", "06": "Jun",
  "07": "Jul", "08": "Aoû", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

const FISCAL_MONTHS = ["10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08", "09"];

export default function AnalyseView() {
  const [currentMonthly, setCurrentMonthly] = useState<MonthlyPnL[]>([]);
  const [previousMonthly, setPreviousMonthly] = useState<MonthlyPnL[]>([]);
  const [entries, setEntries] = useState<Record<string, EntryDetail>>({});
  const [previousEntries, setPreviousEntries] = useState<Record<string, EntryDetail>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detailMonth, setDetailMonth] = useState<string | null>(null); // "YYYY-MM"

  useEffect(() => {
    fetch("/api/pnl/detail")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setCurrentMonthly(d.currentMonthly ?? []);
        setPreviousMonthly(d.previousMonthly ?? []);
        setEntries(d.entries ?? {});
        setPreviousEntries(d.previousEntries ?? {});
        setCategories(d.categories ?? {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCategoryChange(entryLabel: string, category: string) {
    // Recalcul immédiat
    setCategories((prev) => ({ ...prev, [entryLabel]: category }));
    try {
      const res = await fetch("/api/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entryLabel, category }),
      });
      if (!res.ok) setSaveError("Erreur sauvegarde");
      else setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Maps mois → données ─────────────────────────────────────────────────────
  const currentMap = useMemo(
    () => Object.fromEntries(currentMonthly.map((m) => [m.month.slice(5, 7), m])),
    [currentMonthly]
  );
  const previousMap = useMemo(
    () => Object.fromEntries(previousMonthly.map((m) => [m.month.slice(5, 7), m])),
    [previousMonthly]
  );
  const mmToFull = useMemo(
    () => Object.fromEntries(currentMonthly.map((m) => [m.month.slice(5, 7), m.month])),
    [currentMonthly]
  );
  const mmToFullPrev = useMemo(
    () => Object.fromEntries(previousMonthly.map((m) => [m.month.slice(5, 7), m.month])),
    [previousMonthly]
  );
  // label ("Oct") → "YYYY-MM"
  const labelToFull = useMemo(
    () => Object.fromEntries(
      FISCAL_MONTHS.map((mm) => [MONTH_LABELS[mm], mmToFull[mm]]).filter(([, v]) => v)
    ),
    [mmToFull]
  );

  // ── Flags actifs ─────────────────────────────────────────────────────────────
  const hasCogs = useMemo(() => Object.values(categories).some((c) => c === "cogs"), [categories]);
  const hasDirigeants = useMemo(() => Object.values(categories).some((c) => c === "charges_dirigeant"), [categories]);

  // Catégorie fournisseur déduite des factures N pour calculer la Marge N-1
  const supplierCatDerived = useMemo(() => {
    const map = new Map<string, string>();
    for (const [label, cat] of Object.entries(categories)) {
      if (cat && entries[label]) {
        const suppKey = entries[label].supplierKey;
        const current = map.get(suppKey);
        if (!current || cat === "cogs" || (cat === "charges_dirigeant" && current !== "cogs")) {
          map.set(suppKey, cat);
        }
      }
    }
    return map;
  }, [categories, entries]);

  // ── Données mensuelles ajustées ─────────────────────────────────────────────
  const adjustedMonthly = useMemo(() => {
    return FISCAL_MONTHS.map((mm) => {
      const cur = currentMap[mm];
      const prev = previousMap[mm];
      const fullMonth = mmToFull[mm];
      const fullMonthPrev = mmToFullPrev[mm];

      let cogsAmt = 0, dirigeantsAmt = 0;
      if (fullMonth) {
        for (const [label, detail] of Object.entries(entries)) {
          const amt = detail.months[fullMonth] ?? 0;
          if (amt > 0) {
            const cat = categories[label] ?? "";
            if (cat === "cogs") cogsAmt += amt;
            else if (cat === "charges_dirigeant") dirigeantsAmt += amt;
          }
        }
      }

      let cogsAmtN1 = 0;
      if (fullMonthPrev) {
        for (const [, detail] of Object.entries(previousEntries)) {
          const amt = detail.months[fullMonthPrev] ?? 0;
          if (amt > 0 && supplierCatDerived.get(detail.supplierKey) === "cogs") {
            cogsAmtN1 += amt;
          }
        }
      }

      return {
        mm,
        label: MONTH_LABELS[mm],
        hasData: !!cur,
        hasPrevData: !!prev,
        ca: cur?.ca ?? 0,
        ca_n1: prev?.ca ?? 0,
        marge_n1: (prev?.ca ?? 0) - cogsAmtN1,
        charges_personnel: cur?.charges_personnel ?? 0,
        ebe_adj: cur ? cur.ebe + dirigeantsAmt : 0,
        cogs: cogsAmt,
        charges_dirigeants: dirigeantsAmt,
        charges_ext_adj: (cur?.achats_charges_ext ?? 0) - cogsAmt - dirigeantsAmt,
        marge: (cur?.ca ?? 0) - cogsAmt,
      };
    });
  }, [currentMap, previousMap, mmToFull, mmToFullPrev, entries, previousEntries, categories, supplierCatDerived]);

  // ── Données cumulées (graphique 1) ──────────────────────────────────────────
  const chartData = useMemo(() => {
    let cumCA = 0, cumMarge = 0, cumPersonnel = 0, cumChargesExt = 0;
    let cumDirigeants = 0, cumEBE = 0, cumCAN1 = 0, cumMargeN1 = 0;

    return adjustedMonthly
      .map((m) => {
        if (m.hasData) {
          cumCA += m.ca; cumMarge += m.marge;
          cumPersonnel += m.charges_personnel;
          cumChargesExt += m.charges_ext_adj;
          cumDirigeants += m.charges_dirigeants;
          cumEBE += m.ebe_adj;
        }
        if (m.hasPrevData) { cumCAN1 += m.ca_n1; cumMargeN1 += m.marge_n1; }

        const point: Record<string, string | number | null> = {
          month: m.label,
          "Masse salariale": m.hasData ? Math.round(cumPersonnel) : null,
          "Charges externes": m.hasData ? Math.round(cumChargesExt) : null,
          "EBE cumulé": m.hasData ? Math.round(cumEBE) : null,
        };
        if (hasCogs) {
          point["Marge cumulée"] = m.hasData ? Math.round(cumMarge) : null;
          point["Marge N-1 cumulée"] = m.hasPrevData ? Math.round(cumMargeN1) : null;
        } else {
          point["CA cumulé"] = m.hasData ? Math.round(cumCA) : null;
          point["CA N-1 cumulé"] = m.hasPrevData ? Math.round(cumCAN1) : null;
        }
        if (hasDirigeants) point["Charges dirigeants"] = m.hasData ? Math.round(cumDirigeants) : null;
        return point;
      })
      .filter((_, i) => adjustedMonthly[i].hasData || adjustedMonthly[i].hasPrevData);
  }, [adjustedMonthly, hasCogs, hasDirigeants]);

  // ── Données mensuelles brutes (graphique 2) ─────────────────────────────────
  const monthlyChartData = useMemo(() => {
    return adjustedMonthly
      .filter((m) => m.hasData || m.hasPrevData)
      .map((m) => {
        const point: Record<string, string | number | null> = {
          month: m.label,
          "Masse salariale": m.hasData ? Math.round(m.charges_personnel) : null,
          "Charges externes": m.hasData ? Math.round(m.charges_ext_adj) : null,
          "EBE": m.hasData ? Math.round(m.ebe_adj) : null,
        };
        if (hasCogs) {
          point["Marge"] = m.hasData ? Math.round(m.marge) : null;
          point["Marge N-1"] = m.hasPrevData ? Math.round(m.marge_n1) : null;
        } else {
          point["CA"] = m.hasData ? Math.round(m.ca) : null;
          point["CA N-1"] = m.hasPrevData ? Math.round(m.ca_n1) : null;
        }
        if (hasDirigeants) point["Charges dirigeants"] = m.hasData ? Math.round(m.charges_dirigeants) : null;
        return point;
      });
  }, [adjustedMonthly, hasCogs, hasDirigeants]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm animate-pulse">Chargement…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-950/30 border border-red-800 rounded-lg p-4">
        <p className="text-red-400 text-sm font-medium">Erreur</p>
        <p className="text-red-300 text-xs mt-1 font-mono">{error}</p>
      </div>
    );
  }


  return (
    <div className="space-y-6">

      {/* ── Graphique 1 : cumulé (lignes) ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Évolution cumulée — exercice en cours</h3>
        <p className="text-xs text-gray-500 mb-4">
          {hasCogs ? "Marge brute (CA − COGS)" : "CA"}, masse salariale, charges externes et EBE depuis le début de l&apos;exercice
        </p>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => fmt(v, true)} tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={68} />
              <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }} labelStyle={{ color: "#d1d5db", marginBottom: 4 }} formatter={(v) => fmt(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              {hasCogs
                ? <>
                    <Line dataKey="Marge cumulée" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                    <Line dataKey="Marge N-1 cumulée" stroke="#374151" strokeWidth={1.5} dot={false} strokeDasharray="4 3" connectNulls />
                  </>
                : <>
                    <Line dataKey="CA cumulé" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                    <Line dataKey="CA N-1 cumulé" stroke="#374151" strokeWidth={1.5} dot={false} strokeDasharray="4 3" connectNulls />
                  </>
              }
              <Line dataKey="Masse salariale" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
              <Line dataKey="Charges externes" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls />
              {hasDirigeants && <Line dataKey="Charges dirigeants" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />}
              <Line dataKey="EBE cumulé" stroke="#10b981" strokeWidth={2.5} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Tableau mensuel */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 font-medium">Mois</th>
                <th className="text-right py-2 font-medium">{hasCogs ? "Marge" : "CA (N)"}</th>
                <th className="text-right py-2 font-medium">{hasCogs ? "Marge (N-1)" : "CA (N-1)"}</th>
                {hasCogs && <th className="text-right py-2 font-medium">COGS</th>}
                <th className="text-right py-2 font-medium">Charges ext</th>
                {hasDirigeants && <th className="text-right py-2 font-medium">Ch. dirigeants</th>}
                <th className="text-right py-2 font-medium">Masse sal.</th>
                <th className="text-right py-2 font-medium">EBE</th>
              </tr>
            </thead>
            <tbody>
              {adjustedMonthly.filter((m) => m.hasData || m.hasPrevData).map((m) => (
                <tr key={m.mm} className="border-b border-gray-800/50">
                  <td className="py-1.5 text-gray-400">{m.label}</td>
                  <td className="py-1.5 text-right text-gray-200">{m.hasData ? fmt(hasCogs ? m.marge : m.ca) : "—"}</td>
                  <td className="py-1.5 text-right text-gray-500">{m.hasPrevData ? fmt(hasCogs ? m.marge_n1 : m.ca_n1) : "—"}</td>
                  {hasCogs && <td className="py-1.5 text-right text-gray-400">{m.hasData ? fmt(m.cogs) : "—"}</td>}
                  <td className="py-1.5 text-right text-gray-200">{m.hasData ? fmt(m.charges_ext_adj) : "—"}</td>
                  {hasDirigeants && <td className="py-1.5 text-right text-gray-400">{m.hasData ? fmt(m.charges_dirigeants) : "—"}</td>}
                  <td className="py-1.5 text-right text-gray-200">{m.hasData ? fmt(m.charges_personnel) : "—"}</td>
                  <td className={`py-1.5 text-right ${m.hasData ? (m.ebe_adj >= 0 ? "text-green-400" : "text-red-400") : "text-gray-500"}`}>
                    {m.hasData ? fmt(m.ebe_adj) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Graphique 2 : mensuel (barres) + détail factures ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Vue mensuelle — exercice en cours</h3>
        <p className="text-xs text-gray-500 mb-4">
          Valeurs mois par mois · <span className="text-purple-400">cliquer sur une barre pour voir et catégoriser les factures du mois</span>
        </p>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={monthlyChartData}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              barCategoryGap="20%"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(data: any) => {
                if (data?.activeLabel) {
                  const full = labelToFull[data.activeLabel as string];
                  if (full) setDetailMonth((prev) => (prev === full ? null : full));
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => fmt(v, true)} tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={68} />
              <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }} labelStyle={{ color: "#d1d5db", marginBottom: 4 }} formatter={(v) => fmt(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              {hasCogs
                ? <>
                    <Bar dataKey="Marge" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Marge N-1" fill="#374151" radius={[3, 3, 0, 0]} />
                  </>
                : <>
                    <Bar dataKey="CA" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="CA N-1" fill="#374151" radius={[3, 3, 0, 0]} />
                  </>
              }
              <Bar dataKey="Masse salariale" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Charges externes" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              {hasDirigeants && <Bar dataKey="Charges dirigeants" fill="#f97316" radius={[3, 3, 0, 0]} />}
              <Bar dataKey="EBE" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── Panneau factures ── */}
        {detailMonth && (() => {
          const monthLabel = MONTH_LABELS[detailMonth.slice(5, 7)];
          const invoices = Object.entries(entries)
            .map(([label, detail]) => ({
              label,
              supplierLabel: detail.supplierLabel,
              amount: detail.months[detailMonth] ?? 0,
              category: categories[label] ?? "",
            }))
            .filter((inv) => inv.amount > 0)
            .sort((a, b) => b.amount - a.amount);

          return (
            <div className="mt-4 border border-gray-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-800/50 border-b border-gray-700">
                <div className="flex items-center gap-3">
                  <h4 className="text-xs font-semibold text-gray-200">Factures — {monthLabel}</h4>
                  <span className="text-xs text-gray-500">{invoices.length} écriture{invoices.length > 1 ? "s" : ""}</span>
                  {saveError && <span className="text-xs text-red-400 font-mono">{saveError}</span>}
                </div>
                <button onClick={() => setDetailMonth(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
              </div>
              {invoices.length === 0 ? (
                <p className="text-xs text-gray-500 px-4 py-3">Aucune écriture fournisseur ce mois</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700 bg-gray-800/30">
                      <th className="text-left px-4 py-2 font-medium">Fournisseur</th>
                      <th className="text-left px-2 py-2 font-medium">Écriture</th>
                      <th className="text-right px-4 py-2 font-medium">Montant HT</th>
                      <th className="text-left px-2 py-2 font-medium">Catégorie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.label} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                        <td className="px-4 py-2 text-gray-300 max-w-[160px] truncate" title={inv.supplierLabel}>
                          {inv.supplierLabel}
                        </td>
                        <td className="px-2 py-2 text-gray-500 max-w-[220px] truncate" title={inv.label}>
                          {inv.label}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-200 tabular-nums whitespace-nowrap">
                          {fmt(inv.amount)}
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={inv.category}
                            onChange={(e) => handleCategoryChange(inv.label, e.target.value)}
                            className={`border text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500
                              ${inv.category === "cogs"
                                ? "bg-blue-900/30 border-blue-700 text-blue-300"
                                : inv.category === "charges_dirigeant"
                                  ? "bg-orange-900/30 border-orange-700 text-orange-300"
                                  : "bg-gray-800 border-gray-700 text-gray-200"
                              }`}
                          >
                            {CATEGORY_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}
      </div>

    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { MonthlyPnL } from "@/lib/pennylane";

const LineChart = dynamic(() => import("recharts").then((m) => m.LineChart), { ssr: false });
const Line = dynamic(() => import("recharts").then((m) => m.Line), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const Legend = dynamic(() => import("recharts").then((m) => m.Legend), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });
const ReferenceLine = dynamic(() => import("recharts").then((m) => m.ReferenceLine), { ssr: false });

interface Supplier {
  key: string;
  label: string;
  total: number;
  category: string | null;
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
  const [supplierMonthly, setSupplierMonthly] = useState<Record<string, Record<string, number>>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/pnl/detail").then((r) => r.json()),
      fetch("/api/suppliers").then((r) => r.json()),
    ])
      .then(([detailData, suppliersData]) => {
        if (detailData.error) throw new Error(detailData.error);
        if (!Array.isArray(suppliersData)) throw new Error(suppliersData.error ?? "Erreur fournisseurs");
        setCurrentMonthly(detailData.currentMonthly ?? []);
        setPreviousMonthly(detailData.previousMonthly ?? []);
        setSupplierMonthly(detailData.supplierMonthly ?? {});
        setSuppliers(suppliersData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCategoryChange(key: string, category: string) {
    // Recalcul immédiat côté client
    setSuppliers((prev) => prev.map((s) => (s.key === key ? { ...s, category: category || null } : s)));
    // Persistance en arrière-plan
    try {
      const res = await fetch("/api/suppliers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, category }),
      });
      if (!res.ok) setSaveError("Erreur sauvegarde");
      else setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Dériver les sets de fournisseurs par catégorie ──────────────────────────
  const cogsSuppKeys = useMemo(
    () => new Set(suppliers.filter((s) => s.category === "cogs").map((s) => s.key)),
    [suppliers]
  );
  const dirigeantsSuppKeys = useMemo(
    () => new Set(suppliers.filter((s) => s.category === "charges_dirigeant").map((s) => s.key)),
    [suppliers]
  );
  const hasCogs = cogsSuppKeys.size > 0;
  const hasDirigeants = dirigeantsSuppKeys.size > 0;

  // ── Maps mois → données ─────────────────────────────────────────────────────
  const currentMap = useMemo(
    () => Object.fromEntries(currentMonthly.map((m) => [m.month.slice(5, 7), m])),
    [currentMonthly]
  );
  const previousMap = useMemo(
    () => Object.fromEntries(previousMonthly.map((m) => [m.month.slice(5, 7), m])),
    [previousMonthly]
  );
  // MM → "YYYY-MM" pour chercher dans supplierMonthly
  const mmToFull = useMemo(
    () => Object.fromEntries(currentMonthly.map((m) => [m.month.slice(5, 7), m.month])),
    [currentMonthly]
  );

  // ── Données mensuelles ajustées ─────────────────────────────────────────────
  const adjustedMonthly = useMemo(() => {
    return FISCAL_MONTHS.map((mm) => {
      const cur = currentMap[mm];
      const prev = previousMap[mm];
      const fullMonth = mmToFull[mm];

      const cogsAmt = fullMonth
        ? Array.from(cogsSuppKeys).reduce((s, k) => s + (supplierMonthly[k]?.[fullMonth] ?? 0), 0)
        : 0;
      const dirigeantsAmt = fullMonth
        ? Array.from(dirigeantsSuppKeys).reduce((s, k) => s + (supplierMonthly[k]?.[fullMonth] ?? 0), 0)
        : 0;

      return {
        mm,
        label: MONTH_LABELS[mm],
        hasData: !!cur,
        hasPrevData: !!prev,
        ca: cur?.ca ?? 0,
        ca_n1: prev?.ca ?? 0,
        charges_personnel: cur?.charges_personnel ?? 0,
        // EBE ajusté : les charges dirigeants sont exclues du calcul
        ebe_adj: cur ? cur.ebe + dirigeantsAmt : 0,
        cogs: cogsAmt,
        charges_dirigeants: dirigeantsAmt,
        charges_ext_adj: (cur?.achats_charges_ext ?? 0) - cogsAmt - dirigeantsAmt,
        marge: (cur?.ca ?? 0) - cogsAmt,
      };
    });
  }, [currentMap, previousMap, mmToFull, cogsSuppKeys, dirigeantsSuppKeys, supplierMonthly]);

  // ── Données cumulées pour le graphique ──────────────────────────────────────
  const chartData = useMemo(() => {
    let cumCA = 0, cumMarge = 0, cumPersonnel = 0, cumChargesExt = 0;
    let cumDirigeants = 0, cumEBE = 0, cumCAN1 = 0;

    return adjustedMonthly
      .map((m) => {
        if (m.hasData) {
          cumCA += m.ca;
          cumMarge += m.marge;
          cumPersonnel += m.charges_personnel;
          cumChargesExt += m.charges_ext_adj;
          cumDirigeants += m.charges_dirigeants;
          cumEBE += m.ebe_adj;
        }
        if (m.hasPrevData) cumCAN1 += m.ca_n1;

        const point: Record<string, string | number | null> = {
          month: m.label,
          "CA N-1 cumulé": m.hasPrevData ? Math.round(cumCAN1) : null,
          "Masse salariale": m.hasData ? Math.round(cumPersonnel) : null,
          "Charges externes": m.hasData ? Math.round(cumChargesExt) : null,
          "EBE cumulé": m.hasData ? Math.round(cumEBE) : null,
        };

        if (hasCogs) {
          point["Marge cumulée"] = m.hasData ? Math.round(cumMarge) : null;
        } else {
          point["CA cumulé"] = m.hasData ? Math.round(cumCA) : null;
        }

        if (hasDirigeants) {
          point["Charges dirigeants"] = m.hasData ? Math.round(cumDirigeants) : null;
        }

        return point;
      })
      .filter((_, i) => adjustedMonthly[i].hasData || adjustedMonthly[i].hasPrevData);
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

  const totalSuppliers = suppliers.reduce((a, s) => a + s.total, 0);

  return (
    <div className="space-y-6">
      {/* ── Graphique ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Évolution cumulée — exercice en cours</h3>
        <p className="text-xs text-gray-500 mb-4">
          {hasCogs ? "Marge brute (CA − COGS)" : "CA"}, masse salariale, charges externes et EBE depuis le début de l&apos;exercice
        </p>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v) => fmt(v, true)}
                tick={{ fill: "#6b7280", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={68}
              />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                labelStyle={{ color: "#d1d5db", marginBottom: 4 }}
                formatter={(v) => fmt(Number(v))}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              <Line dataKey="CA N-1 cumulé" stroke="#374151" strokeWidth={1.5} dot={false} strokeDasharray="4 3" connectNulls />
              {hasCogs
                ? <Line dataKey="Marge cumulée" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                : <Line dataKey="CA cumulé" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
              }
              <Line dataKey="Masse salariale" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
              <Line dataKey="Charges externes" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls />
              {hasDirigeants && (
                <Line dataKey="Charges dirigeants" stroke="#f97316" strokeWidth={2} dot={false} connectNulls />
              )}
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
                <th className="text-right py-2 font-medium">CA (N-1)</th>
                {hasCogs && <th className="text-right py-2 font-medium">COGS</th>}
                <th className="text-right py-2 font-medium">Charges ext</th>
                {hasDirigeants && <th className="text-right py-2 font-medium">Ch. dirigeants</th>}
                <th className="text-right py-2 font-medium">Masse sal.</th>
                <th className="text-right py-2 font-medium">EBE</th>
              </tr>
            </thead>
            <tbody>
              {adjustedMonthly
                .filter((m) => m.hasData || m.hasPrevData)
                .map((m) => (
                  <tr key={m.mm} className="border-b border-gray-800/50">
                    <td className="py-1.5 text-gray-400">{m.label}</td>
                    <td className="py-1.5 text-right text-gray-200">
                      {m.hasData ? fmt(hasCogs ? m.marge : m.ca) : "—"}
                    </td>
                    <td className="py-1.5 text-right text-gray-500">
                      {m.hasPrevData ? fmt(m.ca_n1) : "—"}
                    </td>
                    {hasCogs && (
                      <td className="py-1.5 text-right text-gray-400">
                        {m.hasData ? fmt(m.cogs) : "—"}
                      </td>
                    )}
                    <td className="py-1.5 text-right text-gray-200">
                      {m.hasData ? fmt(m.charges_ext_adj) : "—"}
                    </td>
                    {hasDirigeants && (
                      <td className="py-1.5 text-right text-gray-400">
                        {m.hasData ? fmt(m.charges_dirigeants) : "—"}
                      </td>
                    )}
                    <td className="py-1.5 text-right text-gray-200">
                      {m.hasData ? fmt(m.charges_personnel) : "—"}
                    </td>
                    <td className={`py-1.5 text-right ${m.hasData ? (m.ebe_adj >= 0 ? "text-green-400" : "text-red-400") : "text-gray-500"}`}>
                      {m.hasData ? fmt(m.ebe_adj) : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Fournisseurs — catégorisation ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-300">Fournisseurs — Charges Externes</h3>
          <span className="text-xs text-gray-500">
            {suppliers.length} fournisseur{suppliers.length > 1 ? "s" : ""} · {fmt(totalSuppliers)}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Catégoriser un fournisseur recalcule le graphique immédiatement · trié par montant décroissant
        </p>
        {saveError && (
          <p className="text-xs text-red-400 mb-3 font-mono bg-red-950/30 px-3 py-2 rounded">{saveError}</p>
        )}
        {suppliers.length === 0 ? (
          <p className="text-gray-500 text-sm">Aucun fournisseur trouvé — lancez une sync depuis l&apos;onglet Annuel</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 font-medium w-full">Fournisseur</th>
                  <th className="text-right py-2 font-medium pr-6 whitespace-nowrap">Total HT</th>
                  <th className="text-left py-2 font-medium whitespace-nowrap">Catégorie</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.key} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2 text-gray-200 pr-4 max-w-xs truncate" title={s.label}>{s.label}</td>
                    <td className="py-2 text-right text-gray-200 pr-6 tabular-nums whitespace-nowrap">{fmt(s.total)}</td>
                    <td className="py-2">
                      <select
                        value={s.category ?? ""}
                        onChange={(e) => handleCategoryChange(s.key, e.target.value)}
                        className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
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
          </div>
        )}
      </div>
    </div>
  );
}

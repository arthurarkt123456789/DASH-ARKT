"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { AnalyseMonthly } from "@/app/api/pnl/analyse/route";

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
  category: string | null;
  accounts: string[];
}

const CATEGORY_OPTIONS = [
  { value: "", label: "—" },
  { value: "charges_ext", label: "Charges Externes" },
  { value: "charges_dirigeant", label: "Charges Dirigeant" },
  { value: "cogs", label: "COGS" },
];

function fmt(n: number, compact = false) {
  if (compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 0 }).format(n);
  }
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

const monthLabels: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr", "05": "Mai", "06": "Jun",
  "07": "Jul", "08": "Aoû", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

function monthLabel(m: string) {
  return monthLabels[m.slice(5, 7)] ?? m;
}

export default function AnalyseView() {
  const [monthly, setMonthly] = useState<AnalyseMonthly[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/pnl/analyse").then((r) => r.json()),
      fetch("/api/suppliers").then((r) => r.json()),
    ])
      .then(([analyseData, suppliersData]) => {
        if (analyseData.error) throw new Error(analyseData.error);
        if (!Array.isArray(suppliersData)) throw new Error(suppliersData.error ?? "Erreur fournisseurs");
        setMonthly(analyseData.monthly ?? []);
        setSuppliers(suppliersData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCategoryChange(key: string, category: string) {
    setSuppliers((prev) =>
      prev.map((s) => (s.key === key ? { ...s, category: category || null } : s))
    );
    await fetch("/api/suppliers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, category }),
    });
  }

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

  // Build cumulative chart data (months ordered Oct→Sep)
  const months = ["10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08", "09"];
  const monthlyMap = new Map(monthly.map((m) => [m.month.slice(5, 7), m]));

  let cumMarge = 0, cumMS = 0, cumChargesExt = 0, cumEBE = 0;
  const chartData = months
    .map((mm) => {
      const m = monthlyMap.get(mm);
      if (m) {
        cumMarge += m.marge_brute;
        cumMS += m.masse_salariale;
        cumChargesExt += m.charges_ext;
        cumEBE += m.ebe_ajuste;
      }
      return {
        month: monthLabels[mm],
        hasData: !!m,
        "Marge Brute": m ? Math.round(cumMarge) : null,
        "Masse salariale": m ? Math.round(cumMS) : null,
        "Charges externes": m ? Math.round(cumChargesExt) : null,
        "EBE ajusté": m ? Math.round(cumEBE) : null,
      };
    })
    .filter((d) => d.hasData);

  // Group suppliers by category
  const grouped: Record<string, Supplier[]> = { cogs: [], charges_dirigeant: [], charges_ext: [], "": [] };
  for (const s of suppliers) {
    const cat = s.category ?? "";
    if (!(cat in grouped)) grouped[cat] = [];
    grouped[cat].push(s);
  }
  const groupOrder: { key: string; label: string }[] = [
    { key: "cogs", label: "COGS" },
    { key: "charges_dirigeant", label: "Charges Dirigeant" },
    { key: "charges_ext", label: "Charges Externes" },
    { key: "", label: "Non catégorisé" },
  ];

  return (
    <div className="space-y-8">
      {/* ── Supplier categorisation ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Catégorisation des fournisseurs</h3>
        <p className="text-xs text-gray-500 mb-4">Associez chaque fournisseur à une catégorie pour affiner l&apos;analyse</p>

        {suppliers.length === 0 ? (
          <p className="text-gray-500 text-sm">Aucun fournisseur trouvé (lancez une sync d&apos;abord)</p>
        ) : (
          <div className="space-y-6">
            {groupOrder.map(({ key, label }) => {
              const group = grouped[key] ?? [];
              if (group.length === 0) return null;
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
                    <div className="flex-1 h-px bg-gray-800" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-800">
                          <th className="text-left py-2 font-medium">Fournisseur</th>
                          <th className="text-left py-2 font-medium">Comptes</th>
                          <th className="text-left py-2 font-medium">Catégorie</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((s) => (
                          <tr key={s.key} className="border-b border-gray-800/50">
                            <td className="py-2 text-gray-200 pr-4">{s.key}</td>
                            <td className="py-2 text-gray-500 pr-4">{s.accounts.join(", ")}</td>
                            <td className="py-2">
                              <select
                                value={s.category ?? ""}
                                onChange={(e) => handleCategoryChange(s.key, e.target.value)}
                                className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                              >
                                {CATEGORY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Cumulative chart ── */}
      {chartData.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Évolution cumulée — analyse ajustée</h3>
          <p className="text-xs text-gray-500 mb-4">Marge brute, masse salariale, charges externes et EBE ajusté depuis le début de l&apos;exercice</p>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmt(v, true)} tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={68} />
                <Tooltip
                  contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                  labelStyle={{ color: "#d1d5db", marginBottom: 4 }}
                  formatter={(v) => fmt(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
                <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
                <Line dataKey="Marge Brute" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                <Line dataKey="Masse salariale" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
                <Line dataKey="Charges externes" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls />
                <Line dataKey="EBE ajusté" stroke="#10b981" strokeWidth={2.5} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly table */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 font-medium">Mois</th>
                  <th className="text-right py-2 font-medium">Marge Brute</th>
                  <th className="text-right py-2 font-medium">MS</th>
                  <th className="text-right py-2 font-medium">Charges ext</th>
                  <th className="text-right py-2 font-medium">Charges dirigeant</th>
                  <th className="text-right py-2 font-medium">EBE ajusté</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.month} className="border-b border-gray-800/50">
                    <td className="py-1.5 text-gray-400">{monthLabel(m.month)}</td>
                    <td className="py-1.5 text-right text-gray-200">{fmt(m.marge_brute)}</td>
                    <td className="py-1.5 text-right text-gray-200">{fmt(m.masse_salariale)}</td>
                    <td className="py-1.5 text-right text-gray-200">{fmt(m.charges_ext)}</td>
                    <td className="py-1.5 text-right text-gray-200">{fmt(m.charges_dirigeant)}</td>
                    <td className={`py-1.5 text-right ${m.ebe_ajuste >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(m.ebe_ajuste)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

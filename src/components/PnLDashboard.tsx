"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { PnLReport, MonthlyPnL } from "@/lib/pennylane";

const BarChart = dynamic(() => import("recharts").then((m) => m.BarChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const Legend = dynamic(() => import("recharts").then((m) => m.Legend), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });
const ReferenceLine = dynamic(() => import("recharts").then((m) => m.ReferenceLine), { ssr: false });

interface PnLData {
  current: PnLReport;
  previous: PnLReport;
  lastSync: { finishedAt: string; linesUpserted: number } | null;
}

function fmt(n: number, compact = false) {
  if (compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 0 }).format(n);
  }
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function delta(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${positive ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}>
      {positive ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function PnLRow({ label, current, previous, bold, highlight, indent }: {
  label: string; current: number; previous: number; bold?: boolean; highlight?: "positive"; indent?: boolean;
}) {
  const pct = delta(current, previous);
  const textColor = highlight === "positive" ? (current >= 0 ? "text-green-400" : "text-red-400") : "text-gray-100";
  return (
    <div className={`flex items-center justify-between py-2 border-b border-gray-800 ${bold ? "font-semibold" : ""}`}>
      <span className={`text-sm ${indent ? "pl-4 text-gray-400" : "text-gray-200"}`}>{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500 w-32 text-right">{fmt(previous)}</span>
        <span className={`text-sm w-32 text-right ${textColor}`}>{fmt(current)}</span>
        <div className="w-16 text-right"><DeltaBadge pct={pct} /></div>
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mt-6 mb-1">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
      <div className="flex-1 h-px bg-gray-800" />
    </div>
  );
}

function MonthlyChart({ current, previous }: { current: MonthlyPnL[]; previous: MonthlyPnL[] }) {
  // Align months to fiscal year position (Oct=1, Sep=12)
  const months = ["10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08", "09"];
  const monthLabels: Record<string, string> = {
    "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr", "05": "Mai", "06": "Jun",
    "07": "Jul", "08": "Aoû", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
  };

  const currentMap = Object.fromEntries(current.map((m) => [m.month.slice(5), m]));
  const previousMap = Object.fromEntries(previous.map((m) => [m.month.slice(5), m]));

  const data = months.map((mm) => ({
    month: monthLabels[mm],
    "CA (N)": Math.round(currentMap[mm]?.ca ?? 0),
    "CA (N-1)": Math.round(previousMap[mm]?.ca ?? 0),
    "Résultat (N)": Math.round(currentMap[mm]?.resultat_exploitation ?? 0),
  }));

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">CA et résultat mensuels</h3>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2}>
            <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => fmt(v, true)} tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
              labelStyle={{ color: "#d1d5db" }}
              formatter={(v) => fmt(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
            <ReferenceLine y={0} stroke="#374151" />
            <Bar dataKey="CA (N-1)" fill="#374151" radius={[2, 2, 0, 0]} />
            <Bar dataKey="CA (N)" fill="#3b82f6" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Résultat (N)" fill="#10b981" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table mensuelle */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2 font-medium">Mois</th>
              <th className="text-right py-2 font-medium">CA (N)</th>
              <th className="text-right py-2 font-medium">CA (N-1)</th>
              <th className="text-right py-2 font-medium">EBE (N)</th>
              <th className="text-right py-2 font-medium">Résultat (N)</th>
            </tr>
          </thead>
          <tbody>
            {months.map((mm) => {
              const cur = currentMap[mm];
              const prev = previousMap[mm];
              if (!cur && !prev) return null;
              return (
                <tr key={mm} className="border-b border-gray-800/50">
                  <td className="py-1.5 text-gray-400">{monthLabels[mm]}</td>
                  <td className="py-1.5 text-right text-gray-200">{cur ? fmt(cur.ca) : "—"}</td>
                  <td className="py-1.5 text-right text-gray-500">{prev ? fmt(prev.ca) : "—"}</td>
                  <td className="py-1.5 text-right text-gray-200">{cur ? fmt(cur.ebe) : "—"}</td>
                  <td className={`py-1.5 text-right ${cur ? (cur.resultat_exploitation >= 0 ? "text-green-400" : "text-red-400") : "text-gray-500"}`}>
                    {cur ? fmt(cur.resultat_exploitation) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PnLDashboard() {
  const [data, setData] = useState<PnLData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"annual" | "monthly">("annual");

  useEffect(() => {
    fetch("/api/pnl")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-400 text-sm animate-pulse">Chargement…</div></div>;
  if (error) return <div className="bg-red-950/30 border border-red-800 rounded-lg p-4"><p className="text-red-400 text-sm font-medium">Erreur API Pennylane</p><p className="text-red-300 text-xs mt-1 font-mono">{error}</p></div>;
  if (!data) return null;

  const { current, previous } = data;
  const periodLabel = (p: PnLReport) => `${p.period.start.slice(0, 7)} → ${p.period.end.slice(0, 7)}`;
  const hasFinancier = current.produits_financiers !== 0 || previous.produits_financiers !== 0 || current.charges_financieres !== 0 || previous.charges_financieres !== 0;
  const hasExceptionnel = current.resultat_exceptionnel !== 0 || previous.resultat_exceptionnel !== 0;

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <div className="flex items-center gap-2">
        {(["annual", "monthly"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === v ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}>
            {v === "annual" ? "Annuel" : "Mensuel"}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Chiffre d'affaires", value: current.ca, prev: previous.ca },
          { label: "EBE", value: current.ebe, prev: previous.ebe },
          { label: "Résultat exploitation", value: current.resultat_exploitation, prev: previous.resultat_exploitation },
          { label: "Résultat net (estimé)", value: current.resultat_net - current.is_estime + current.impot_societes, prev: previous.resultat_net - previous.is_estime + previous.impot_societes },
        ].map(({ label, value, prev }) => (
          <div key={label} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-xl font-bold ${value >= 0 ? "text-white" : "text-red-400"}`}>{fmt(value)}</p>
            <div className="mt-1"><DeltaBadge pct={delta(value, prev)} /></div>
          </div>
        ))}
      </div>

      {view === "monthly" && <MonthlyChart current={current.monthly} previous={previous.monthly} />}

      {view === "annual" && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center justify-between pb-3 border-b border-gray-800 mb-2">
            <span className="text-sm font-semibold text-gray-300">Poste</span>
            <div className="flex gap-4">
              <span className="text-xs text-gray-500 w-32 text-right">{periodLabel(previous)} (N-1)</span>
              <span className="text-xs text-gray-400 w-32 text-right">{periodLabel(current)} (N)</span>
              <span className="text-xs text-gray-500 w-16 text-right">Var.</span>
            </div>
          </div>

          <SectionHeader title="Produits d'exploitation" />
          <PnLRow label="Chiffre d'affaires" current={current.ca} previous={previous.ca} />
          {(current.autres_produits !== 0 || previous.autres_produits !== 0) && (
            <PnLRow label="Autres produits" current={current.autres_produits} previous={previous.autres_produits} indent />
          )}
          <PnLRow label="Total produits d'exploitation" current={current.total_produits} previous={previous.total_produits} bold />

          <SectionHeader title="Charges d'exploitation" />
          <PnLRow label="Achats & charges externes" current={current.achats_charges_ext} previous={previous.achats_charges_ext} indent />
          {(current.impots_taxes !== 0 || previous.impots_taxes !== 0) && (
            <PnLRow label="Impôts et taxes" current={current.impots_taxes} previous={previous.impots_taxes} indent />
          )}
          <PnLRow label="Charges de personnel" current={current.charges_personnel} previous={previous.charges_personnel} indent />
          {(current.dotations_amort !== 0 || previous.dotations_amort !== 0) && (
            <PnLRow label="Dotations amortissements" current={current.dotations_amort} previous={previous.dotations_amort} indent />
          )}
          {(current.autres_charges !== 0 || previous.autres_charges !== 0) && (
            <PnLRow label="Autres charges" current={current.autres_charges} previous={previous.autres_charges} indent />
          )}
          <PnLRow label="Total charges d'exploitation" current={current.total_charges} previous={previous.total_charges} bold />

          <SectionHeader title="Résultats" />
          <PnLRow label="EBE" current={current.ebe} previous={previous.ebe} highlight="positive" />
          <PnLRow label="Résultat d'exploitation" current={current.resultat_exploitation} previous={previous.resultat_exploitation} bold highlight="positive" />

          {hasFinancier && (
            <>
              {(current.produits_financiers !== 0 || previous.produits_financiers !== 0) && (
                <PnLRow label="Produits financiers" current={current.produits_financiers} previous={previous.produits_financiers} indent />
              )}
              {(current.charges_financieres !== 0 || previous.charges_financieres !== 0) && (
                <PnLRow label="Charges financières" current={-current.charges_financieres} previous={-previous.charges_financieres} indent />
              )}
              <PnLRow label="Résultat financier" current={current.resultat_financier} previous={previous.resultat_financier} indent />
            </>
          )}

          {hasExceptionnel && (
            <PnLRow label="Résultat exceptionnel" current={current.resultat_exceptionnel} previous={previous.resultat_exceptionnel} indent />
          )}

          <PnLRow label="Résultat avant IS" current={current.resultat_exploitation + current.resultat_financier + current.resultat_exceptionnel} previous={previous.resultat_exploitation + previous.resultat_financier + previous.resultat_exceptionnel} />

          <PnLRow label={current.impot_societes !== 0 ? "Impôt sur les sociétés" : "IS estimé (15% / 25%)"} current={-(current.impot_societes || current.is_estime)} previous={-(previous.impot_societes || previous.is_estime)} indent />

          <PnLRow label="Résultat net" current={current.resultat_net} previous={previous.resultat_net} bold highlight="positive" />
        </div>
      )}

      <p className="text-xs text-gray-600 text-right">
        {data.lastSync
          ? `Sync ${data.lastSync.linesUpserted.toLocaleString("fr-FR")} lignes — ${new Date(data.lastSync.finishedAt).toLocaleString("fr-FR")}`
          : "Données en cache"}
      </p>
    </div>
  );
}

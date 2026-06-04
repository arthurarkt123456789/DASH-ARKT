"use client";

import { useEffect, useState } from "react";
import type { PnLReport } from "@/lib/pennylane";

interface PnLData {
  current: PnLReport;
  previous: PnLReport;
  fetchedAt: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function delta(current: number, previous: number) {
  if (previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return pct;
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
        positive ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
      }`}
    >
      {positive ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

interface PnLRowProps {
  label: string;
  current: number;
  previous: number;
  bold?: boolean;
  highlight?: "positive" | "negative" | "neutral";
  indent?: boolean;
}

function PnLRow({ label, current, previous, bold, highlight, indent }: PnLRowProps) {
  const pct = delta(current, previous);
  const textColor =
    highlight === "positive"
      ? current >= 0
        ? "text-green-400"
        : "text-red-400"
      : highlight === "negative"
      ? "text-red-400"
      : "text-gray-100";

  return (
    <div
      className={`flex items-center justify-between py-2 border-b border-gray-800 ${
        bold ? "font-semibold" : "font-normal"
      }`}
    >
      <span className={`text-sm ${indent ? "pl-4 text-gray-400" : "text-gray-200"}`}>{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500 w-32 text-right">{fmt(previous)}</span>
        <span className={`text-sm w-32 text-right ${textColor}`}>{fmt(current)}</span>
        <div className="w-16 text-right">
          <DeltaBadge pct={pct} />
        </div>
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

export default function PnLDashboard() {
  const [data, setData] = useState<PnLData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pnl")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm animate-pulse">Chargement depuis Pennylane…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/30 border border-red-800 rounded-lg p-4">
        <p className="text-red-400 text-sm font-medium">Erreur API Pennylane</p>
        <p className="text-red-300 text-xs mt-1 font-mono">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { current, previous } = data;

  const periodLabel = (p: PnLReport) =>
    `${p.period.start.slice(0, 7)} → ${p.period.end.slice(0, 7)}`;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Chiffre d'affaires", value: current.ca, prev: previous.ca },
          { label: "Charges personnel", value: current.charges_personnel, prev: previous.charges_personnel },
          { label: "Résultat exploitation", value: current.resultat_exploitation, prev: previous.resultat_exploitation },
          { label: "Résultat net", value: current.resultat_net, prev: previous.resultat_net },
        ].map(({ label, value, prev }) => (
          <div key={label} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-xl font-bold text-white">{fmt(value)}</p>
            <div className="mt-1">
              <DeltaBadge pct={delta(value, prev)} />
            </div>
          </div>
        ))}
      </div>

      {/* Table compte de résultat */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-800 mb-2">
          <span className="text-sm font-semibold text-gray-300">Poste</span>
          <div className="flex gap-4">
            <span className="text-xs text-gray-500 w-32 text-right">{periodLabel(previous)} (N-1)</span>
            <span className="text-xs text-gray-400 w-32 text-right">{periodLabel(current)} (N)</span>
            <span className="text-xs text-gray-500 w-16 text-right">Var.</span>
          </div>
        </div>

        {/* Produits */}
        <SectionHeader title="Produits d'exploitation" />
        <PnLRow label="Chiffre d'affaires" current={current.ca} previous={previous.ca} />
        {current.autres_produits !== 0 || previous.autres_produits !== 0 ? (
          <PnLRow label="Autres produits" current={current.autres_produits} previous={previous.autres_produits} indent />
        ) : null}
        <PnLRow label="Total produits d'exploitation" current={current.total_produits} previous={previous.total_produits} bold />

        {/* Charges */}
        <SectionHeader title="Charges d'exploitation" />
        <PnLRow label="Achats & charges externes" current={current.achats_charges_ext} previous={previous.achats_charges_ext} indent />
        {current.impots_taxes !== 0 || previous.impots_taxes !== 0 ? (
          <PnLRow label="Impôts et taxes" current={current.impots_taxes} previous={previous.impots_taxes} indent />
        ) : null}
        <PnLRow label="Charges de personnel" current={current.charges_personnel} previous={previous.charges_personnel} indent />
        {current.dotations_amort !== 0 || previous.dotations_amort !== 0 ? (
          <PnLRow label="Dotations amortissements" current={current.dotations_amort} previous={previous.dotations_amort} indent />
        ) : null}
        {current.autres_charges !== 0 || previous.autres_charges !== 0 ? (
          <PnLRow label="Autres charges" current={current.autres_charges} previous={previous.autres_charges} indent />
        ) : null}
        <PnLRow label="Total charges d'exploitation" current={current.total_charges} previous={previous.total_charges} bold />

        {/* Résultats */}
        <SectionHeader title="Résultats" />
        <PnLRow
          label="Résultat d'exploitation"
          current={current.resultat_exploitation}
          previous={previous.resultat_exploitation}
          bold
          highlight="positive"
        />
        {(current.charges_financieres !== 0 || previous.charges_financieres !== 0) ? (
          <PnLRow label="Résultat financier" current={current.resultat_financier} previous={previous.resultat_financier} indent />
        ) : null}
        {(current.resultat_exceptionnel !== 0 || previous.resultat_exceptionnel !== 0) ? (
          <PnLRow label="Résultat exceptionnel" current={current.resultat_exceptionnel} previous={previous.resultat_exceptionnel} indent />
        ) : null}
        {(current.impot_societes !== 0 || previous.impot_societes !== 0) ? (
          <PnLRow label="Impôt sur les sociétés" current={-current.impot_societes} previous={-previous.impot_societes} indent />
        ) : null}
        <PnLRow
          label="Résultat net"
          current={current.resultat_net}
          previous={previous.resultat_net}
          bold
          highlight="positive"
        />
      </div>

      <p className="text-xs text-gray-600 text-right">
        Données Pennylane — actualisé le{" "}
        {new Date(data.fetchedAt).toLocaleString("fr-FR")}
      </p>
    </div>
  );
}

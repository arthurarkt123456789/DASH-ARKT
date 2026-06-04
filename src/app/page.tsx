import PnLDashboard from "@/components/PnLDashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">ARKT Conseil — Pilotage financier</h1>
          <p className="text-gray-400 text-sm mt-1">Compte de résultat — exercices N et N-1</p>
        </div>
        <PnLDashboard />
      </div>
    </main>
  );
}

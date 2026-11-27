import React, { useEffect, useState } from 'react';
import { Sliders, Download, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { exportRowsToExcel, formatIDR } from '../lib/exportUtils';
import { ConditionLabel } from '../components/StatusText';
import type { AuthUser, Lang } from '../types/oims';

interface ReplacementPlanningModuleProps {
  lang: Lang;
  user: AuthUser;
}

export const ReplacementPlanningModule: React.FC<ReplacementPlanningModuleProps> = ({ lang, user }) => {
  const canConfig = user.role_code === 'super_admin' || user.permissions.includes('replacement.configure');
  const canPlan = user.role_code === 'super_admin' || user.permissions.includes('replacement.plan');

  const [thresholds, setThresholds] = useState({
    replacement_age_warning_pct: 80,
    replacement_age_urgent_pct: 100,
    replacement_cost_ratio_pct: 40,
  });
  const [evaluated, setEvaluated] = useState<any[]>([]);
  const [savedPlans, setSavedPlans] = useState<any[]>([]);
  const [showThresholds, setShowThresholds] = useState(false);

  const load = async () => {
    const res = await apiFetch<{ thresholds: any; evaluated: any[]; savedPlans: any[] }>('/api/replacement');
    setThresholds(res.thresholds);
    setEvaluated(res.evaluated);
    setSavedPlans(res.savedPlans);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/replacement/thresholds', {
      method: 'POST',
      body: JSON.stringify(thresholds),
    });
    setShowThresholds(false);
    await load();
  };

  const handleQueuePlan = async (asset: any) => {
    await apiFetch('/api/replacement/plan', {
      method: 'POST',
      body: JSON.stringify({
        asset_id: asset.id,
        assessment_year: 2027,
        asset_age_years: asset.age_years,
        maintenance_count: asset.maintenance_count,
        total_maintenance_cost: asset.total_maintenance_cost,
        priority_level: asset.recommended_priority,
        estimated_replacement_cost: Math.round(asset.acquisition_value * 1.1),
        planned_quarter: asset.recommended_priority === 'Urgent Replacement' ? 'Q1' : 'Q3',
        notes: `Auto-queued from ${asset.life_pct}% useful life / ${asset.cost_ratio_pct}% repair ratio`,
      }),
    });
    await load();
  };

  const isId = lang === 'id';
  const priorityColor = (p: string) => {
    if (p === 'Urgent Replacement') return 'text-[#C8102E] dark:text-red-400 font-semibold';
    if (p === 'Replacement Recommended') return 'text-orange-700 dark:text-orange-400 font-semibold';
    if (p === 'Repair Required') return 'text-amber-700 dark:text-amber-400 font-medium';
    if (p === 'Monitor') return 'text-neutral-700 dark:text-neutral-300 font-medium';
    return 'text-emerald-700 dark:text-emerald-400';
  };

  const inputClass =
    'w-full px-3 py-2 text-xs font-mono bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Perencanaan Penggantian Aset' : 'Asset Replacement & Budget Planning'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Analisis umur ekonomis, riwayat perbaikan, dan rasio biaya untuk perencanaan anggaran tahunan.'
              : 'Configurable lifecycle thresholds, maintenance cost ratios, and annual CAPEX replacement planning.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canConfig && (
            <button
              type="button"
              onClick={() => setShowThresholds((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{isId ? 'Atur Ambang Batas' : 'Configure Rules'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              exportRowsToExcel(
                savedPlans.map((s) => ({
                  'Asset Code': s.asset_code,
                  'Asset Name': s.asset_name,
                  Category: s.category_name,
                  Year: s.assessment_year,
                  Quarter: s.planned_quarter,
                  'Age (Years)': s.asset_age_years,
                  Priority: s.priority_level,
                  'Estimated Cost (IDR)': s.estimated_replacement_cost,
                  Status: s.status,
                })),
                'KIDECO_Replacement_Plan_2027.xlsx'
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isId ? 'Ekspor Rencana Tahunan' : 'Export Annual Plan'}</span>
          </button>
        </div>
      </div>

      {showThresholds && (
        <form
          onSubmit={handleSaveThresholds}
          className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
        >
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {isId ? 'Ambang Batas Evaluasi Penggantian' : 'Configurable Replacement Thresholds'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className={labelClass}>
                {isId ? 'Ambang Pantau (% Umur Ekonomis)' : 'Monitor Threshold (% of Useful Life)'}
              </label>
              <input
                type="number"
                value={thresholds.replacement_age_warning_pct}
                onChange={(e) => setThresholds({ ...thresholds, replacement_age_warning_pct: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {isId ? 'Ambang Mendesak (% Umur Ekonomis)' : 'Urgent Threshold (% of Useful Life)'}
              </label>
              <input
                type="number"
                value={thresholds.replacement_age_urgent_pct}
                onChange={(e) => setThresholds({ ...thresholds, replacement_age_urgent_pct: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {isId ? 'Maks. Rasio Biaya Perbaikan (% Nilai)' : 'Max Maintenance Cost Ratio (% of Acq. Value)'}
              </label>
              <input
                type="number"
                value={thresholds.replacement_cost_ratio_pct}
                onChange={(e) => setThresholds({ ...thresholds, replacement_cost_ratio_pct: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowThresholds(false)}
              className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              {isId ? 'Batal' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md"
            >
              {isId ? 'Simpan Aturan' : 'Save Thresholds'}
            </button>
          </div>
        </form>
      )}

      {/* Live Evaluation Table */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
          {isId ? `Evaluasi Kelayakan Siklus Hidup (${evaluated.length} aset)` : `Lifecycle Health Evaluation (${evaluated.length} assets)`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Aset' : 'Asset'}</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{isId ? 'Usia / Umur Ekonomis' : 'Age / Useful Life'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Kondisi' : 'Condition'}</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{isId ? 'Biaya Perbaikan' : 'Maint. Cost'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Rekomendasi' : 'Recommendation'}</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{isId ? 'Rencana Anggaran' : 'Budget Plan'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {evaluated.map((a) => (
                <tr key={a.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-mono font-semibold text-[#C8102E] dark:text-red-400">{a.asset_code}</div>
                    <div className="text-neutral-800 dark:text-neutral-200">{a.asset_name}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-neutral-700 dark:text-neutral-300 tabular-nums whitespace-nowrap">
                    {a.age_years}y / {a.default_useful_life_years}y ({a.life_pct}%)
                  </td>
                  <td className="px-4 py-2.5">
                    <ConditionLabel condition={a.condition_status} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-neutral-700 dark:text-neutral-300 tabular-nums whitespace-nowrap">
                    {formatIDR(a.total_maintenance_cost)} ({a.cost_ratio_pct}%)
                  </td>
                  <td className={`px-4 py-2.5 whitespace-nowrap ${priorityColor(a.recommended_priority)}`}>
                    {a.recommended_priority}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canPlan && a.recommended_priority !== 'Normal' && (
                      <button
                        type="button"
                        onClick={() => handleQueuePlan(a)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{isId ? 'Masukkan Rencana' : 'Add to Plan'}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Annual Budget Plan Table */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {isId ? 'Antrean Anggaran Penggantian Tahunan' : 'Annual Replacement Budget Queue'}
          </h3>
          <span className="text-xs font-mono font-semibold text-[#C8102E] dark:text-red-400 tabular-nums">
            {isId ? 'Total Estimasi CAPEX:' : 'Total Est. CAPEX:'}{' '}
            {formatIDR(savedPlans.reduce((acc, p) => acc + Number(p.estimated_replacement_cost || 0), 0))}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">{isId ? 'Aset' : 'Asset'}</th>
                <th className="px-4 py-2.5 font-medium">{isId ? 'Target' : 'Target'}</th>
                <th className="px-4 py-2.5 font-medium">{isId ? 'Prioritas' : 'Priority'}</th>
                <th className="px-4 py-2.5 font-medium text-right">{isId ? 'Est. Biaya (IDR)' : 'Est. Cost (IDR)'}</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {savedPlans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500 dark:text-neutral-400">
                    {isId ? 'Belum ada aset dalam antrean anggaran penggantian.' : 'No assets queued in the replacement budget plan yet.'}
                  </td>
                </tr>
              ) : (
                savedPlans.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors">
                    <td className="px-4 py-2.5 text-neutral-800 dark:text-neutral-200">
                      <span className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{p.asset_code}</span> ·{' '}
                      {p.asset_name}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                      {p.assessment_year} {p.planned_quarter}
                    </td>
                    <td className={`px-4 py-2.5 ${priorityColor(p.priority_level)}`}>{p.priority_level}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[#141619] dark:text-neutral-100 tabular-nums whitespace-nowrap">
                      {formatIDR(p.estimated_replacement_cost)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">{p.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

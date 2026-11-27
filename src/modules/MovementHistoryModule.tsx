import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, X, Building2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { StatusLabel } from '../components/StatusText';
import type { AssetRow, AuthUser, Lang, MasterData } from '../types/oims';

interface MovementHistoryModuleProps {
  lang: Lang;
  user: AuthUser;
  master: MasterData;
  assets: AssetRow[];
  onRefreshAssets: () => void;
}

export const MovementHistoryModule: React.FC<MovementHistoryModuleProps> = ({
  lang,
  user,
  master,
  assets,
  onRefreshAssets,
}) => {
  const canRequest = user.role_code === 'super_admin' || user.permissions.includes('movements.request');
  const canApprove = user.role_code === 'super_admin' || user.permissions.includes('movements.approve');

  const targetLocations = master.transferTargets?.locations || master.locations;
  const targetDivisions = master.transferTargets?.divisions || master.divisions;
  const targetPersons = master.transferTargets?.persons || master.persons;

  const [movements, setMovements] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    asset_id: String(assets[0]?.id || ''),
    to_location_id: String(targetLocations[0]?.id || ''),
    to_division_id: '',
    to_pic_id: '',
    movement_date: new Date().toISOString().slice(0, 10),
    reason: '',
  });

  const load = async () => {
    const res = await apiFetch<{ movements: any[] }>('/api/movements');
    setMovements(res.movements);
  };

  useEffect(() => {
    load();
  }, []);

  const selectedAsset = useMemo(
    () => assets.find((a) => String(a.id) === form.asset_id),
    [assets, form.asset_id]
  );
  const selectedDestLoc = useMemo(
    () => targetLocations.find((l) => String(l.id) === form.to_location_id),
    [targetLocations, form.to_location_id]
  );

  const isCrossCompanyTransfer = Boolean(
    selectedAsset && selectedDestLoc && selectedAsset.company_id !== selectedDestLoc.company_id
  );

  const destCompanyDivisions = useMemo(() => {
    if (!selectedDestLoc) return targetDivisions;
    return targetDivisions.filter((d) => d.company_id === selectedDestLoc.company_id);
  }, [targetDivisions, selectedDestLoc]);

  const destCompanyPersons = useMemo(() => {
    if (!selectedDestLoc) return targetPersons;
    return targetPersons.filter((p) => p.company_id === selectedDestLoc.company_id);
  }, [targetPersons, selectedDestLoc]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/movements', {
        method: 'POST',
        body: JSON.stringify({
          asset_id: Number(form.asset_id),
          to_location_id: Number(form.to_location_id),
          to_division_id: form.to_division_id ? Number(form.to_division_id) : null,
          to_pic_id: form.to_pic_id ? Number(form.to_pic_id) : null,
          movement_date: form.movement_date,
          reason: form.reason,
        }),
      });
      setShowForm(false);
      setForm({
        asset_id: String(assets[0]?.id || ''),
        to_location_id: String(targetLocations[0]?.id || ''),
        to_division_id: '',
        to_pic_id: '',
        movement_date: new Date().toISOString().slice(0, 10),
        reason: '',
      });
      await load();
      onRefreshAssets();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDecision = async (id: number, decision: 'Approved' | 'Rejected') => {
    setError('');
    try {
      await apiFetch(`/api/movements/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, notes: `${decision} by ${user.full_name}` }),
      });
      await load();
      onRefreshAssets();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const isId = lang === 'id';
  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Riwayat & Persetujuan Perpindahan Aset' : 'Asset Movement & Transfer Workflow'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Transfer Intra-Perusahaan & Antar-Perusahaan → Persetujuan Berjenjang → Pembaruan Kepemilikan Atomik → Riwayat Tersimpan'
              : 'Intra & Cross-Company Transfer → Hierarchical Approval → Atomic Ownership Update → Preserved Ownership History'}
          </p>
        </div>
        {canRequest && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>{isId ? 'Ajukan Perpindahan' : 'Request Transfer'}</span>
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md text-xs text-[#C8102E] dark:text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleRequest}
          className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
              {isId ? 'Formulir Permintaan Perpindahan Aset' : 'Submit Asset Transfer Request'}
            </h3>
            {isCrossCompanyTransfer && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                <Building2 className="w-3.5 h-3.5" />
                {isId
                  ? `Transfer Antar-Perusahaan (${selectedAsset?.company_name} → ${selectedDestLoc?.company_name})`
                  : `Cross-Company Transfer (${selectedAsset?.company_name} → ${selectedDestLoc?.company_name})`}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className={labelClass}>{isId ? 'Aset *' : 'Asset *'}</label>
              <select
                value={form.asset_id}
                onChange={(e) => setForm({ ...form, asset_id: e.target.value })}
                className={inputClass}
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.asset_code} — {a.asset_name} ({a.company_code || a.company_name} · {a.specific_location})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Lokasi Tujuan *' : 'Destination Location *'}</label>
              <select
                value={form.to_location_id}
                onChange={(e) =>
                  setForm({ ...form, to_location_id: e.target.value, to_division_id: '', to_pic_id: '' })
                }
                className={inputClass}
              >
                {targetLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    [{l.company_name}] {l.building_name} → {l.room_name} → {l.specific_location}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Divisi Tujuan (Opsional)' : 'Destination Division (Optional)'}</label>
              <select
                value={form.to_division_id}
                onChange={(e) => setForm({ ...form, to_division_id: e.target.value })}
                className={inputClass}
              >
                <option value="">
                  {isId ? 'Otomatis / Pertahankan Divisi' : 'Auto / Keep Current Division'}
                </option>
                {destCompanyDivisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Custodian / PIC Baru (Opsional)' : 'New Custodian / PIC (Optional)'}</label>
              <select
                value={form.to_pic_id}
                onChange={(e) => setForm({ ...form, to_pic_id: e.target.value })}
                className={inputClass}
              >
                <option value="">{isId ? 'Pertahankan / Default PIC' : 'Keep / Unassign PIC'}</option>
                {destCompanyPersons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.nik_nip})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Tanggal Perpindahan *' : 'Transfer Date *'}</label>
              <input
                type="date"
                required
                value={form.movement_date}
                onChange={(e) => setForm({ ...form, movement_date: e.target.value })}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Alasan Perpindahan *' : 'Reason for Movement *'}</label>
              <input
                type="text"
                required
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="e.g. Relokasi operasional antar entitas"
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              {isId ? 'Batal' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md"
            >
              {isId ? 'Kirim Permintaan' : 'Submit Request'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'ID Perpindahan' : 'Movement ID'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Aset' : 'Asset'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Entitas & Divisi' : 'Company & Division'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Lokasi Asal → Tujuan' : 'Location Origin → Dest'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Perubahan PIC' : 'PIC Change'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Tanggal & Alasan' : 'Date & Reason'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{isId ? 'Persetujuan' : 'Approval'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400">
                    {isId ? 'Belum ada riwayat perpindahan aset.' : 'No asset movement records yet.'}
                  </td>
                </tr>
              ) : (
                movements.map((m) => {
                  const isCross = Number(m.is_cross_company || 0) === 1 || m.from_company_id !== m.to_company_id;
                  return (
                    <tr key={m.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{m.movement_code}</div>
                        {isCross && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 rounded">
                            {isId ? 'Antar-Perusahaan' : 'Cross-Company'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-[#C8102E] dark:text-red-400">{m.asset_code}</div>
                        <div className="text-neutral-700 dark:text-neutral-300">{m.asset_name}</div>
                      </td>
                      <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                        <div className="font-medium">
                          {m.from_company_code || m.from_company_name || '-'} ({m.from_division_name || '-'})
                        </div>
                        <div className="text-neutral-500 dark:text-neutral-400">
                          → {m.to_company_code || m.to_company_name || '-'} ({m.to_division_name || '-'})
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                        <div>{m.from_location_label}</div>
                        <div className="text-neutral-500 dark:text-neutral-400">→ {m.to_location_label}</div>
                      </td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                        {m.from_pic_name || '-'} → {m.to_pic_name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-neutral-600 dark:text-neutral-400 tabular-nums">
                          {String(m.movement_date).slice(0, 10)}
                        </div>
                        <div className="text-neutral-500 dark:text-neutral-400 max-w-xs truncate">{m.reason}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusLabel status={m.status} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                        {m.status === 'Pending Approval' && canApprove ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDecision(m.id, 'Approved')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded"
                            >
                              <Check className="w-3 h-3" />
                              <span>{isId ? 'Setujui' : 'Approve'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDecision(m.id, 'Rejected')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#C8102E] hover:bg-[#A10D24] rounded"
                            >
                              <X className="w-3 h-3" />
                              <span>{isId ? 'Tolak' : 'Reject'}</span>
                            </button>
                          </>
                        ) : (
                          <span className="text-neutral-400 dark:text-neutral-500">{m.approval_decision || '-'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

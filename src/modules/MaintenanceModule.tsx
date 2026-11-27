import React, { useEffect, useState } from 'react';
import { Wrench, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatIDR } from '../lib/exportUtils';
import { StatusLabel } from '../components/StatusText';
import type { AssetRow, AuthUser, Lang } from '../types/oims';

interface MaintenanceModuleProps {
  lang: Lang;
  user: AuthUser;
  assets: AssetRow[];
  onRefreshAssets: () => void;
}

export const MaintenanceModule: React.FC<MaintenanceModuleProps> = ({
  lang,
  user,
  assets,
  onRefreshAssets,
}) => {
  const canReport = user.role_code === 'super_admin' || user.permissions.includes('maintenance.report');
  const canUpdate = user.role_code === 'super_admin' || user.permissions.includes('maintenance.update');

  const [records, setRecords] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const [form, setForm] = useState({
    asset_id: String(assets[0]?.id || ''),
    damage_date: new Date().toISOString().slice(0, 10),
    damage_type: '',
    issue_description: '',
    vendor_technician: '',
    cost: '0',
    asset_condition: 'Minor Damage',
  });

  const load = async () => {
    const res = await apiFetch<{ records: any[] }>('/api/maintenance');
    setRecords(res.records);
  };

  useEffect(() => {
    load();
  }, []);

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/maintenance', {
      method: 'POST',
      body: JSON.stringify({ ...form, cost: Number(form.cost || 0) }),
    });
    setShowForm(false);
    setForm({
      asset_id: String(assets[0]?.id || ''),
      damage_date: new Date().toISOString().slice(0, 10),
      damage_type: '',
      issue_description: '',
      vendor_technician: '',
      cost: '0',
      asset_condition: 'Minor Damage',
    });
    await load();
    onRefreshAssets();
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await apiFetch(`/api/maintenance/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify(editing),
    });
    setEditing(null);
    await load();
    onRefreshAssets();
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
            {isId ? 'Manajemen Pemeliharaan & Perbaikan' : 'Maintenance & Repair Management'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Dilaporkan → Menunggu Persetujuan → Dalam Proses → Selesai / Dibatalkan'
              : 'Reported → Waiting Approval → In Progress → Completed / Cancelled'}
          </p>
        </div>
        {canReport && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{isId ? 'Laporkan Kerusakan' : 'Report Damage'}</span>
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={handleReport}
          className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
        >
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {isId ? 'Laporkan Kerusakan / Pemeliharaan Aset' : 'Report Asset Damage / Maintenance'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="sm:col-span-2">
              <label className={labelClass}>{isId ? 'Aset *' : 'Asset *'}</label>
              <select
                value={form.asset_id}
                onChange={(e) => setForm({ ...form, asset_id: e.target.value })}
                className={inputClass}
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.asset_code} — {a.asset_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Tanggal Kerusakan *' : 'Damage Date *'}</label>
              <input
                type="date"
                required
                value={form.damage_date}
                onChange={(e) => setForm({ ...form, damage_date: e.target.value })}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Jenis Kerusakan *' : 'Damage Type *'}</label>
              <input
                type="text"
                required
                value={form.damage_type}
                onChange={(e) => setForm({ ...form, damage_type: e.target.value })}
                placeholder="e.g. Display Flicker / Battery Failure"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Kondisi Aset Terkini' : 'Resulting Asset Condition'}</label>
              <select
                value={form.asset_condition}
                onChange={(e) => setForm({ ...form, asset_condition: e.target.value })}
                className={inputClass}
              >
                <option value="Minor Damage">Minor Damage</option>
                <option value="Major Damage">Major Damage</option>
                <option value="Unserviceable">Unserviceable</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Estimasi Biaya (IDR)' : 'Estimated Cost (IDR)'}</label>
              <input
                type="number"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="sm:col-span-3">
              <label className={labelClass}>{isId ? 'Deskripsi Masalah *' : 'Issue Description *'}</label>
              <textarea
                rows={2}
                required
                value={form.issue_description}
                onChange={(e) => setForm({ ...form, issue_description: e.target.value })}
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
              {isId ? 'Kirim Tiket' : 'Submit Ticket'}
            </button>
          </div>
        </form>
      )}

      {editing && (
        <form
          onSubmit={handleUpdate}
          className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
        >
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {isId ? `Perbarui Tiket Pemeliharaan ${editing.ticket_code}` : `Update Maintenance Ticket ${editing.ticket_code}`}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className={labelClass}>Status</label>
              <select
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                className={inputClass}
              >
                <option value="Reported">Reported</option>
                <option value="Waiting Approval">Waiting Approval</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Teknisi / Vendor' : 'Technician / Vendor'}</label>
              <input
                type="text"
                value={editing.vendor_technician || ''}
                onChange={(e) => setEditing({ ...editing, vendor_technician: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Biaya Akhir (IDR)' : 'Final Cost (IDR)'}</label>
              <input
                type="number"
                value={editing.cost || 0}
                onChange={(e) => setEditing({ ...editing, cost: Number(e.target.value) })}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="sm:col-span-3">
              <label className={labelClass}>{isId ? 'Tindakan Perbaikan' : 'Repair Action Taken'}</label>
              <input
                type="text"
                value={editing.repair_action || ''}
                onChange={(e) => setEditing({ ...editing, repair_action: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              {isId ? 'Batal' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md"
            >
              {isId ? 'Simpan Pembaruan' : 'Save Update'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Tiket' : 'Ticket'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Aset' : 'Asset'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Kerusakan & Tindakan' : 'Damage & Action'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Vendor</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{isId ? 'Biaya (IDR)' : 'Cost (IDR)'}</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{isId ? 'Aksi' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400">
                    {isId ? 'Belum ada catatan pemeliharaan.' : 'No maintenance records yet.'}
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-[#141619] dark:text-neutral-100 whitespace-nowrap">
                      {r.ticket_code}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-[#C8102E] dark:text-red-400">{r.asset_code}</div>
                      <div className="text-neutral-700 dark:text-neutral-300">{r.asset_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#141619] dark:text-neutral-100">{r.damage_type}</div>
                      <div className="text-neutral-500 dark:text-neutral-400 max-w-xs truncate">
                        {r.repair_action || r.issue_description}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{r.vendor_technician || '-'}</td>
                    <td className="px-4 py-3 text-right font-mono text-[#141619] dark:text-neutral-100 tabular-nums whitespace-nowrap">
                      {formatIDR(r.cost)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusLabel status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canUpdate && (
                        <button
                          type="button"
                          onClick={() => setEditing({ ...r })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <Wrench className="w-3 h-3" />
                          <span>{isId ? 'Perbarui' : 'Update'}</span>
                        </button>
                      )}
                    </td>
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

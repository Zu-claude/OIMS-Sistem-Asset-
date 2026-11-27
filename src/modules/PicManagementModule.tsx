import React, { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { ConditionLabel } from '../components/StatusText';
import type { AssetRow, AuthUser, Lang, MasterData } from '../types/oims';

interface PicManagementModuleProps {
  lang: Lang;
  user: AuthUser;
  master: MasterData;
  assets: AssetRow[];
  onRefresh: () => void;
}

export const PicManagementModule: React.FC<PicManagementModuleProps> = ({
  lang,
  user,
  master,
  assets,
  onRefresh,
}) => {
  const canManage = user.role_code === 'super_admin' || user.permissions.includes('pic.create');
  const canAssign = user.role_code === 'super_admin' || user.permissions.includes('pic.assign');

  const [selectedPicId, setSelectedPicId] = useState<number | null>(master.persons[0]?.id || null);
  const [showForm, setShowForm] = useState(false);
  const [assignAssetId, setAssignAssetId] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    nik_nip: '',
    full_name: '',
    company_id: String(master.companies[0]?.id || 1),
    division_id: String(master.divisions[0]?.id || 1),
    department: '',
    position_title: '',
    email: '',
    phone: '',
    status: 'Active',
  });

  const handleCreatePic = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/persons', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowForm(false);
      setForm({
        nik_nip: '',
        full_name: '',
        company_id: String(master.companies[0]?.id || 1),
        division_id: String(master.divisions[0]?.id || 1),
        department: '',
        position_title: '',
        email: '',
        phone: '',
        status: 'Active',
      });
      onRefresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAssignAssetToPic = async () => {
    if (!assignAssetId || !selectedPicId) return;
    await apiFetch(`/api/assets/${assignAssetId}`, {
      method: 'PUT',
      body: JSON.stringify({ pic_id: selectedPicId }),
    });
    setAssignAssetId('');
    onRefresh();
  };

  const selectedPic = master.persons.find((p) => p.id === selectedPicId);
  const picAssets = assets.filter((a) => a.pic_id === selectedPicId);
  const isId = lang === 'id';

  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Manajemen Penanggung Jawab (PIC)' : 'PIC / Custodian Management'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Daftar penanggung jawab inventaris beserta jumlah dan daftar aset yang dipegang.'
              : 'Custodian directory tracking assigned assets, NIK/NIP, and responsibility counts.'}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{isId ? 'Tambah PIC' : 'Add PIC'}</span>
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
          onSubmit={handleCreatePic}
          className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
        >
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {isId ? 'Daftarkan PIC Baru' : 'Register New PIC'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className={labelClass}>NIK / NIP *</label>
              <input
                type="text"
                required
                value={form.nik_nip}
                onChange={(e) => setForm({ ...form, nik_nip: e.target.value })}
                placeholder="KDC-12045"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Nama Lengkap *' : 'Full Name *'}</label>
              <input
                type="text"
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Jabatan *' : 'Position Title *'}</label>
              <input
                type="text"
                required
                value={form.position_title}
                onChange={(e) => setForm({ ...form, position_title: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Perusahaan *' : 'Company *'}</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                className={inputClass}
              >
                {master.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Divisi *' : 'Division *'}</label>
              <select
                value={form.division_id}
                onChange={(e) => setForm({ ...form, division_id: e.target.value })}
                className={inputClass}
              >
                {master.divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Telepon' : 'Phone'}</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
              {isId ? 'Simpan PIC' : 'Save PIC'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {isId ? `Direktori PIC (${master.persons.length})` : `Custodian Directory (${master.persons.length})`}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">NIK/NIP</th>
                  <th className="px-4 py-2.5 font-medium">{isId ? 'Nama & Jabatan' : 'Name & Role'}</th>
                  <th className="px-4 py-2.5 font-medium">{isId ? 'Divisi' : 'Division'}</th>
                  <th className="px-4 py-2.5 font-medium text-right">{isId ? 'Aset Dipegang' : 'Assets Held'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {master.persons.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedPicId(p.id)}
                    className={`hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 cursor-pointer transition-colors ${
                      selectedPicId === p.id ? 'bg-red-50/40 dark:bg-red-950/25' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono font-medium text-[#141619] dark:text-neutral-100 whitespace-nowrap">
                      {p.nik_nip}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#141619] dark:text-neutral-100">{p.full_name}</div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        {p.position_title} · {p.email}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">{p.division_name}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#141619] dark:text-neutral-100 tabular-nums">
                      {p.asset_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-[#C8102E] dark:text-red-400 shrink-0" />
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 truncate">
              {selectedPic
                ? `${selectedPic.full_name} (${picAssets.length} ${isId ? 'aset' : 'assets'})`
                : isId
                ? 'Pilih PIC'
                : 'Select PIC'}
            </h3>
          </div>

          {canAssign && selectedPic && (
            <div className="p-3 bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 flex gap-2 text-xs">
              <select
                value={assignAssetId}
                onChange={(e) => setAssignAssetId(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]"
              >
                <option value="">
                  {isId ? `Tetapkan aset ke ${selectedPic.full_name}...` : `Assign / Reassign asset to ${selectedPic.full_name}...`}
                </option>
                {assets
                  .filter((a) => a.pic_id !== selectedPic.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.asset_code} — {a.asset_name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!assignAssetId}
                onClick={handleAssignAssetToPic}
                className="px-3 py-1.5 font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                {isId ? 'Tetapkan' : 'Assign'}
              </button>
            </div>
          )}

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 max-h-[420px] overflow-y-auto">
            {picAssets.length === 0 ? (
              <div className="p-6 text-xs text-neutral-500 dark:text-neutral-400 text-center">
                {isId ? 'Belum ada aset yang ditugaskan ke PIC ini.' : 'No assets assigned to this PIC.'}
              </div>
            ) : (
              picAssets.map((a) => (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-[#C8102E] dark:text-red-400">{a.asset_code}</div>
                    <div className="font-medium text-[#141619] dark:text-neutral-100 truncate">{a.asset_name}</div>
                    <div className="text-neutral-500 dark:text-neutral-400 truncate">
                      {a.building_name} · {a.specific_location}
                    </div>
                  </div>
                  <ConditionLabel condition={a.condition_status} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { Building2, Image as ImageIcon, MapPin, Plus, Search, Trash2, Eye } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatIDR } from '../lib/exportUtils';
import { isSafeExternalUrl } from '../lib/workspace';
import { ConfirmModal } from '../components/ConfirmModal';
import { ConditionLabel, StatusLabel } from '../components/StatusText';
import type { AssetRow, AuthUser, Lang, MasterData } from '../types/oims';

interface LocationManagementModuleProps {
  lang: Lang;
  user: AuthUser;
  master: MasterData;
  assets: AssetRow[];
  onRefresh: () => void;
}

export const LocationManagementModule: React.FC<LocationManagementModuleProps> = ({
  lang,
  user,
  master,
  assets,
  onRefresh,
}) => {
  const canCreate = user.role_code === 'super_admin' || user.permissions.includes('locations.create');
  const canDelete = user.role_code === 'super_admin' || user.permissions.includes('locations.delete');

  const [selectedLocId, setSelectedLocId] = useState<number | null>(master.locations[0]?.id || null);
  const [locSearch, setLocSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [brokenThumbs, setBrokenThumbs] = useState<Record<number, boolean>>({});

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    company_id: String(master.companies[0]?.id || 1),
    building_name: '',
    floor_name: '',
    room_name: '',
    specific_location: '',
    location_code: '',
    notes: '',
  });

  const isId = lang === 'id';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/locations', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowForm(false);
      setForm({
        company_id: String(master.companies[0]?.id || 1),
        building_name: '',
        floor_name: '',
        room_name: '',
        specific_location: '',
        location_code: '',
        notes: '',
      });
      onRefresh();
    } catch (err: any) {
      setError(err.message || (isId ? 'Gagal menambah lokasi' : 'Failed to add location'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      await apiFetch(`/api/locations/${deleteTarget.id}`, { method: 'DELETE' });
      if (selectedLocId === deleteTarget.id) {
        const nextLoc = master.locations.find((l) => l.id !== deleteTarget.id);
        setSelectedLocId(nextLoc?.id || null);
      }
      setDeleteTarget(null);
      onRefresh();
    } catch (err: any) {
      setError(err.message);
      setDeleteTarget(null);
    }
  };

  const assetStatsByLocation = useMemo(() => {
    const map = new Map<number, { count: number; totalValue: number; goodCount: number; attentionCount: number }>();
    for (const a of assets) {
      const current = map.get(a.location_id) || { count: 0, totalValue: 0, goodCount: 0, attentionCount: 0 };
      current.count += 1;
      current.totalValue += Number(a.acquisition_value || 0);
      if (a.condition_status === 'Good') {
        current.goodCount += 1;
      } else {
        current.attentionCount += 1;
      }
      map.set(a.location_id, current);
    }
    return map;
  }, [assets]);

  const buildingNames = useMemo(
    () => Array.from(new Set(master.locations.map((l) => l.building_name))).sort(),
    [master.locations]
  );

  const filteredLocations = useMemo(() => {
    const q = locSearch.trim().toLowerCase();
    return master.locations.filter((l) => {
      if (companyFilter && String(l.company_id) !== companyFilter) return false;
      if (buildingFilter && l.building_name !== buildingFilter) return false;
      if (!q) return true;
      return (
        l.location_code.toLowerCase().includes(q) ||
        l.specific_location.toLowerCase().includes(q) ||
        l.building_name.toLowerCase().includes(q) ||
        l.floor_name.toLowerCase().includes(q) ||
        l.room_name.toLowerCase().includes(q) ||
        l.company_name.toLowerCase().includes(q)
      );
    });
  }, [master.locations, locSearch, companyFilter, buildingFilter]);

  const selectedLoc =
    master.locations.find((l) => l.id === selectedLocId) || filteredLocations[0] || null;

  const selectedLocAssets = useMemo(() => {
    if (!selectedLoc) return [];
    const base = assets.filter((a) => a.location_id === selectedLoc.id);
    const q = assetSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (a) =>
        a.asset_code.toLowerCase().includes(q) ||
        a.asset_name.toLowerCase().includes(q) ||
        (a.serial_number || '').toLowerCase().includes(q) ||
        (a.pic_name || '').toLowerCase().includes(q) ||
        a.category_name.toLowerCase().includes(q)
    );
  }, [assets, selectedLoc, assetSearch]);

  const selectedStats = selectedLoc
    ? assetStatsByLocation.get(selectedLoc.id) || { count: 0, totalValue: 0, goodCount: 0, attentionCount: 0 }
    : { count: 0, totalValue: 0, goodCount: 0, attentionCount: 0 };

  const occupiedLocationsCount = useMemo(
    () => master.locations.filter((l) => (assetStatsByLocation.get(l.id)?.count ?? l.asset_count) > 0).length,
    [master.locations, assetStatsByLocation]
  );

  const totalAssetsValueAll = useMemo(
    () => assets.reduce((sum, a) => sum + Number(a.acquisition_value || 0), 0),
    [assets]
  );

  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Manajemen Lokasi & Aset per Lokasi' : 'Asset Location Management'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Hierarki 5-tingkat (Perusahaan · Gedung · Lantai · Ruangan · Titik Spesifik) beserta distribusi aset'
              : '5-tier hierarchy (Company · Building · Floor · Room · Specific Spot) with stationed asset inspection'}
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{isId ? 'Tambah Lokasi' : 'Add Location'}</span>
          </button>
        )}
      </div>

      {/* Top 4 KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {isId ? 'Total Titik Lokasi' : 'Registered Locations'}
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums">
            {master.locations.length}
          </div>
        </div>
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {isId ? 'Lokasi Terisi Aset' : 'Occupied Locations'}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums">
              {occupiedLocationsCount}
            </span>
            <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
              {master.locations.length > 0 ? Math.round((occupiedLocationsCount / master.locations.length) * 100) : 0}%
            </span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {isId ? 'Total Aset Ditempatkan' : 'Total Stationed Assets'}
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums">
            {assets.length}
          </div>
        </div>
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {isId ? 'Total Nilai Aset Lokasi' : 'Total Location Asset Value'}
          </div>
          <div className="mt-2 font-mono text-base font-bold text-[#141619] dark:text-neutral-100 tabular-nums truncate">
            {formatIDR(totalAssetsValueAll)}
          </div>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md text-xs text-[#C8102E] dark:text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
        >
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {isId ? 'Tambah Lokasi 5-Tingkat' : 'Add 5-Tier Location'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
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
              <label className={labelClass}>{isId ? 'Gedung *' : 'Building *'}</label>
              <input
                type="text"
                required
                value={form.building_name}
                onChange={(e) => setForm({ ...form, building_name: e.target.value })}
                placeholder="e.g. Office Building"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Lantai *' : 'Floor *'}</label>
              <input
                type="text"
                required
                value={form.floor_name}
                onChange={(e) => setForm({ ...form, floor_name: e.target.value })}
                placeholder="e.g. Floor 3"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Ruangan *' : 'Room *'}</label>
              <input
                type="text"
                required
                value={form.room_name}
                onChange={(e) => setForm({ ...form, room_name: e.target.value })}
                placeholder="e.g. General Affairs"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Lokasi Spesifik *' : 'Specific Location *'}</label>
              <input
                type="text"
                required
                value={form.specific_location}
                onChange={(e) => setForm({ ...form, specific_location: e.target.value })}
                placeholder="e.g. Storage Cabinet B"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Kode Lokasi (Opsional)' : 'Location Code (Optional)'}</label>
              <input
                type="text"
                value={form.location_code}
                onChange={(e) => setForm({ ...form, location_code: e.target.value })}
                placeholder="LOC-KDC-..."
                className={`${inputClass} font-mono`}
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
              {isId ? 'Simpan Lokasi' : 'Save Location'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
        <div className="md:col-span-6 relative">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={locSearch}
            onChange={(e) => setLocSearch(e.target.value)}
            placeholder={
              isId
                ? 'Cari kode lokasi, gedung, ruangan, atau titik spesifik...'
                : 'Search location code, building, room, or specific spot...'
            }
            className="w-full pl-8 pr-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]"
          />
        </div>
        <div className="md:col-span-3">
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className={inputClass}>
            <option value="">{isId ? 'Semua Perusahaan' : 'All Companies'}</option>
            {master.companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-3">
          <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)} className={inputClass}>
            <option value="">{isId ? 'Semua Gedung' : 'All Buildings'}</option>
            {buildingNames.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Directory */}
        <div className="lg:col-span-6 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
              <span className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Direktori Lokasi' : 'Location Directory'}
              </span>
            </div>
            <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
              {filteredLocations.length} / {master.locations.length}
            </span>
          </div>

          <div className="overflow-x-auto max-h-[580px] overflow-y-auto">
            {filteredLocations.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
                {isId ? 'Tidak ada lokasi yang cocok dengan filter pencarian.' : 'No locations match your search filters.'}
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{isId ? 'Lokasi & Hierarki' : 'Location & Hierarchy'}</th>
                    <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{isId ? 'Aset' : 'Assets'}</th>
                    <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{isId ? 'Nilai' : 'Value'}</th>
                    <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{isId ? 'Aksi' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {filteredLocations.map((l) => {
                    const stats = assetStatsByLocation.get(l.id);
                    const count = stats?.count ?? l.asset_count;
                    const value = stats?.totalValue ?? 0;
                    const isSelected = selectedLoc?.id === l.id;

                    return (
                      <tr
                        key={l.id}
                        onClick={() => setSelectedLocId(l.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-red-50/50 dark:bg-red-950/25'
                            : 'hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60'
                        }`}
                      >
                        <td className="px-4 py-3 min-w-[200px]">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-semibold ${
                                isSelected ? 'text-[#C8102E] dark:text-red-400' : 'text-[#141619] dark:text-neutral-100'
                              }`}
                            >
                              {l.specific_location}
                            </span>
                            <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                              · {l.location_code}
                            </span>
                          </div>
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">
                            {l.company_name} · {l.building_name} · {l.floor_name} · {l.room_name}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-[#141619] dark:text-neutral-100 tabular-nums whitespace-nowrap">
                          {count}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[11px] text-neutral-600 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                          {value > 0 ? formatIDR(value) : '-'}
                        </td>
                        <td
                          className="px-4 py-3 text-right whitespace-nowrap space-x-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedLocId(l.id)}
                            className="p-1.5 text-neutral-600 dark:text-neutral-300 hover:text-[#141619] dark:hover:text-white border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            title={isId ? 'Lihat aset di lokasi' : 'Inspect location assets'}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(l)}
                              className="p-1.5 text-neutral-600 dark:text-neutral-300 hover:text-[#C8102E] dark:hover:text-red-400 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              title={isId ? 'Hapus lokasi' : 'Delete location'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Detail Panel: Aset di Lokasi */}
        <div className="lg:col-span-6 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <MapPin className="w-4 h-4 text-[#C8102E] dark:text-red-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-bold text-[#141619] dark:text-neutral-100 truncate">
                    {selectedLoc ? selectedLoc.specific_location : isId ? 'Pilih lokasi' : 'Select a location'}
                  </h3>
                  {selectedLoc && (
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">
                      {selectedLoc.company_name} · {selectedLoc.building_name} · {selectedLoc.floor_name} · {selectedLoc.room_name} ·{' '}
                      <span className="font-mono">{selectedLoc.location_code}</span>
                    </p>
                  )}
                </div>
              </div>
              {selectedLoc && (
                <div className="text-right shrink-0 tabular-nums">
                  <div className="font-mono text-sm font-bold text-[#141619] dark:text-neutral-100">
                    {selectedStats.count} {isId ? 'Aset' : 'Assets'}
                  </div>
                  <div className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                    {formatIDR(selectedStats.totalValue)}
                  </div>
                </div>
              )}
            </div>

            {selectedLoc && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3 text-[11px] text-neutral-600 dark:text-neutral-400 tabular-nums">
                  <span>
                    {isId ? 'Kondisi Baik:' : 'Good:'}{' '}
                    <strong className="font-mono text-emerald-700 dark:text-emerald-400">{selectedStats.goodCount}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {isId ? 'Perlu Perhatian:' : 'Attention:'}{' '}
                    <strong className="font-mono text-[#C8102E] dark:text-red-400">{selectedStats.attentionCount}</strong>
                  </span>
                </div>
                <div className="relative w-full sm:w-56">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    placeholder={isId ? 'Filter aset di lokasi ini...' : 'Filter assets here...'}
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-neutral-50 dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 max-h-[500px] overflow-y-auto">
            {!selectedLoc ? (
              <div className="p-8 text-xs text-neutral-500 dark:text-neutral-400 text-center">
                {isId ? 'Pilih lokasi di direktori untuk melihat daftar aset.' : 'Select a location from the directory to inspect assets.'}
              </div>
            ) : selectedLocAssets.length === 0 ? (
              <div className="p-8 text-xs text-neutral-500 dark:text-neutral-400 text-center">
                {assetSearch.trim()
                  ? isId
                    ? 'Tidak ada aset di lokasi ini yang cocok dengan pencarian.'
                    : 'No assets at this location match your search.'
                  : isId
                  ? 'Belum ada aset yang ditempatkan di lokasi ini.'
                  : 'No assets currently stationed at this location.'}
              </div>
            ) : (
              selectedLocAssets.map((a) => {
                const showPhoto = Boolean(a.primary_photo_url && isSafeExternalUrl(a.primary_photo_url) && !brokenThumbs[a.id]);
                return (
                  <div
                    key={a.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-neutral-50/70 dark:hover:bg-[#1E222A]/50 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      {showPhoto ? (
                        <img
                          src={a.primary_photo_url!}
                          alt={a.asset_name}
                          referrerPolicy="no-referrer"
                          onError={() => setBrokenThumbs((prev) => ({ ...prev, [a.id]: true }))}
                          className="w-11 h-11 rounded-md object-cover border border-neutral-200 dark:border-neutral-700 shrink-0 bg-neutral-100 dark:bg-[#1E222A]"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-[#1E222A] flex items-center justify-center text-neutral-400 dark:text-neutral-500 shrink-0">
                          <ImageIcon className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono text-xs font-semibold text-[#C8102E] dark:text-red-400">
                            {a.asset_code}
                          </span>
                          <span className="text-xs font-semibold text-[#141619] dark:text-neutral-100 truncate">
                            {a.asset_name}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
                          {a.category_name} · PIC: {a.pic_name || (isId ? 'Belum ditetapkan' : 'Unassigned')}
                          {a.serial_number ? ` · SN: ${a.serial_number}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0 text-xs">
                      <div className="flex items-center gap-2">
                        <ConditionLabel condition={a.condition_status} />
                        <StatusLabel status={a.asset_status} />
                      </div>
                      <div className="text-[11px] font-mono text-neutral-600 dark:text-neutral-400 tabular-nums">
                        {formatIDR(Number(a.acquisition_value || 0))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={isId ? 'Hapus Lokasi Tidak Terpakai?' : 'Delete Unused Location?'}
        description={
          isId
            ? `Hapus lokasi ${deleteTarget?.specific_location} (${deleteTarget?.location_code})? Penghapusan diblokir jika masih ada aset atau riwayat perpindahan terkait.`
            : `Delete location ${deleteTarget?.specific_location} (${deleteTarget?.location_code})? Deletion is blocked if assets or historical movements reference this location.`
        }
        confirmLabel={isId ? 'Hapus Lokasi' : 'Delete Location'}
        cancelLabel={isId ? 'Batal' : 'Cancel'}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

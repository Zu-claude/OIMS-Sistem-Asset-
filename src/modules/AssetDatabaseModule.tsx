import React, { useMemo, useRef, useState } from 'react';
import {
  Search,
  Download,
  Printer,
  Upload,
  Eye,
  Edit3,
  Trash2,
  X,
  ExternalLink,
  HardDrive,
  Image as ImageIcon,
  ScanBarcode,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { exportRowsToExcel, formatIDR, parseSpreadsheetFile } from '../lib/exportUtils';
import { normalizeScannedBarcode, playScanBeep, useBarcodeScanner } from '../lib/useBarcodeScanner';
import { formatFileSize, isSafeExternalUrl, uploadAssetFileLocally } from '../lib/workspace';
import { ConfirmModal } from '../components/ConfirmModal';
import { ConditionLabel, StatusLabel } from '../components/StatusText';
import type { AssetRow, AuthUser, Lang, MasterData } from '../types/oims';

interface AssetDatabaseModuleProps {
  lang: Lang;
  user: AuthUser;
  master: MasterData;
  assets: AssetRow[];
  initialSearch?: string;
  onRefresh: () => void;
}

export const AssetDatabaseModule: React.FC<AssetDatabaseModuleProps> = ({
  lang,
  user,
  master,
  assets,
  initialSearch = '',
  onRefresh,
}) => {
  const isId = lang === 'id';
  const canEdit = user.role_code === 'super_admin' || user.permissions.includes('assets.edit');
  const canDelete = user.role_code === 'super_admin' || user.permissions.includes('assets.delete');
  const canImport = user.role_code === 'super_admin' || user.permissions.includes('assets.import');

  const [search, setSearch] = useState(initialSearch);
  const [catFilter, setCatFilter] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [divFilter, setDivFilter] = useState('');
  const [picFilter, setPicFilter] = useState('');
  const [condFilter, setCondFilter] = useState('');
  const [sortKey, setSortKey] = useState<'asset_code' | 'asset_name' | 'acquisition_value' | 'acquisition_date'>('asset_code');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [detailData, setDetailData] = useState<any>(null);
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetRow | null>(null);

  // Import Wizard
  const [importOpen, setImportOpen] = useState(false);
  const [importDefaultCompanyId, setImportDefaultCompanyId] = useState(String(master.companies[0]?.id || ''));
  const [importDefaultDivisionId, setImportDefaultDivisionId] = useState('');
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [editReason, setEditReason] = useState('');

  const [uploadingFile, setUploadingFile] = useState(false);
  const [photoPreviewBroken, setPhotoPreviewBroken] = useState(false);
  const [brokenThumbs, setBrokenThumbs] = useState<Record<number, boolean>>({});
  const [lightboxPhoto, setLightboxPhoto] = useState<{
    assetId: number;
    assetCode: string;
    assetName: string;
    url: string;
  } | null>(null);
  const [toast, setToast] = useState('');

  // USB HID & Bluetooth Barcode Scanner state
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [autoOpenExact, setAutoOpenExact] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScanned, setLastScanned] = useState<{
    code: string;
    matchedAsset: AssetRow | null;
    matchCount: number;
  } | null>(null);

  const filtered = useMemo(() => {
    const rawQ = search.trim();
    const extracted = rawQ.includes('token=') ? rawQ.split('token=').pop()!.split('&')[0].trim() : rawQ;
    const q = extracted.toLowerCase();
    return assets
      .filter((a) => {
        if (q) {
          const hay = `${a.asset_code} ${a.asset_name} ${a.serial_number || ''} ${a.qr_token || ''} ${a.brand || ''} ${a.pic_name || ''} ${a.building_name} ${a.specific_location}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (catFilter && String(a.category_id) !== catFilter) return false;
        if (locFilter && String(a.location_id) !== locFilter) return false;
        if (divFilter && String(a.division_id) !== divFilter) return false;
        if (picFilter && String(a.pic_id || '') !== picFilter) return false;
        if (condFilter && a.condition_status !== condFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortAsc ? av - bv : bv - av;
        }
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
  }, [assets, search, catFilter, locFilter, divFilter, picFilter, condFilter, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openDetails = async (id: number) => {
    setPhotoPreviewBroken(false);
    const res = await apiFetch(`/api/assets/${id}`);
    setDetailData(res);
  };

  const handleBarcodeScan = async (rawCode: string) => {
    let cleaned = normalizeScannedBarcode(rawCode);
    if (cleaned.includes('token=')) {
      cleaned = cleaned.split('token=').pop()!.split('&')[0].trim();
    }
    if (!cleaned) return;

    setSearch(cleaned);
    setPage(1);

    const upper = cleaned.toUpperCase();
    const exactMatch =
      assets.find(
        (a) =>
          (a.serial_number && a.serial_number.trim().toUpperCase() === upper) ||
          a.asset_code.trim().toUpperCase() === upper ||
          (a.qr_token && a.qr_token.trim().toUpperCase() === upper)
      ) || null;

    const matchCount = assets.filter((a) => {
      const hay = `${a.asset_code} ${a.asset_name} ${a.serial_number || ''} ${a.qr_token || ''}`.toLowerCase();
      return hay.includes(cleaned.toLowerCase());
    }).length;

    setLastScanned({ code: cleaned, matchedAsset: exactMatch, matchCount });
    if (soundEnabled) {
      playScanBeep(Boolean(exactMatch || matchCount > 0));
    }

    if (autoOpenExact && exactMatch) {
      await openDetails(exactMatch.id);
    }
  };

  const modalOpen = Boolean(
    detailData || editingAsset || deleteTarget || importOpen || lightboxPhoto
  );

  useBarcodeScanner({
    enabled: scannerEnabled && !modalOpen,
    targetInputRef: searchInputRef,
    onScan: (code) => {
      void handleBarcodeScan(code);
    },
  });

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;
    try {
      await apiFetch(`/api/assets/${editingAsset.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...editingAsset,
          custodian_person_id: editingAsset.pic_id ?? null,
          responsible_division_id: editingAsset.division_id,
          reason: editReason.trim() || undefined,
        }),
      });
      setEditingAsset(null);
      setEditReason('');
      setToast(isId ? 'Data aset berhasil diperbarui.' : 'Asset updated successfully.');
      onRefresh();
    } catch (err: any) {
      setToast(err?.message || (isId ? 'Gagal memperbarui aset.' : 'Failed to update asset.'));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await apiFetch(`/api/assets/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    setToast(isId ? 'Aset berhasil diarsipkan.' : 'Asset archived.');
    onRefresh();
  };

  const handleExportExcel = () => {
    const rows = filtered.map((a) => ({
      'Asset Code': a.asset_code,
      'Asset Name': a.asset_name,
      Company: a.company_name,
      Category: a.category_name,
      Brand: a.brand || '',
      Model: a.model || '',
      'Serial Number': a.serial_number || '',
      Division: a.division_name,
      Location: `${a.building_name} - ${a.floor_name} - ${a.room_name} - ${a.specific_location}`,
      PIC: a.pic_name || 'Unassigned',
      'Data Owner': a.data_owner_name || '-',
      'Verification Officer': a.verification_officer_name || '-',
      Approver: a.approver_name || '-',
      'Acquisition Date': a.acquisition_date,
      'Acquisition Value (IDR)': a.acquisition_value,
      Condition: a.condition_status,
      Status: a.asset_status,
      'QR Token': a.qr_token || 'Missing',
    }));
    exportRowsToExcel(rows, `KIDECO_OIMS_Assets_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Assets');
  };

  const handleImportFileChange = async (file: File | undefined) => {
    if (!file) return;
    const rawRows = await parseSpreadsheetFile(file);
    const preview = await apiFetch('/api/assets/import/validate', {
      method: 'POST',
      body: JSON.stringify({
        rows: rawRows,
        default_company_id: importDefaultCompanyId ? Number(importDefaultCompanyId) : null,
        default_division_id: importDefaultDivisionId ? Number(importDefaultDivisionId) : null,
      }),
    });
    setImportPreview(preview);
  };

  const handleCommitImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const validItems = importPreview.results.filter((r: any) => r.valid).map((r: any) => r.normalized);
      await apiFetch('/api/assets/import/commit', {
        method: 'POST',
        body: JSON.stringify({ items: validItems }),
      });
      setImportOpen(false);
      setImportPreview(null);
      setToast(isId ? `${validItems.length} aset berhasil diimpor.` : `Imported ${validItems.length} assets cleanly.`);
      onRefresh();
    } finally {
      setImporting(false);
    }
  };

  const handleLocalUpload = async (
    assetId: number,
    assetCode: string,
    file: File,
    kind: 'photo' | 'document'
  ) => {
    setUploadingFile(true);
    try {
      await uploadAssetFileLocally({
        assetId,
        assetCode,
        file,
        kind,
        docType: kind === 'photo' ? 'Asset Photo' : 'Invoice / Purchase Document',
      });
      await openDetails(assetId);
      setToast(
        isId
          ? `${kind === 'photo' ? 'Foto aset' : 'Dokumen / invoice'} berhasil diunggah ke penyimpanan lokal.`
          : `${kind === 'photo' ? 'Asset photo' : 'Invoice / document'} uploaded to local server storage.`
      );
      onRefresh();
    } catch (err: any) {
      setToast(err.message || (isId ? 'Gagal mengunggah lampiran.' : 'File upload failed.'));
    } finally {
      setUploadingFile(false);
    }
  };

  const controlBtnClass =
    'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0 transition-colors';

  const selectClass =
    'px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Database Inventaris Terpusat' : 'Centralized Asset Database'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
            {isId
              ? `Menampilkan ${filtered.length} dari ${assets.length} aset terdaftar`
              : `Showing ${filtered.length} of ${assets.length} registered assets`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canImport && (
            <button type="button" onClick={() => setImportOpen(true)} className={controlBtnClass}>
              <Upload className="w-3.5 h-3.5" />
              <span>{isId ? 'Impor CSV/Excel' : 'Import CSV/Excel'}</span>
            </button>
          )}
          <button type="button" onClick={handleExportExcel} className={controlBtnClass}>
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isId ? 'Cetak / PDF' : 'PDF / Print'}</span>
          </button>
        </div>
      </div>

      {toast && (
        <div className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 rounded-md text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between no-print">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')} className="font-semibold underline">
            {isId ? 'Tutup' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Filters Toolbar + USB HID / Bluetooth Barcode Scanner Bar */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 space-y-3 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-neutral-100 dark:border-neutral-800 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setScannerEnabled((v) => !v);
                if (!scannerEnabled) searchInputRef.current?.focus();
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-medium transition-colors whitespace-nowrap shrink-0 ${
                scannerEnabled
                  ? 'bg-[#141619] dark:bg-[#C8102E] text-white border-[#141619] dark:border-[#C8102E]'
                  : 'bg-white dark:bg-[#1E222A] text-neutral-600 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
              }`}
            >
              <ScanBarcode className="w-3.5 h-3.5" />
              <span>
                {isId
                  ? `Scanner USB HID / Bluetooth: ${scannerEnabled ? 'Aktif' : 'Nonaktif'}`
                  : `USB HID / Bluetooth Scanner: ${scannerEnabled ? 'Ready' : 'Off'}`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
              }}
              className="px-2.5 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              {isId ? 'Fokus Input Scan' : 'Focus Scan Input'}
            </button>

            <label className="inline-flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300 cursor-pointer ml-1">
              <input
                type="checkbox"
                checked={autoOpenExact}
                onChange={(e) => setAutoOpenExact(e.target.checked)}
                className="accent-[#C8102E]"
              />
              <span>
                {isId ? 'Buka otomatis jika SN/Kode cocok' : 'Auto-open exact Serial/Code match'}
              </span>
            </label>

            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              title={soundEnabled ? 'Mute scan beep' : 'Enable scan beep'}
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
          </div>

          {lastScanned && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-mono font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Hasil Scan:' : 'Scanned:'} {lastScanned.code}
              </span>
              {lastScanned.matchedAsset ? (
                <button
                  type="button"
                  onClick={() => openDetails(lastScanned.matchedAsset!.id)}
                  className="px-2 py-0.5 bg-[#C8102E] text-white font-medium rounded hover:bg-[#A10D24]"
                >
                  {isId ? 'Buka Detail' : 'Open Asset'} ({lastScanned.matchedAsset.asset_code})
                </button>
              ) : (
                <span className={lastScanned.matchCount > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#C8102E] dark:text-red-400'}>
                  {lastScanned.matchCount > 0
                    ? `${lastScanned.matchCount} ${isId ? 'kecocokan' : 'match(es)'}`
                    : isId
                    ? 'Tidak ditemukan'
                    : 'No matching serial/code'}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                if (!e.target.value) setLastScanned(null);
              }}
              placeholder={
                isId
                  ? 'Scan barcode serial number, kode aset, nama, PIC...'
                  : 'Scan serial barcode, asset code, name, PIC...'
              }
              className="w-full pl-8 pr-8 py-1.5 text-xs font-mono bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setLastScanned(null);
                  setPage(1);
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                title={isId ? 'Bersihkan pencarian' : 'Clear search'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select value={divFilter} onChange={(e) => { setDivFilter(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">{isId ? 'Semua Divisi' : 'All Divisions'}</option>
            {master.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">{isId ? 'Semua Kategori' : 'All Categories'}</option>
            {master.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={locFilter} onChange={(e) => { setLocFilter(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">{isId ? 'Semua Lokasi' : 'All Locations'}</option>
            {master.locations.map((l) => <option key={l.id} value={l.id}>{l.building_name} · {l.specific_location}</option>)}
          </select>
          <select value={picFilter} onChange={(e) => { setPicFilter(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">{isId ? 'Semua PIC' : 'All PICs'}</option>
            {master.persons.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select value={condFilter} onChange={(e) => { setCondFilter(e.target.value); setPage(1); }} className={selectClass}>
            <option value="">{isId ? 'Semua Kondisi' : 'All Conditions'}</option>
            <option value="Good">Good</option>
            <option value="Minor Damage">Minor Damage</option>
            <option value="Major Damage">Major Damage</option>
            <option value="Unserviceable">Unserviceable</option>
          </select>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium w-16">{isId ? 'Foto' : 'Photo'}</th>
                <th className="px-4 py-3 font-medium cursor-pointer whitespace-nowrap" onClick={() => { setSortKey('asset_code'); setSortAsc(!sortAsc); }}>
                  {isId ? 'Kode Aset' : 'Asset Code'}
                </th>
                <th className="px-4 py-3 font-medium cursor-pointer" onClick={() => { setSortKey('asset_name'); setSortAsc(!sortAsc); }}>
                  {isId ? 'Nama Aset' : 'Asset Name'}
                </th>
                <th className="px-4 py-3 font-medium">{isId ? 'Entitas & Divisi' : 'Entity & Division'}</th>
                <th className="px-4 py-3 font-medium">{isId ? 'Lokasi' : 'Location'}</th>
                <th className="px-4 py-3 font-medium">PIC</th>
                <th className="px-4 py-3 font-medium text-right cursor-pointer whitespace-nowrap" onClick={() => { setSortKey('acquisition_value'); setSortAsc(!sortAsc); }}>
                  {isId ? 'Nilai (IDR)' : 'Value (IDR)'}
                </th>
                <th className="px-4 py-3 font-medium">{isId ? 'Kondisi' : 'Condition'}</th>
                <th className="px-4 py-3 font-medium text-right no-print">{isId ? 'Aksi' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400">
                    {isId ? 'Tidak ada aset yang cocok.' : 'No matching assets found.'}
                  </td>
                </tr>
              ) : (
                paged.map((a) => {
                  const hasValidPhoto = Boolean(a.primary_photo_url && isSafeExternalUrl(a.primary_photo_url) && !brokenThumbs[a.id]);
                  return (
                  <tr key={a.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/70 transition-colors">
                    <td className="px-4 py-2.5">
                      {hasValidPhoto ? (
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxPhoto({
                              assetId: a.id,
                              assetCode: a.asset_code,
                              assetName: a.asset_name,
                              url: a.primary_photo_url!,
                            })
                          }
                          className="relative group block w-11 h-11 rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 hover:border-[#C8102E] transition-colors"
                          title={isId ? 'Lihat foto aset' : 'Preview asset photo'}
                        >
                          <img
                            src={a.primary_photo_url!}
                            alt={a.asset_name}
                            referrerPolicy="no-referrer"
                            onError={() => setBrokenThumbs((prev) => ({ ...prev, [a.id]: true }))}
                            className="w-full h-full object-cover"
                          />
                          {(a.photo_count || 0) > 1 && (
                            <span className="absolute bottom-0 right-0 px-1 bg-black/75 text-white text-[9px] font-mono leading-tight">
                              +{a.photo_count! - 1}
                            </span>
                          )}
                        </button>
                      ) : canEdit ? (
                        <label
                          className={`w-11 h-11 rounded-md bg-neutral-50 dark:bg-[#1E222A] border border-dashed border-neutral-300 dark:border-neutral-700 hover:border-[#C8102E] dark:hover:border-red-400 hover:bg-red-50/40 dark:hover:bg-red-950/20 flex flex-col items-center justify-center text-[9px] text-neutral-500 dark:text-neutral-400 hover:text-[#C8102E] dark:hover:text-red-400 cursor-pointer transition-colors ${uploadingFile ? 'opacity-50 pointer-events-none' : ''}`}
                          title={isId ? 'Unggah foto aset ke server lokal' : 'Upload asset photo to local server'}
                        >
                          <ImageIcon className="w-3.5 h-3.5 mb-0.5" />
                          <span>+Foto</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            disabled={uploadingFile}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) void handleLocalUpload(a.id, a.asset_code, f, 'photo');
                            }}
                          />
                        </label>
                      ) : (
                        <div className="w-11 h-11 rounded-md bg-neutral-100 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-400">
                          <ImageIcon className="w-4 h-4" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#C8102E] dark:text-red-400 whitespace-nowrap">{a.asset_code}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#141619] dark:text-neutral-100">{a.asset_name}</div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                        {a.category_name} · {a.serial_number || 'No SN'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">
                      <div className="font-medium text-[#141619] dark:text-neutral-100">{a.company_code || a.company_name}</div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{a.division_name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">
                      <div>{a.building_name}</div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">{a.room_name} · {a.specific_location}</div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">
                      {a.pic_name || <span className="text-[#C8102E] dark:text-red-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-neutral-800 dark:text-neutral-200">{formatIDR(a.acquisition_value)}</td>
                    <td className="px-4 py-2.5"><ConditionLabel condition={a.condition_status} /></td>
                    <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap no-print">
                      <button
                        type="button"
                        onClick={() => openDetails(a.id)}
                        className="p-1.5 text-neutral-600 dark:text-neutral-300 hover:text-[#141619] dark:hover:text-white border border-neutral-200 dark:border-neutral-700 rounded"
                        title="View Details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditingAsset({ ...a })}
                          className="p-1.5 text-neutral-600 dark:text-neutral-300 hover:text-[#141619] dark:hover:text-white border border-neutral-200 dark:border-neutral-700 rounded"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(a)}
                          className="p-1.5 text-neutral-600 dark:text-neutral-300 hover:text-[#C8102E] dark:hover:text-red-400 border border-neutral-200 dark:border-neutral-700 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400 no-print">
          <span className="tabular-nums">
            {isId ? `Halaman ${page} dari ${totalPages}` : `Page ${page} of ${totalPages}`}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Asset Detail Modal */}
      {detailData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-neutral-200 dark:border-neutral-800 pb-4">
              <div>
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{detailData.asset.asset_code}</div>
                <h2 className="font-display text-lg font-bold text-[#141619] dark:text-neutral-100">{detailData.asset.asset_name}</h2>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  {detailData.asset.category_name} · {detailData.asset.division_name}
                </div>
              </div>
              <button type="button" onClick={() => setDetailData(null)} className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="space-y-2">
                {detailData.asset.primary_photo_url && isSafeExternalUrl(detailData.asset.primary_photo_url) && !photoPreviewBroken ? (
                  <img
                    src={detailData.asset.primary_photo_url}
                    alt={detailData.asset.asset_name}
                    referrerPolicy="no-referrer"
                    onError={() => setPhotoPreviewBroken(true)}
                    onClick={() =>
                      setLightboxPhoto({
                        assetId: detailData.asset.id,
                        assetCode: detailData.asset.asset_code,
                        assetName: detailData.asset.asset_name,
                        url: detailData.asset.primary_photo_url,
                      })
                    }
                    className="w-full h-40 object-cover rounded border border-neutral-200 dark:border-neutral-700 cursor-zoom-in hover:opacity-95"
                  />
                ) : (
                  <div className="w-full h-40 bg-neutral-100 dark:bg-[#1E222A] rounded border border-neutral-200 dark:border-neutral-700 flex flex-col items-center justify-center text-neutral-500 dark:text-neutral-400 p-3 text-center gap-1.5">
                    <ImageIcon className="w-5 h-5 text-neutral-400" />
                    <span>{isId ? 'Belum Ada Foto Aset' : 'No Asset Photo'}</span>
                  </div>
                )}
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-3 text-neutral-800 dark:text-neutral-200">
                <div><span className="text-neutral-500 dark:text-neutral-400 block">Brand / Model</span><span className="font-medium">{detailData.asset.brand} {detailData.asset.model}</span></div>
                <div><span className="text-neutral-500 dark:text-neutral-400 block">Serial Number</span><span className="font-mono">{detailData.asset.serial_number || '-'}</span></div>
                <div><span className="text-neutral-500 dark:text-neutral-400 block">Acquisition Date</span><span className="font-mono">{detailData.asset.acquisition_date}</span></div>
                <div><span className="text-neutral-500 dark:text-neutral-400 block">Acquisition Value</span><span className="font-mono font-semibold tabular-nums">{formatIDR(detailData.asset.acquisition_value)}</span></div>
                <div><span className="text-neutral-500 dark:text-neutral-400 block">Condition</span><ConditionLabel condition={detailData.asset.condition_status} /></div>
                <div><span className="text-neutral-500 dark:text-neutral-400 block">Status</span><StatusLabel status={detailData.asset.asset_status} /></div>
                <div className="col-span-2">
                  <span className="text-neutral-500 dark:text-neutral-400 block">Full Location</span>
                  <span className="font-medium">{detailData.asset.company_name} → {detailData.asset.building_name} → {detailData.asset.floor_name} → {detailData.asset.room_name} → {detailData.asset.specific_location}</span>
                </div>
              </div>
            </div>

            {/* 5-Role Asset Data Ownership Governance Card */}
            <div className="p-3.5 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md text-xs space-y-2">
              <div className="font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Tata Kelola Kepemilikan Data Aset (5 Peran)' : 'Asset Data Ownership Governance (5 Roles)'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">{isId ? 'Perusahaan & Divisi' : 'Company & Resp. Division'}</span>
                  <span className="font-medium text-[#141619] dark:text-neutral-100">
                    {detailData.asset.company_code || detailData.asset.company_name} · {detailData.asset.responsible_division_name || detailData.asset.division_name}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">Data Owner</span>
                  <span className="font-medium text-[#141619] dark:text-neutral-100">{detailData.asset.data_owner_name || '-'}</span>
                </div>
                <div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">Custodian / PIC</span>
                  <span className="font-medium text-[#141619] dark:text-neutral-100">{detailData.asset.custodian_name || detailData.asset.pic_name || 'Unassigned'}</span>
                </div>
                <div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">Verification Officer</span>
                  <span className="font-medium text-[#141619] dark:text-neutral-100">{detailData.asset.verification_officer_name || '-'}</span>
                </div>
                <div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">Approver</span>
                  <span className="font-medium text-[#141619] dark:text-neutral-100">{detailData.asset.approver_name || '-'}</span>
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="p-3 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-medium text-neutral-700 dark:text-neutral-200">
                    {isId ? 'Lampiran File Lokal Server (/uploads)' : 'Local Server Attachments (/uploads)'}
                  </div>
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400">JPG, PNG, WEBP, atau PDF maks. 10 MB</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#171A20] border border-neutral-300 dark:border-neutral-700 rounded cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 font-medium text-neutral-800 dark:text-neutral-200 ${uploadingFile ? 'opacity-50 pointer-events-none' : ''}`}>
                    <HardDrive className="w-3.5 h-3.5 text-[#C8102E] dark:text-red-400" />
                    <span>{isId ? 'Unggah Foto Aset' : 'Upload Asset Photo'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingFile}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleLocalUpload(detailData.asset.id, detailData.asset.asset_code, f, 'photo');
                      }}
                    />
                  </label>
                  <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#141619] dark:bg-[#C8102E] text-white rounded cursor-pointer hover:bg-neutral-800 dark:hover:bg-[#A10D24] font-medium ${uploadingFile ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isId ? 'Unggah Invoice / Dokumen' : 'Upload Invoice / Doc'}</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingFile}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleLocalUpload(detailData.asset.id, detailData.asset.asset_code, f, 'document');
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {detailData.photos?.length > 0 && (
              <div className="text-xs space-y-1.5">
                <div className="font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Foto Aset Tersimpan' : 'Stored Asset Photos'}
                </div>
                {detailData.photos.map((photo: any) => (
                  <div key={photo.id} className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800 gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">{photo.file_name}</span>
                      {(photo.mime_type || photo.file_size_bytes) && (
                        <span className="ml-2 text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                          {photo.mime_type || 'image'} · {formatFileSize(photo.file_size_bytes)}
                        </span>
                      )}
                    </div>
                    {isSafeExternalUrl(photo.file_url) && (
                      <a
                        href={photo.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#C8102E] dark:text-red-400 hover:underline shrink-0"
                      >
                        <span>{isId ? 'Pratinjau' : 'Preview'}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {detailData.documents.length > 0 && (
              <div className="text-xs space-y-1.5">
                <div className="font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Invoice & Dokumen Pendukung' : 'Invoices & Supporting Documents'}
                </div>
                {detailData.documents.map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800 gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">{doc.doc_type} · {doc.file_name}</span>
                      {(doc.mime_type || doc.file_size_bytes) && (
                        <span className="ml-2 text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                          {doc.mime_type || 'document'} · {formatFileSize(doc.file_size_bytes)}
                        </span>
                      )}
                    </div>
                    {isSafeExternalUrl(doc.file_url) && (
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline shrink-0"
                      >
                        <span>{isId ? 'Buka File' : 'Open File'}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {detailData.ownershipHistory?.length > 0 && (
              <div className="text-xs space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                <div className="font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Riwayat Kepemilikan Entitas & Custodian' : 'Entity & Custodian Ownership History'}
                </div>
                <div className="space-y-1.5">
                  {detailData.ownershipHistory.map((oh: any) => (
                    <div
                      key={oh.id}
                      className="p-2.5 rounded-md bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 flex flex-wrap items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-medium text-[#141619] dark:text-neutral-100">
                          {oh.from_company_name ? (
                            <>
                              <span>{oh.from_company_name}</span>
                              {oh.from_division_name ? ` (${oh.from_division_name})` : ''}
                              <span className="mx-1.5 text-[#C8102E] dark:text-red-400">→</span>
                              <span>{oh.to_company_name}</span>
                              {oh.to_division_name ? ` (${oh.to_division_name})` : ''}
                            </>
                          ) : (
                            <>
                              <span>{isId ? 'Penetapan Awal:' : 'Initial Assignment:'}</span>{' '}
                              <span>{oh.to_company_name}</span>
                              {oh.to_division_name ? ` (${oh.to_division_name})` : ''}
                            </>
                          )}
                        </div>
                        {(oh.from_custodian_name || oh.to_custodian_name) && (
                          <div className="text-[11px] text-neutral-600 dark:text-neutral-400">
                            Custodian: {oh.from_custodian_name || '-'} → {oh.to_custodian_name || '-'}
                          </div>
                        )}
                        {oh.reason && (
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                            {isId ? 'Alasan:' : 'Reason:'} {oh.reason}
                          </div>
                        )}
                      </div>
                      <div className="text-right text-[11px] font-mono text-neutral-500 dark:text-neutral-400 shrink-0">
                        <div>{oh.changed_at}</div>
                        {oh.changed_by_name && <div className="font-sans">{oh.changed_by_name}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailData.events?.length > 0 && (
              <div className="text-xs space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-[#141619] dark:text-neutral-100">
                    {isId ? 'Immutable Asset Event Ledger (SHA-256 Chain)' : 'Immutable Asset Event Ledger (SHA-256 Chain)'}
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500 dark:text-neutral-400">
                    {detailData.events.length} {isId ? 'event' : 'events'}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {detailData.events.map((ev: any) => (
                    <div
                      key={ev.id}
                      className="p-2.5 rounded-md bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 flex flex-wrap items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-[#1E222A] font-mono text-[10px] font-semibold text-[#C8102E] dark:text-red-400">
                            {ev.event_type}
                          </span>
                          <span
                            title={ev.event_hash}
                            className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-mono text-[10px]"
                          >
                            #{String(ev.event_hash || '').slice(0, 12)}…
                          </span>
                        </div>
                        {ev.reason && (
                          <div className="text-[11px] text-neutral-700 dark:text-neutral-300 truncate max-w-md">
                            {ev.reason}
                          </div>
                        )}
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {isId ? 'Aktor:' : 'Actor:'} {ev.actor_full_name || ev.actor_username || 'system'}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 shrink-0">
                        {ev.created_at}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleSaveEdit} className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <h3 className="font-display text-base font-bold text-[#141619] dark:text-neutral-100">Edit {editingAsset.asset_code}</h3>
              <button type="button" onClick={() => setEditingAsset(null)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-neutral-700 dark:text-neutral-300">
              <div className="sm:col-span-2">
                <label className="block font-medium mb-1">Asset Name</label>
                <input
                  type="text"
                  required
                  value={editingAsset.asset_name}
                  onChange={(e) => setEditingAsset({ ...editingAsset, asset_name: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium mb-1">Serial Number (USB HID / Bluetooth Scan Ready)</label>
                <input
                  type="text"
                  value={editingAsset.serial_number || ''}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setEditingAsset({
                        ...editingAsset,
                        serial_number: normalizeScannedBarcode(e.currentTarget.value),
                      });
                    }
                  }}
                  onChange={(e) => setEditingAsset({ ...editingAsset, serial_number: e.target.value })}
                  placeholder="Scan or enter serial number..."
                  className="w-full px-3 py-2 font-mono bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Condition</label>
                <select
                  value={editingAsset.condition_status}
                  onChange={(e) => setEditingAsset({ ...editingAsset, condition_status: e.target.value as any })}
                  className={`w-full ${selectClass} py-2`}
                >
                  <option value="Good">Good</option>
                  <option value="Minor Damage">Minor Damage</option>
                  <option value="Major Damage">Major Damage</option>
                  <option value="Unserviceable">Unserviceable</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">PIC / Custodian</label>
                <select
                  value={editingAsset.pic_id ?? ''}
                  onChange={(e) => setEditingAsset({ ...editingAsset, pic_id: e.target.value ? Number(e.target.value) : null })}
                  className={`w-full ${selectClass} py-2`}
                >
                  <option value="">-- Unassigned --</option>
                  {master.persons
                    .filter((p) => p.company_id === editingAsset.company_id)
                    .map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">{isId ? 'Divisi Penanggung Jawab' : 'Responsible Division'}</label>
                <select
                  value={editingAsset.division_id}
                  onChange={(e) => setEditingAsset({ ...editingAsset, division_id: Number(e.target.value) })}
                  className={`w-full ${selectClass} py-2`}
                >
                  {master.divisions
                    .filter((d) => d.company_id === editingAsset.company_id)
                    .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Data Owner</label>
                <select
                  value={editingAsset.data_owner_user_id ?? ''}
                  onChange={(e) => setEditingAsset({ ...editingAsset, data_owner_user_id: e.target.value ? Number(e.target.value) : null })}
                  className={`w-full ${selectClass} py-2`}
                >
                  <option value="">-- Default --</option>
                  {(master.governanceUsers || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Verification Officer</label>
                <select
                  value={editingAsset.verification_officer_user_id ?? ''}
                  onChange={(e) => setEditingAsset({ ...editingAsset, verification_officer_user_id: e.target.value ? Number(e.target.value) : null })}
                  className={`w-full ${selectClass} py-2`}
                >
                  <option value="">-- Default --</option>
                  {(master.governanceUsers || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Approver</label>
                <select
                  value={editingAsset.approver_user_id ?? ''}
                  onChange={(e) => setEditingAsset({ ...editingAsset, approver_user_id: e.target.value ? Number(e.target.value) : null })}
                  className={`w-full ${selectClass} py-2`}
                >
                  <option value="">-- Default --</option>
                  {(master.governanceUsers || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium mb-1">Location</label>
                <select
                  value={editingAsset.location_id}
                  onChange={(e) => setEditingAsset({ ...editingAsset, location_id: Number(e.target.value) })}
                  className={`w-full ${selectClass} py-2`}
                >
                  {master.locations
                    .filter((l) => l.company_id === editingAsset.company_id)
                    .map((l) => (
                      <option key={l.id} value={l.id}>{l.building_name} → {l.room_name} → {l.specific_location}</option>
                    ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium mb-1">{isId ? 'Alasan Perubahan (Tercatat di Event Ledger)' : 'Change Reason (Logged to Event Ledger)'}</label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder={isId ? 'Contoh: Pembaruan data master / verifikasi aset' : 'e.g. Master metadata & ownership review'}
                  className="w-full px-3 py-2 bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-neutral-200 dark:border-neutral-800">
              <button type="button" onClick={() => { setEditingAsset(null); setEditReason(''); }} className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md">
                {isId ? 'Batal' : 'Cancel'}
              </button>
              <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md">
                {isId ? 'Simpan Perubahan' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import CSV/Excel Modal with Preview, Validation & Duplicate Detection */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <h3 className="font-display text-base font-bold text-[#141619] dark:text-neutral-100">Import Assets from CSV</h3>
              <button type="button" onClick={() => { setImportOpen(false); setImportPreview(null); }} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Expected columns: <span className="font-mono">asset_name, asset_code (optional), company (optional), division (optional), category, brand, model, serial_number, acquisition_date, acquisition_value, location, pic, condition_status</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  {isId ? 'Perusahaan Default (jika kolom company kosong)' : 'Default Company (if company column omitted)'}
                </label>
                <select
                  value={importDefaultCompanyId}
                  onChange={(e) => {
                    setImportDefaultCompanyId(e.target.value);
                    setImportDefaultDivisionId('');
                  }}
                  className={`w-full ${selectClass} py-2`}
                >
                  {master.companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                  {isId ? 'Divisi Default (jika kolom division kosong)' : 'Default Division (if division column omitted)'}
                </label>
                <select
                  value={importDefaultDivisionId}
                  onChange={(e) => setImportDefaultDivisionId(e.target.value)}
                  className={`w-full ${selectClass} py-2`}
                >
                  <option value="">{isId ? '-- Otomatis (Divisi Pertama) --' : '-- Auto (First Company Division) --'}</option>
                  {master.divisions
                    .filter((d) => !importDefaultCompanyId || String(d.company_id) === importDefaultCompanyId)
                    .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleImportFileChange(e.target.files?.[0])}
              className="text-xs text-neutral-700 dark:text-neutral-300"
            />
            {importPreview && (
              <div className="space-y-3">
                <div className="flex gap-4 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  <span>Total Rows: <strong className="font-mono">{importPreview.total}</strong></span>
                  <span className="text-emerald-700 dark:text-emerald-400">Valid: <strong className="font-mono">{importPreview.validCount}</strong></span>
                  <span className="text-[#C8102E] dark:text-red-400">Errors / Duplicates: <strong className="font-mono">{importPreview.errorCount}</strong></span>
                </div>
                <div className="max-h-64 overflow-y-auto border border-neutral-200 dark:border-neutral-800 rounded">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Asset Name</th>
                        <th className="px-3 py-2">Company / Division</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {importPreview.results.map((r: any) => (
                        <tr key={r.rowIndex} className={r.valid ? '' : 'bg-red-50 dark:bg-red-950/30'}>
                          <td className="px-3 py-2 font-mono">{r.rowIndex}</td>
                          <td className="px-3 py-2">{r.normalized.asset_name || '-'}</td>
                          <td className="px-3 py-2">{r.normalized.company_name || '-'} / {r.normalized.division_name || '-'}</td>
                          <td className="px-3 py-2">{r.normalized.category_name}</td>
                          <td className="px-3 py-2">
                            {r.valid ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">Ready</span>
                            ) : (
                              <span className="text-[#C8102E] dark:text-red-400">{r.errors.join('; ')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={importing || importPreview.validCount === 0}
                    onClick={handleCommitImport}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] rounded-md disabled:opacity-50"
                  >
                    {importing ? 'Importing...' : `Commit ${importPreview.validCount} Valid Rows`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={isId ? 'Arsipkan Aset?' : 'Archive Asset?'}
        description={
          isId
            ? `Apakah Anda yakin ingin mengarsipkan ${deleteTarget?.asset_code} (${deleteTarget?.asset_name})? Riwayat perpindahan dan pemeliharaan tetap tersimpan.`
            : `Are you sure you want to archive ${deleteTarget?.asset_code} (${deleteTarget?.asset_name})? Historical movement and maintenance logs will remain preserved.`
        }
        confirmLabel={isId ? 'Arsipkan' : 'Archive Asset'}
        cancelLabel={isId ? 'Batal' : 'Cancel'}
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-2xl w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{lightboxPhoto.assetCode}</div>
                <div className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 truncate">{lightboxPhoto.assetName}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const id = lightboxPhoto.assetId;
                    setLightboxPhoto(null);
                    void openDetails(id);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded"
                >
                  {isId ? 'Lihat Detail Aset' : 'Open Asset Details'}
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(null)}
                  className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="bg-neutral-950 flex items-center justify-center p-4 max-h-[75vh]">
              <img
                src={lightboxPhoto.url}
                alt={lightboxPhoto.assetName}
                referrerPolicy="no-referrer"
                className="max-h-[68vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

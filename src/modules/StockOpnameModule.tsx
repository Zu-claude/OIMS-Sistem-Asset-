import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Plus,
  CheckCircle2,
  ScanBarcode,
  Volume2,
  VolumeX,
  AlertTriangle,
  MapPin,
  Upload,
  Scale,
  RefreshCw,
  Download,
  FileSpreadsheet,
  ShieldCheck,
  Search,
  X,
  Image as ImageIcon,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { exportRowsToCsv, exportRowsToExcel } from '../lib/exportUtils';
import { isSafeExternalUrl } from '../lib/workspace';
import { normalizeScannedBarcode, playScanBeep, useBarcodeScanner } from '../lib/useBarcodeScanner';
import { StatusLabel } from '../components/StatusText';
import type {
  AuthUser,
  Lang,
  MasterData,
  ReconciliationFindingRow,
  ReconciliationSummary,
} from '../types/oims';

interface StockOpnameModuleProps {
  lang: Lang;
  user: AuthUser;
  master: MasterData;
}

interface OpnameVerifyResponse {
  id: number;
  verification_result: string;
  scanned_code: string;
  asset: {
    id: number;
    asset_code: string;
    asset_name: string;
    serial_number: string | null;
  } | null;
}

export const StockOpnameModule: React.FC<StockOpnameModuleProps> = ({ lang, user, master }) => {
  const isId = lang === 'id';
  const canSchedule = user.role_code === 'super_admin' || user.permissions.includes('opname.schedule');
  const canVerify = user.role_code === 'super_admin' || user.permissions.includes('opname.verify');
  const canEditAssets = user.role_code === 'super_admin' || user.permissions.includes('assets.edit');

  const [tab, setTab] = useState<'opname' | 'reconciliation'>('opname');

  const [schedules, setSchedules] = useState<any[]>([]);
  const [details, setDetails] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  const [schedForm, setSchedForm] = useState({
    title: '',
    scheduled_date: new Date().toISOString().slice(0, 10),
    location_id: String(master.locations[0]?.id || 1),
    notes: '',
  });

  const [verifyForm, setVerifyForm] = useState({
    scanned_code: '',
    actual_location_id: String(master.locations[0]?.id || 1),
    actual_condition: 'Good',
    actual_pic_id: '',
    manual_result: '',
    notes: '',
    gps_latitude: '',
    gps_longitude: '',
    gps_accuracy_m: '',
    field_photo_url: '',
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [gpsNotice, setGpsNotice] = useState('');

  // USB HID & Bluetooth Barcode Scanner state
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [autoVerifyOnScan, setAutoVerifyOnScan] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [submittingScan, setSubmittingScan] = useState(false);
  const [scanError, setScanError] = useState('');
  const [lastScanResult, setLastScanResult] = useState<OpnameVerifyResponse | null>(null);

  // Asset Reconciliation Engine state
  const [reconFindings, setReconFindings] = useState<ReconciliationFindingRow[]>([]);
  const [reconSummary, setReconSummary] = useState<ReconciliationSummary | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconRunning, setReconRunning] = useState(false);
  const [reconRunOpnameId, setReconRunOpnameId] = useState('');
  const [reconStatusFilter, setReconStatusFilter] = useState('all');
  const [reconPriorityFilter, setReconPriorityFilter] = useState('all');
  const [reconResolutionFilter, setReconResolutionFilter] = useState('all');
  const [reconSearch, setReconSearch] = useState('');
  const [reconNotice, setReconNotice] = useState('');
  const [reconError, setReconError] = useState('');

  // Follow-up / Resolution Modal state
  const [activeFinding, setActiveFinding] = useState<ReconciliationFindingRow | null>(null);
  const [resolveForm, setResolveForm] = useState({
    priority: 'Medium' as 'Low' | 'Medium' | 'High' | 'Critical',
    assigned_to_user_id: '',
    resolution_status: 'Open' as 'Open' | 'In Review' | 'Resolved' | 'Dismissed',
    resolution_notes: '',
    authorize_master_update: false,
  });
  const [savingFinding, setSavingFinding] = useState(false);
  const [findingError, setFindingError] = useState('');
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const load = async () => {
    const res = await apiFetch<{ schedules: any[]; details: any[] }>('/api/opname');
    setSchedules(res.schedules);
    setDetails(res.details);
    if (!activeId && res.schedules.length > 0) {
      setActiveId(res.schedules[0].id);
    }
  };

  const loadReconciliation = useCallback(async () => {
    setReconLoading(true);
    setReconError('');
    try {
      const params = new URLSearchParams();
      if (reconStatusFilter !== 'all') params.set('status', reconStatusFilter);
      if (reconPriorityFilter !== 'all') params.set('priority', reconPriorityFilter);
      if (reconResolutionFilter !== 'all') params.set('resolution_status', reconResolutionFilter);
      if (reconSearch.trim()) params.set('search', reconSearch.trim());
      const res = await apiFetch<{ findings: ReconciliationFindingRow[]; summary: ReconciliationSummary }>(
        `/api/reconciliation/findings?${params.toString()}`
      );
      setReconFindings(res.findings || []);
      setReconSummary(res.summary || null);
    } catch (err: any) {
      setReconError(err?.message || 'Failed to load reconciliation findings');
    } finally {
      setReconLoading(false);
    }
  }, [reconStatusFilter, reconPriorityFilter, reconResolutionFilter, reconSearch]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab === 'reconciliation') {
      void loadReconciliation();
    }
  }, [tab, loadReconciliation]);

  const activeDetails = details.filter((d) => d.opname_id === activeId);
  const activeSchedule = schedules.find((s) => s.id === activeId);
  const isVerifyPanelActive = Boolean(tab === 'opname' && activeSchedule && canVerify && activeSchedule.status !== 'Completed');

  useEffect(() => {
    if (activeSchedule && activeSchedule.location_id) {
      setVerifyForm((prev) => ({
        ...prev,
        actual_location_id: String(activeSchedule.location_id),
      }));
    }
  }, [activeSchedule?.id, activeSchedule?.location_id]);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch<{ id: number }>('/api/opname', {
      method: 'POST',
      body: JSON.stringify(schedForm),
    });
    setShowScheduleForm(false);
    setSchedForm({
      title: '',
      scheduled_date: new Date().toISOString().slice(0, 10),
      location_id: String(master.locations[0]?.id || 1),
      notes: '',
    });
    setActiveId(res.id);
    await load();
  };

  const handleCaptureGps = () => {
    if (!navigator.geolocation) {
      setGpsNotice(isId ? 'Browser tidak mendukung Geolocation.' : 'Geolocation unsupported in this browser.');
      return;
    }
    setGpsNotice(isId ? 'Mengambil koordinat GPS...' : 'Fetching GPS coordinates...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setVerifyForm((prev) => ({
          ...prev,
          gps_latitude: pos.coords.latitude.toFixed(6),
          gps_longitude: pos.coords.longitude.toFixed(6),
          gps_accuracy_m: pos.coords.accuracy ? String(Math.round(pos.coords.accuracy)) : '',
        }));
        setGpsNotice(isId ? 'Koordinat GPS terpasang.' : 'GPS coordinates attached.');
      },
      (err) => {
        setGpsNotice(
          isId
            ? `GPS gagal (${err.message}). Isi koordinat manual bila diperlukan.`
            : `GPS failed (${err.message}). Enter coordinates manually if needed.`
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleUploadFieldPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploadingPhoto(true);
    setScanError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch<{ fileUrl: string }>('/api/uploads/field-photo', {
        method: 'POST',
        body: fd,
      });
      setVerifyForm((prev) => ({ ...prev, field_photo_url: res.fileUrl }));
      setGpsNotice(isId ? 'Foto lapangan diunggah ke server lokal.' : 'Field photo uploaded to local server.');
    } catch (err: any) {
      setScanError(err?.message || 'Field photo upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const executeVerify = async (codeOverride?: string) => {
    const cleanCode = normalizeScannedBarcode(codeOverride ?? verifyForm.scanned_code);
    if (!activeId || !cleanCode || submittingScan) return;

    setSubmittingScan(true);
    setScanError('');
    try {
      const res = await apiFetch<OpnameVerifyResponse>(`/api/opname/${activeId}/verify`, {
        method: 'POST',
        body: JSON.stringify({
          ...verifyForm,
          scanned_code: cleanCode,
        }),
      });
      setLastScanResult(res);
      if (soundEnabled) {
        playScanBeep(res.verification_result === 'Verified');
      }
      setVerifyForm((prev) => ({
        ...prev,
        scanned_code: '',
        notes: '',
        manual_result: '',
        field_photo_url: '',
      }));
      await load();
      window.setTimeout(() => {
        scanInputRef.current?.focus();
      }, 20);
    } catch (err: any) {
      setScanError(err?.message || 'Verification failed');
      if (soundEnabled) {
        playScanBeep(false);
      }
    } finally {
      setSubmittingScan(false);
    }
  };

  const handleVerifyItem = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeVerify();
  };

  const handleHardwareOrEnterScan = (rawCode: string, source: 'hardware-wedge' | 'manual-enter') => {
    const cleanCode = normalizeScannedBarcode(rawCode);
    if (!cleanCode) return;

    setVerifyForm((prev) => ({ ...prev, scanned_code: cleanCode }));

    if (autoVerifyOnScan || source === 'manual-enter') {
      void executeVerify(cleanCode);
    } else if (soundEnabled) {
      playScanBeep(true);
    }
  };

  useBarcodeScanner({
    enabled: scannerEnabled && isVerifyPanelActive && !showScheduleForm && !activeFinding,
    targetInputRef: scanInputRef,
    onScan: handleHardwareOrEnterScan,
  });

  const handleComplete = async (id: number) => {
    await apiFetch(`/api/opname/${id}/complete`, { method: 'POST' });
    await load();
  };

  const handleRunReconciliation = async () => {
    setReconRunning(true);
    setReconNotice('');
    setReconError('');
    try {
      const res = await apiFetch<{
        evaluatedAssets: number;
        createdCount: number;
        refreshedCount: number;
      }>('/api/reconciliation/run', {
        method: 'POST',
        body: JSON.stringify({
          opname_id: reconRunOpnameId ? Number(reconRunOpnameId) : null,
        }),
      });
      setReconNotice(
        isId
          ? `Rekonsiliasi selesai: ${res.evaluatedAssets} aset dievaluasi (${res.createdCount} temuan baru, ${res.refreshedCount} diperbarui). Master aset tidak diubah otomatis.`
          : `Reconciliation complete: ${res.evaluatedAssets} assets evaluated (${res.createdCount} new findings, ${res.refreshedCount} refreshed). Master assets were NOT auto-overwritten.`
      );
      await loadReconciliation();
    } catch (err: any) {
      setReconError(err?.message || 'Reconciliation run failed');
    } finally {
      setReconRunning(false);
    }
  };

  const openFindingModal = (f: ReconciliationFindingRow) => {
    setActiveFinding(f);
    setFindingError('');
    setResolveForm({
      priority: f.priority,
      assigned_to_user_id: f.assigned_to_user_id ? String(f.assigned_to_user_id) : '',
      resolution_status: f.resolution_status,
      resolution_notes: f.resolution_notes || '',
      authorize_master_update: false,
    });
  };

  const handleSaveFindingResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFinding) return;
    setSavingFinding(true);
    setFindingError('');
    try {
      const res = await apiFetch<{ ok: boolean; master_updated: number }>(
        `/api/reconciliation/findings/${activeFinding.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            priority: resolveForm.priority,
            assigned_to_user_id: resolveForm.assigned_to_user_id ? Number(resolveForm.assigned_to_user_id) : null,
            resolution_status: resolveForm.resolution_status,
            resolution_notes: resolveForm.resolution_notes,
            authorize_master_update: resolveForm.authorize_master_update,
          }),
        }
      );
      setReconNotice(
        res.master_updated
          ? isId
            ? `Temuan ${activeFinding.finding_code} diselesaikan & master aset diperbarui dengan otorisasi + log hash SHA-256.`
            : `Finding ${activeFinding.finding_code} saved & authorized master asset update logged.`
          : isId
          ? `Tindak lanjut temuan ${activeFinding.finding_code} disimpan.`
          : `Follow-up saved for finding ${activeFinding.finding_code}.`
      );
      setActiveFinding(null);
      await loadReconciliation();
    } catch (err: any) {
      setFindingError(err?.message || 'Failed to update reconciliation finding');
    } finally {
      setSavingFinding(false);
    }
  };

  const exportReconRows = (format: 'csv' | 'excel') => {
    const rows = reconFindings.map((f) => ({
      finding_code: f.finding_code,
      company: f.company_code || f.company_name || '-',
      opname_code: f.opname_code || '-',
      asset_code: f.asset_code || '-',
      asset_name: f.asset_name || '-',
      scanned_code: f.scanned_code || '-',
      reconciliation_status: f.reconciliation_status,
      priority: f.priority,
      resolution_status: f.resolution_status,
      assigned_to: f.assigned_to_name || '-',
      master_updated: f.master_updated ? 'Yes' : 'No',
      title: f.title,
      summary: f.discrepancy_summary,
      resolution_notes: f.resolution_notes || '',
      updated_at: f.updated_at,
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      exportRowsToCsv(rows, `KIDECO_OIMS_Reconciliation_${stamp}.csv`);
    } else {
      exportRowsToExcel(rows, `KIDECO_OIMS_Reconciliation_${stamp}.xls`, 'Reconciliation');
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  const reconBadgeClass = (status: string) => {
    if (status === 'MATCHED') return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60';
    if (status === 'MISSING_ASSET' || status === 'DUPLICATE_SUSPECTED') return 'bg-red-50 dark:bg-red-950/40 text-[#C8102E] dark:text-red-300 border-red-200 dark:border-red-900/60';
    if (status === 'LOCATION_MISMATCH' || status === 'CONDITION_MISMATCH' || status === 'UNIDENTIFIED_ASSET') {
      return 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900/60';
    }
    return 'bg-neutral-100 dark:bg-[#1E222A] text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Stock Opname, Lapangan & Rekonsiliasi Aset' : 'Stock Opname, Field & Asset Reconciliation'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Verifikasi fisik barcode/QR dengan bukti GPS & foto lapangan, serta mesin rekonsiliasi non-destruktif terhadap master aset.'
              : 'Physical barcode/QR verification with field GPS & photo evidence, plus non-destructive master asset reconciliation.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 bg-neutral-200/70 dark:bg-[#1E222A] rounded-md text-xs font-medium">
            <button
              type="button"
              onClick={() => setTab('opname')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded whitespace-nowrap ${
                tab === 'opname'
                  ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              <span>{isId ? 'Stock Opname & Lapangan' : 'Stock Opname & Field'}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('reconciliation')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded whitespace-nowrap ${
                tab === 'reconciliation'
                  ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span>{isId ? 'Mesin Rekonsiliasi Aset' : 'Asset Reconciliation Engine'}</span>
            </button>
          </div>

          {tab === 'opname' && canSchedule && (
            <button
              type="button"
              onClick={() => setShowScheduleForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{isId ? 'Jadwalkan Opname' : 'Schedule Opname'}</span>
            </button>
          )}
        </div>
      </div>

      {tab === 'opname' && (
        <>
          {showScheduleForm && (
            <form
              onSubmit={handleCreateSchedule}
              className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
            >
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Jadwal Stock Opname Baru' : 'New Stock Opname Schedule'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className={labelClass}>{isId ? 'Judul Audit *' : 'Audit Title *'}</label>
                  <input
                    type="text"
                    required
                    value={schedForm.title}
                    onChange={(e) => setSchedForm({ ...schedForm, title: e.target.value })}
                    placeholder="Q1 2027 General Affairs Audit"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>{isId ? 'Tanggal Terjadwal *' : 'Scheduled Date *'}</label>
                  <input
                    type="date"
                    required
                    value={schedForm.scheduled_date}
                    onChange={(e) => setSchedForm({ ...schedForm, scheduled_date: e.target.value })}
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className={labelClass}>{isId ? 'Lokasi Target *' : 'Target Location *'}</label>
                  <select
                    value={schedForm.location_id}
                    onChange={(e) => setSchedForm({ ...schedForm, location_id: e.target.value })}
                    className={inputClass}
                  >
                    {master.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.building_name} → {l.specific_location}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowScheduleForm(false)}
                  className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md"
                >
                  {isId ? 'Buat Jadwal' : 'Create Schedule'}
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Schedules List */}
            <div className="lg:col-span-5 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? `Jadwal Opname (${schedules.length})` : `Opname Schedules (${schedules.length})`}
              </div>
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {schedules.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveId(s.id);
                      setLastScanResult(null);
                      setScanError('');
                    }}
                    className={`p-4 cursor-pointer hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors ${
                      activeId === s.id ? 'bg-red-50/40 dark:bg-red-950/25' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{s.opname_code}</span>
                      <StatusLabel status={s.status} />
                    </div>
                    <div className="text-xs font-semibold text-[#141619] dark:text-neutral-100 mt-1">{s.title}</div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">{s.location_label}</div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-neutral-600 dark:text-neutral-400 mt-2 tabular-nums">
                      <span>
                        {isId ? 'Diperiksa' : 'Checked'}: {s.checked_count} / {s.expected_count}
                      </span>
                      <span className={s.variance_count > 0 ? 'text-[#C8102E] dark:text-red-400 font-semibold' : ''}>
                        {isId ? 'Selisih' : 'Variances'}: {s.variance_count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Audit Verification & Findings */}
            <div className="lg:col-span-7 space-y-4">
              {isVerifyPanelActive && activeSchedule && (
                <form
                  onSubmit={handleVerifyItem}
                  className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                      {isId ? 'Verifikasi Fisik Aset' : 'Verify Physical Asset'} ({activeSchedule.opname_code})
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleComplete(activeSchedule.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isId ? 'Tandai Selesai' : 'Mark Completed'}</span>
                    </button>
                  </div>

                  {/* USB HID & Bluetooth Barcode Scanner Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#F4F5F7] dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setScannerEnabled((v) => !v);
                          if (!scannerEnabled) scanInputRef.current?.focus();
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-medium transition-colors whitespace-nowrap ${
                          scannerEnabled
                            ? 'bg-[#141619] dark:bg-[#C8102E] text-white border-[#141619] dark:border-[#C8102E]'
                            : 'bg-white dark:bg-[#171A20] text-neutral-600 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <ScanBarcode className="w-3.5 h-3.5" />
                        <span>{`USB HID / Bluetooth: ${scannerEnabled ? (isId ? 'Siap' : 'Ready') : 'Off'}`}</span>
                      </button>

                      <label className="inline-flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoVerifyOnScan}
                          onChange={(e) => setAutoVerifyOnScan(e.target.checked)}
                          className="accent-[#C8102E]"
                        />
                        <span>{isId ? 'Verifikasi otomatis saat scan' : 'Auto-verify on scan'}</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => setSoundEnabled((v) => !v)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#171A20] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        title={soundEnabled ? 'Mute scan beep' : 'Enable scan beep'}
                      >
                        {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => scanInputRef.current?.focus()}
                      className="px-2.5 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-[#171A20] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 font-medium whitespace-nowrap"
                    >
                      {isId ? 'Fokus Input Scan' : 'Focus Scan Input'}
                    </button>
                  </div>

                  {lastScanResult && (
                    <div
                      className={`p-3 rounded-md border text-xs flex flex-wrap items-center justify-between gap-2 ${
                        lastScanResult.verification_result === 'Verified'
                          ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-900/60 text-emerald-900 dark:text-emerald-200'
                          : 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200'
                      }`}
                    >
                      <div>
                        <div className="font-semibold">
                          {lastScanResult.asset
                            ? `${lastScanResult.asset.asset_code} · ${lastScanResult.asset.asset_name}`
                            : `${isId ? 'Kode tidak terdaftar' : 'Unregistered scan'}: ${lastScanResult.scanned_code}`}
                        </div>
                        <div className="text-[11px] font-mono opacity-85">
                          {isId ? 'Input:' : 'Scanned:'} {lastScanResult.scanned_code}
                          {lastScanResult.asset?.serial_number ? ` · SN: ${lastScanResult.asset.serial_number}` : ''}
                        </div>
                      </div>
                      <StatusLabel status={lastScanResult.verification_result} />
                    </div>
                  )}

                  {scanError && (
                    <div className="p-2.5 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/35 text-xs text-[#C8102E] dark:text-red-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{scanError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className={labelClass}>
                        {isId
                          ? 'Scan Serial Number, Token QR, atau Kode Aset *'
                          : 'Scanned Serial Number, QR Token, or Asset Code *'}
                      </label>
                      <input
                        ref={scanInputRef}
                        type="text"
                        required
                        value={verifyForm.scanned_code}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setVerifyForm({ ...verifyForm, scanned_code: e.target.value })}
                        placeholder="SN-..., OIMS-2027-000001, or OIMS-QR-..."
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{isId ? 'Lokasi Aktual' : 'Actual Location'}</label>
                      <select
                        value={verifyForm.actual_location_id}
                        onChange={(e) => setVerifyForm({ ...verifyForm, actual_location_id: e.target.value })}
                        className={inputClass}
                      >
                        {master.locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.building_name} · {l.specific_location}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>{isId ? 'Kondisi Aktual' : 'Actual Condition'}</label>
                      <select
                        value={verifyForm.actual_condition}
                        onChange={(e) => setVerifyForm({ ...verifyForm, actual_condition: e.target.value })}
                        className={inputClass}
                      >
                        <option value="Good">Good</option>
                        <option value="Minor Damage">Minor Damage</option>
                        <option value="Major Damage">Major Damage</option>
                        <option value="Unserviceable">Unserviceable</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>{isId ? 'Ubah Hasil (Opsional)' : 'Override Result (Optional)'}</label>
                      <select
                        value={verifyForm.manual_result}
                        onChange={(e) => setVerifyForm({ ...verifyForm, manual_result: e.target.value })}
                        className={inputClass}
                      >
                        <option value="">{isId ? 'Deteksi otomatis dari database' : 'Auto-detect from database'}</option>
                        <option value="Verified">Verified</option>
                        <option value="Not Found">Not Found</option>
                        <option value="Location Mismatch">Location Mismatch</option>
                        <option value="Condition Mismatch">Condition Mismatch</option>
                        <option value="Unregistered Asset">Unregistered Asset</option>
                        <option value="QR Code Missing">QR Code Missing</option>
                      </select>
                    </div>

                    {/* Field GPS + Photo Evidence */}
                    <div className="sm:col-span-2 p-3 rounded-md bg-[#F4F5F7] dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#141619] dark:text-neutral-100 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-[#C8102E] dark:text-red-400" />
                          <span>{isId ? 'Telemetri GPS & Foto Lapangan (Opsional)' : 'Field GPS Telemetry & Photo (Optional)'}</span>
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCaptureGps}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800"
                          >
                            <MapPin className="w-3 h-3 text-[#C8102E] dark:text-red-400" />
                            <span>{isId ? 'Ambil GPS' : 'Capture GPS'}</span>
                          </button>
                          <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">
                            <Upload className="w-3 h-3 text-[#C8102E] dark:text-red-400" />
                            <span>
                              {uploadingPhoto
                                ? isId
                                  ? 'Mengunggah...'
                                  : 'Uploading...'
                                : verifyForm.field_photo_url
                                ? isId
                                  ? 'Foto Terpasang'
                                  : 'Photo Attached'
                                : isId
                                ? 'Foto Lapangan'
                                : 'Field Photo'}
                            </span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => handleUploadFieldPhoto(e.target.files?.[0])}
                            />
                          </label>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={verifyForm.gps_latitude}
                          onChange={(e) => setVerifyForm({ ...verifyForm, gps_latitude: e.target.value })}
                          placeholder="Latitude"
                          className={`${inputClass} font-mono`}
                        />
                        <input
                          type="text"
                          value={verifyForm.gps_longitude}
                          onChange={(e) => setVerifyForm({ ...verifyForm, gps_longitude: e.target.value })}
                          placeholder="Longitude"
                          className={`${inputClass} font-mono`}
                        />
                        <input
                          type="text"
                          value={verifyForm.notes}
                          onChange={(e) => setVerifyForm({ ...verifyForm, notes: e.target.value })}
                          placeholder={isId ? 'Catatan pemeriksaan lapangan...' : 'Field inspection notes...'}
                          className={`col-span-2 sm:col-span-1 ${inputClass}`}
                        />
                      </div>
                      {gpsNotice && <div className="text-[11px] text-neutral-600 dark:text-neutral-400">{gpsNotice}</div>}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submittingScan || uploadingPhoto}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md disabled:opacity-50"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>{submittingScan ? (isId ? 'Memverifikasi...' : 'Verifying...') : isId ? 'Catat Verifikasi' : 'Record Verification'}</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? `Log Verifikasi & Selisih (${activeDetails.length})` : `Verification & Variance Log (${activeDetails.length})`}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                      <tr>
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Kode Dipindai' : 'Scanned Code'}</th>
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Aset' : 'Asset'}</th>
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Hasil' : 'Result'}</th>
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">GPS / Foto</th>
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Catatan' : 'Notes'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {activeDetails.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-neutral-500 dark:text-neutral-400">
                            {isId ? 'Belum ada aset yang diverifikasi.' : 'No items verified yet.'}
                          </td>
                        </tr>
                      ) : (
                        activeDetails.map((d) => (
                          <tr key={d.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors">
                            <td className="px-4 py-2.5 font-mono font-semibold text-[#141619] dark:text-neutral-100 whitespace-nowrap">
                              {d.scanned_code}
                            </td>
                            <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">
                              <div>{d.asset_name || (isId ? 'Tidak terdaftar' : 'Unregistered')}</div>
                              {d.serial_number && (
                                <div className="font-mono text-[11px] text-neutral-400">SN: {d.serial_number}</div>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusLabel status={d.verification_result} />
                            </td>
                            <td className="px-4 py-2.5 text-[11px] font-mono text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {d.gps_latitude !== null && d.gps_latitude !== undefined && d.gps_longitude !== null && d.gps_longitude !== undefined ? (
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    {Number(d.gps_latitude).toFixed(4)}, {Number(d.gps_longitude).toFixed(4)}
                                  </span>
                                ) : (
                                  <span>-</span>
                                )}
                                {d.field_photo_url && isSafeExternalUrl(d.field_photo_url) && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewPhotoUrl(d.field_photo_url)}
                                    className="inline-flex items-center gap-1 text-[#C8102E] dark:text-red-400 hover:underline font-sans font-semibold"
                                  >
                                    <ImageIcon className="w-3 h-3" />
                                    <span>Foto</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">{d.notes || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'reconciliation' && (
        <div className="space-y-5">
          {/* Governance Safeguard Banner + Run Controls */}
          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <div className="flex items-center gap-2 text-sm font-display font-bold text-[#141619] dark:text-neutral-100">
                  <ShieldCheck className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                  <span>
                    {isId
                      ? 'Asset Reconciliation Engine (Tanpa Auto-Overwrite Master Aset)'
                      : 'Asset Reconciliation Engine (Non-Destructive · Zero Auto-Overwrite)'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  {isId
                    ? 'Membandingkan master aset terhadap hasil stock opname, bukti GPS/foto lapangan, status QR, duplikasi nomor seri, dan kelengkapan metadata. Master aset hanya boleh diubah melalui tindak lanjut temuan yang diotorisasi eksplisit.'
                    : 'Compares master asset records against stock opname scans, field GPS/photos, QR status, duplicate serials, and metadata completeness. Master asset attributes are only modified upon explicit authorized finding resolution.'}
                </p>
              </div>

              {canVerify && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={reconRunOpnameId}
                    onChange={(e) => setReconRunOpnameId(e.target.value)}
                    className="px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md"
                  >
                    <option value="">{isId ? 'Semua Aset dalam Scope' : 'All Scoped Assets'}</option>
                    {schedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.opname_code} · {s.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={reconRunning}
                    onClick={handleRunReconciliation}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md disabled:opacity-50 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${reconRunning ? 'animate-spin' : ''}`} />
                    <span>{reconRunning ? (isId ? 'Menganalisis...' : 'Running...') : isId ? 'Jalankan Rekonsiliasi' : 'Run Reconciliation'}</span>
                  </button>
                </div>
              )}
            </div>

            {reconNotice && (
              <div className="px-3.5 py-2.5 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 rounded-md text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
                <span>{reconNotice}</span>
                <button type="button" onClick={() => setReconNotice('')} className="underline font-semibold">
                  {isId ? 'Tutup' : 'Dismiss'}
                </button>
              </div>
            )}

            {reconError && (
              <div className="px-3.5 py-2.5 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md text-xs text-[#C8102E] dark:text-red-300">
                {reconError}
              </div>
            )}
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-3.5">
              <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Total Findings</div>
              <div className="font-display text-xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums mt-1">
                {reconSummary?.total || 0}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-3.5">
              <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Open / In Review' : 'Open / In Review'}
              </div>
              <div className="font-display text-xl font-bold text-[#C8102E] dark:text-red-400 tabular-nums mt-1">
                {reconSummary?.open_count || 0}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-3.5">
              <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">MATCHED</div>
              <div className="font-display text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
                {reconSummary?.matched_count || 0}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-3.5">
              <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">MISSING_ASSET</div>
              <div className="font-display text-xl font-bold text-[#C8102E] dark:text-red-400 tabular-nums mt-1">
                {reconSummary?.missing_count || 0}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-3.5">
              <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Mismatch (Loc/Cond)</div>
              <div className="font-display text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
                {(reconSummary?.location_mismatch_count || 0) + (reconSummary?.condition_mismatch_count || 0)}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-3.5">
              <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Dup / Unid / Incomplete</div>
              <div className="font-display text-xl font-bold text-neutral-700 dark:text-neutral-200 tabular-nums mt-1">
                {(reconSummary?.unidentified_count || 0) +
                  (reconSummary?.duplicate_count || 0) +
                  (reconSummary?.other_anomaly_count || 0)}
              </div>
            </div>
          </div>

          {/* Filter & Findings Table */}
          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={reconSearch}
                    onChange={(e) => setReconSearch(e.target.value)}
                    placeholder={isId ? 'Cari temuan, kode aset, ringkasan...' : 'Search findings, asset code...'}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md"
                  />
                </div>
                <select
                  value={reconStatusFilter}
                  onChange={(e) => setReconStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md"
                >
                  <option value="all">{isId ? 'Semua Status Rekonsiliasi' : 'All Reconciliation Status'}</option>
                  <option value="MISSING_ASSET">MISSING_ASSET</option>
                  <option value="LOCATION_MISMATCH">LOCATION_MISMATCH</option>
                  <option value="CONDITION_MISMATCH">CONDITION_MISMATCH</option>
                  <option value="UNIDENTIFIED_ASSET">UNIDENTIFIED_ASSET</option>
                  <option value="DUPLICATE_SUSPECTED">DUPLICATE_SUSPECTED</option>
                  <option value="QR_MISMATCH">QR_MISMATCH</option>
                  <option value="INCOMPLETE_DATA">INCOMPLETE_DATA</option>
                  <option value="MATCHED">MATCHED</option>
                </select>
                <select
                  value={reconPriorityFilter}
                  onChange={(e) => setReconPriorityFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md"
                >
                  <option value="all">{isId ? 'Semua Prioritas' : 'All Priorities'}</option>
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
                <select
                  value={reconResolutionFilter}
                  onChange={(e) => setReconResolutionFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md"
                >
                  <option value="all">{isId ? 'Semua Penyelesaian' : 'All Resolutions'}</option>
                  <option value="Open">Open</option>
                  <option value="In Review">In Review</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Dismissed">Dismissed</option>
                </select>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={reconFindings.length === 0}
                  onClick={() => exportReconRows('csv')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  disabled={reconFindings.length === 0}
                  onClick={() => exportReconRows('excel')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md hover:bg-neutral-800 dark:hover:bg-[#A10D24] disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            <div className="border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
              <div className="overflow-x-auto max-h-[540px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Finding</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Prioritas' : 'Priority'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Ringkasan Temuan' : 'Discrepancy'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'PIC Tindak Lanjut' : 'Assignee'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Penyelesaian' : 'Resolution'}</th>
                      <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{isId ? 'Aksi' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {reconLoading && reconFindings.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                          {isId ? 'Memuat temuan rekonsiliasi...' : 'Loading reconciliation findings...'}
                        </td>
                      </tr>
                    ) : reconFindings.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                          {isId
                            ? 'Belum ada temuan rekonsiliasi. Klik "Jalankan Rekonsiliasi" untuk menganalisis aset.'
                            : 'No reconciliation findings yet. Click "Run Reconciliation" to analyze assets.'}
                        </td>
                      </tr>
                    ) : (
                      reconFindings.map((f) => (
                        <tr key={f.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="font-mono font-bold text-[#C8102E] dark:text-red-400">{f.finding_code}</div>
                            <div className="text-[11px] font-mono text-neutral-500">
                              {f.asset_code || f.scanned_code || '-'}
                              {f.opname_code ? ` · ${f.opname_code}` : ''}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span
                              className={`inline-block font-mono text-[10px] font-semibold px-2 py-0.5 rounded border ${reconBadgeClass(
                                f.reconciliation_status
                              )}`}
                            >
                              {f.reconciliation_status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                            <span
                              className={
                                f.priority === 'Critical'
                                  ? 'text-[#C8102E] dark:text-red-400'
                                  : f.priority === 'High'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-neutral-700 dark:text-neutral-300'
                              }
                            >
                              {f.priority}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 max-w-xs">
                            <div className="font-semibold text-[#141619] dark:text-neutral-100 truncate">{f.title}</div>
                            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 line-clamp-2">
                              {f.discrepancy_summary}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                            {f.assigned_to_name || '-'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="font-medium text-[#141619] dark:text-neutral-100">{f.resolution_status}</div>
                            {f.master_updated === 1 && (
                              <div className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
                                Master Authorized
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {canVerify ? (
                              <button
                                type="button"
                                onClick={() => openFindingModal(f)}
                                className="px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              >
                                {isId ? 'Tindak Lanjut' : 'Review'}
                              </button>
                            ) : (
                              <span className="text-neutral-400">-</span>
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
        </div>
      )}

      {/* Reconciliation Follow-up & Authorized Master Update Modal */}
      {activeFinding && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setActiveFinding(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-2xl w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">
                  {activeFinding.finding_code} · {activeFinding.reconciliation_status}
                </div>
                <div className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {activeFinding.title}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveFinding(null)}
                className="p-1 text-neutral-500 hover:text-[#141619] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveFindingResolution} className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              {findingError && (
                <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-[#C8102E] dark:text-red-300">
                  {findingError}
                </div>
              )}

              <div className="p-3 rounded bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 space-y-1">
                <div className="font-semibold text-[#141619] dark:text-neutral-100">{isId ? 'Ringkasan Ketidaksesuaian' : 'Discrepancy Summary'}</div>
                <p className="text-neutral-600 dark:text-neutral-400">{activeFinding.discrepancy_summary}</p>
                {(activeFinding.gps_latitude !== null || activeFinding.evidence_photo_url) && (
                  <div className="pt-1 flex flex-wrap items-center gap-3 text-[11px] font-mono">
                    {activeFinding.gps_latitude !== null && activeFinding.gps_longitude !== null && (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        GPS: {Number(activeFinding.gps_latitude).toFixed(5)}, {Number(activeFinding.gps_longitude).toFixed(5)}
                      </span>
                    )}
                    {activeFinding.evidence_photo_url && isSafeExternalUrl(activeFinding.evidence_photo_url) && (
                      <button
                        type="button"
                        onClick={() => setPreviewPhotoUrl(activeFinding.evidence_photo_url!)}
                        className="text-[#C8102E] dark:text-red-400 hover:underline font-sans font-semibold"
                      >
                        {isId ? 'Lihat Bukti Foto Lapangan' : 'View Evidence Photo'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>{isId ? 'Prioritas' : 'Priority'}</label>
                  <select
                    value={resolveForm.priority}
                    onChange={(e) => setResolveForm({ ...resolveForm, priority: e.target.value as any })}
                    className={inputClass}
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{isId ? 'Status Penyelesaian' : 'Resolution Status'}</label>
                  <select
                    value={resolveForm.resolution_status}
                    onChange={(e) => setResolveForm({ ...resolveForm, resolution_status: e.target.value as any })}
                    className={inputClass}
                  >
                    <option value="Open">Open</option>
                    <option value="In Review">In Review</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Dismissed">Dismissed</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>{isId ? 'Penanggung Jawab Tindak Lanjut' : 'Assigned Follow-Up Officer'}</label>
                  <select
                    value={resolveForm.assigned_to_user_id}
                    onChange={(e) => setResolveForm({ ...resolveForm, assigned_to_user_id: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">{isId ? '-- Belum Ditugaskan --' : '-- Unassigned --'}</option>
                    {(master.governanceUsers || []).map((gu) => (
                      <option key={gu.id} value={gu.id}>
                        {gu.full_name} (@{gu.username}) · {gu.role_name || gu.role_code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>{isId ? 'Catatan Tindak Lanjut / Alasan' : 'Resolution Notes / Authorization Reason'}</label>
                  <textarea
                    rows={3}
                    value={resolveForm.resolution_notes}
                    onChange={(e) => setResolveForm({ ...resolveForm, resolution_notes: e.target.value })}
                    placeholder={isId ? 'Tuliskan hasil investigasi atau alasan pembaruan master...' : 'Document investigation outcome or authorization reason...'}
                    className={inputClass}
                  />
                </div>
              </div>

              {canEditAssets &&
                activeFinding.asset_id &&
                activeFinding.master_updated === 0 &&
                (activeFinding.reconciliation_status === 'LOCATION_MISMATCH' ||
                  activeFinding.reconciliation_status === 'CONDITION_MISMATCH') && (
                  <label className="flex items-start gap-2.5 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={resolveForm.authorize_master_update}
                      onChange={(e) => setResolveForm({ ...resolveForm, authorize_master_update: e.target.checked })}
                      className="accent-[#C8102E] mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <div className="font-semibold">
                        {isId
                          ? 'Otorisasi Pembaruan Master Aset dari Hasil Observasi Lapangan'
                          : 'Authorize Master Asset Update from Observed Field Value'}
                      </div>
                      <div className="text-[11px] opacity-90">
                        {isId
                          ? 'Membutuhkan izin assets.edit dan alasan wajib. Perubahan akan dicatat ke Immutable Asset Event Ledger (SHA-256).'
                          : 'Requires assets.edit permission and mandatory reason. Update is recorded in the SHA-256 Asset Event Ledger.'}
                      </div>
                    </div>
                  </label>
                )}

              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setActiveFinding(null)}
                  className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingFinding}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md disabled:opacity-50"
                >
                  {savingFinding ? (isId ? 'Menyimpan...' : 'Saving...') : isId ? 'Simpan Tindak Lanjut' : 'Save Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewPhotoUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewPhotoUrl(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-2xl w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <span className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Bukti Foto Lapangan' : 'Field Evidence Photo'}
              </span>
              <button type="button" onClick={() => setPreviewPhotoUrl(null)} className="p-1 text-neutral-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-neutral-950 p-4 flex justify-center">
              <img src={previewPhotoUrl} alt="Field evidence" className="max-h-[70vh] w-auto object-contain rounded" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

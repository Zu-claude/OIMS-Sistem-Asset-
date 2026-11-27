import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Download,
  Upload,
  BookOpen,
  ShieldCheck,
  History,
  Search,
  RefreshCw,
  FileSpreadsheet,
  X,
  Link2,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { apiDownloadInstallPhp, apiDownloadSql, apiFetch, getSessionToken } from '../lib/api';
import { exportRowsToCsv, exportRowsToExcel } from '../lib/exportUtils';
import { DEFAULT_COMPANY_LOGO_URL } from '../components/BrandMark';
import { ConfirmModal } from '../components/ConfirmModal';
import type { AssetEventRow, AuthUser, Lang } from '../types/oims';

interface SystemSettingsModuleProps {
  lang: Lang;
  user: AuthUser;
  logoUrl?: string;
  onRefreshBranding: () => void;
}

interface AuditLogRow {
  id: number;
  user_id: number | null;
  username: string | null;
  actor_full_name?: string | null;
  actor_email?: string | null;
  action: string;
  module: string;
  entity_type: string | null;
  entity_id: string | null;
  details_json: string | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditSummary {
  totalEvents: number;
  loginSuccessCount: number;
  loginFailedCount: number;
  inventoryEventCount: number;
}

export const SystemSettingsModule: React.FC<SystemSettingsModuleProps> = ({
  lang,
  user,
  logoUrl,
  onRefreshBranding,
}) => {
  const isId = lang === 'id';
  const canManage = user.role_code === 'super_admin' || user.permissions.includes('settings.manage');
  const canBackup = user.role_code === 'super_admin' || user.permissions.includes('settings.backup');

  const [settings, setSettings] = useState<any[]>([]);
  const [tab, setTab] = useState<'general' | 'events' | 'org' | 'audit' | 'backup' | 'docs'>('general');
  const [toast, setToast] = useState('');
  const [pendingRestoreJson, setPendingRestoreJson] = useState<any>(null);

  // Immutable Asset Event Ledger state
  const [assetEvents, setAssetEvents] = useState<AssetEventRow[]>([]);
  const [eventSummary, setEventSummary] = useState({ totalEvents: 0, trackedAssets: 0, transferEvents: 0, verificationEvents: 0 });
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [eventSearch, setEventSearch] = useState('');
  const [chainVerifyResult, setChainVerifyResult] = useState<{
    valid: boolean;
    checkedCount: number;
    scopedEventCount?: number;
    brokenEventId: number | null;
    brokenReason?: string | null;
    latestHash: string | null;
    genesisHash: string;
  } | null>(null);
  const [selectedEventRow, setSelectedEventRow] = useState<AssetEventRow | null>(null);

  // Org Hierarchy state
  const [orgStructure, setOrgStructure] = useState<{ holdingGroups: any[]; companies: any[]; divisions: any[] }>({
    holdingGroups: [],
    companies: [],
    divisions: [],
  });
  const [newCompany, setNewCompany] = useState({ code: '', name: '', address: '' });
  const [newDivision, setNewDivision] = useState({ company_id: '', code: '', name: '', department: '' });
  const [orgError, setOrgError] = useState('');

  // Audit Trail state
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary>({
    totalEvents: 0,
    loginSuccessCount: 0,
    loginFailedCount: 0,
    inventoryEventCount: 0,
  });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditModule, setAuditModule] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');
  const [selectedAuditRow, setSelectedAuditRow] = useState<AuditLogRow | null>(null);

  const load = async () => {
    const res = await apiFetch<{ settings: any[] }>('/api/system/settings');
    setSettings(res.settings);
  };

  const loadAssetEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const params = new URLSearchParams();
      if (eventTypeFilter && eventTypeFilter !== 'all') params.set('event_type', eventTypeFilter);
      if (eventSearch.trim()) params.set('search', eventSearch.trim());
      params.set('limit', '200');
      const res = await apiFetch<{ events: AssetEventRow[]; summary?: any }>(`/api/asset-events?${params.toString()}`);
      setAssetEvents(res.events || []);
      if (res.summary) setEventSummary(res.summary);
    } finally {
      setEventsLoading(false);
    }
  }, [eventTypeFilter, eventSearch]);

  const handleVerifyEventChain = async () => {
    const res = await apiFetch<any>('/api/system/event-chain/verify');
    setChainVerifyResult(res);
  };

  const loadOrgStructure = useCallback(async () => {
    const res = await apiFetch<{ holdingGroups: any[]; companies: any[]; divisions: any[] }>('/api/org/structure');
    setOrgStructure(res);
    setNewDivision((prev) => ({
      ...prev,
      company_id: prev.company_id || String(res.companies?.[0]?.id || ''),
    }));
  }, []);

  const loadAuditTrail = useCallback(async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const params = new URLSearchParams();
      if (auditModule && auditModule !== 'all') params.set('module', auditModule);
      if (auditSearch.trim()) params.set('search', auditSearch.trim());
      if (auditDateFrom) params.set('date_from', auditDateFrom);
      if (auditDateTo) params.set('date_to', auditDateTo);
      params.set('limit', '250');

      const res = await apiFetch<{ logs: AuditLogRow[]; summary: AuditSummary }>(
        `/api/system/audit-trail?${params.toString()}`
      );
      setAuditLogs(res.logs || []);
      if (res.summary) setAuditSummary(res.summary);
    } catch (err: any) {
      setAuditError(err?.message || (isId ? 'Gagal memuat log jejak audit.' : 'Failed to load audit trail logs.'));
    } finally {
      setAuditLoading(false);
    }
  }, [auditModule, auditSearch, auditDateFrom, auditDateTo, isId]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab === 'audit') loadAuditTrail();
    if (tab === 'events') loadAssetEvents();
    if (tab === 'org') loadOrgStructure();
  }, [tab, loadAuditTrail, loadAssetEvents, loadOrgStructure]);

  const handleDownloadMysqlSql = async () => {
    const blob = await apiDownloadSql();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oims.sql';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast(isId ? 'Berhasil mengunduh skrip MySQL oims.sql siap phpMyAdmin.' : 'Downloaded phpMyAdmin-ready MySQL oims.sql script.');
  };

  const handleDownloadInstallPhp = async () => {
    const blob = await apiDownloadInstallPhp();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'install.php';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast(isId ? 'Berhasil mengunduh skrip installer install.php (PHP 8.2 / PDO MySQL).' : 'Downloaded PHP 8.2 / PDO MySQL installer script (install.php).');
  };

  const handleDownloadJsonBackup = async () => {
    const payload = await apiFetch('/api/system/backup');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KIDECO_OIMS_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast(isId ? 'Snapshot database JSON berhasil diunduh.' : 'Downloaded JSON database snapshot.');
  };

  const handleRestoreSelect = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);
    setPendingRestoreJson(parsed);
  };

  const executeRestore = async () => {
    if (!pendingRestoreJson) return;
    await apiFetch('/api/system/restore', {
      method: 'POST',
      body: JSON.stringify(pendingRestoreJson),
    });
    setPendingRestoreJson(null);
    setToast(isId ? 'Database berhasil dipulihkan dari snapshot.' : 'Database restored cleanly from backup snapshot.');
    load();
  };

  const handleLogoUpload = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    const res = await fetch('/api/system/logo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getSessionToken()}` },
      body: fd,
    });
    if (res.ok) {
      setToast(isId ? 'Logo resmi KIDECO berhasil diperbarui.' : 'Official KIDECO company logo updated.');
      onRefreshBranding();
      load();
    }
  };

  const handleSaveNotifyRule = async (settingKey: string, enabled: boolean, priority: string) => {
    await apiFetch('/api/system/settings', {
      method: 'PUT',
      body: JSON.stringify({
        entries: [{ setting_key: settingKey, setting_value: JSON.stringify({ enabled, priority }), category: 'notifications' }],
      }),
    });
    setToast(isId ? 'Aturan notifikasi diperbarui.' : 'Notification rule updated.');
    load();
  };

  const notifSettings = settings.filter((s) => s.category === 'notifications');
  const cardClass = 'bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4';
  const inputClass =
    'px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Pengaturan Sistem, Backup & Dokumentasi' : 'System Settings, Backup & Handover Docs'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Branding perusahaan, prioritas notifikasi, backup database lokal, dan ekspor MySQL oims.sql'
              : 'Branding, notification priorities, local database snapshots, and MySQL oims.sql export'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-neutral-200/70 dark:bg-[#1E222A] rounded-md text-xs font-medium">
          <button
            type="button"
            onClick={() => setTab('general')}
            className={`px-3 py-1.5 rounded whitespace-nowrap ${
              tab === 'general'
                ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
            }`}
          >
            {isId ? 'Notifikasi & Logo' : 'Notifications & Logo'}
          </button>
          <button
            type="button"
            onClick={() => setTab('events')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded whitespace-nowrap ${
              tab === 'events'
                ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{isId ? 'Event Ledger Aset' : 'Asset Event Ledger'}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('org')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded whitespace-nowrap ${
              tab === 'org'
                ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>{isId ? 'Hierarki Entitas' : 'Org Hierarchy'}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded whitespace-nowrap ${
              tab === 'audit'
                ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{isId ? 'Audit Keamanan' : 'Security Audit'}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('backup')}
            className={`px-3 py-1.5 rounded whitespace-nowrap ${
              tab === 'backup'
                ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
            }`}
          >
            {isId ? 'Backup & Ekspor MySQL' : 'Backup & MySQL Export'}
          </button>
          <button
            type="button"
            onClick={() => setTab('docs')}
            className={`px-3 py-1.5 rounded whitespace-nowrap ${
              tab === 'docs'
                ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
            }`}
          >
            {isId ? 'Dokumentasi & QA' : 'Architecture & QA Docs'}
          </button>
        </div>
      </div>

      {toast && (
        <div className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 rounded-md text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')} className="font-semibold underline">
            {isId ? 'Tutup' : 'Dismiss'}
          </button>
        </div>
      )}

      {tab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`lg:col-span-5 ${cardClass}`}>
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">Official KIDECO Logo</h3>
            <div className="p-4 bg-[#F4F5F7] dark:bg-white border border-neutral-200 dark:border-neutral-700 rounded-md flex items-center justify-center">
              <img
                src={logoUrl && logoUrl.trim() ? logoUrl : DEFAULT_COMPANY_LOGO_URL}
                alt="KIDECO – Member of Indika Energy Group"
                referrerPolicy="no-referrer"
                className="h-14 w-auto max-w-full object-contain"
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {isId
                ? 'Logo resmi KIDECO – Member of Indika Energy Group yang ditampilkan di halaman masuk, sidebar navigasi, dan area branding.'
                : 'Official KIDECO – Member of Indika Energy Group corporate logo displayed across the login screen, navigation header, and branding areas.'}
            </p>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md cursor-pointer hover:bg-neutral-800 dark:hover:bg-[#A10D24]">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isId ? 'Unggah Logo Kustom' : 'Upload Custom Logo'}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => handleLogoUpload(e.target.files?.[0])} />
                </label>
                {logoUrl && logoUrl !== DEFAULT_COMPANY_LOGO_URL && (
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch('/api/system/settings', {
                        method: 'PUT',
                        body: JSON.stringify({
                          entries: [{ setting_key: 'company_logo_url', setting_value: DEFAULT_COMPANY_LOGO_URL, category: 'branding' }],
                        }),
                      });
                      setToast(isId ? 'Logo resmi KIDECO dipulihkan.' : 'Restored official KIDECO logo.');
                      onRefreshBranding();
                      load();
                    }}
                    className="px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    {isId ? 'Pulihkan Logo Resmi' : 'Restore Official Logo'}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={`lg:col-span-7 ${cardClass}`}>
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
              {isId ? 'Aturan Notifikasi Otomatis' : 'Automated Notification Rules'}
            </h3>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
              {notifSettings.map((s) => {
                let parsed = { enabled: true, priority: 'Medium' };
                try { parsed = JSON.parse(s.setting_value); } catch { /* noop */ }
                return (
                  <div key={s.setting_key} className="py-2.5 flex items-center justify-between gap-4">
                    <span className="font-mono text-neutral-800 dark:text-neutral-200">{s.setting_key.replace('notify_', '')}</span>
                    <div className="flex items-center gap-3">
                      <select
                        disabled={!canManage}
                        value={parsed.priority}
                        onChange={(e) => handleSaveNotifyRule(s.setting_key, parsed.enabled, e.target.value)}
                        className={inputClass}
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Critical">Critical</option>
                      </select>
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={parsed.enabled}
                        onChange={(e) => handleSaveNotifyRule(s.setting_key, e.target.checked, parsed.priority)}
                        className="accent-[#C8102E]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'events' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#141619] dark:text-neutral-100">
                <Link2 className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                <span>
                  {isId
                    ? 'Immutable Asset Event Ledger (Terpisah dari Security Audit Log)'
                    : 'Immutable Asset Event Ledger (Separated from Security Audit Log)'}
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {isId
                  ? 'Setiap siklus hidup aset dicatat secara append-only dan dirantai dengan hash SHA-256 (prev_hash → event_hash) pada lapisan aplikasi. Perlindungan mutlak terhadap modifikasi langsung database tetap membutuhkan pembatasan hak akses DBA/infrastruktur.'
                  : 'Every asset lifecycle event is recorded append-only and hash-chained via SHA-256 (prev_hash → event_hash) at the application layer. Absolute protection against direct DB tampering still requires DBA/infrastructure-level privilege restrictions.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleVerifyEventChain}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md hover:bg-neutral-800 dark:hover:bg-[#A10D24] shrink-0"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isId ? 'Verifikasi Rantai Hash SHA-256' : 'Verify SHA-256 Hash Chain'}</span>
            </button>
          </div>

          {chainVerifyResult && (
            <div
              className={`px-4 py-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-3 ${
                chainVerifyResult.valid
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60 text-emerald-900 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/60 text-[#C8102E] dark:text-red-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {chainVerifyResult.valid ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#C8102E] dark:text-red-400" />
                )}
                <div>
                  <div className="font-semibold">
                    {chainVerifyResult.valid
                      ? isId
                        ? `Integritas Rantai Event Valid (${chainVerifyResult.checkedCount} event terverifikasi)`
                        : `Event Chain Integrity Valid (${chainVerifyResult.checkedCount} events verified)`
                      : isId
                        ? `Terdeteksi Ketidakcocokan Rantai pada Event #${chainVerifyResult.brokenEventId}`
                        : `Chain Mismatch Detected at Event #${chainVerifyResult.brokenEventId}`}
                  </div>
                  <div className="font-mono text-[11px] opacity-80 mt-0.5 break-all">
                    Genesis: {chainVerifyResult.genesisHash} · Latest: {chainVerifyResult.latestHash || '-'}
                    {chainVerifyResult.brokenReason ? ` · ${chainVerifyResult.brokenReason}` : ''}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setChainVerifyResult(null)} className="text-xs underline font-medium">
                {isId ? 'Tutup' : 'Dismiss'}
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Total Event Ledger' : 'Total Ledger Events'}
              </div>
              <div className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums mt-1.5">
                {eventSummary.totalEvents || 0}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Aset Terlacak' : 'Tracked Assets'}
              </div>
              <div className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums mt-1.5">
                {eventSummary.trackedAssets || 0}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Event Perpindahan / Kepemilikan' : 'Transfer & Ownership Events'}
              </div>
              <div className="font-display text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-1.5">
                {eventSummary.transferEvents || 0}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Event Verifikasi / Opname' : 'Verification Events'}
              </div>
              <div className="font-display text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1.5">
                {eventSummary.verificationEvents || 0}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={eventSearch}
                    onChange={(e) => setEventSearch(e.target.value)}
                    placeholder={isId ? 'Cari kode aset, event, aktor, alasan...' : 'Search asset code, event, actor, reason...'}
                    className={`w-full pl-8 pr-3 ${inputClass}`}
                  />
                </div>
                <select
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                  className={inputClass}
                >
                  <option value="all">{isId ? 'Semua Tipe Event' : 'All Event Types'}</option>
                  <option value="ASSET_REGISTERED">ASSET_REGISTERED</option>
                  <option value="ASSET_UPDATED">ASSET_UPDATED</option>
                  <option value="LOCATION_CHANGED">LOCATION_CHANGED</option>
                  <option value="CONDITION_CHANGED">CONDITION_CHANGED</option>
                  <option value="TRANSFER_REQUESTED">TRANSFER_REQUESTED</option>
                  <option value="ASSET_TRANSFERRED">ASSET_TRANSFERRED</option>
                  <option value="OWNERSHIP_TRANSFERRED">OWNERSHIP_TRANSFERRED</option>
                  <option value="TRANSFER_REJECTED">TRANSFER_REJECTED</option>
                  <option value="PHOTO_CAPTURED">PHOTO_CAPTURED</option>
                  <option value="DOCUMENT_ATTACHED">DOCUMENT_ATTACHED</option>
                  <option value="QR_GENERATED">QR_GENERATED</option>
                  <option value="ASSET_VERIFIED">ASSET_VERIFIED</option>
                  <option value="MAINTENANCE_STARTED">MAINTENANCE_STARTED</option>
                  <option value="MAINTENANCE_COMPLETED">MAINTENANCE_COMPLETED</option>
                  <option value="ASSET_DEACTIVATED">ASSET_DEACTIVATED</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={loadAssetEvents}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${eventsLoading ? 'animate-spin' : ''}`} />
                  <span>{isId ? 'Muat Ulang' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  disabled={assetEvents.length === 0}
                  onClick={() => {
                    const exportData = assetEvents.map((ev) => ({
                      id: ev.id,
                      event_uuid: ev.event_uuid,
                      timestamp_utc: ev.created_at,
                      company: ev.company_code || ev.company_name || '-',
                      asset_code: ev.asset_code || '-',
                      asset_name: ev.asset_name || '-',
                      event_type: ev.event_type,
                      actor: ev.actor_full_name || ev.actor_username || 'system',
                      reason: ev.reason || '-',
                      prev_hash: ev.prev_hash,
                      event_hash: ev.event_hash,
                    }));
                    exportRowsToCsv(exportData, `KIDECO_OIMS_Asset_Event_Ledger_${new Date().toISOString().slice(0, 10)}.csv`);
                    setToast(isId ? 'Asset Event Ledger berhasil diekspor ke CSV.' : 'Asset Event Ledger exported to CSV.');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </button>
              </div>
            </div>

            <div className="border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
              <div className="overflow-x-auto max-h-[520px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Waktu (UTC)' : 'Timestamp (UTC)'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Aset' : 'Asset'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Entitas' : 'Company'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">Event Type</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Aktor' : 'Actor'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Alasan' : 'Reason'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">SHA-256 Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {eventsLoading && assetEvents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400">
                          {isId ? 'Memuat event ledger aset...' : 'Loading asset event ledger...'}
                        </td>
                      </tr>
                    ) : assetEvents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400">
                          {isId ? 'Tidak ada event aset yang cocok dengan filter.' : 'No asset events match the filter.'}
                        </td>
                      </tr>
                    ) : (
                      assetEvents.map((ev) => (
                        <tr
                          key={ev.id}
                          onClick={() => setSelectedEventRow(ev)}
                          className="hover:bg-neutral-50 dark:hover:bg-[#1E222A] cursor-pointer"
                        >
                          <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                            {ev.created_at}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{ev.asset_code || '-'}</div>
                            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate max-w-[180px]">{ev.asset_name || ''}</div>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                            {ev.company_code || ev.company_name || '-'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded bg-neutral-100 dark:bg-[#1E222A] font-mono text-[11px] font-semibold text-[#C8102E] dark:text-red-400">
                              {ev.event_type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                            {ev.actor_full_name || ev.actor_username || 'system'}
                          </td>
                          <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-400 max-w-[220px] truncate">
                            {ev.reason || '-'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                            {String(ev.event_hash || '').slice(0, 14)}…
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

      {tab === 'org' && (
        <div className="space-y-6">
          {orgError && (
            <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md text-xs text-[#C8102E] dark:text-red-300 flex items-center justify-between">
              <span>{orgError}</span>
              <button type="button" onClick={() => setOrgError('')} className="underline font-semibold">
                {isId ? 'Tutup' : 'Dismiss'}
              </button>
            </div>
          )}

          {/* Holding Group Header */}
          <div className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Holding / Grup Korporasi' : 'Corporate Holding / Group'}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {isId
                    ? 'Hierarki isolasi multi-perusahaan: Holding → Perusahaan → Divisi → Departemen → Lokasi → Gedung → Ruangan → PIC'
                    : 'Multi-company isolation hierarchy: Holding → Company → Division → Department → Location → Building → Room → PIC'}
                </p>
              </div>
              <button
                type="button"
                onClick={loadOrgStructure}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isId ? 'Muat Ulang' : 'Refresh'}</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {orgStructure.holdingGroups.map((hg) => (
                <div key={hg.id} className="p-3.5 rounded-md bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 text-xs">
                  <div className="font-mono text-[11px] font-semibold text-[#C8102E] dark:text-red-400">{hg.code}</div>
                  <div className="font-semibold text-[#141619] dark:text-neutral-100 mt-0.5">{hg.name}</div>
                  {hg.description && <div className="text-neutral-500 dark:text-neutral-400 mt-1">{hg.description}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Operating Companies */}
          <div className={cardClass}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Perusahaan Beroperasi (Operating Companies)' : 'Operating Companies'}
              </h3>
              <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                {orgStructure.companies.length} {isId ? 'entitas' : 'entities'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {orgStructure.companies.map((c) => (
                <div key={c.id} className="p-3.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-[#1E222A] text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#C8102E] dark:text-red-400">{c.code}</span>
                    <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                      {c.division_count || 0} {isId ? 'divisi' : 'divisions'} · {c.asset_count || 0} {isId ? 'aset' : 'assets'}
                    </span>
                  </div>
                  <div className="font-semibold text-[#141619] dark:text-neutral-100">{c.name}</div>
                  {c.address && <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{c.address}</div>}
                </div>
              ))}
            </div>

            {canManage && user.is_holding_scope && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setOrgError('');
                  try {
                    await apiFetch('/api/org/companies', {
                      method: 'POST',
                      body: JSON.stringify(newCompany),
                    });
                    setNewCompany({ code: '', name: '', address: '' });
                    setToast(isId ? 'Perusahaan baru berhasil ditambahkan.' : 'New operating company added.');
                    await loadOrgStructure();
                  } catch (err: any) {
                    setOrgError(err?.message || (isId ? 'Gagal menambahkan perusahaan.' : 'Failed to create company.'));
                  }
                }}
                className="pt-3 border-t border-neutral-200 dark:border-neutral-800 grid grid-cols-1 md:grid-cols-4 gap-2.5 items-end"
              >
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Kode Perusahaan *' : 'Company Code *'}
                  </label>
                  <input
                    required
                    value={newCompany.code}
                    onChange={(e) => setNewCompany((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                    placeholder="KDC-SUB"
                    className={`w-full ${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Nama Perusahaan *' : 'Company Name *'}
                  </label>
                  <input
                    required
                    value={newCompany.name}
                    onChange={(e) => setNewCompany((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="PT Kideco Subsidiary"
                    className={`w-full ${inputClass}`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Alamat' : 'Address'}
                  </label>
                  <input
                    value={newCompany.address}
                    onChange={(e) => setNewCompany((prev) => ({ ...prev, address: e.target.value }))}
                    placeholder="Kalimantan Timur"
                    className={`w-full ${inputClass}`}
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md hover:bg-neutral-800 dark:hover:bg-[#A10D24]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isId ? 'Tambah Perusahaan' : 'Add Company'}</span>
                </button>
              </form>
            )}
          </div>

          {/* Divisions */}
          <div className={cardClass}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Daftar Divisi & Departemen' : 'Divisions & Departments'}
              </h3>
              <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                {orgStructure.divisions.length} {isId ? 'divisi' : 'divisions'}
              </span>
            </div>

            <div className="border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">{isId ? 'Perusahaan' : 'Company'}</th>
                      <th className="px-4 py-2.5 font-medium">{isId ? 'Kode Divisi' : 'Code'}</th>
                      <th className="px-4 py-2.5 font-medium">{isId ? 'Nama Divisi' : 'Division Name'}</th>
                      <th className="px-4 py-2.5 font-medium">{isId ? 'Departemen' : 'Department'}</th>
                      <th className="px-4 py-2.5 font-medium text-right">{isId ? 'Jumlah Aset' : 'Assets'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {orgStructure.divisions.map((d) => (
                      <tr key={d.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]">
                        <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                          {d.company_code || d.company_name}
                        </td>
                        <td className="px-4 py-2.5 font-mono font-semibold text-[#C8102E] dark:text-red-400">{d.code}</td>
                        <td className="px-4 py-2.5 font-medium text-[#141619] dark:text-neutral-100">{d.name}</td>
                        <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">{d.department || '-'}</td>
                        <td className="px-4 py-2.5 font-mono text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {d.asset_count || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {canManage && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setOrgError('');
                  try {
                    await apiFetch('/api/org/divisions', {
                      method: 'POST',
                      body: JSON.stringify({
                        company_id: Number(newDivision.company_id),
                        code: newDivision.code,
                        name: newDivision.name,
                        department: newDivision.department,
                      }),
                    });
                    setNewDivision((prev) => ({ ...prev, code: '', name: '', department: '' }));
                    setToast(isId ? 'Divisi baru berhasil ditambahkan.' : 'New division added.');
                    await loadOrgStructure();
                  } catch (err: any) {
                    setOrgError(err?.message || (isId ? 'Gagal menambahkan divisi.' : 'Failed to create division.'));
                  }
                }}
                className="pt-3 border-t border-neutral-200 dark:border-neutral-800 grid grid-cols-1 md:grid-cols-5 gap-2.5 items-end"
              >
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Perusahaan *' : 'Company *'}
                  </label>
                  <select
                    required
                    value={newDivision.company_id}
                    onChange={(e) => setNewDivision((prev) => ({ ...prev, company_id: e.target.value }))}
                    className={`w-full ${inputClass}`}
                  >
                    {orgStructure.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Kode Divisi *' : 'Division Code *'}
                  </label>
                  <input
                    required
                    value={newDivision.code}
                    onChange={(e) => setNewDivision((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                    placeholder="OPS"
                    className={`w-full ${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Nama Divisi *' : 'Division Name *'}
                  </label>
                  <input
                    required
                    value={newDivision.name}
                    onChange={(e) => setNewDivision((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Mining Operations"
                    className={`w-full ${inputClass}`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Departemen' : 'Department'}
                  </label>
                  <input
                    value={newDivision.department}
                    onChange={(e) => setNewDivision((prev) => ({ ...prev, department: e.target.value }))}
                    placeholder="Site Operations"
                    className={`w-full ${inputClass}`}
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md hover:bg-neutral-800 dark:hover:bg-[#A10D24]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isId ? 'Tambah Divisi' : 'Add Division'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-5">
          {/* Compliance KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Total Kejadian Tercatat' : 'Total Recorded Events'}
              </div>
              <div className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums mt-1.5">
                {auditSummary.totalEvents}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Login Berhasil' : 'Successful Logins'}
              </div>
              <div className="font-display text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1.5">
                {auditSummary.loginSuccessCount}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Login Gagal / Diblokir' : 'Failed / Blocked Logins'}
              </div>
              <div
                className={`font-display text-2xl font-bold tabular-nums mt-1.5 ${
                  auditSummary.loginFailedCount > 0 ? 'text-[#C8102E] dark:text-red-400' : 'text-[#141619] dark:text-neutral-100'
                }`}
              >
                {auditSummary.loginFailedCount}
              </div>
            </div>
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {isId ? 'Perubahan Aset & Operasional' : 'Asset & Inventory Actions'}
              </div>
              <div className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums mt-1.5">
                {auditSummary.inventoryEventCount}
              </div>
            </div>
          </div>

          {/* Filter & Compliance Export Toolbar */}
          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder={
                      isId ? 'Cari user, aksi, kode aset, IP...' : 'Search user, action, asset ID, IP...'
                    }
                    className={`w-full pl-8 pr-3 ${inputClass}`}
                  />
                </div>

                <select
                  value={auditModule}
                  onChange={(e) => setAuditModule(e.target.value)}
                  className={inputClass}
                >
                  <option value="all">{isId ? 'Semua Modul' : 'All Modules'}</option>
                  <option value="auth">auth (Login / Logout)</option>
                  <option value="account">account (Profile & Password)</option>
                  <option value="assets">assets (Create / Edit / Delete)</option>
                  <option value="movements">movements (Transfers)</option>
                  <option value="maintenance">maintenance (Repairs)</option>
                  <option value="opname">opname (Stock Opname)</option>
                  <option value="replacement">replacement (Lifecycle Plan)</option>
                  <option value="qr">qr (QR Tagging & Scans)</option>
                  <option value="locations">locations</option>
                  <option value="pic">pic</option>
                  <option value="users">users (RBAC)</option>
                  <option value="settings">settings (System & Backup)</option>
                  <option value="system">system</option>
                  <option value="installer">installer</option>
                </select>

                <input
                  type="date"
                  value={auditDateFrom}
                  onChange={(e) => setAuditDateFrom(e.target.value)}
                  title={isId ? 'Dari tanggal' : 'From date'}
                  className={`${inputClass} font-mono`}
                />
                <input
                  type="date"
                  value={auditDateTo}
                  onChange={(e) => setAuditDateTo(e.target.value)}
                  title={isId ? 'Sampai tanggal' : 'To date'}
                  className={`${inputClass} font-mono`}
                />

                {(auditModule !== 'all' || auditSearch || auditDateFrom || auditDateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuditModule('all');
                      setAuditSearch('');
                      setAuditDateFrom('');
                      setAuditDateTo('');
                    }}
                    className="px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    {isId ? 'Atur Ulang' : 'Reset'}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={loadAuditTrail}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
                  <span>{isId ? 'Muat Ulang' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  disabled={auditLogs.length === 0}
                  onClick={() => {
                    const exportData = auditLogs.map((l) => ({
                      timestamp_utc: l.created_at,
                      username: l.username || 'system',
                      full_name: l.actor_full_name || '-',
                      action: l.action,
                      module: l.module,
                      entity_type: l.entity_type || '-',
                      entity_id: l.entity_id || '-',
                      ip_address: l.ip_address || '-',
                      details: l.details_json || '',
                    }));
                    exportRowsToCsv(exportData, `KIDECO_OIMS_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`);
                    setToast(isId ? 'Log Audit Trail berhasil diekspor ke CSV.' : 'Audit trail exported to CSV.');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  disabled={auditLogs.length === 0}
                  onClick={() => {
                    const exportData = auditLogs.map((l) => ({
                      timestamp_utc: l.created_at,
                      username: l.username || 'system',
                      full_name: l.actor_full_name || '-',
                      action: l.action,
                      module: l.module,
                      entity_type: l.entity_type || '-',
                      entity_id: l.entity_id || '-',
                      ip_address: l.ip_address || '-',
                      details: l.details_json || '',
                    }));
                    exportRowsToExcel(
                      exportData,
                      `KIDECO_OIMS_Audit_Trail_${new Date().toISOString().slice(0, 10)}.xls`,
                      'Audit Trail'
                    );
                    setToast(isId ? 'Log Audit Trail berhasil diekspor ke Excel.' : 'Audit trail exported to Excel.');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md hover:bg-neutral-800 dark:hover:bg-[#A10D24] disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            {auditError && (
              <div className="px-3 py-2 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded text-xs text-[#C8102E] dark:text-red-300">
                {auditError}
              </div>
            )}

            {/* Audit Trail Compliance Table */}
            <div className="border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
              <div className="overflow-x-auto max-h-[520px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Waktu (UTC)' : 'Timestamp (UTC)'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Pengguna' : 'Actor / User'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Aksi Kritis' : 'Action'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Modul' : 'Module'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Target Entitas' : 'Target'}</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap">IP Address</th>
                      <th className="px-4 py-2.5 font-medium whitespace-nowrap text-right">{isId ? 'Rincian' : 'Details'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {auditLoading && auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400">
                          {isId ? 'Memuat catatan audit kepatuhan...' : 'Loading compliance audit trail...'}
                        </td>
                      </tr>
                    ) : auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400">
                          {isId ? 'Tidak ada catatan audit yang cocok dengan filter.' : 'No audit log entries match the current filters.'}
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => {
                        const isFailureOrSecurity =
                          log.action.includes('FAILED') ||
                          log.action.includes('RATE_LIMITED') ||
                          log.action.includes('DELETED') ||
                          log.action.includes('REJECTED') ||
                          log.action.includes('RESTORED');
                        const isSuccessAuth = log.action === 'LOGIN_SUCCESS' || log.action === 'ACCOUNT_PASSWORD_CHANGED';

                        let previewText = '-';
                        if (log.details_json) {
                          try {
                            const parsed = JSON.parse(log.details_json);
                            previewText = Object.entries(parsed)
                              .slice(0, 3)
                              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : String(v)}`)
                              .join(' · ');
                          } catch {
                            previewText = log.details_json.slice(0, 60);
                          }
                        }

                        return (
                          <tr key={log.id} className="hover:bg-neutral-50/80 dark:hover:bg-[#1E222A]/60">
                            <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                              {String(log.created_at).slice(0, 19).replace('T', ' ')}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="font-mono font-semibold text-[#141619] dark:text-neutral-100">
                                {log.username || 'system'}
                              </div>
                              {log.actor_full_name && (
                                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate max-w-[160px]">
                                  {log.actor_full_name}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] font-semibold whitespace-nowrap">
                              <span
                                className={
                                  isFailureOrSecurity
                                    ? 'text-[#C8102E] dark:text-red-400'
                                    : isSuccessAuth
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-[#141619] dark:text-neutral-100'
                                }
                              >
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-neutral-600 dark:text-neutral-400 whitespace-nowrap">{log.module}</td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                              {log.entity_type ? `${log.entity_type}${log.entity_id ? ` #${log.entity_id}` : ''}` : '-'}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                              {log.ip_address || '-'}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {log.details_json ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedAuditRow(log)}
                                  title={previewText}
                                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#C8102E] dark:text-red-400 hover:underline max-w-[200px] truncate"
                                >
                                  <span className="truncate font-mono text-neutral-600 dark:text-neutral-400">{previewText}</span>
                                  <span className="shrink-0 font-semibold">{isId ? 'Detail' : 'View'}</span>
                                </button>
                              ) : (
                                <span className="text-neutral-400 font-mono">-</span>
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
        </div>
      )}

      {tab === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={cardClass}>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-[#C8102E] dark:text-red-400" />
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                MySQL 8 / phpMyAdmin Script (oims.sql)
              </h3>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              {isId
                ? 'Ekspor skema MySQL ternormalisasi lengkap (46 tabel termasuk Holding, Scope Organisasi, Histori Kepemilikan, Event Ledger SHA-256, QR Access Logs, Field Captures, Reconciliation Engine, Retensi & Legal Hold, SOP Enterprise, Integration Governance, Smart AI, serta Health/DR/BCP & Quality Gate) siap impor phpMyAdmin atau XAMPP.'
                : 'Export the complete 46-table normalized MySQL schema (including Holding Groups, Org Scopes, Ownership History, SHA-256 Asset Event Ledger, QR Access Logs, Field Captures, Reconciliation Engine, Retention & Legal Hold, Enterprise SOPs, Integration Governance, Smart AI, and DR/BCP & Quality Gate tables) ready for phpMyAdmin or XAMPP import.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadMysqlSql}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download oims.sql</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadInstallPhp}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-md whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download install.php</span>
              </button>
            </div>
          </div>

          <div className={cardClass}>
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
              {isId ? 'Snapshot Database & Pemulihan (JSON)' : 'Live Database Snapshot & Restore'}
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              {isId
                ? 'Unduh salinan cadangan JSON atomik seluruh data OIMS aktif atau pulihkan dari snapshot cadangan sebelumnya.'
                : 'Download an atomic JSON backup of all live OIMS records or restore from a previously exported snapshot.'}
            </p>
            {canBackup ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownloadJsonBackup}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isId ? 'Ekspor Backup JSON' : 'Export JSON Backup'}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#C8102E] dark:text-red-300 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/50 whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isId ? 'Pulihkan dari JSON' : 'Restore from JSON'}</span>
                  <input type="file" accept="application/json" className="hidden" onChange={(e) => handleRestoreSelect(e.target.files?.[0])} />
                </label>
              </div>
            ) : (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {isId ? 'Hanya Super Administrator yang dapat melakukan backup/restore penuh.' : 'Only Super Administrators can perform full backup/restore.'}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'docs' && (
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-6 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <BookOpen className="w-5 h-5 text-[#C8102E] dark:text-red-400" />
            <h3 className="font-display text-base font-bold text-[#141619] dark:text-neutral-100">
              KIDECO OIMS Architecture, Security & Handover Reference
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-[#141619] dark:text-neutral-100 mb-2">1. Relational Database (46 Normalized Entities)</h4>
              <p>
                Covers RBAC & Org Scopes (users, roles, permissions, role_permissions, user_roles, user_org_scopes, password_reset_tokens), Master Hierarchy (holding_groups, companies, divisions, categories, subcategories, buildings, floors, rooms, locations, persons), Core Assets & Governance (assets, asset_photos, asset_documents, asset_qr_codes, qr_access_logs, asset_field_captures, asset_ownership_history, asset_events), Transactions (asset_movements, movement_approvals, maintenance_records, maintenance_approvals), Verification & Reconciliation (stock_opname, stock_opname_details, asset_reconciliation_findings, replacement_plans), Fase 3 Tata Kelola & Smart AI (retention_policies, record_retention_holds, enterprise_sops, sop_executions, integration_connectors, integration_logs, ai_asset_identifications), Fase 4 Keandalan & Rilis (dr_backup_verifications, bcp_runbooks, enterprise_acceptance_signoffs), and System (notifications, audit_logs, system_settings).
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-[#141619] dark:text-neutral-100 mb-2">2. Security Verification Safeguards</h4>
              <ul className="space-y-1 list-disc pl-4">
                <li>scrypt password hashing with per-user 16-byte cryptographic salt.</li>
                <li>HMAC-SHA256 in-memory Bearer session tokens (never persisted to localStorage).</li>
                <li>Server-side RBAC permission & multi-company/division isolation checks on every /api/* endpoint.</li>
                <li>3-tier QR privacy controls (Public, Authenticated, Administrative), anti-enumeration slugs, token revocation, and sliding-window rate limiting.</li>
                <li>Append-only SHA-256 hash-chained Asset Event Ledger separated from Security Audit Trail.</li>
                <li>MIME/extension allowlisted local uploads served safely from confined storage.</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-[#141619] dark:text-neutral-100 mb-2">3. MySQL / phpMyAdmin &amp; install.php Deployment</h4>
              <ol className="space-y-1 list-decimal pl-4">
                <li>Download <span className="font-mono font-semibold">oims.sql</span> and <span className="font-mono font-semibold">install.php</span> from the Backup &amp; MySQL Export tab (or <span className="font-mono">/database/</span>).</li>
                <li>Place both files on your Apache/XAMPP PHP 8.2 server and open <span className="font-mono">install.php</span> in a browser (or import <span className="font-mono">oims.sql</span> via phpMyAdmin).</li>
                <li>If tables do not exist yet, <span className="font-mono">install.php</span> initializes all 46 tables and prompts for your Super Administrator email and password.</li>
              </ol>
            </div>
            <div>
              <h4 className="font-semibold text-[#141619] dark:text-neutral-100 mb-2">4. Roadmap 2027–2031 Alignment</h4>
              <p>
                Phase 1 (Digital Foundation) through Phase 5 (Integrated Ecosystem) are unified in this platform: standardized <span className="font-mono">OIMS-2027-XXXXXX</span> coding, QR tracking, movement approvals, maintenance & replacement planning, local server attachment repository, and Excel/PDF/MySQL export.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="font-medium">
              {isId
                ? 'Seluruh modul operasional, RBAC server, penyimpanan lokal, dan ekspor Excel/PDF/SQL aktif.'
                : 'All operational modules, server RBAC enforcement, local attachment storage, and Excel/PDF/SQL export are active.'}
            </span>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(pendingRestoreJson)}
        title={isId ? 'Pulihkan Database dari Snapshot?' : 'Restore Database from Snapshot?'}
        description={
          isId
            ? 'Pemulihan akan menggantikan tabel inventaris saat ini dengan isi file backup JSON yang diunggah. Tindakan ini tidak dapat dibatalkan.'
            : 'Restoring will replace current inventory tables with the contents of your uploaded JSON backup. This cannot be undone.'
        }
        confirmLabel={isId ? 'Pulihkan Database' : 'Restore Database'}
        cancelLabel={isId ? 'Batal' : 'Cancel'}
        danger
        onConfirm={executeRestore}
        onCancel={() => setPendingRestoreJson(null)}
      />

      {selectedAuditRow && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedAuditRow(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-lg w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{selectedAuditRow.action}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">
                  {selectedAuditRow.created_at} · @{selectedAuditRow.username || 'system'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAuditRow(null)}
                className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-white"
                aria-label="Close detail modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md p-3">
                <div>
                  <div className="text-neutral-500 dark:text-neutral-400">{isId ? 'Modul' : 'Module'}</div>
                  <div className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{selectedAuditRow.module}</div>
                </div>
                <div>
                  <div className="text-neutral-500 dark:text-neutral-400">IP Address</div>
                  <div className="font-mono text-[#141619] dark:text-neutral-100">{selectedAuditRow.ip_address || '-'}</div>
                </div>
                <div>
                  <div className="text-neutral-500 dark:text-neutral-400">{isId ? 'Entitas Target' : 'Target Entity'}</div>
                  <div className="font-mono text-[#141619] dark:text-neutral-100">
                    {selectedAuditRow.entity_type || '-'} {selectedAuditRow.entity_id ? `#${selectedAuditRow.entity_id}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500 dark:text-neutral-400">{isId ? 'Nama Aktor' : 'Actor Name'}</div>
                  <div className="font-medium text-[#141619] dark:text-neutral-100">{selectedAuditRow.actor_full_name || selectedAuditRow.username || 'System'}</div>
                </div>
              </div>
              <div>
                <div className="font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                  {isId ? 'Payload Kepatuhan (JSON)' : 'Compliance Payload (JSON)'}
                </div>
                <pre className="p-3 bg-[#141619] dark:bg-[#0F1115] text-neutral-100 rounded-md text-[11px] font-mono overflow-x-auto max-h-60 border border-neutral-800">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(selectedAuditRow.details_json || '{}'), null, 2);
                    } catch {
                      return selectedAuditRow.details_json || '';
                    }
                  })()}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedEventRow && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedEventRow(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-2xl w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{selectedEventRow.event_type}</div>
                <div className="text-[11px] font-mono text-neutral-500 mt-0.5">{selectedEventRow.event_uuid}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEventRow(null)}
                className="p-1 text-neutral-500 hover:text-[#141619] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs max-h-[75vh] overflow-y-auto">
              <div className="p-3 rounded bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 font-mono text-[11px] space-y-1 break-all">
                <div><span className="text-neutral-500">Prev Hash:</span> {selectedEventRow.prev_hash}</div>
                <div><span className="text-neutral-500">Event Hash:</span> {selectedEventRow.event_hash}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="font-medium text-neutral-600 dark:text-neutral-400 mb-1">Previous State</div>
                  <pre className="p-3 bg-[#141619] text-neutral-100 rounded text-[11px] font-mono overflow-x-auto max-h-52">
                    {selectedEventRow.previous_state_json || 'null'}
                  </pre>
                </div>
                <div>
                  <div className="font-medium text-neutral-600 dark:text-neutral-400 mb-1">New State</div>
                  <pre className="p-3 bg-[#141619] text-neutral-100 rounded text-[11px] font-mono overflow-x-auto max-h-52">
                    {selectedEventRow.new_state_json || 'null'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

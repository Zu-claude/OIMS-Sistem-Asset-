import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  AcceptanceSignoffRow,
  AuthUser,
  BcpRunbookRow,
  DrBackupVerificationRow,
  Lang,
  QualityGateReport,
  SystemHealthReport,
} from '../types/oims';

interface SystemOpsModuleProps {
  lang: Lang;
  user: AuthUser;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx += 1;
  }
  return `${val.toFixed(1)} ${units[unitIdx]}`;
}

function formatUptime(sec: number): string {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  return `${hrs}h ${mins}m ${rem}s`;
}

export const SystemOpsModule: React.FC<SystemOpsModuleProps> = ({ lang, user }) => {
  const isId = lang === 'id';
  const canManageDr = user.role_code === 'super_admin' || user.permissions.includes('ops.dr.manage');
  const canBackup = user.role_code === 'super_admin' || user.permissions.includes('settings.backup');

  const [tab, setTab] = useState<'health' | 'dr' | 'gate'>('health');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [verifications, setVerifications] = useState<DrBackupVerificationRow[]>([]);
  const [runbooks, setRunbooks] = useState<BcpRunbookRow[]>([]);
  const [signoffs, setSignoffs] = useState<AcceptanceSignoffRow[]>([]);
  const [gateReport, setGateReport] = useState<QualityGateReport | null>(null);

  const [drillModalTarget, setDrillModalTarget] = useState<BcpRunbookRow | null>(null);
  const [drillForm, setDrillForm] = useState({
    test_status: 'Passed' as 'Passed' | 'Action Required',
    rto_minutes: '20',
    rpo_minutes: '5',
    notes: '',
  });
  const [signoffNotes, setSignoffNotes] = useState('');

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{
        health: SystemHealthReport;
        verifications: DrBackupVerificationRow[];
        runbooks: BcpRunbookRow[];
        signoffs: AcceptanceSignoffRow[];
      }>('/api/ops/health');
      setHealth(res.health);
      setVerifications(res.verifications || []);
      setRunbooks(res.runbooks || []);
      setSignoffs(res.signoffs || []);
    } catch (err: any) {
      setError(err.message || (isId ? 'Gagal memuat telemetri kesehatan sistem' : 'Failed to load system health'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleVerifyIntegrity = async () => {
    setBusyAction('integrity');
    setError('');
    setToast('');
    try {
      const res = await apiFetch<{ verification_code: string; result: { summary: string; status: string } }>(
        '/api/ops/dr/verify-integrity',
        { method: 'POST' }
      );
      setToast(`${res.verification_code} (${res.result.status}): ${res.result.summary}`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleVerifyLiveSnapshot = async () => {
    setBusyAction('snapshot-live');
    setError('');
    setToast('');
    try {
      const res = await apiFetch<{ verification_code: string; result: { summary: string; status: string } }>(
        '/api/ops/dr/verify-snapshot',
        { method: 'POST', body: JSON.stringify({}) }
      );
      setToast(`${res.verification_code}: ${res.result.summary}`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleVerifyUploadedSnapshot = async (file?: File) => {
    if (!file) return;
    setBusyAction('snapshot-file');
    setError('');
    setToast('');
    try {
      const parsed = JSON.parse(await file.text());
      const res = await apiFetch<{ verification_code: string; result: { summary: string } }>(
        '/api/ops/dr/verify-snapshot',
        { method: 'POST', body: JSON.stringify({ snapshot: parsed }) }
      );
      setToast(`${res.verification_code}: ${res.result.summary}`);
      await loadAll();
    } catch (err: any) {
      setError(err.message || (isId ? 'File snapshot JSON tidak valid.' : 'Invalid snapshot JSON file.'));
      await loadAll();
    } finally {
      setBusyAction(null);
    }
  };

  const handleRecordBcpDrill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drillModalTarget) return;
    setBusyAction('bcp-drill');
    setError('');
    setToast('');
    try {
      const res = await apiFetch<{ verification_code: string }>(
        `/api/ops/bcp/runbooks/${drillModalTarget.id}/drill`,
        {
          method: 'POST',
          body: JSON.stringify({
            test_status: drillForm.test_status,
            rto_minutes: Number(drillForm.rto_minutes),
            rpo_minutes: Number(drillForm.rpo_minutes),
            notes: drillForm.notes,
          }),
        }
      );
      setToast(
        isId
          ? `Uji BCP ${drillModalTarget.runbook_code} tercatat (${res.verification_code}).`
          : `BCP drill for ${drillModalTarget.runbook_code} recorded (${res.verification_code}).`
      );
      setDrillModalTarget(null);
      setDrillForm({ test_status: 'Passed', rto_minutes: '20', rpo_minutes: '5', notes: '' });
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunQualityGate = async () => {
    setBusyAction('quality-gate');
    setError('');
    setToast('');
    try {
      const res = await apiFetch<QualityGateReport>('/api/ops/quality-gate/run', { method: 'POST' });
      setGateReport(res);
      setToast(
        isId
          ? `Quality Gate selesai: ${res.checksPassed}/${res.checksTotal} pemeriksaan lulus (${res.overallStatus}).`
          : `Quality Gate complete: ${res.checksPassed}/${res.checksTotal} checks passed (${res.overallStatus}).`
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSignOff = async () => {
    setBusyAction('signoff');
    setError('');
    setToast('');
    try {
      const res = await apiFetch<{ ok: boolean; signoffId: number; report: QualityGateReport }>(
        '/api/ops/quality-gate/signoff',
        {
          method: 'POST',
          body: JSON.stringify({
            gate_scope: 'final_acceptance',
            notes: signoffNotes,
          }),
        }
      );
      setGateReport(res.report);
      setSignoffNotes('');
      setToast(
        isId
          ? `Final Enterprise Acceptance #${res.signoffId} (${res.report.releaseTag}) berhasil ditandatangani.`
          : `Final Enterprise Acceptance #${res.signoffId} (${res.report.releaseTag}) signed off.`
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadJsonBackup = async () => {
    const payload = await apiFetch('/api/system/backup');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kideco_oims_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const cardClass =
    'bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5';
  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';

  if (loading && !health) {
    return (
      <div className="space-y-6">
        <div className="h-16 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Kesehatan Sistem, DR/BCP & Quality Gate' : 'System Health, DR/BCP & Quality Gate'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Pemantauan keandalan infrastruktur lokal, uji pemulihan bencana, dan persetujuan rilis enterprise (tanpa mengekspos kredensial)'
              : 'Local infrastructure reliability monitoring, disaster recovery drills, and enterprise release gate (zero secret exposure)'}
          </p>
        </div>

        <button
          type="button"
          onClick={loadAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{isId ? 'Muat Ulang Metrik' : 'Refresh Metrics'}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-neutral-100 dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg w-fit">
        {[
          { id: 'health', label: isId ? 'System Health Monitoring' : 'System Health Monitoring' },
          { id: 'dr', label: isId ? 'Disaster Recovery & BCP' : 'Disaster Recovery & BCP' },
          { id: 'gate', label: isId ? 'Enterprise Quality Gate & Rilis' : 'Enterprise Quality Gate & Acceptance' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as 'health' | 'dr' | 'gate')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === item.id
                ? 'bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 shadow-sm border border-neutral-200 dark:border-neutral-700'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-100'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md text-xs text-[#C8102E] dark:text-red-300">
          {error}
        </div>
      )}
      {toast && (
        <div className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 rounded-md text-xs text-emerald-800 dark:text-emerald-300">
          {toast}
        </div>
      )}

      {/* TAB 1: SYSTEM HEALTH MONITORING */}
      {tab === 'health' && health && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={cardClass}>
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>{isId ? 'Status Database' : 'Database Health'}</span>
                <Database className="w-4 h-4 text-neutral-400" />
              </div>
              <div
                className={`mt-2 font-display text-xl font-bold ${
                  health.overallStatus === 'Healthy'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-[#C8102E] dark:text-red-400'
                }`}
              >
                {health.overallStatus}
              </div>
              <div className="mt-1 text-[11px] font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                {health.database.tableCount}/{health.database.expectedTableCount} tables · FK {health.database.foreignKeyViolations}
              </div>
            </div>

            <div className={cardClass}>
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>{isId ? 'Kapasitas Penyimpanan Lokal' : 'Local Storage Usage'}</span>
                <HardDrive className="w-4 h-4 text-neutral-400" />
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums">
                {formatBytes(health.storage.uploadsTotalBytes + health.database.totalDbBytes)}
              </div>
              <div className="mt-1 text-[11px] font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                {health.storage.uploadsFileCount} files ·{' '}
                {health.storage.diskFreeBytes !== null
                  ? `Free ${formatBytes(health.storage.diskFreeBytes)}`
                  : 'Local disk'}
              </div>
            </div>

            <div className={cardClass}>
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>{isId ? 'Aset & Aktivitas QR (24j)' : 'Assets & QR Scans (24h)'}</span>
                <Activity className="w-4 h-4 text-neutral-400" />
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-[#141619] dark:text-neutral-100 tabular-nums">
                {health.operations.activeQrCodes} QR · {health.operations.qrScans24h} scan
              </div>
              <div className="mt-1 text-[11px] font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                {health.operations.totalAssets} assets · denied {health.operations.qrDenied24h}
              </div>
            </div>

            <div className={cardClass}>
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>{isId ? 'Integritas Event Ledger' : 'Event Ledger Integrity'}</span>
                <ShieldCheck className="w-4 h-4 text-neutral-400" />
              </div>
              <div
                className={`mt-2 font-display text-xl font-bold ${
                  health.operations.eventChainValid
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-[#C8102E] dark:text-red-400'
                }`}
              >
                {health.operations.eventChainValid ? 'SHA-256 Valid' : 'Broken Chain'}
              </div>
              <div className="mt-1 text-[11px] font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                {health.operations.eventChainCheckedCount} events verified · uptime {formatUptime(health.runtime.uptimeSeconds)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Storage & Database Breakdown */}
            <div className={`lg:col-span-7 ${cardClass} space-y-4`}>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Rincian Penyimpanan Database, Foto & Dokumen' : 'Database, Photo & Document Storage Breakdown'}
                </h2>
                <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                  {health.database.engine}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">{isId ? 'Komponen' : 'Component'}</th>
                      <th className="px-3 py-2 font-medium text-right">{isId ? 'Jumlah' : 'Count'}</th>
                      <th className="px-3 py-2 font-medium text-right">{isId ? 'Ukuran' : 'Size'}</th>
                      <th className="px-3 py-2 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800 tabular-nums">
                    <tr>
                      <td className="px-3 py-2.5 text-[#141619] dark:text-neutral-100">SQLite Main DB (data/oims.db)</td>
                      <td className="px-3 py-2.5 text-right font-mono">{health.database.tableCount} tbl</td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatBytes(health.database.dbFileSizeBytes)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">
                        {health.database.quickCheck}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2.5 text-[#141619] dark:text-neutral-100">SQLite WAL &amp; SHM Journal</td>
                      <td className="px-3 py-2.5 text-right font-mono">-</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {formatBytes(health.database.walFileSizeBytes + health.database.shmFileSizeBytes)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-neutral-500 dark:text-neutral-400">WAL Active</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2.5 text-[#141619] dark:text-neutral-100">
                        {isId ? 'Foto Aset Lokal (/uploads/photos)' : 'Asset Photos (/uploads/photos)'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{health.storage.photosFileCount} files</td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatBytes(health.storage.photosBytes)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-neutral-600 dark:text-neutral-300">
                        {health.operations.assetPhotosRecords} rows
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2.5 text-[#141619] dark:text-neutral-100">
                        {isId ? 'Dokumen Aset (/uploads/docs)' : 'Asset Documents (/uploads/docs)'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{health.storage.docsFileCount} files</td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatBytes(health.storage.docsBytes)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-neutral-600 dark:text-neutral-300">
                        {health.operations.assetDocumentsRecords} rows
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2.5 text-[#141619] dark:text-neutral-100">
                        {isId ? 'Foto Lapangan (/uploads/field)' : 'Field Captures (/uploads/field)'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{health.storage.fieldFileCount} files</td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatBytes(health.storage.fieldBytes)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-neutral-600 dark:text-neutral-300">
                        {health.operations.fieldCapturesRecords} rows
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Operational Anomalies & Safe Environment Flags */}
            <div className={`lg:col-span-5 ${cardClass} space-y-5`}>
              <div>
                <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Sinyal Operasional & Kesiapan Lingkungan' : 'Operational Signals & Environment Readiness'}
                </h2>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {isId
                    ? 'Hanya menampilkan indikator kesiapan boolean tanpa nilai rahasia atau kredensial.'
                    : 'Displays boolean readiness indicators only — never exposes secret keys or credentials.'}
                </p>
              </div>

              <div className="space-y-2.5 text-xs divide-y divide-neutral-100 dark:divide-neutral-800">
                {[
                  {
                    label: isId ? 'Kegagalan Autentikasi / Upload (7h)' : 'Auth / Upload Failures (7d)',
                    val: String(health.operations.failedAuthOrUpload7d),
                    warn: health.operations.failedAuthOrUpload7d > 0,
                  },
                  {
                    label: isId ? 'Integrasi Diblokir / Gagal (7h)' : 'Blocked / Failed Integrations (7d)',
                    val: String(health.operations.failedIntegrations7d),
                    warn: health.operations.failedIntegrations7d > 0,
                  },
                  {
                    label: isId ? 'Temuan Rekonsiliasi Terbuka' : 'Open Reconciliation Findings',
                    val: String(health.operations.openReconciliationFindings),
                    warn: health.operations.openReconciliationFindings > 0,
                  },
                  {
                    label: isId ? 'Deviasi SOP Operasional (7h)' : 'SOP Deviations (7d)',
                    val: String(health.operations.sopDeviations7d),
                    warn: health.operations.sopDeviations7d > 0,
                  },
                  {
                    label: isId ? 'Aset Berstatus Legal Hold' : 'Assets Under Legal Hold',
                    val: String(health.operations.legalHoldAssets),
                    warn: false,
                  },
                ].map((row) => (
                  <div key={row.label} className="pt-2.5 flex items-center justify-between gap-2">
                    <span className="text-neutral-600 dark:text-neutral-300">{row.label}</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        row.warn ? 'text-[#C8102E] dark:text-red-400' : 'text-[#141619] dark:text-neutral-100'
                      }`}
                    >
                      {row.val}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2 text-xs">
                <div className="font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Konfigurasi Aman (Non-Secret Flags)' : 'Safe Configuration Flags'}
                </div>
                <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Google Cloud / Workspace / Firebase</span>
                    <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {health.readiness.googleCloudConnected ? 'Enabled' : 'Disconnected (Local Mode)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Local File Storage</span>
                    <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">Active</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Server Admin Passcode Env</span>
                    <span className="font-mono text-[#141619] dark:text-neutral-200">
                      {health.readiness.envPasscodeConfigured ? 'Configured' : 'DB Hash Mode'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">SMTP Mailer</span>
                    <span className="font-mono text-[#141619] dark:text-neutral-200">
                      {health.readiness.smtpConfigured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Smart AI Kill Switch / Server Key</span>
                    <span className="font-mono text-[#141619] dark:text-neutral-200">
                      {health.readiness.smartAiKillSwitchEnabled ? 'ON' : 'OFF'} ·{' '}
                      {health.readiness.geminiApiKeyConfigured ? 'Key Ready' : 'Local Only'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DISASTER RECOVERY & BCP */}
      {tab === 'dr' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className={`${cardClass} space-y-4`}>
              <div>
                <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Verifikasi Integritas & Uji Dry-Run Backup' : 'Integrity Verification & Snapshot Dry-Run'}
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {isId
                    ? 'Menguji PRAGMA integrity_check, rantai SHA-256, keberadaan foto lokal, serta validasi checksum snapshot tanpa menimpa data aktif.'
                    : 'Runs PRAGMA integrity_check, SHA-256 chain check, local upload validation, and snapshot checksum dry-run without overwriting live data.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {canManageDr && (
                  <>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleVerifyIntegrity}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md disabled:opacity-50"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>
                        {busyAction === 'integrity'
                          ? isId ? 'Memeriksa...' : 'Checking...'
                          : isId ? 'Uji Integritas DB & Foto' : 'Run DB & File Integrity Check'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleVerifyLiveSnapshot}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#141619] dark:text-neutral-100 bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-md disabled:opacity-50"
                    >
                      <FileCheck2 className="w-3.5 h-3.5" />
                      <span>{isId ? 'Validasi Checksum Snapshot Live' : 'Verify Live Snapshot Checksum'}</span>
                    </button>
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isId ? 'Dry-Run File Snapshot JSON' : 'Dry-Run JSON Snapshot File'}</span>
                      <input
                        type="file"
                        accept="application/json"
                        className="hidden"
                        onChange={(e) => handleVerifyUploadedSnapshot(e.target.files?.[0])}
                      />
                    </label>
                  </>
                )}
                {canBackup && (
                  <button
                    type="button"
                    onClick={handleDownloadJsonBackup}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isId ? 'Unduh Backup JSON' : 'Download JSON Backup'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className={`${cardClass} space-y-3`}>
              <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Target Pemulihan & Catatan Infrastruktur Server' : 'Recovery Objectives & Server Infrastructure Scope'}
              </h2>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md">
                  <div className="text-neutral-500 dark:text-neutral-400">Target RPO</div>
                  <div className="font-mono text-base font-bold text-[#141619] dark:text-neutral-100 mt-1 tabular-nums">
                    {health?.runtime.rpoTargetMinutes ?? 15} min
                  </div>
                </div>
                <div className="p-3 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md">
                  <div className="text-neutral-500 dark:text-neutral-400">Target RTO</div>
                  <div className="font-mono text-base font-bold text-[#141619] dark:text-neutral-100 mt-1 tabular-nums">
                    {health?.runtime.rtoTargetMinutes ?? 60} min
                  </div>
                </div>
                <div className="p-3 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md">
                  <div className="text-neutral-500 dark:text-neutral-400">{isId ? 'Retensi Backup' : 'Retention'}</div>
                  <div className="font-mono text-base font-bold text-[#141619] dark:text-neutral-100 mt-1 tabular-nums">
                    {health?.runtime.backupRetentionCount ?? 14}x
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                {isId
                  ? 'Penjadwalan cron backup OS/server, replikasi volume /uploads, dan uji restore terpisah berada di lapisan infrastruktur server; aplikasi menyediakan endpoint verifikasi checksum, dry-run, dan pencatatan drill BCP.'
                  : 'OS-level scheduled backups, /uploads volume replication, and isolated restore drills belong to server infrastructure; the app provides checksum verification, dry-run checks, and BCP drill logging.'}
              </p>
            </div>
          </div>

          {/* BCP Runbooks */}
          <div className={cardClass}>
            <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-4">
              {isId ? 'Runbook Business Continuity Plan (BCP)' : 'Business Continuity Plan (BCP) Runbooks'}
            </h2>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {runbooks.map((rb) => {
                let steps: string[] = [];
                try {
                  steps = JSON.parse(rb.steps_json || '[]');
                } catch {
                  steps = [];
                }
                return (
                  <div key={rb.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-[#C8102E] dark:text-red-400">{rb.runbook_code}</span>
                          <span className="font-semibold text-[#141619] dark:text-neutral-100">{rb.title}</span>
                        </div>
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
                          Owner: {rb.owner_role} · Target RTO {rb.rto_target_minutes}m · RPO {rb.rpo_target_minutes}m · Status:{' '}
                          <strong
                            className={
                              rb.last_test_status === 'Passed'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : rb.last_test_status === 'Action Required'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-neutral-500 dark:text-neutral-400'
                            }
                          >
                            {rb.last_test_status}
                          </strong>
                          {rb.last_tested_at ? ` · ${rb.last_tested_at}` : ''}
                        </div>
                      </div>
                      {canManageDr && (
                        <button
                          type="button"
                          onClick={() => setDrillModalTarget(rb)}
                          className="px-3 py-1.5 text-xs font-medium text-[#141619] dark:text-neutral-100 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap"
                        >
                          {isId ? 'Catat Hasil Drill' : 'Record Drill'}
                        </button>
                      )}
                    </div>
                    <ol className="list-decimal pl-5 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                      {steps.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DR Verification History */}
          <div className={`${cardClass} p-0 overflow-hidden`}>
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Riwayat Verifikasi DR & Simulasi BCP' : 'DR Verification & BCP Drill Log'}
              </h2>
              <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                {verifications.length} records
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Code</th>
                    <th className="px-4 py-2.5 font-medium">{isId ? 'Jenis Uji' : 'Check Type'}</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Checksum / Metrics</th>
                    <th className="px-4 py-2.5 font-medium">{isId ? 'Ringkasan' : 'Summary'}</th>
                    <th className="px-4 py-2.5 font-medium">{isId ? 'Waktu' : 'Timestamp'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {verifications.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-neutral-500 dark:text-neutral-400">
                        {isId
                          ? 'Belum ada verifikasi DR dijalankan. Jalankan uji integritas atau dry-run snapshot di atas.'
                          : 'No DR verifications recorded yet. Run an integrity check or snapshot dry-run above.'}
                      </td>
                    </tr>
                  ) : (
                    verifications.map((v) => (
                      <tr key={v.id}>
                        <td className="px-4 py-2.5 font-mono font-semibold text-[#141619] dark:text-neutral-100 whitespace-nowrap">
                          {v.verification_code}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-neutral-600 dark:text-neutral-300 whitespace-nowrap">
                          {v.verification_type}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              v.status === 'Passed'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : v.status === 'Warning'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-[#C8102E] dark:text-red-400'
                            }`}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap tabular-nums">
                          {v.snapshot_sha256 ? v.snapshot_sha256.slice(0, 12) + '...' : `${v.table_count} tbl`}
                        </td>
                        <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300 max-w-md">{v.summary}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap tabular-nums">
                          {v.created_at}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ENTERPRISE QUALITY GATE & FINAL ACCEPTANCE */}
      {tab === 'gate' && (
        <div className="space-y-6">
          <div className={`${cardClass} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Enterprise Quality Gate (Evaluasi Langsung)' : 'Enterprise Quality Gate (Live Evaluation)'}
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {isId
                    ? 'Menjalankan verifikasi langsung pada skema database, foreign key, rantai hash event, isolasi perusahaan, privasi QR, dan penyimpanan lokal.'
                    : 'Executes live verification across database schema, foreign keys, event hash-chain, multi-company isolation, QR privacy, and local storage.'}
                </p>
              </div>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleRunQualityGate}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md disabled:opacity-50 whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {busyAction === 'quality-gate'
                    ? isId ? 'Mengevaluasi...' : 'Evaluating...'
                    : isId ? 'Jalankan Quality Gate' : 'Run Quality Gate'}
                </span>
              </button>
            </div>

            {gateReport && (
              <div className="space-y-3 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="font-mono text-neutral-600 dark:text-neutral-300 tabular-nums">
                    Release: <strong>{gateReport.releaseTag}</strong> · {gateReport.checksPassed}/{gateReport.checksTotal} Passed · Status:{' '}
                    <strong
                      className={
                        gateReport.overallStatus === 'Passed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : gateReport.overallStatus === 'Conditional'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-[#C8102E] dark:text-red-400'
                      }
                    >
                      {gateReport.overallStatus}
                    </strong>
                  </div>
                  <div className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">{gateReport.evaluatedAt}</div>
                </div>

                <div className="divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-md">
                  {gateReport.checks.map((chk) => (
                    <div key={chk.key} className="px-4 py-3 flex items-start justify-between gap-4 text-xs">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {chk.status === 'Passed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                        ) : (
                          <ShieldAlert
                            className={`w-4 h-4 mt-0.5 shrink-0 ${
                              chk.status === 'Warning' ? 'text-amber-600 dark:text-amber-400' : 'text-[#C8102E] dark:text-red-400'
                            }`}
                          />
                        )}
                        <div>
                          <div className="font-semibold text-[#141619] dark:text-neutral-100">{chk.title}</div>
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">{chk.detail}</div>
                        </div>
                      </div>
                      <span
                        className={`font-mono font-semibold shrink-0 ${
                          chk.status === 'Passed'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : chk.status === 'Warning'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[#C8102E] dark:text-red-400'
                        }`}
                      >
                        {chk.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {canManageDr && (
            <div className={`${cardClass} space-y-4`}>
              <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Final Enterprise Acceptance Sign-Off' : 'Final Enterprise Acceptance Sign-Off'}
              </h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={signoffNotes}
                  onChange={(e) => setSignoffNotes(e.target.value)}
                  placeholder={
                    isId
                      ? 'Catatan persetujuan rilis (opsional, mis. siap serah terima operasional KIDECO)...'
                      : 'Release acceptance notes (optional)...'
                  }
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleSignOff}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>{isId ? 'Tandatangani Acceptance Rilis' : 'Sign Off Release Acceptance'}</span>
                </button>
              </div>
            </div>
          )}

          <div className={`${cardClass} p-0 overflow-hidden`}>
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Riwayat Sign-Off Penerimaan Enterprise' : 'Enterprise Acceptance Sign-Off History'}
              </h2>
              <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                {signoffs.length} records
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Release Tag</th>
                    <th className="px-4 py-2.5 font-medium">Scope</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Score</th>
                    <th className="px-4 py-2.5 font-medium">{isId ? 'Penanda Tangan' : 'Signed Off By'}</th>
                    <th className="px-4 py-2.5 font-medium">{isId ? 'Catatan' : 'Notes'}</th>
                    <th className="px-4 py-2.5 font-medium">{isId ? 'Waktu' : 'Timestamp'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {signoffs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-neutral-500 dark:text-neutral-400">
                        {isId ? 'Belum ada sign-off enterprise tercatat.' : 'No enterprise acceptance sign-offs recorded yet.'}
                      </td>
                    </tr>
                  ) : (
                    signoffs.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5 font-mono font-semibold text-[#141619] dark:text-neutral-100 whitespace-nowrap">
                          {s.release_tag}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-neutral-600 dark:text-neutral-300 whitespace-nowrap">
                          {s.gate_scope}
                        </td>
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          <span
                            className={
                              s.gate_status === 'Passed'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {s.gate_status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                          {s.checks_passed}/{s.checks_total}
                        </td>
                        <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-200 whitespace-nowrap">
                          {s.signed_off_by_name || s.signed_off_by_username || '-'}
                        </td>
                        <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-400 max-w-xs truncate">
                          {s.notes || '-'}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap tabular-nums">
                          {s.signed_off_at}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* BCP Drill Modal */}
      {drillModalTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDrillModalTarget(null)}
        >
          <form
            onSubmit={handleRecordBcpDrill}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-md w-full p-5 space-y-4 shadow-xl text-xs"
          >
            <div>
              <div className="font-mono font-bold text-[#C8102E] dark:text-red-400">{drillModalTarget.runbook_code}</div>
              <h3 className="font-display text-sm font-bold text-[#141619] dark:text-neutral-100 mt-0.5">
                {drillModalTarget.title}
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  {isId ? 'Hasil Uji Drill' : 'Drill Outcome'}
                </label>
                <select
                  value={drillForm.test_status}
                  onChange={(e) => setDrillForm({ ...drillForm, test_status: e.target.value as 'Passed' | 'Action Required' })}
                  className={inputClass}
                >
                  <option value="Passed">Passed</option>
                  <option value="Action Required">Action Required</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1">RTO (min)</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={drillForm.rto_minutes}
                  onChange={(e) => setDrillForm({ ...drillForm, rto_minutes: e.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1">RPO (min)</label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={drillForm.rpo_minutes}
                  onChange={(e) => setDrillForm({ ...drillForm, rpo_minutes: e.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                {isId ? 'Catatan Hasil Simulasi' : 'Simulation Notes'}
              </label>
              <textarea
                rows={3}
                value={drillForm.notes}
                onChange={(e) => setDrillForm({ ...drillForm, notes: e.target.value })}
                placeholder={isId ? 'Ringkasan hasil uji restore/failover...' : 'Summary of drill outcome...'}
                className={inputClass}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDrillModalTarget(null)}
                className="px-4 py-2 text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                {isId ? 'Batal' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busyAction !== null}
                className="px-4 py-2 font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md disabled:opacity-50"
              >
                {isId ? 'Simpan Hasil Drill' : 'Save Drill Result'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

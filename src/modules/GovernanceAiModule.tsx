import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Lock,
  Network,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, getSessionToken } from '../lib/api';
import type {
  AiIdentificationRow,
  AiSettingsStatus,
  AssetRow,
  AuthUser,
  EnterpriseSopRow,
  IntegrationConnectorRow,
  IntegrationLogRow,
  Lang,
  LegalHoldRow,
  MasterData,
  RetentionPolicyRow,
  SopExecutionRow,
} from '../types/oims';

interface GovernanceAiModuleProps {
  lang: Lang;
  user: AuthUser;
  master: MasterData;
  assets: AssetRow[];
  onRefreshAssets: () => void;
}

export const GovernanceAiModule: React.FC<GovernanceAiModuleProps> = ({
  lang,
  user,
  master,
  assets,
  onRefreshAssets,
}) => {
  const isId = lang === 'id';
  const canManageGov = user.role_code === 'super_admin' || user.permissions.includes('governance.manage');
  const canManageSettings = user.role_code === 'super_admin' || user.permissions.includes('settings.manage');
  const canAiIdentify = user.role_code === 'super_admin' || user.permissions.includes('ai.identify');
  const canAiVerify = user.role_code === 'super_admin' || user.permissions.includes('ai.verify');
  const canEditAssets = user.role_code === 'super_admin' || user.permissions.includes('assets.edit');

  const [tab, setTab] = useState<'retention' | 'sops' | 'integrations' | 'ai'>('retention');
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Tab 1: Retention & Legal Hold
  const [policies, setPolicies] = useState<RetentionPolicyRow[]>([]);
  const [holds, setHolds] = useState<LegalHoldRow[]>([]);
  const [retentionStats, setRetentionStats] = useState({
    heldAssetsCount: 0,
    archivedAssetsCount: 0,
    disposedPendingArchiveCount: 0,
    immutableEventsCount: 0,
    auditLogsCount: 0,
  });
  const [policyDrafts, setPolicyDrafts] = useState<Record<number, { retention_days: number; action_mode: string; is_active: boolean }>>({});
  const [evalResults, setEvalResults] = useState<any[] | null>(null);
  const [holdAssetId, setHoldAssetId] = useState<string>('');
  const [holdAction, setHoldAction] = useState<'place' | 'release'>('place');
  const [holdReason, setHoldReason] = useState('');

  // Tab 2: Enterprise SOP
  const [sops, setSops] = useState<EnterpriseSopRow[]>([]);
  const [sopExecutions, setSopExecutions] = useState<SopExecutionRow[]>([]);
  const [sopSummary, setSopSummary] = useState({
    activeSops: 0,
    totalExecutions: 0,
    compliantCount: 0,
    deviationCount: 0,
    complianceRatePct: 100,
  });
  const [selectedSopId, setSelectedSopId] = useState<string>('');
  const [sopExecAssetId, setSopExecAssetId] = useState<string>('');
  const [sopExecModule, setSopExecModule] = useState<string>('database');
  const [sopStepChecks, setSopStepChecks] = useState<{ step: string; checked: boolean; notes: string }[]>([]);
  const [sopDeviationNotes, setSopDeviationNotes] = useState('');
  const [showNewSopForm, setShowNewSopForm] = useState(false);
  const [newSop, setNewSop] = useState({
    sop_code: '',
    title: '',
    category: 'Asset Control',
    version: '1.0',
    mandatory_module: 'database',
    checklist_steps: '',
  });

  // Tab 3: Integration Governance
  const [connectors, setConnectors] = useState<IntegrationConnectorRow[]>([]);
  const [integrationLogs, setIntegrationLogs] = useState<IntegrationLogRow[]>([]);
  const [showNewConnForm, setShowNewConnForm] = useState(false);
  const [newConn, setNewConn] = useState({
    connector_code: '',
    name: '',
    connector_type: 'erp_sync',
    endpoint_url: '',
    auth_scheme: 'Bearer Env',
    env_secret_ref: '',
    data_classification: 'Internal',
  });

  // Tab 4: Smart Asset Identification (AI)
  const [aiStatus, setAiStatus] = useState<AiSettingsStatus>({
    smart_ai_enabled: true,
    smart_ai_external_allowed: true,
    geminiKeyConfigured: false,
  });
  const [aiIdentifications, setAiIdentifications] = useState<AiIdentificationRow[]>([]);
  const [aiAssetId, setAiAssetId] = useState<string>('');
  const [aiPhotoUrl, setAiPhotoUrl] = useState<string>('');
  const [aiMode, setAiMode] = useState<'local_dedup_similarity' | 'gemini_vision_ocr'>('local_dedup_similarity');
  const [aiExternalConsent, setAiExternalConsent] = useState(false);
  const [aiHintText, setAiHintText] = useState('');
  const [aiUploading, setAiUploading] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);

  // Human-in-the-loop Apply modal state
  const [applyTarget, setApplyTarget] = useState<AiIdentificationRow | null>(null);
  const [applyAssetId, setApplyAssetId] = useState<string>('');
  const [applyFields, setApplyFields] = useState<{
    serial_number: boolean;
    brand: boolean;
    model: boolean;
    specification: boolean;
    category_id: boolean;
  }>({
    serial_number: false,
    brand: false,
    model: false,
    specification: false,
    category_id: false,
  });
  const [applyOverrides, setApplyOverrides] = useState({
    serial_number: '',
    brand: '',
    model: '',
    specification: '',
    category_id: '',
  });
  const [applyConfirmCheck, setApplyConfirmCheck] = useState(false);
  const [applyNotes, setApplyNotes] = useState('');

  const showToast = (msg: string) => {
    setErrorMsg('');
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const loadRetention = useCallback(async () => {
    const res = await apiFetch<{ policies: RetentionPolicyRow[]; holds: LegalHoldRow[]; stats: any }>(
      '/api/governance/retention'
    );
    setPolicies(res.policies || []);
    setHolds(res.holds || []);
    if (res.stats) setRetentionStats(res.stats);
    const drafts: Record<number, { retention_days: number; action_mode: string; is_active: boolean }> = {};
    for (const p of res.policies || []) {
      drafts[p.id] = {
        retention_days: p.retention_days,
        action_mode: p.action_mode,
        is_active: Boolean(p.is_active),
      };
    }
    setPolicyDrafts(drafts);
  }, []);

  const loadSops = useCallback(async () => {
    const res = await apiFetch<{ sops: EnterpriseSopRow[]; executions: SopExecutionRow[]; summary: any }>(
      '/api/governance/sops'
    );
    const list = res.sops || [];
    setSops(list);
    setSopExecutions(res.executions || []);
    if (res.summary) setSopSummary(res.summary);
    if (!selectedSopId && list.length > 0) {
      const first = list.find((s) => Number(s.is_active) === 1) || list[0];
      setSelectedSopId(String(first.id));
    }
  }, [selectedSopId]);

  const loadIntegrations = useCallback(async () => {
    const res = await apiFetch<{ connectors: IntegrationConnectorRow[]; logs: IntegrationLogRow[] }>(
      '/api/governance/integrations'
    );
    setConnectors(res.connectors || []);
    setIntegrationLogs(res.logs || []);
  }, []);

  const loadAi = useCallback(async () => {
    const res = await apiFetch<{ identifications: AiIdentificationRow[]; aiStatus: AiSettingsStatus }>(
      '/api/ai/identifications'
    );
    setAiIdentifications(res.identifications || []);
    if (res.aiStatus) setAiStatus(res.aiStatus);
  }, []);

  useEffect(() => {
    setErrorMsg('');
    if (tab === 'retention') loadRetention().catch((e) => setErrorMsg(e.message));
    if (tab === 'sops') loadSops().catch((e) => setErrorMsg(e.message));
    if (tab === 'integrations') loadIntegrations().catch((e) => setErrorMsg(e.message));
    if (tab === 'ai') loadAi().catch((e) => setErrorMsg(e.message));
  }, [tab, loadRetention, loadSops, loadIntegrations, loadAi]);

  // Sync SOP checklist steps when selectedSopId changes
  useEffect(() => {
    const sop = sops.find((s) => String(s.id) === selectedSopId);
    if (!sop) {
      setSopStepChecks([]);
      return;
    }
    setSopExecModule(sop.mandatory_module || 'database');
    try {
      const steps = JSON.parse(sop.checklist_json || '[]') as string[];
      setSopStepChecks(steps.map((step) => ({ step, checked: true, notes: '' })));
    } catch {
      setSopStepChecks([]);
    }
  }, [selectedSopId, sops]);

  // Sync photo URL if selecting an asset in Smart AI
  useEffect(() => {
    if (!aiAssetId) return;
    const found = assets.find((a) => String(a.id) === aiAssetId);
    if (found?.primary_photo_url) {
      setAiPhotoUrl(found.primary_photo_url);
    }
  }, [aiAssetId, assets]);

  const handleSavePolicy = async (policy: RetentionPolicyRow) => {
    const draft = policyDrafts[policy.id];
    if (!draft) return;
    setErrorMsg('');
    try {
      await apiFetch(`/api/governance/retention/${policy.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          retention_days: Number(draft.retention_days),
          action_mode: draft.action_mode,
          is_active: draft.is_active,
        }),
      });
      await loadRetention();
      showToast(isId ? `Kebijakan retensi ${policy.policy_code} disimpan.` : `Retention policy ${policy.policy_code} saved.`);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleEvaluateRetention = async (execute: boolean) => {
    setErrorMsg('');
    try {
      const res = await apiFetch<{ results: any[] }>('/api/governance/retention/evaluate', {
        method: 'POST',
        body: JSON.stringify({ execute }),
      });
      setEvalResults(res.results || []);
      await loadRetention();
      if (execute) onRefreshAssets();
      showToast(
        execute
          ? isId
            ? 'Evaluasi & pengarsipan retensi selesai dijalankan (ledger permanen tetap terlindungi).'
            : 'Retention execution completed (immutable ledgers protected).'
          : isId
          ? 'Simulasi Dry-Run retensi selesai.'
          : 'Retention dry-run evaluation completed.'
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleLegalHoldSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await apiFetch('/api/governance/legal-hold', {
        method: 'POST',
        body: JSON.stringify({
          asset_id: Number(holdAssetId),
          action: holdAction,
          reason: holdReason,
        }),
      });
      setHoldReason('');
      await loadRetention();
      onRefreshAssets();
      showToast(
        holdAction === 'place'
          ? isId
            ? 'Legal Hold berhasil diaktifkan pada aset.'
            : 'Legal Hold placed on asset.'
          : isId
          ? 'Legal Hold berhasil dilepaskan.'
          : 'Legal Hold released.'
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCreateSop = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await apiFetch('/api/governance/sops', {
        method: 'POST',
        body: JSON.stringify(newSop),
      });
      setShowNewSopForm(false);
      setNewSop({ sop_code: '', title: '', category: 'Asset Control', version: '1.0', mandatory_module: 'database', checklist_steps: '' });
      await loadSops();
      showToast(isId ? 'SOP Enterprise baru berhasil ditambahkan.' : 'Enterprise SOP created.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleToggleSopActive = async (sop: EnterpriseSopRow) => {
    setErrorMsg('');
    try {
      await apiFetch(`/api/governance/sops/${sop.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !Number(sop.is_active) }),
      });
      await loadSops();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSubmitSopExecution = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await apiFetch<{ execution_code: string; compliance_status: string }>('/api/governance/sop-executions', {
        method: 'POST',
        body: JSON.stringify({
          sop_id: Number(selectedSopId),
          asset_id: sopExecAssetId ? Number(sopExecAssetId) : null,
          module_context: sopExecModule,
          checklist_results: sopStepChecks,
          deviation_notes: sopDeviationNotes,
        }),
      });
      setSopDeviationNotes('');
      await loadSops();
      showToast(
        isId
          ? `Eksekusi SOP ${res.execution_code} tercatat (${res.compliance_status}).`
          : `SOP execution ${res.execution_code} recorded (${res.compliance_status}).`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCreateConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await apiFetch('/api/governance/integrations', {
        method: 'POST',
        body: JSON.stringify(newConn),
      });
      setShowNewConnForm(false);
      setNewConn({
        connector_code: '',
        name: '',
        connector_type: 'erp_sync',
        endpoint_url: '',
        auth_scheme: 'Bearer Env',
        env_secret_ref: '',
        data_classification: 'Internal',
      });
      await loadIntegrations();
      showToast(isId ? 'Konektor integrasi terdaftar (status default: Nonaktif).' : 'Integration connector registered (disabled by default).');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleToggleConnector = async (conn: IntegrationConnectorRow) => {
    setErrorMsg('');
    try {
      await apiFetch(`/api/governance/integrations/${conn.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_enabled: !Number(conn.is_enabled) }),
      });
      await loadIntegrations();
      showToast(
        !Number(conn.is_enabled)
          ? isId
            ? `Konektor ${conn.connector_code} diaktifkan.`
            : `Connector ${conn.connector_code} enabled.`
          : isId
          ? `Kill Switch: Konektor ${conn.connector_code} dinonaktifkan.`
          : `Kill Switch: Connector ${conn.connector_code} disabled.`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleTestDispatch = async (conn: IntegrationConnectorRow, dryRun: boolean) => {
    setErrorMsg('');
    try {
      await apiFetch(`/api/governance/integrations/${conn.id}/test-dispatch`, {
        method: 'POST',
        body: JSON.stringify({ dry_run: dryRun }),
      });
      await loadIntegrations();
      showToast(
        dryRun
          ? isId
            ? `Dry-Run ${conn.connector_code} berhasil divalidasi.`
            : `Dry-Run ${conn.connector_code} validated.`
          : isId
          ? `Live dispatch ${conn.connector_code} selesai.`
          : `Live dispatch ${conn.connector_code} completed.`
      );
    } catch (err: any) {
      await loadIntegrations();
      setErrorMsg(err.message);
    }
  };

  const handleToggleAiSetting = async (field: 'smart_ai_enabled' | 'smart_ai_external_allowed') => {
    setErrorMsg('');
    try {
      const next = await apiFetch<AiSettingsStatus & { ok: boolean }>('/api/ai/settings', {
        method: 'PUT',
        body: JSON.stringify({ [field]: !aiStatus[field] }),
      });
      setAiStatus({
        smart_ai_enabled: next.smart_ai_enabled,
        smart_ai_external_allowed: next.smart_ai_external_allowed,
        geminiKeyConfigured: next.geminiKeyConfigured,
      });
      showToast(isId ? 'Pengaturan Kill Switch Smart AI diperbarui.' : 'Smart AI Kill Switch settings updated.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleUploadAiPhoto = async (file?: File) => {
    if (!file) return;
    setErrorMsg('');
    setAiUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getSessionToken();
      const res = await fetch('/api/uploads/field-photo', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload foto gagal');
      setAiPhotoUrl(data.fileUrl);
      showToast(isId ? `Foto diunggah ke penyimpanan lokal: ${data.fileName}` : `Photo uploaded to local storage: ${data.fileName}`);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setAiUploading(false);
    }
  };

  const handleRunIdentification = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setAiRunning(true);
    try {
      const res = await apiFetch<{ identification: AiIdentificationRow }>('/api/ai/identify', {
        method: 'POST',
        body: JSON.stringify({
          asset_id: aiAssetId ? Number(aiAssetId) : null,
          photo_url: aiPhotoUrl,
          analysis_mode: aiMode,
          external_consent_confirmed: aiMode === 'gemini_vision_ocr' ? aiExternalConsent : false,
          hint_text: aiHintText,
        }),
      });
      await loadAi();
      showToast(
        isId
          ? `Identifikasi ${res.identification.identification_code} selesai (Status: Pending Review — Master aset tidak berubah).`
          : `Identification ${res.identification.identification_code} created (Pending Review — Master asset untouched).`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setAiRunning(false);
    }
  };

  const handleVerifyDecision = async (row: AiIdentificationRow, decision: 'Accept' | 'Reject') => {
    setErrorMsg('');
    try {
      await apiFetch(`/api/ai/identifications/${row.id}/verify`, {
        method: 'PUT',
        body: JSON.stringify({ decision }),
      });
      await loadAi();
      showToast(
        decision === 'Accept'
          ? isId
            ? `Rekomendasi ${row.identification_code} ditandai Diterima.`
            : `Recommendation ${row.identification_code} accepted.`
          : isId
          ? `Rekomendasi ${row.identification_code} ditolak.`
          : `Recommendation ${row.identification_code} rejected.`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const openApplyModal = (row: AiIdentificationRow) => {
    setApplyTarget(row);
    setApplyAssetId(row.asset_id ? String(row.asset_id) : '');
    setApplyFields({
      serial_number: Boolean(row.extracted_serial_number),
      brand: Boolean(row.extracted_brand),
      model: Boolean(row.extracted_model),
      specification: Boolean(row.extracted_specs),
      category_id: Boolean(row.recommended_category_id),
    });
    setApplyOverrides({
      serial_number: row.extracted_serial_number || '',
      brand: row.extracted_brand || '',
      model: row.extracted_model || '',
      specification: row.extracted_specs || '',
      category_id: row.recommended_category_id ? String(row.recommended_category_id) : '',
    });
    setApplyConfirmCheck(false);
    setApplyNotes('');
  };

  const handleConfirmApplyToMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyTarget) return;
    setErrorMsg('');
    const selected = (Object.entries(applyFields) as [string, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k);
    try {
      await apiFetch(`/api/ai/identifications/${applyTarget.id}/verify`, {
        method: 'PUT',
        body: JSON.stringify({
          decision: 'Apply',
          confirm_apply: applyConfirmCheck,
          asset_id: Number(applyAssetId),
          apply_fields: selected,
          override_values: {
            serial_number: applyOverrides.serial_number,
            brand: applyOverrides.brand,
            model: applyOverrides.model,
            specification: applyOverrides.specification,
            category_id: applyOverrides.category_id ? Number(applyOverrides.category_id) : undefined,
          },
          notes: applyNotes,
        }),
      });
      setApplyTarget(null);
      await loadAi();
      onRefreshAssets();
      showToast(
        isId
          ? `Rekomendasi ${applyTarget.identification_code} berhasil diterapkan ke master aset & dicatat ke ledger SHA-256.`
          : `Recommendation ${applyTarget.identification_code} applied to master asset & logged in SHA-256 ledger.`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const cardClass =
    'bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5';
  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';

  const hasSopUnchecked = sopStepChecks.some((s) => !s.checked);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-[#141619] dark:text-neutral-100">
            {isId ? 'Tata Kelola Enterprise, Retensi, SOP & Smart AI' : 'Enterprise Governance, Retention, SOP & Smart AI'}
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? 'Kebijakan retensi & legal hold, kontrol SOP operasional, tata kelola konektor integrasi, dan identifikasi aset berbasis human-in-the-loop.'
              : 'Retention & legal hold management, operational SOP compliance, integration governance, and human-in-the-loop Smart AI asset identification.'}
          </p>
        </div>
        {toast && (
          <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3 py-2 rounded-md">
            {toast}
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="text-xs text-[#C8102E] dark:text-red-300 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 px-4 py-2.5 rounded-md">
          {errorMsg}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800 pb-2">
        {[
          { id: 'retention', label: isId ? 'Retensi & Legal Hold' : 'Retention & Legal Hold', icon: Archive },
          { id: 'sops', label: isId ? 'SOP & Kontrol Operasional' : 'Enterprise SOP Control', icon: ClipboardCheck },
          { id: 'integrations', label: isId ? 'Tata Kelola Integrasi' : 'Integration Governance', icon: Network },
          { id: 'ai', label: isId ? 'Smart Asset Identification (AI)' : 'Smart Asset Identification (AI)', icon: Sparkles },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as any)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#141619] dark:bg-[#C8102E] text-white'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: RETENTION POLICIES & LEGAL HOLD                                */}
      {/* ===================================================================== */}
      {tab === 'retention' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: isId ? 'Legal Hold Aktif' : 'Active Legal Holds', value: retentionStats.heldAssetsCount, accent: 'text-[#C8102E] dark:text-red-400' },
              { label: isId ? 'Aset Diarsipkan' : 'Archived Assets', value: retentionStats.archivedAssetsCount, accent: 'text-[#141619] dark:text-neutral-100' },
              { label: isId ? 'Disposed Siap Arsip' : 'Disposed Eligible', value: retentionStats.disposedPendingArchiveCount, accent: 'text-amber-700 dark:text-amber-400' },
              { label: isId ? 'Ledger SHA-256 (Permanen)' : 'Immutable Events', value: retentionStats.immutableEventsCount, accent: 'text-emerald-700 dark:text-emerald-400' },
              { label: isId ? 'Log Audit (Permanen)' : 'Security Audit Logs', value: retentionStats.auditLogsCount, accent: 'text-emerald-700 dark:text-emerald-400' },
            ].map((stat, idx) => (
              <div key={idx} className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg px-4 py-3">
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{stat.label}</div>
                <div className={`text-xl font-bold font-mono tabular-nums mt-1 ${stat.accent}`}>{stat.value}</div>
              </div>
            ))}
          </div>

          <div className={cardClass}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Kebijakan Retensi Kelas Rekaman' : 'Record Class Retention Policies'}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {isId
                    ? 'Ledger SHA-256 (asset_events) dan audit_logs dilindungi guardrail agar tidak pernah dihapus otomatis.'
                    : 'SHA-256 asset_events and audit_logs are guardrail-locked and never pruned by retention jobs.'}
                </p>
              </div>
              {canManageGov && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleEvaluateRetention(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <FileSearch className="w-3.5 h-3.5" />
                    <span>{isId ? 'Simulasi Dry-Run' : 'Dry-Run Evaluation'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEvaluateRetention(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-[#C8102E] hover:bg-[#A10D24] text-white rounded-md"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{isId ? 'Jalankan Retensi & Arsip' : 'Execute Retention'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-[#1E222A] text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{isId ? 'Kode & Kelas' : 'Code & Class'}</th>
                    <th className="px-3 py-2.5 font-medium">{isId ? 'Kebijakan' : 'Policy'}</th>
                    <th className="px-3 py-2.5 font-medium">{isId ? 'Retensi (Hari)' : 'Days'}</th>
                    <th className="px-3 py-2.5 font-medium">{isId ? 'Mode Aksi' : 'Action Mode'}</th>
                    <th className="px-3 py-2.5 font-medium">{isId ? 'Status' : 'Status'}</th>
                    {canManageGov && <th className="px-3 py-2.5 font-medium text-right">{isId ? 'Simpan' : 'Save'}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {policies.map((p) => {
                    const draft = policyDrafts[p.id] || {
                      retention_days: p.retention_days,
                      action_mode: p.action_mode,
                      is_active: Boolean(p.is_active),
                    };
                    const locked = Number(p.is_immutable_ledger) === 1;
                    return (
                      <tr key={p.id}>
                        <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                          <div className="font-semibold text-[#141619] dark:text-neutral-100">{p.policy_code}</div>
                          <div className="text-[11px] text-neutral-500">{p.record_class}</div>
                        </td>
                        <td className="px-3 py-2.5 max-w-sm">
                          <div className="font-medium text-[#141619] dark:text-neutral-100 flex items-center gap-1.5">
                            {locked && <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                            <span>{p.title}</span>
                          </div>
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">{p.description}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="number"
                            min={30}
                            max={36500}
                            disabled={!canManageGov}
                            value={draft.retention_days}
                            onChange={(e) =>
                              setPolicyDrafts((prev) => ({
                                ...prev,
                                [p.id]: { ...draft, retention_days: Number(e.target.value) },
                              }))
                            }
                            className="w-24 px-2 py-1 text-xs font-mono tabular-nums bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            disabled={!canManageGov || locked}
                            value={draft.action_mode}
                            onChange={(e) =>
                              setPolicyDrafts((prev) => ({
                                ...prev,
                                [p.id]: { ...draft, action_mode: e.target.value },
                              }))
                            }
                            className="px-2 py-1 text-xs font-mono bg-white dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded disabled:opacity-60"
                          >
                            <option value="immutable_retain">immutable_retain</option>
                            {!locked && <option value="archive_record">archive_record</option>}
                            {!locked && <option value="purge_non_ledger">purge_non_ledger</option>}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              disabled={!canManageGov || locked}
                              checked={draft.is_active}
                              onChange={(e) =>
                                setPolicyDrafts((prev) => ({
                                  ...prev,
                                  [p.id]: { ...draft, is_active: e.target.checked },
                                }))
                              }
                            />
                            <span className={draft.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500'}>
                              {locked ? (isId ? 'Permanen' : 'Protected') : draft.is_active ? (isId ? 'Aktif' : 'Active') : (isId ? 'Nonaktif' : 'Paused')}
                            </span>
                          </label>
                        </td>
                        {canManageGov && (
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleSavePolicy(p)}
                              className="px-2.5 py-1 text-[11px] font-medium bg-neutral-900 dark:bg-neutral-700 text-white rounded hover:bg-[#C8102E]"
                            >
                              {isId ? 'Simpan' : 'Save'}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {evalResults && (
              <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
                <div className="text-xs font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Hasil Evaluasi Retensi Terbaru' : 'Latest Retention Evaluation Results'}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {evalResults.map((r, i) => (
                    <div key={i} className="px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded bg-neutral-50 dark:bg-[#1E222A] flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{r.policy_code}</span>
                        <span className="text-neutral-500"> · {r.record_class}</span>
                        {r.skipped_reason && <div className="text-[11px] text-neutral-500 mt-0.5">{r.skipped_reason}</div>}
                      </div>
                      <div className="font-mono text-[11px] tabular-nums text-right shrink-0">
                        <div>{isId ? 'Eligible' : 'Eligible'}: {r.eligible_count}</div>
                        <div className="text-emerald-700 dark:text-emerald-400">{isId ? 'Diproses' : 'Processed'}: {r.processed_count}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {canManageGov && (
              <form onSubmit={handleLegalHoldSubmit} className={cardClass + ' space-y-3'}>
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                  <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                    {isId ? 'Tetapkan / Lepas Legal Hold' : 'Place / Release Legal Hold'}
                  </h3>
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {isId
                    ? 'Aset dengan status Legal Hold tidak dapat diarsipkan atau dimusnahkan selama investigasi/audit berlangsung.'
                    : 'Assets under Legal Hold are protected from archival or disposal during audit or legal review.'}
                </p>
                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Pilih Aset' : 'Select Asset'} *
                  </label>
                  <select required value={holdAssetId} onChange={(e) => setHoldAssetId(e.target.value)} className={inputClass}>
                    <option value="">-- {isId ? 'Pilih Aset' : 'Select Asset'} --</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.asset_code} · {a.asset_name} {a.legal_hold ? '[HOLD]' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Tindakan' : 'Action'} *
                  </label>
                  <select value={holdAction} onChange={(e) => setHoldAction(e.target.value as any)} className={inputClass}>
                    <option value="place">{isId ? 'Aktifkan Legal Hold' : 'Place Legal Hold'}</option>
                    <option value="release">{isId ? 'Lepaskan Legal Hold' : 'Release Legal Hold'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Dasar Hukum / Alasan Audit' : 'Legal / Audit Reason'} *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={holdReason}
                    onChange={(e) => setHoldReason(e.target.value)}
                    placeholder={isId ? 'Contoh: Audit eksternal BPK / sengketa garansi vendor...' : 'E.g. External audit preservation notice...'}
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md"
                >
                  {holdAction === 'place'
                    ? isId
                      ? 'Aktifkan Legal Hold'
                      : 'Place Legal Hold'
                    : isId
                    ? 'Lepaskan Legal Hold'
                    : 'Release Legal Hold'}
                </button>
              </form>
            )}

            <div className={cardClass + (canManageGov ? ' lg:col-span-2' : ' lg:col-span-3')}>
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-3">
                {isId ? 'Daftar Riwayat Legal Hold Aset' : 'Asset Legal Hold Register'}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-[#1E222A] text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                    <tr>
                      <th className="px-3 py-2 font-medium">Hold Code</th>
                      <th className="px-3 py-2 font-medium">{isId ? 'Aset' : 'Asset'}</th>
                      <th className="px-3 py-2 font-medium">{isId ? 'Alasan' : 'Reason'}</th>
                      <th className="px-3 py-2 font-medium">{isId ? 'Status' : 'Status'}</th>
                      <th className="px-3 py-2 font-medium">{isId ? 'Waktu' : 'Timestamp'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {holds.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                          {isId ? 'Belum ada catatan Legal Hold pada cakupan organisasi ini.' : 'No legal hold records in this organization scope.'}
                        </td>
                      </tr>
                    ) : (
                      holds.map((h) => (
                        <tr key={h.id}>
                          <td className="px-3 py-2 font-mono font-semibold text-[#141619] dark:text-neutral-100 whitespace-nowrap">{h.hold_code}</td>
                          <td className="px-3 py-2">
                            <div className="font-mono text-[11px] font-semibold">{h.asset_code}</div>
                            <div className="text-[11px] text-neutral-500">{h.asset_name}</div>
                          </td>
                          <td className="px-3 py-2 max-w-xs text-neutral-700 dark:text-neutral-300">{h.hold_reason}</td>
                          <td className="px-3 py-2 font-mono font-semibold">
                            <span className={h.status === 'Active' ? 'text-[#C8102E] dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>
                              {h.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-neutral-500 whitespace-nowrap">
                            {h.placed_at}
                            {h.released_at ? ` · Rel: ${h.released_at}` : ''}
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

      {/* ===================================================================== */}
      {/* TAB 2: ENTERPRISE SOP & OPERATIONAL CONTROL                           */}
      {/* ===================================================================== */}
      {tab === 'sops' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: isId ? 'SOP Aktif' : 'Active SOPs', value: sopSummary.activeSops, accent: 'text-[#141619] dark:text-neutral-100' },
              { label: isId ? 'Total Eksekusi SOP' : 'Total Sign-offs', value: sopSummary.totalExecutions, accent: 'text-[#141619] dark:text-neutral-100' },
              { label: isId ? 'Patuh (Compliant)' : 'Compliant', value: sopSummary.compliantCount, accent: 'text-emerald-700 dark:text-emerald-400' },
              { label: isId ? 'Deviasi (Deviation)' : 'Deviations', value: sopSummary.deviationCount, accent: 'text-[#C8102E] dark:text-red-400' },
              { label: isId ? 'Tingkat Kepatuhan' : 'Compliance Rate', value: `${sopSummary.complianceRatePct}%`, accent: 'text-emerald-700 dark:text-emerald-400' },
            ].map((s, idx) => (
              <div key={idx} className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg px-4 py-3">
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{s.label}</div>
                <div className={`text-xl font-bold font-mono tabular-nums mt-1 ${s.accent}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Execute SOP Checklist */}
            <form onSubmit={handleSubmitSopExecution} className={cardClass + ' lg:col-span-5 space-y-3'}>
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Eksekusi & Sign-off Checklist SOP' : 'Execute & Sign-off SOP Checklist'}
              </h3>
              <div>
                <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                  {isId ? 'Pilih Prosedur SOP' : 'Select SOP Procedure'} *
                </label>
                <select required value={selectedSopId} onChange={(e) => setSelectedSopId(e.target.value)} className={inputClass}>
                  {sops
                    .filter((s) => Number(s.is_active) === 1)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sop_code} (v{s.version}) · {s.title}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Aset Terkait (Opsional)' : 'Linked Asset (Optional)'}
                  </label>
                  <select value={sopExecAssetId} onChange={(e) => setSopExecAssetId(e.target.value)} className={inputClass}>
                    <option value="">-- {isId ? 'Umum / Non-aset' : 'General / Non-asset'} --</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.asset_code} · {a.asset_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Konteks Modul' : 'Module Context'}
                  </label>
                  <input type="text" value={sopExecModule} onChange={(e) => setSopExecModule(e.target.value)} className={inputClass} />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                  {isId ? 'Langkah Verifikasi SOP:' : 'SOP Verification Steps:'}
                </div>
                {sopStepChecks.map((item, idx) => (
                  <label
                    key={idx}
                    className="flex items-start gap-2.5 p-2.5 border border-neutral-200 dark:border-neutral-700 rounded-md bg-neutral-50/70 dark:bg-[#1E222A] cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) =>
                        setSopStepChecks((prev) =>
                          prev.map((row, rIdx) => (rIdx === idx ? { ...row, checked: e.target.checked } : row))
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="text-neutral-800 dark:text-neutral-200">{item.step}</span>
                  </label>
                ))}
              </div>

              {hasSopUnchecked && (
                <div>
                  <label className="block text-[11px] text-[#C8102E] dark:text-red-400 font-medium mb-1">
                    {isId ? 'Catatan Deviasi Wajib Diisi *' : 'Deviation Justification Required *'}
                  </label>
                  <textarea
                    required
                    rows={2}
                    value={sopDeviationNotes}
                    onChange={(e) => setSopDeviationNotes(e.target.value)}
                    placeholder={isId ? 'Jelaskan alasan langkah SOP belum dipenuhi...' : 'Explain why checklist step was not fulfilled...'}
                    className={inputClass}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={!selectedSopId}
                className="w-full py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-[#C8102E] dark:hover:bg-[#A10D24] rounded-md disabled:opacity-50"
              >
                {hasSopUnchecked
                  ? isId
                    ? 'Catat Eksekusi sebagai Deviasi'
                    : 'Record Execution with Deviation'
                  : isId
                  ? 'Sign-off Kepatuhan SOP'
                  : 'Sign-off Compliant SOP'}
              </button>
            </form>

            {/* SOP Registry & Recent Executions */}
            <div className="lg:col-span-7 space-y-6">
              <div className={cardClass}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                    {isId ? 'Standar Prosedur Operasional (SOP)' : 'Enterprise SOP Definitions'}
                  </h3>
                  {canManageGov && (
                    <button
                      type="button"
                      onClick={() => setShowNewSopForm((v) => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-neutral-900 dark:bg-neutral-700 text-white rounded-md hover:bg-[#C8102E]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isId ? 'Tambah SOP' : 'New SOP'}</span>
                    </button>
                  )}
                </div>

                {showNewSopForm && canManageGov && (
                  <form onSubmit={handleCreateSop} className="mb-4 p-3.5 border border-neutral-200 dark:border-neutral-700 rounded-md bg-neutral-50 dark:bg-[#1E222A] space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        type="text"
                        placeholder="SOP-OIMS-004 (opsional)"
                        value={newSop.sop_code}
                        onChange={(e) => setNewSop((p) => ({ ...p, sop_code: e.target.value }))}
                        className={inputClass}
                      />
                      <input
                        type="text"
                        required
                        placeholder={isId ? 'Judul SOP *' : 'SOP Title *'}
                        value={newSop.title}
                        onChange={(e) => setNewSop((p) => ({ ...p, title: e.target.value }))}
                        className={inputClass + ' sm:col-span-2'}
                      />
                      <input
                        type="text"
                        placeholder={isId ? 'Kategori' : 'Category'}
                        value={newSop.category}
                        onChange={(e) => setNewSop((p) => ({ ...p, category: e.target.value }))}
                        className={inputClass}
                      />
                      <input
                        type="text"
                        placeholder="v1.0"
                        value={newSop.version}
                        onChange={(e) => setNewSop((p) => ({ ...p, version: e.target.value }))}
                        className={inputClass}
                      />
                      <select
                        value={newSop.mandatory_module}
                        onChange={(e) => setNewSop((p) => ({ ...p, mandatory_module: e.target.value }))}
                        className={inputClass}
                      >
                        <option value="register">register</option>
                        <option value="database">database</option>
                        <option value="opname">opname</option>
                        <option value="movements">movements</option>
                        <option value="maintenance">maintenance</option>
                      </select>
                    </div>
                    <textarea
                      required
                      rows={3}
                      placeholder={isId ? 'Langkah checklist (pisahkan setiap baris dengan Enter) *' : 'Checklist steps (one per line) *'}
                      value={newSop.checklist_steps}
                      onChange={(e) => setNewSop((p) => ({ ...p, checklist_steps: e.target.value }))}
                      className={inputClass}
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setShowNewSopForm(false)} className="px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                        {isId ? 'Batal' : 'Cancel'}
                      </button>
                      <button type="submit" className="px-3 py-1.5 text-xs font-semibold text-white bg-[#C8102E] rounded-md">
                        {isId ? 'Simpan SOP' : 'Save SOP'}
                      </button>
                    </div>
                  </form>
                )}

                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {sops.map((s) => (
                    <div key={s.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-[#141619] dark:text-neutral-100">
                          <span className="font-mono text-[#C8102E] dark:text-red-400">{s.sop_code}</span> · {s.title}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          v{s.version} · {s.category} · {isId ? 'Modul' : 'Module'}: <span className="font-mono">{s.mandatory_module}</span> ·{' '}
                          {s.company_name || (isId ? 'Standar Grup Holding' : 'Holding Group Standard')}
                        </div>
                      </div>
                      {canManageGov && (
                        <button
                          type="button"
                          onClick={() => handleToggleSopActive(s)}
                          className={`px-2.5 py-1 text-[11px] font-mono rounded border ${
                            Number(s.is_active)
                              ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                              : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'
                          }`}
                        >
                          {Number(s.is_active) ? 'Active' : 'Disabled'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className={cardClass}>
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-3">
                  {isId ? 'Log Eksekusi & Kepatuhan SOP' : 'SOP Execution & Compliance Log'}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 dark:bg-[#1E222A] text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                      <tr>
                        <th className="px-3 py-2 font-medium">Execution</th>
                        <th className="px-3 py-2 font-medium">SOP / Asset</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">{isId ? 'Pelaksana' : 'Officer'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {sopExecutions.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-5 text-center text-neutral-500">
                            {isId ? 'Belum ada catatan eksekusi SOP.' : 'No SOP executions recorded yet.'}
                          </td>
                        </tr>
                      ) : (
                        sopExecutions.map((ex) => (
                          <tr key={ex.id}>
                            <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                              <div className="font-semibold text-[#141619] dark:text-neutral-100">{ex.execution_code}</div>
                              <div className="text-neutral-500">{ex.signed_off_at}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{ex.sop_code} · {ex.sop_title}</div>
                              <div className="text-[11px] text-neutral-500">
                                {ex.asset_code ? `${ex.asset_code} · ` : ''}{ex.module_context}
                                {ex.deviation_notes ? ` · ${ex.deviation_notes}` : ''}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">
                              <span className={ex.compliance_status === 'Deviation' ? 'text-[#C8102E] dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>
                                {ex.compliance_status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-[11px] text-neutral-600 dark:text-neutral-400">{ex.executed_by_name || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: SYSTEM INTEGRATION GOVERNANCE                                  */}
      {/* ===================================================================== */}
      {tab === 'integrations' && (
        <div className="space-y-6">
          <div className={cardClass}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Registri Konektor Integrasi Korporat' : 'Enterprise Integration Connector Registry'}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {isId
                    ? 'Konektor ERP/HRIS/Procurement tanpa layanan Google Cloud. Dilindungi SSRF Guard, referensi Env Var (tanpa secret plaintext), serta Kill Switch per konektor.'
                    : 'Zero Google Cloud connectors. Guarded by SSRF protection, environment-variable secret references (never plaintext), and per-connector Kill Switches.'}
                </p>
              </div>
              {canManageGov && (
                <button
                  type="button"
                  onClick={() => setShowNewConnForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isId ? 'Daftarkan Konektor' : 'Register Connector'}</span>
                </button>
              )}
            </div>

            {showNewConnForm && canManageGov && (
              <form onSubmit={handleCreateConnector} className="mb-5 p-4 border border-neutral-200 dark:border-neutral-700 rounded-md bg-neutral-50 dark:bg-[#1E222A] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="ERP-SYNC-01 (opsional)"
                    value={newConn.connector_code}
                    onChange={(e) => setNewConn((p) => ({ ...p, connector_code: e.target.value }))}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    required
                    placeholder={isId ? 'Nama Konektor *' : 'Connector Name *'}
                    value={newConn.name}
                    onChange={(e) => setNewConn((p) => ({ ...p, name: e.target.value }))}
                    className={inputClass}
                  />
                  <select
                    value={newConn.connector_type}
                    onChange={(e) => setNewConn((p) => ({ ...p, connector_type: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="erp_sync">erp_sync</option>
                    <option value="hris_sync">hris_sync</option>
                    <option value="procurement_sync">procurement_sync</option>
                    <option value="webhook">webhook</option>
                  </select>
                  <input
                    type="url"
                    required
                    placeholder="https://erp.company.com/api/sync *"
                    value={newConn.endpoint_url}
                    onChange={(e) => setNewConn((p) => ({ ...p, endpoint_url: e.target.value }))}
                    className={inputClass + ' sm:col-span-2 font-mono'}
                  />
                  <select
                    value={newConn.data_classification}
                    onChange={(e) => setNewConn((p) => ({ ...p, data_classification: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="Public">Public</option>
                    <option value="Internal">Internal</option>
                    <option value="Confidential">Confidential</option>
                  </select>
                  <select
                    value={newConn.auth_scheme}
                    onChange={(e) => setNewConn((p) => ({ ...p, auth_scheme: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="Bearer Env">Bearer Env</option>
                    <option value="HMAC Header">HMAC Header</option>
                    <option value="None">None</option>
                  </select>
                  <input
                    type="text"
                    placeholder="ENV_VAR_NAME (e.g. KIDECO_ERP_TOKEN)"
                    value={newConn.env_secret_ref}
                    onChange={(e) => setNewConn((p) => ({ ...p, env_secret_ref: e.target.value.toUpperCase() }))}
                    className={inputClass + ' font-mono sm:col-span-2'}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowNewConnForm(false)} className="px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                    {isId ? 'Batal' : 'Cancel'}
                  </button>
                  <button type="submit" className="px-3 py-1.5 text-xs font-semibold text-white bg-[#C8102E] rounded-md">
                    {isId ? 'Simpan Konektor' : 'Save Connector'}
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-[#1E222A] text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{isId ? 'Konektor' : 'Connector'}</th>
                    <th className="px-3 py-2.5 font-medium">Endpoint & Auth</th>
                    <th className="px-3 py-2.5 font-medium">{isId ? 'Klasifikasi' : 'Classification'}</th>
                    <th className="px-3 py-2.5 font-medium">Kill Switch</th>
                    <th className="px-3 py-2.5 font-medium text-right">{isId ? 'Uji Pengiriman' : 'Dispatch Test'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {connectors.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{c.connector_code}</div>
                        <div className="text-[11px] text-neutral-600 dark:text-neutral-400">{c.name} · {c.connector_type}</div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px]">
                        <div className="truncate max-w-xs text-[#141619] dark:text-neutral-200" title={c.endpoint_url}>{c.endpoint_url}</div>
                        <div className="text-neutral-500 mt-0.5">
                          {c.auth_scheme} {c.env_secret_ref ? `· env:${c.env_secret_ref} (${c.env_secret_configured ? 'SET' : 'UNSET'})` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px]">{c.data_classification}</td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          disabled={!canManageGov}
                          onClick={() => handleToggleConnector(c)}
                          className={`px-2.5 py-1 text-[11px] font-mono rounded border ${
                            Number(c.is_enabled)
                              ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                              : 'border-red-300 dark:border-red-900 text-[#C8102E] dark:text-red-400'
                          }`}
                        >
                          {Number(c.is_enabled) ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                        {canManageGov && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleTestDispatch(c, true)}
                              className="px-2.5 py-1 text-[11px] font-medium border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800"
                            >
                              Dry-Run
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTestDispatch(c, false)}
                              className="px-2.5 py-1 text-[11px] font-medium bg-[#141619] dark:bg-neutral-700 text-white rounded hover:bg-[#C8102E]"
                            >
                              Live Ping
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={cardClass}>
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-3">
              {isId ? 'Log Pengiriman & Pemblokiran Integrasi' : 'Integration Delivery & Block Logs'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-[#1E222A] text-neutral-600 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                  <tr>
                    <th className="px-3 py-2 font-medium">{isId ? 'Waktu' : 'Time'}</th>
                    <th className="px-3 py-2 font-medium">{isId ? 'Konektor' : 'Connector'}</th>
                    <th className="px-3 py-2 font-medium">Mode / Status</th>
                    <th className="px-3 py-2 font-medium">{isId ? 'Ringkasan Respons' : 'Response Summary'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {integrationLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-5 text-center text-neutral-500">
                        {isId ? 'Belum ada aktivitas pengiriman integrasi.' : 'No integration dispatch logs yet.'}
                      </td>
                    </tr>
                  ) : (
                    integrationLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-3 py-2 font-mono text-[11px] text-neutral-500 whitespace-nowrap">{log.created_at}</td>
                        <td className="px-3 py-2 font-mono font-semibold">{log.connector_code}</td>
                        <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                          <span
                            className={
                              log.status === 'Blocked' || log.status === 'Failed'
                                ? 'text-[#C8102E] dark:text-red-400 font-semibold'
                                : 'text-emerald-700 dark:text-emerald-400 font-semibold'
                            }
                          >
                            {log.direction} · {log.status} {log.http_status ? `(${log.http_status})` : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-neutral-600 dark:text-neutral-300">{log.response_summary || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: SMART ASSET IDENTIFICATION (POIN 55)                           */}
      {/* ===================================================================== */}
      {tab === 'ai' && (
        <div className="space-y-6">
          {/* Admin Kill Switch Governance Bar */}
          <div className={cardClass + ' flex flex-col lg:flex-row lg:items-center justify-between gap-4'}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Kendali Kill Switch & Tata Kelola Smart AI (Poin 55)' : 'Smart AI Admin Kill Switch & Governance'}
                </h3>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {isId
                  ? 'Output AI bersifat rekomendasi saja (Pending Review), wajib persetujuan pengiriman foto ke layanan eksternal, dan tidak pernah menimpa master aset secara otomatis.'
                  : 'AI outputs are recommendations only (Pending Review), require explicit user consent before external Vision OCR, and never overwrite master assets automatically.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
              <button
                type="button"
                disabled={!canManageSettings}
                onClick={() => handleToggleAiSetting('smart_ai_enabled')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono rounded-md border ${
                  aiStatus.smart_ai_enabled
                    ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/25'
                    : 'border-red-300 dark:border-red-900 text-[#C8102E] dark:text-red-400 bg-red-50/60 dark:bg-red-950/30'
                } disabled:opacity-70`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Smart AI: {aiStatus.smart_ai_enabled ? 'AKTIF' : 'NONAKTIF (KILL SWITCH)'}</span>
              </button>
              <button
                type="button"
                disabled={!canManageSettings}
                onClick={() => handleToggleAiSetting('smart_ai_external_allowed')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono rounded-md border ${
                  aiStatus.smart_ai_external_allowed
                    ? 'border-neutral-300 dark:border-neutral-700 text-[#141619] dark:text-neutral-200'
                    : 'border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                } disabled:opacity-70`}
              >
                <span>External Gemini OCR: {aiStatus.smart_ai_external_allowed ? 'ALLOWED' : 'BLOCKED'}</span>
              </button>
              <span className="font-mono text-[11px] text-neutral-500">
                Server Key: {aiStatus.geminiKeyConfigured ? 'Configured' : 'Not Set'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Run Identification Form */}
            {canAiIdentify && (
              <form onSubmit={handleRunIdentification} className={cardClass + ' lg:col-span-5 space-y-3.5'}>
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Analisis Foto Aset & Deteksi Duplikat' : 'Analyze Asset Photo & Deduplication'}
                </h3>

                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Tautkan ke Aset Master (Opsional)' : 'Link to Master Asset (Optional)'}
                  </label>
                  <select value={aiAssetId} onChange={(e) => setAiAssetId(e.target.value)} className={inputClass}>
                    <option value="">-- {isId ? 'Identifikasi Foto Baru / Umum' : 'New / Unlinked Photo'} --</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.asset_code} · {a.asset_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Unggah Foto Label / Perangkat (Lokal Server)' : 'Upload Label / Asset Photo (Local Server)'}
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-neutral-100 dark:bg-[#1E222A] border border-neutral-300 dark:border-neutral-700 rounded-md cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-800">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{aiUploading ? (isId ? 'Mengunggah...' : 'Uploading...') : (isId ? 'Pilih Foto' : 'Choose Photo')}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => handleUploadAiPhoto(e.target.files?.[0])}
                      />
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="/uploads/... atau /src/assets/images/..."
                      value={aiPhotoUrl}
                      onChange={(e) => setAiPhotoUrl(e.target.value)}
                      className={inputClass + ' font-mono'}
                    />
                  </div>
                  {aiPhotoUrl && (
                    <div className="mt-2 border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden bg-neutral-50 dark:bg-[#0F1115] h-32 flex items-center justify-center">
                      <img src={aiPhotoUrl} alt="Asset preview" className="max-h-full object-contain" />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Mode Analisis' : 'Analysis Mode'}
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 p-2.5 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="aiMode"
                        checked={aiMode === 'local_dedup_similarity'}
                        onChange={() => setAiMode('local_dedup_similarity')}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-semibold text-[#141619] dark:text-neutral-100">
                          Local SHA-256 Deduplication &amp; Similarity (Offline / Zero External Transfer)
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {isId
                            ? 'Deteksi foto duplikat lintas aset via SHA-256 lokal & kemiripan metadata tanpa mengirim gambar ke luar server.'
                            : 'Detects cross-asset duplicate photos via local SHA-256 & metadata similarity without external transfer.'}
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 p-2.5 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer text-xs">
                      <input
                        type="radio"
                        name="aiMode"
                        checked={aiMode === 'gemini_vision_ocr'}
                        onChange={() => setAiMode('gemini_vision_ocr')}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-semibold text-[#141619] dark:text-neutral-100">
                          Gemini Vision OCR &amp; Spec Extraction (Opt-in Server Proxy)
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {isId
                            ? 'Ekstraksi nomor seri, label barang, merek, model, spesifikasi, & rekomendasi kategori dari foto.'
                            : 'Extracts serial number, asset label, brand, model, specs, and category recommendation from photo.'}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                    {isId ? 'Petunjuk Kata Kunci / Teks Label (Opsional)' : 'Keyword / Label Hint (Optional)'}
                  </label>
                  <input
                    type="text"
                    placeholder={isId ? 'Misal: Dell Latitude 7450 / Printer Lexmark' : 'E.g. Dell Latitude 7450 / Lexmark Printer'}
                    value={aiHintText}
                    onChange={(e) => setAiHintText(e.target.value)}
                    className={inputClass}
                  />
                </div>

                {aiMode === 'gemini_vision_ocr' && (
                  <label className="flex items-start gap-2 p-3 border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/25 rounded-md text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiExternalConsent}
                      onChange={(e) => setAiExternalConsent(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-amber-900 dark:text-amber-200">
                      {isId
                        ? 'Saya mengonfirmasi bahwa foto ini tidak mengandung rahasia sensitif terlarang dan menyetujui pengiriman ke layanan Gemini Vision eksternal (hanya sebagai rekomendasi).'
                        : 'I confirm this photo contains no restricted sensitive secrets and consent to sending it to external Gemini Vision (recommendations only).'}
                    </span>
                  </label>
                )}

                <button
                  type="submit"
                  disabled={!aiStatus.smart_ai_enabled || aiRunning || !aiPhotoUrl}
                  className="w-full py-2.5 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md disabled:opacity-50"
                >
                  {aiRunning
                    ? isId
                      ? 'Menganalisis...'
                      : 'Analyzing...'
                    : isId
                    ? 'Jalankan Identifikasi (Pending Review)'
                    : 'Run Identification (Pending Review)'}
                </button>
              </form>
            )}

            {/* Identification Verification Queue */}
            <div className={cardClass + (canAiIdentify ? ' lg:col-span-7' : ' lg:col-span-12')}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {isId ? 'Antrean Verifikasi Rekomendasi Smart AI' : 'Smart AI Recommendation Verification Queue'}
                </h3>
                <button
                  type="button"
                  onClick={() => loadAi()}
                  className="p-1.5 text-neutral-500 hover:text-[#141619] dark:hover:text-white rounded"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-3">
                {aiIdentifications.length === 0 ? (
                  <div className="py-10 text-center text-xs text-neutral-500">
                    {isId ? 'Belum ada hasil identifikasi Smart AI.' : 'No Smart AI identifications recorded yet.'}
                  </div>
                ) : (
                  aiIdentifications.map((row) => {
                    let dupes: any[] = [];
                    let sims: any[] = [];
                    try {
                      dupes = JSON.parse(row.duplicate_matches_json || '[]');
                    } catch {
                      dupes = [];
                    }
                    try {
                      sims = JSON.parse(row.similarity_matches_json || '[]');
                    } catch {
                      sims = [];
                    }

                    return (
                      <div key={row.id} className="p-3.5 border border-neutral-200 dark:border-neutral-800 rounded-md space-y-2.5 text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <img
                              src={row.source_photo_url}
                              alt={row.identification_code}
                              className="w-12 h-12 object-cover rounded border border-neutral-200 dark:border-neutral-700 shrink-0"
                            />
                            <div>
                              <div className="font-mono font-bold text-[#141619] dark:text-neutral-100">
                                {row.identification_code}
                                <span className="font-normal text-neutral-500"> · {row.analysis_mode}</span>
                              </div>
                              <div className="text-[11px] text-neutral-500">
                                {row.asset_code ? `${row.asset_code} · ${row.asset_name}` : isId ? 'Belum tertaut ke master aset' : 'Unlinked asset'}
                                {' · '}SHA256: <span className="font-mono">{row.photo_sha256?.slice(0, 12) || '-'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="font-mono font-semibold text-[11px] whitespace-nowrap">
                            <span
                              className={
                                row.verification_status === 'Applied' || row.verification_status === 'Accepted'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : row.verification_status === 'Rejected'
                                  ? 'text-[#C8102E] dark:text-red-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }
                            >
                              {row.verification_status}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1 border-t border-neutral-100 dark:border-neutral-800">
                          <div>
                            <span className="text-neutral-500">Serial OCR:</span>{' '}
                            <span className="font-mono font-semibold">{row.extracted_serial_number || '-'}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500">Brand / Model:</span>{' '}
                            <span className="font-semibold">{[row.extracted_brand, row.extracted_model].filter(Boolean).join(' ') || '-'}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500">{isId ? 'Rek. Kategori:' : 'Rec. Category:'}</span>{' '}
                            <span className="font-semibold">{row.recommended_category_name || '-'}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500">{isId ? 'Duplikat Foto:' : 'Photo Dupes:'}</span>{' '}
                            <span className={`font-mono font-semibold ${dupes.length > 0 ? 'text-[#C8102E] dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                              {dupes.length} {isId ? 'aset' : 'assets'}
                            </span>
                          </div>
                        </div>

                        {dupes.length > 0 && (
                          <div className="text-[11px] text-[#C8102E] dark:text-red-300 bg-red-50/70 dark:bg-red-950/25 px-2.5 py-1.5 rounded">
                            <ShieldAlert className="w-3.5 h-3.5 inline mr-1" />
                            {isId ? 'Duplikat foto terdeteksi pada: ' : 'Duplicate photo detected on: '}
                            {dupes.map((d) => `${d.asset_code} (${d.match_type})`).join(', ')}
                          </div>
                        )}

                        {sims.length > 0 && (
                          <div className="text-[11px] text-neutral-600 dark:text-neutral-400">
                            {isId ? 'Aset mirip: ' : 'Similar assets: '}
                            {sims
                              .slice(0, 3)
                              .map((s) => `${s.asset_code} (${s.asset_name})`)
                              .join(' · ')}
                          </div>
                        )}

                        {canAiVerify && row.verification_status !== 'Applied' && (
                          <div className="flex flex-wrap justify-end gap-2 pt-1">
                            {row.verification_status === 'Pending Review' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleVerifyDecision(row, 'Reject')}
                                  className="px-2.5 py-1 text-[11px] font-medium border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                >
                                  {isId ? 'Tolak' : 'Reject'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleVerifyDecision(row, 'Accept')}
                                  className="px-2.5 py-1 text-[11px] font-medium border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                >
                                  {isId ? 'Terima Catatan' : 'Accept Only'}
                                </button>
                              </>
                            )}
                            {canEditAssets && (
                              <button
                                type="button"
                                onClick={() => openApplyModal(row)}
                                className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-semibold bg-[#141619] dark:bg-[#C8102E] text-white rounded hover:bg-[#C8102E]"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{isId ? 'Konfirmasi & Terapkan ke Master' : 'Confirm & Apply to Master'}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Human-in-the-Loop Apply Confirmation Modal */}
      {applyTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setApplyTarget(null)}
        >
          <form
            onSubmit={handleConfirmApplyToMaster}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-lg w-full overflow-hidden shadow-xl"
          >
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <div>
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">
                  Human-in-the-Loop Confirmation · {applyTarget.identification_code}
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  {isId ? 'Pilih field yang diverifikasi untuk diterapkan ke master aset.' : 'Select verified fields to apply to the master asset.'}
                </div>
              </div>
              <button type="button" onClick={() => setApplyTarget(null)} className="p-1 text-neutral-500 hover:text-[#141619] dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs max-h-[75vh] overflow-y-auto">
              <div>
                <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                  {isId ? 'Aset Master Target *' : 'Target Master Asset *'}
                </label>
                <select required value={applyAssetId} onChange={(e) => setApplyAssetId(e.target.value)} className={inputClass}>
                  <option value="">-- {isId ? 'Pilih Aset Target' : 'Select Target Asset'} --</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.asset_code} · {a.asset_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-2">
                {(
                  [
                    ['serial_number', 'Serial Number'],
                    ['brand', 'Brand'],
                    ['model', 'Model'],
                    ['specification', isId ? 'Spesifikasi' : 'Specification'],
                  ] as const
                ).map(([fieldKey, label]) => (
                  <div key={fieldKey} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={applyFields[fieldKey]}
                      onChange={(e) => setApplyFields((p) => ({ ...p, [fieldKey]: e.target.checked }))}
                    />
                    <span className="w-24 text-[11px] text-neutral-500 shrink-0">{label}</span>
                    <input
                      type="text"
                      value={applyOverrides[fieldKey]}
                      onChange={(e) => setApplyOverrides((p) => ({ ...p, [fieldKey]: e.target.value }))}
                      placeholder="-"
                      className={inputClass}
                    />
                  </div>
                ))}

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={applyFields.category_id}
                    onChange={(e) => setApplyFields((p) => ({ ...p, category_id: e.target.checked }))}
                  />
                  <span className="w-24 text-[11px] text-neutral-500 shrink-0">{isId ? 'Kategori' : 'Category'}</span>
                  <select
                    value={applyOverrides.category_id}
                    onChange={(e) => setApplyOverrides((p) => ({ ...p, category_id: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">-- {isId ? 'Pilih Kategori' : 'Select Category'} --</option>
                    {master.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-neutral-600 dark:text-neutral-400 mb-1">
                  {isId ? 'Catatan Verifikator' : 'Verifier Notes'}
                </label>
                <input type="text" value={applyNotes} onChange={(e) => setApplyNotes(e.target.value)} className={inputClass} />
              </div>

              <label className="flex items-start gap-2 p-2.5 border border-neutral-200 dark:border-neutral-700 rounded bg-neutral-50 dark:bg-[#1E222A] cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={applyConfirmCheck}
                  onChange={(e) => setApplyConfirmCheck(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[11px] text-neutral-700 dark:text-neutral-300">
                  {isId
                    ? 'Saya telah memeriksa secara manual hasil ekstraksi AI di atas dan menyetujui pembaruan field terpilih pada master aset (tercatat di ledger SHA-256).'
                    : 'I have manually verified the extracted values above and approve updating the selected master asset fields (logged in SHA-256 ledger).'}
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setApplyTarget(null)} className="px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300">
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={!applyConfirmCheck || !applyAssetId}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{isId ? 'Terapkan ke Master Aset' : 'Apply to Master Asset'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

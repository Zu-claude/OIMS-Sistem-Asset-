import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, dbPath } from './db';
import { verifyAssetEventChain } from './events';
import { isGeminiApiKeyConfigured } from './ai';

export const EXPECTED_SCHEMA_TABLES = 46;

export const BACKUP_ORDERED_TABLES = [
  'holding_groups',
  'companies',
  'divisions',
  'user_org_scopes',
  'categories',
  'subcategories',
  'buildings',
  'floors',
  'rooms',
  'locations',
  'persons',
  'assets',
  'asset_photos',
  'asset_documents',
  'asset_qr_codes',
  'asset_movements',
  'movement_approvals',
  'asset_ownership_history',
  'asset_events',
  'maintenance_records',
  'maintenance_approvals',
  'stock_opname',
  'stock_opname_details',
  'replacement_plans',
  'qr_access_logs',
  'asset_field_captures',
  'asset_reconciliation_findings',
  'retention_policies',
  'record_retention_holds',
  'enterprise_sops',
  'sop_executions',
  'integration_connectors',
  'integration_logs',
  'ai_asset_identifications',
  'dr_backup_verifications',
  'bcp_runbooks',
  'enterprise_acceptance_signoffs',
  'system_settings',
] as const;

interface FolderStats {
  fileCount: number;
  totalBytes: number;
}

function measureDirectoryStats(dirPath: string): FolderStats {
  if (!fs.existsSync(dirPath)) {
    return { fileCount: 0, totalBytes: 0 };
  }
  let fileCount = 0;
  let totalBytes = 0;
  const stack: string[] = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          fileCount += 1;
          totalBytes += stat.size;
        } catch {
          // ignore transient file stat issue
        }
      }
    }
  }
  return { fileCount, totalBytes };
}

function safeFileSize(filePath: string): number {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function getDiskCapacityStats(): { totalBytes: number | null; freeBytes: number | null; usedPct: number | null } {
  try {
    const statFs = (fs as unknown as { statfsSync?: (p: string) => { blocks: number; bavail: number; bsize: number } }).statfsSync;
    if (typeof statFs === 'function') {
      const s = statFs(process.cwd());
      const totalBytes = Number(s.blocks) * Number(s.bsize);
      const freeBytes = Number(s.bavail) * Number(s.bsize);
      if (Number.isFinite(totalBytes) && totalBytes > 0 && Number.isFinite(freeBytes)) {
        const usedPct = Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10;
        return { totalBytes, freeBytes, usedPct };
      }
    }
  } catch {
    // ignore unsupported statfsSync
  }
  return { totalBytes: null, freeBytes: null, usedPct: null };
}

export function collectSystemHealthReport() {
  const quickCheck = String(db.pragma('quick_check', { simple: true }) || 'unknown');
  const fkViolations = (db.pragma('foreign_key_check') as unknown[]).length;
  const tableCount = (
    db
      .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get() as { c: number }
  ).c;

  const dbFileSizeBytes = safeFileSize(dbPath);
  const walFileSizeBytes = safeFileSize(`${dbPath}-wal`);
  const shmFileSizeBytes = safeFileSize(`${dbPath}-shm`);

  const uploadsRoot = path.resolve(process.cwd(), 'uploads');
  const photosStats = measureDirectoryStats(path.join(uploadsRoot, 'photos'));
  const docsStats = measureDirectoryStats(path.join(uploadsRoot, 'docs'));
  const fieldStats = measureDirectoryStats(path.join(uploadsRoot, 'field'));
  const totalUploadsStats = measureDirectoryStats(uploadsRoot);
  const disk = getDiskCapacityStats();

  const assetStats = db
    .prepare(`
      SELECT
        COUNT(*) as total_assets,
        SUM(CASE WHEN asset_status = 'Active' THEN 1 ELSE 0 END) as active_assets,
        SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) as archived_assets,
        SUM(CASE WHEN legal_hold = 1 THEN 1 ELSE 0 END) as legal_hold_assets
      FROM assets
      WHERE deleted_at IS NULL
    `)
    .get() as {
      total_assets: number;
      active_assets: number;
      archived_assets: number;
      legal_hold_assets: number;
    };

  const qrStats = db
    .prepare(`
      SELECT
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active_qr,
        SUM(CASE WHEN status = 'Revoked' THEN 1 ELSE 0 END) as revoked_qr
      FROM asset_qr_codes
    `)
    .get() as { active_qr: number; revoked_qr: number };

  const scanStats24h = db
    .prepare(`
      SELECT
        COUNT(*) as total_scans_24h,
        SUM(CASE WHEN outcome = 'granted' THEN 1 ELSE 0 END) as granted_24h,
        SUM(CASE WHEN outcome IN ('denied', 'forbidden', 'revoked', 'expired', 'public_disabled') THEN 1 ELSE 0 END) as denied_24h,
        SUM(CASE WHEN outcome = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited_24h
      FROM qr_access_logs
      WHERE created_at >= datetime('now', '-24 hours')
    `)
    .get() as {
      total_scans_24h: number;
      granted_24h: number;
      denied_24h: number;
      rate_limited_24h: number;
    };

  const mediaCounts = {
    assetPhotosRecords: (db.prepare('SELECT COUNT(*) as c FROM asset_photos').get() as { c: number }).c,
    assetDocumentsRecords: (db.prepare('SELECT COUNT(*) as c FROM asset_documents').get() as { c: number }).c,
    fieldCapturesRecords: (db.prepare('SELECT COUNT(*) as c FROM asset_field_captures').get() as { c: number }).c,
  };

  const failedIntegrations7d = (
    db
      .prepare("SELECT COUNT(*) as c FROM integration_logs WHERE status IN ('Blocked', 'Failed') AND created_at >= datetime('now', '-7 days')")
      .get() as { c: number }
  ).c;

  const failedAuthOrUpload7d = (
    db
      .prepare(`
        SELECT COUNT(*) as c FROM audit_logs
        WHERE created_at >= datetime('now', '-7 days')
          AND (action LIKE '%FAILED%' OR action LIKE '%LOCKED%' OR action LIKE '%REJECTED%' OR action LIKE '%DENIED%')
      `)
      .get() as { c: number }
  ).c;

  const openReconciliationFindings = (
    db
      .prepare("SELECT COUNT(*) as c FROM asset_reconciliation_findings WHERE resolution_status IN ('Open', 'In Review')")
      .get() as { c: number }
  ).c;

  const sopDeviations7d = (
    db
      .prepare("SELECT COUNT(*) as c FROM sop_executions WHERE compliance_status = 'Deviation' AND signed_off_at >= datetime('now', '-7 days')")
      .get() as { c: number }
  ).c;

  const eventChain = verifyAssetEventChain(null);

  const settingsRows = db
    .prepare("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('smart_ai_enabled', 'bcp_rpo_target_minutes', 'bcp_rto_target_minutes', 'backup_retention_count')")
    .all() as { setting_key: string; setting_value: string }[];
  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.setting_key, r.setting_value]));

  const mem = process.memoryUsage();

  return {
    collectedAt: new Date().toISOString(),
    overallStatus:
      quickCheck.toLowerCase() === 'ok' && fkViolations === 0 && eventChain.valid && tableCount === EXPECTED_SCHEMA_TABLES
        ? 'Healthy'
        : 'Attention Required',
    database: {
      engine: 'SQLite (WAL Mode)',
      quickCheck,
      foreignKeyViolations: fkViolations,
      tableCount,
      expectedTableCount: EXPECTED_SCHEMA_TABLES,
      dbFileSizeBytes,
      walFileSizeBytes,
      shmFileSizeBytes,
      totalDbBytes: dbFileSizeBytes + walFileSizeBytes + shmFileSizeBytes,
    },
    storage: {
      uploadsFileCount: totalUploadsStats.fileCount,
      uploadsTotalBytes: totalUploadsStats.totalBytes,
      photosFileCount: photosStats.fileCount,
      photosBytes: photosStats.totalBytes,
      docsFileCount: docsStats.fileCount,
      docsBytes: docsStats.totalBytes,
      fieldFileCount: fieldStats.fileCount,
      fieldBytes: fieldStats.totalBytes,
      diskTotalBytes: disk.totalBytes,
      diskFreeBytes: disk.freeBytes,
      diskUsedPct: disk.usedPct,
    },
    operations: {
      totalAssets: assetStats.total_assets || 0,
      activeAssets: assetStats.active_assets || 0,
      archivedAssets: assetStats.archived_assets || 0,
      legalHoldAssets: assetStats.legal_hold_assets || 0,
      activeQrCodes: qrStats.active_qr || 0,
      revokedQrCodes: qrStats.revoked_qr || 0,
      qrScans24h: scanStats24h.total_scans_24h || 0,
      qrGranted24h: scanStats24h.granted_24h || 0,
      qrDenied24h: scanStats24h.denied_24h || 0,
      qrRateLimited24h: scanStats24h.rate_limited_24h || 0,
      ...mediaCounts,
      failedIntegrations7d,
      failedAuthOrUpload7d,
      openReconciliationFindings,
      sopDeviations7d,
      eventChainValid: eventChain.valid,
      eventChainCheckedCount: eventChain.checkedCount,
      brokenEventId: eventChain.brokenEventId,
    },
    runtime: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
      rpoTargetMinutes: Number(settingsMap.bcp_rpo_target_minutes || 15),
      rtoTargetMinutes: Number(settingsMap.bcp_rto_target_minutes || 60),
      backupRetentionCount: Number(settingsMap.backup_retention_count || 14),
    },
    // Strict security rule: expose boolean readiness flags only — NEVER expose raw keys, tokens, hosts, or passwords
    readiness: {
      googleCloudConnected: false,
      localSelfContainedStorage: true,
      envPasscodeConfigured: Boolean((process.env.OIMS_ADMIN_PASSCODE || '').trim()),
      smtpConfigured: Boolean((process.env.SMTP_HOST || '').trim() && (process.env.SMTP_USER || '').trim()),
      geminiApiKeyConfigured: isGeminiApiKeyConfigured(),
      smartAiKillSwitchEnabled: settingsMap.smart_ai_enabled === 'true',
    },
  };
}

export function runDrIntegrityVerification() {
  const startedMs = Date.now();
  const integrityRows = db.pragma('integrity_check') as { integrity_check: string }[];
  const integrityStatus = integrityRows.map((r) => r.integrity_check).join('; ');
  const integrityOk = integrityRows.length === 1 && integrityRows[0]?.integrity_check?.toLowerCase() === 'ok';

  const fkRows = db.pragma('foreign_key_check') as unknown[];
  const eventChain = verifyAssetEventChain(null);

  const uploadsBase = path.resolve(process.cwd(), 'uploads');
  const uploadUrls = db
    .prepare(`
      SELECT 'asset_primary' as source, id, primary_photo_url as url FROM assets WHERE deleted_at IS NULL AND primary_photo_url LIKE '/uploads/%'
      UNION ALL
      SELECT 'asset_photo' as source, id, file_url as url FROM asset_photos WHERE file_url LIKE '/uploads/%'
      UNION ALL
      SELECT 'asset_document' as source, id, file_url as url FROM asset_documents WHERE file_url LIKE '/uploads/%'
    `)
    .all() as { source: string; id: number; url: string }[];

  const missingFiles: { source: string; id: number; url: string }[] = [];
  for (const item of uploadUrls) {
    const cleanRel = String(item.url || '').replace(/^\/uploads\//, '').split('?')[0];
    if (!cleanRel || cleanRel.includes('..') || cleanRel.includes('\0')) {
      missingFiles.push(item);
      continue;
    }
    const resolved = path.resolve(uploadsBase, cleanRel);
    if (!resolved.startsWith(uploadsBase + path.sep) || !fs.existsSync(resolved)) {
      missingFiles.push(item);
    }
  }

  const tableCount = (
    db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as { c: number }
  ).c;
  const totalRecords = (
    db.prepare('SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL').get() as { c: number }
  ).c + eventChain.checkedCount;

  const status: 'Passed' | 'Warning' | 'Failed' =
    !integrityOk || fkRows.length > 0 || !eventChain.valid
      ? 'Failed'
      : missingFiles.length > 0
      ? 'Warning'
      : 'Passed';

  const durationMs = Math.max(1, Date.now() - startedMs);

  return {
    status,
    tableCount,
    recordCount: totalRecords,
    integrityOk,
    integrityStatus,
    foreignKeyViolations: fkRows.length,
    eventChainValid: eventChain.valid,
    eventChainCheckedCount: eventChain.checkedCount,
    checkedUploadFiles: uploadUrls.length,
    missingUploadFiles: missingFiles,
    durationMs,
    summary:
      status === 'Passed'
        ? `PRAGMA integrity_check OK, 0 pelanggaran FK, ${eventChain.checkedCount} event ledger valid, ${uploadUrls.length} berkas upload terverifikasi.`
        : status === 'Warning'
        ? `DB & hash chain valid, namun ${missingFiles.length} berkas referensi /uploads/ tidak ditemukan di disk.`
        : `Pemeriksaan integritas gagal: integrity=${integrityStatus}, FK=${fkRows.length}, chainValid=${eventChain.valid}.`,
  };
}

export function verifySnapshotPayloadDryRun(snapshotInput?: { version?: string; tables?: Record<string, unknown> } | null) {
  let version = 'OIMS-2027.4-FASE4';
  let tablesObj: Record<string, unknown[]> = {};
  let mode: 'snapshot_dry_run' | 'backup_export_check' = 'backup_export_check';

  if (snapshotInput && snapshotInput.tables && typeof snapshotInput.tables === 'object') {
    mode = 'snapshot_dry_run';
    version = String(snapshotInput.version || 'Unknown');
    tablesObj = snapshotInput.tables as Record<string, unknown[]>;
  } else {
    for (const t of BACKUP_ORDERED_TABLES) {
      tablesObj[t] = db.prepare(`SELECT * FROM ${t}`).all();
    }
  }

  const missingTables: string[] = [];
  const invalidTables: string[] = [];
  let totalRecords = 0;
  let presentTables = 0;

  for (const t of BACKUP_ORDERED_TABLES) {
    const val = tablesObj[t];
    if (val === undefined) {
      missingTables.push(t);
    } else if (!Array.isArray(val)) {
      invalidTables.push(t);
    } else {
      presentTables += 1;
      totalRecords += val.length;
    }
  }

  const serialized = JSON.stringify({ version, tables: tablesObj });
  const snapshotSha256 = crypto.createHash('sha256').update(serialized).digest('hex');

  const status: 'Passed' | 'Warning' | 'Failed' =
    invalidTables.length > 0 || !tablesObj.assets || !tablesObj.companies
      ? 'Failed'
      : missingTables.length > 0
      ? 'Warning'
      : 'Passed';

  return {
    verificationType: mode,
    backupVersion: version,
    snapshotSha256,
    presentTables,
    expectedBackupTables: BACKUP_ORDERED_TABLES.length,
    totalRecords,
    missingTables,
    invalidTables,
    status,
    summary:
      status === 'Passed'
        ? `Dry-run snapshot ${version} valid (${presentTables}/${BACKUP_ORDERED_TABLES.length} tabel, ${totalRecords} baris, SHA-256 ${snapshotSha256.slice(0, 12)}...).`
        : status === 'Warning'
        ? `Snapshot ${version} terbaca (${totalRecords} baris), namun ${missingTables.length} tabel opsional/baru belum ada di file snapshot.`
        : `Format snapshot tidak valid: ${invalidTables.join(', ') || 'tabel inti assets/companies tidak ditemukan'}.`,
  };
}

export interface QualityGateCheckItem {
  key: string;
  title: string;
  status: 'Passed' | 'Warning' | 'Failed';
  detail: string;
}

export function runEnterpriseQualityGate() {
  const health = collectSystemHealthReport();
  const checks: QualityGateCheckItem[] = [];

  // 1. Schema Completeness
  checks.push({
    key: 'schema_completeness',
    title: 'Kelengkapan Skema Database Relasional (46 Tabel)',
    status: health.database.tableCount === EXPECTED_SCHEMA_TABLES ? 'Passed' : 'Failed',
    detail: `Terdeteksi ${health.database.tableCount} dari ${EXPECTED_SCHEMA_TABLES} tabel target di SQLite.`,
  });

  // 2. Database Integrity & Foreign Keys
  checks.push({
    key: 'db_integrity_fk',
    title: 'Integritas SQLite & Referential Foreign Keys',
    status: health.database.quickCheck.toLowerCase() === 'ok' && health.database.foreignKeyViolations === 0 ? 'Passed' : 'Failed',
    detail: `quick_check=${health.database.quickCheck}, foreign_key_violations=${health.database.foreignKeyViolations}.`,
  });

  // 3. Immutable Asset Event Hash Chain
  checks.push({
    key: 'event_hash_chain',
    title: 'Integritas Hash-Chain SHA-256 Asset Event Ledger',
    status: health.operations.eventChainValid ? 'Passed' : 'Failed',
    detail: health.operations.eventChainValid
      ? `${health.operations.eventChainCheckedCount} event ledger terverifikasi berantai tanpa celah.`
      : `Kerusakan rantai terdeteksi pada event ID ${health.operations.brokenEventId}.`,
  });

  // 4. Multi-Company & Org Scope Isolation
  const orphanCompanyAssets = (
    db.prepare('SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL AND (company_id IS NULL OR company_id NOT IN (SELECT id FROM companies))').get() as { c: number }
  ).c;
  const orgScopeCount = (db.prepare('SELECT COUNT(*) as c FROM user_org_scopes').get() as { c: number }).c;
  checks.push({
    key: 'multi_company_isolation',
    title: 'Isolasi Multi-Perusahaan & Cakupan Organisasi',
    status: orphanCompanyAssets === 0 && orgScopeCount > 0 ? 'Passed' : 'Failed',
    detail: `aset_tanpa_perusahaan=${orphanCompanyAssets}, cakupan_pengguna_terdaftar=${orgScopeCount}.`,
  });

  // 5. QR Privacy & Anti-Enumeration Protection
  const qrWithoutSlug = (
    db.prepare("SELECT COUNT(*) as c FROM asset_qr_codes WHERE status = 'Active' AND (public_slug IS NULL OR trim(public_slug) = '')").get() as { c: number }
  ).c;
  checks.push({
    key: 'qr_privacy_control',
    title: 'Kontrol Privasi QR 3-Tier & Anti-Enumerasi Slug',
    status: qrWithoutSlug === 0 ? 'Passed' : 'Failed',
    detail: `qr_aktif=${health.operations.activeQrCodes}, qr_tanpa_public_slug=${qrWithoutSlug}.`,
  });

  // 6. Retention & Immutable Ledger Lock
  const unlockedLedgers = (
    db.prepare("SELECT COUNT(*) as c FROM retention_policies WHERE record_class IN ('asset_events', 'audit_logs') AND is_immutable_ledger = 0").get() as { c: number }
  ).c;
  checks.push({
    key: 'retention_ledger_lock',
    title: 'Penguncian Retensi Ledger & Legal Hold',
    status: unlockedLedgers === 0 ? 'Passed' : 'Failed',
    detail: `unlocked_immutable_ledgers=${unlockedLedgers}, aset_legal_hold_aktif=${health.operations.legalHoldAssets}.`,
  });

  // 7. Integration Kill Switch & Zero Secret Exposure
  const oimsSqlExists = fs.existsSync(path.resolve(process.cwd(), 'database', 'oims.sql'));
  const installPhpExists = fs.existsSync(path.resolve(process.cwd(), 'database', 'install.php'));
  const recentDrPass = (
    db.prepare("SELECT COUNT(*) as c FROM dr_backup_verifications WHERE status = 'Passed'").get() as { c: number }
  ).c;

  checks.push({
    key: 'local_storage_no_google',
    title: 'Penyimpanan Lokal Mandiri & Bebas Google Cloud',
    status: !health.readiness.googleCloudConnected && oimsSqlExists && installPhpExists ? 'Passed' : 'Failed',
    detail: `googleCloudConnected=false, oims.sql=${oimsSqlExists ? 'ada' : 'hilang'}, install.php=${installPhpExists ? 'ada' : 'hilang'}, berkas_upload=${health.storage.uploadsFileCount}.`,
  });

  // 8. DR Verification & BCP Readiness
  const testedRunbooks = (
    db.prepare("SELECT COUNT(*) as c FROM bcp_runbooks WHERE last_test_status = 'Passed'").get() as { c: number }
  ).c;
  checks.push({
    key: 'dr_bcp_readiness',
    title: 'Kesiapan Disaster Recovery & Uji BCP',
    status: recentDrPass > 0 && testedRunbooks > 0 ? 'Passed' : 'Warning',
    detail: `verifikasi_dr_lulus=${recentDrPass}, runbook_bcp_teruji=${testedRunbooks}/3.`,
  });

  const passedCount = checks.filter((c) => c.status === 'Passed').length;
  const failedCount = checks.filter((c) => c.status === 'Failed').length;
  const overallStatus: 'Passed' | 'Conditional' | 'Failed' =
    failedCount > 0 ? 'Failed' : passedCount === checks.length ? 'Passed' : 'Conditional';

  return {
    evaluatedAt: new Date().toISOString(),
    releaseTag: 'OIMS-2027.4-FASE4',
    overallStatus,
    checksPassed: passedCount,
    checksTotal: checks.length,
    checks,
  };
}

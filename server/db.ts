import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const dbPath = path.join(dataDir, 'oims.db');

function backupCorruptDatabaseFiles() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, `corrupt_backup_${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const fileName of ['oims.db', 'oims.db-wal', 'oims.db-shm']) {
    const src = path.join(dataDir, fileName);
    if (fs.existsSync(src)) {
      fs.renameSync(src, path.join(backupDir, fileName));
    }
  }
  console.warn(`[OIMS DB] Detected malformed SQLite database; archived old files to ${backupDir} and reinitialized.`);
}

function openAndVerifyDatabase(): Database.Database {
  let instance: Database.Database | null = null;
  try {
    instance = new Database(dbPath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    const checkResult = String(instance.pragma('quick_check', { simple: true }) || '').toLowerCase();
    if (checkResult !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${checkResult}`);
    }
    return instance;
  } catch (err: any) {
    if (instance) {
      try {
        instance.close();
      } catch {
        // ignore close error on corrupt handle
      }
    }
    const msg = String(err?.message || '');
    const code = String(err?.code || '');
    if (
      code === 'SQLITE_CORRUPT' ||
      code === 'SQLITE_NOTADB' ||
      msg.includes('malformed') ||
      msg.includes('quick_check failed')
    ) {
      backupCorruptDatabaseFiles();
      const fresh = new Database(dbPath);
      fresh.pragma('journal_mode = WAL');
      fresh.pragma('foreign_keys = ON');
      return fresh;
    }
    throw err;
  }
}

export const db = openAndVerifyDatabase();

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT,
      department TEXT,
      position_title TEXT,
      password_hash TEXT,
      avatar_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER,
      updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      department TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      default_useful_life_years INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      level_number INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      room_code TEXT,
      FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      building_id INTEGER NOT NULL,
      floor_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      specific_location TEXT NOT NULL,
      location_code TEXT NOT NULL UNIQUE,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE RESTRICT,
      FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE RESTRICT,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nik_nip TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      company_id INTEGER NOT NULL,
      division_id INTEGER NOT NULL,
      department TEXT,
      position_title TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_code TEXT NOT NULL UNIQUE,
      asset_name TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      subcategory_id INTEGER,
      brand TEXT,
      model TEXT,
      serial_number TEXT,
      description TEXT,
      specification TEXT,
      acquisition_date TEXT NOT NULL,
      acquisition_value REAL NOT NULL DEFAULT 0,
      supplier TEXT,
      purchase_reference TEXT,
      warranty_period_months INTEGER DEFAULT 12,
      acquisition_source TEXT DEFAULT 'CAPEX Purchase',
      company_id INTEGER NOT NULL,
      division_id INTEGER NOT NULL,
      department TEXT,
      location_id INTEGER NOT NULL,
      pic_id INTEGER,
      condition_status TEXT NOT NULL DEFAULT 'Good' CHECK (condition_status IN ('Good', 'Minor Damage', 'Major Damage', 'Unserviceable')),
      asset_status TEXT NOT NULL DEFAULT 'Active' CHECK (asset_status IN ('Active', 'In Maintenance', 'Pending Transfer', 'Missing', 'Disposed')),
      primary_photo_url TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER,
      updated_by INTEGER,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
      FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE SET NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (pic_id) REFERENCES persons(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assets_code ON assets(asset_code);
    CREATE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial_number);
    CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location_id);
    CREATE INDEX IF NOT EXISTS idx_assets_pic ON assets(pic_id);
    CREATE INDEX IF NOT EXISTS idx_assets_condition ON assets(condition_status);
    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);

    CREATE TABLE IF NOT EXISTS asset_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      drive_file_id TEXT,
      drive_web_view_link TEXT,
      mime_type TEXT,
      file_size_bytes INTEGER,
      is_primary INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'Supporting Document',
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      drive_file_id TEXT,
      drive_web_view_link TEXT,
      mime_type TEXT,
      file_size_bytes INTEGER,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL UNIQUE,
      qr_token TEXT NOT NULL UNIQUE,
      public_slug TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Revoked')),
      public_enabled INTEGER NOT NULL DEFAULT 1,
      public_show_photo INTEGER NOT NULL DEFAULT 1,
      public_show_location INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      revoked_at TEXT,
      revoked_by INTEGER,
      revoked_reason TEXT,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      generated_by INTEGER,
      last_scanned_at TEXT,
      scan_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_code TEXT NOT NULL UNIQUE,
      asset_id INTEGER NOT NULL,
      from_location_id INTEGER NOT NULL,
      to_location_id INTEGER NOT NULL,
      from_pic_id INTEGER,
      to_pic_id INTEGER,
      movement_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      officer_user_id INTEGER NOT NULL,
      proof_doc_url TEXT,
      status TEXT NOT NULL DEFAULT 'Pending Approval' CHECK (status IN ('Pending Approval', 'Approved', 'Completed', 'Rejected', 'Cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
      FOREIGN KEY (from_location_id) REFERENCES locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (to_location_id) REFERENCES locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (from_pic_id) REFERENCES persons(id) ON DELETE SET NULL,
      FOREIGN KEY (to_pic_id) REFERENCES persons(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS movement_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_id INTEGER NOT NULL,
      approver_user_id INTEGER NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('Approved', 'Rejected')),
      notes TEXT,
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (movement_id) REFERENCES asset_movements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_code TEXT NOT NULL UNIQUE,
      asset_id INTEGER NOT NULL,
      damage_date TEXT NOT NULL,
      damage_type TEXT NOT NULL,
      issue_description TEXT NOT NULL,
      repair_action TEXT,
      vendor_technician TEXT,
      cost REAL NOT NULL DEFAULT 0,
      completion_date TEXT,
      status TEXT NOT NULL DEFAULT 'Reported' CHECK (status IN ('Reported', 'Waiting Approval', 'In Progress', 'Completed', 'Cancelled')),
      before_photo_url TEXT,
      after_photo_url TEXT,
      reported_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS maintenance_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      maintenance_id INTEGER NOT NULL,
      approver_user_id INTEGER NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('Approved', 'Rejected')),
      notes TEXT,
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (maintenance_id) REFERENCES maintenance_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stock_opname (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opname_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      scheduled_date TEXT NOT NULL,
      location_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'In Progress', 'Completed')),
      conducted_by INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS stock_opname_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opname_id INTEGER NOT NULL,
      asset_id INTEGER,
      scanned_code TEXT NOT NULL,
      expected_location_id INTEGER,
      actual_location_id INTEGER,
      expected_condition TEXT,
      actual_condition TEXT,
      expected_pic_id INTEGER,
      actual_pic_id INTEGER,
      verification_result TEXT NOT NULL CHECK (verification_result IN ('Verified', 'Not Found', 'Location Mismatch', 'Condition Mismatch', 'Unregistered Asset', 'QR Code Missing')),
      notes TEXT,
      gps_latitude REAL,
      gps_longitude REAL,
      gps_accuracy_m REAL,
      field_photo_url TEXT,
      verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_by INTEGER,
      FOREIGN KEY (opname_id) REFERENCES stock_opname(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS replacement_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      assessment_year INTEGER NOT NULL,
      asset_age_years REAL NOT NULL,
      maintenance_count INTEGER NOT NULL DEFAULT 0,
      total_maintenance_cost REAL NOT NULL DEFAULT 0,
      priority_level TEXT NOT NULL CHECK (priority_level IN ('Normal', 'Monitor', 'Repair Required', 'Replacement Recommended', 'Urgent Replacement')),
      estimated_replacement_cost REAL NOT NULL DEFAULT 0,
      planned_quarter TEXT DEFAULT 'Q1',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned', 'Approved', 'Procured', 'Deferred')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      dedupe_key TEXT UNIQUE,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      request_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS holding_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_org_scopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      scope_level TEXT NOT NULL CHECK (scope_level IN ('holding', 'company', 'division')),
      holding_id INTEGER,
      company_id INTEGER,
      division_id INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (holding_id) REFERENCES holding_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_uos_user ON user_org_scopes(user_id);
    CREATE INDEX IF NOT EXISTS idx_uos_company ON user_org_scopes(company_id);

    CREATE TABLE IF NOT EXISTS asset_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uuid TEXT NOT NULL UNIQUE,
      company_id INTEGER NOT NULL,
      asset_id INTEGER,
      qr_id INTEGER,
      event_type TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_username TEXT,
      reference_type TEXT,
      reference_id TEXT,
      reason TEXT,
      previous_state_json TEXT,
      new_state_json TEXT,
      prev_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_asset_events_company ON asset_events(company_id);
    CREATE INDEX IF NOT EXISTS idx_asset_events_asset ON asset_events(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_events_type ON asset_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_asset_events_created ON asset_events(created_at);

    CREATE TABLE IF NOT EXISTS asset_ownership_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      from_company_id INTEGER,
      to_company_id INTEGER NOT NULL,
      from_division_id INTEGER,
      to_division_id INTEGER NOT NULL,
      from_custodian_person_id INTEGER,
      to_custodian_person_id INTEGER,
      movement_id INTEGER,
      changed_by_user_id INTEGER,
      reason TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (from_company_id) REFERENCES companies(id) ON DELETE SET NULL,
      FOREIGN KEY (to_company_id) REFERENCES companies(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_aoh_asset ON asset_ownership_history(asset_id);

    CREATE TABLE IF NOT EXISTS qr_access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qr_id INTEGER,
      asset_id INTEGER,
      token_attempted TEXT NOT NULL,
      access_tier TEXT NOT NULL CHECK (access_tier IN ('public', 'authenticated', 'administrative', 'denied')),
      outcome TEXT NOT NULL CHECK (outcome IN ('granted', 'revoked', 'expired', 'not_found', 'rate_limited', 'forbidden', 'public_disabled')),
      user_id INTEGER,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (qr_id) REFERENCES asset_qr_codes(id) ON DELETE SET NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_qral_qr ON qr_access_logs(qr_id);
    CREATE INDEX IF NOT EXISTS idx_qral_created ON qr_access_logs(created_at);

    CREATE TABLE IF NOT EXISTS asset_field_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      qr_id INTEGER,
      opname_id INTEGER,
      captured_by_user_id INTEGER,
      capture_context TEXT NOT NULL DEFAULT 'field_scan',
      latitude REAL,
      longitude REAL,
      accuracy_meters REAL,
      photo_url TEXT,
      condition_observed TEXT,
      notes TEXT,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (qr_id) REFERENCES asset_qr_codes(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_afc_asset ON asset_field_captures(asset_id);
    CREATE INDEX IF NOT EXISTS idx_afc_company ON asset_field_captures(company_id);

    CREATE TABLE IF NOT EXISTS asset_reconciliation_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_code TEXT NOT NULL UNIQUE,
      company_id INTEGER NOT NULL,
      opname_id INTEGER,
      asset_id INTEGER,
      scanned_code TEXT,
      reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN (
        'MATCHED',
        'LOCATION_MISMATCH',
        'CONDITION_MISMATCH',
        'UNIDENTIFIED_ASSET',
        'MISSING_ASSET',
        'DUPLICATE_SUSPECTED',
        'INCOMPLETE_DATA',
        'QR_MISMATCH',
        'PENDING_REVIEW'
      )),
      priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
      title TEXT NOT NULL,
      discrepancy_summary TEXT NOT NULL,
      expected_snapshot_json TEXT,
      observed_snapshot_json TEXT,
      evidence_photo_url TEXT,
      gps_latitude REAL,
      gps_longitude REAL,
      assigned_to_user_id INTEGER,
      resolution_status TEXT NOT NULL DEFAULT 'Open' CHECK (resolution_status IN ('Open', 'In Review', 'Resolved', 'Dismissed')),
      resolution_notes TEXT,
      master_updated INTEGER NOT NULL DEFAULT 0,
      resolved_by_user_id INTEGER,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (opname_id) REFERENCES stock_opname(id) ON DELETE SET NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_arf_company ON asset_reconciliation_findings(company_id);
    CREATE INDEX IF NOT EXISTS idx_arf_status ON asset_reconciliation_findings(reconciliation_status);

    CREATE TABLE IF NOT EXISTS retention_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_code TEXT NOT NULL UNIQUE,
      record_class TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      retention_days INTEGER NOT NULL DEFAULT 1825,
      action_mode TEXT NOT NULL CHECK (action_mode IN ('immutable_retain', 'archive_record', 'purge_non_ledger')),
      is_immutable_ledger INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_evaluated_at TEXT,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS record_retention_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hold_code TEXT NOT NULL UNIQUE,
      company_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      hold_reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Released')),
      placed_by_user_id INTEGER,
      placed_at TEXT NOT NULL DEFAULT (datetime('now')),
      released_by_user_id INTEGER,
      released_at TEXT,
      release_notes TEXT,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rrh_asset ON record_retention_holds(asset_id);
    CREATE INDEX IF NOT EXISTS idx_rrh_company ON record_retention_holds(company_id);

    CREATE TABLE IF NOT EXISTS enterprise_sops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sop_code TEXT NOT NULL UNIQUE,
      company_id INTEGER,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      mandatory_module TEXT NOT NULL,
      checklist_json TEXT NOT NULL,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sop_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_code TEXT NOT NULL UNIQUE,
      sop_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      asset_id INTEGER,
      module_context TEXT NOT NULL,
      executed_by_user_id INTEGER NOT NULL,
      checklist_results_json TEXT NOT NULL,
      compliance_status TEXT NOT NULL CHECK (compliance_status IN ('Compliant', 'Deviation')),
      deviation_notes TEXT,
      signed_off_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sop_id) REFERENCES enterprise_sops(id) ON DELETE RESTRICT,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sopex_company ON sop_executions(company_id);
    CREATE INDEX IF NOT EXISTS idx_sopex_sop ON sop_executions(sop_id);

    CREATE TABLE IF NOT EXISTS integration_connectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connector_code TEXT NOT NULL UNIQUE,
      company_id INTEGER,
      name TEXT NOT NULL,
      connector_type TEXT NOT NULL CHECK (connector_type IN ('erp_sync', 'hris_sync', 'procurement_sync', 'webhook')),
      endpoint_url TEXT NOT NULL,
      auth_scheme TEXT NOT NULL DEFAULT 'Bearer Env' CHECK (auth_scheme IN ('None', 'Bearer Env', 'HMAC Header')),
      env_secret_ref TEXT,
      data_classification TEXT NOT NULL DEFAULT 'Internal' CHECK (data_classification IN ('Public', 'Internal', 'Confidential')),
      is_enabled INTEGER NOT NULL DEFAULT 0,
      last_test_status TEXT,
      last_tested_at TEXT,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS integration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connector_id INTEGER NOT NULL,
      company_id INTEGER,
      direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'dry_run')),
      status TEXT NOT NULL CHECK (status IN ('Success', 'DryRun', 'Blocked', 'Failed')),
      http_status INTEGER,
      request_summary TEXT,
      response_summary TEXT,
      triggered_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (connector_id) REFERENCES integration_connectors(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ilog_connector ON integration_logs(connector_id);

    CREATE TABLE IF NOT EXISTS ai_asset_identifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identification_code TEXT NOT NULL UNIQUE,
      company_id INTEGER NOT NULL,
      asset_id INTEGER,
      source_photo_url TEXT NOT NULL,
      photo_sha256 TEXT,
      analysis_mode TEXT NOT NULL CHECK (analysis_mode IN ('local_dedup_similarity', 'gemini_vision_ocr')),
      external_consent_confirmed INTEGER NOT NULL DEFAULT 0,
      model_used TEXT,
      extracted_serial_number TEXT,
      extracted_label TEXT,
      extracted_brand TEXT,
      extracted_model TEXT,
      extracted_specs TEXT,
      recommended_category_id INTEGER,
      duplicate_matches_json TEXT,
      similarity_matches_json TEXT,
      raw_ai_json TEXT,
      verification_status TEXT NOT NULL DEFAULT 'Pending Review' CHECK (verification_status IN ('Pending Review', 'Accepted', 'Rejected', 'Applied')),
      applied_fields_json TEXT,
      requested_by_user_id INTEGER,
      verified_by_user_id INTEGER,
      verified_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
      FOREIGN KEY (recommended_category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_aiid_company ON ai_asset_identifications(company_id);
    CREATE INDEX IF NOT EXISTS idx_aiid_sha256 ON ai_asset_identifications(photo_sha256);
    CREATE INDEX IF NOT EXISTS idx_aiid_status ON ai_asset_identifications(verification_status);

    CREATE TABLE IF NOT EXISTS dr_backup_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verification_code TEXT NOT NULL UNIQUE,
      verification_type TEXT NOT NULL CHECK (verification_type IN ('sqlite_integrity_check', 'snapshot_dry_run', 'backup_export_check', 'restore_drill_sandbox', 'manual_bcp_drill')),
      backup_version TEXT,
      snapshot_sha256 TEXT,
      table_count INTEGER NOT NULL DEFAULT 0,
      record_count INTEGER NOT NULL DEFAULT 0,
      rpo_minutes INTEGER,
      rto_minutes INTEGER,
      status TEXT NOT NULL CHECK (status IN ('Passed', 'Warning', 'Failed')),
      summary TEXT NOT NULL,
      details_json TEXT,
      verified_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_drver_created ON dr_backup_verifications(created_at);

    CREATE TABLE IF NOT EXISTS bcp_runbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runbook_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      scenario TEXT NOT NULL,
      rto_target_minutes INTEGER NOT NULL DEFAULT 60,
      rpo_target_minutes INTEGER NOT NULL DEFAULT 15,
      owner_role TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      last_tested_at TEXT,
      last_test_status TEXT NOT NULL DEFAULT 'Not Tested' CHECK (last_test_status IN ('Not Tested', 'Passed', 'Action Required')),
      updated_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enterprise_acceptance_signoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      release_tag TEXT NOT NULL,
      gate_scope TEXT NOT NULL,
      gate_status TEXT NOT NULL CHECK (gate_status IN ('Passed', 'Conditional', 'Failed')),
      checks_passed INTEGER NOT NULL DEFAULT 0,
      checks_total INTEGER NOT NULL DEFAULT 0,
      checks_json TEXT NOT NULL,
      notes TEXT,
      signed_off_by_user_id INTEGER,
      signed_off_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureMetadataColumns();
  seedInitialData();
  backfillFase1GovernanceData();
  backfillFase2Data();
  backfillFase3Data();
  backfillFase4Data();
  ensureDefaultCompanyLogo();
}

function ensureMetadataColumns() {
  const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  const userColNames = new Set(userCols.map((c) => c.name));
  if (!userColNames.has('phone')) {
    db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
  }
  if (!userColNames.has('department')) {
    db.exec('ALTER TABLE users ADD COLUMN department TEXT');
  }
  if (!userColNames.has('position_title')) {
    db.exec('ALTER TABLE users ADD COLUMN position_title TEXT');
  }

  const tablesToCheck = ['asset_photos', 'asset_documents'] as const;
  for (const table of tablesToCheck) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('mime_type')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN mime_type TEXT`);
    }
    if (!colNames.has('file_size_bytes')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN file_size_bytes INTEGER`);
    }
  }

  const companyCols = new Set((db.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map((c) => c.name));
  if (!companyCols.has('holding_id')) {
    db.exec('ALTER TABLE companies ADD COLUMN holding_id INTEGER');
  }

  const assetCols = new Set((db.prepare('PRAGMA table_info(assets)').all() as { name: string }[]).map((c) => c.name));
  if (!assetCols.has('data_owner_user_id')) {
    db.exec('ALTER TABLE assets ADD COLUMN data_owner_user_id INTEGER');
  }
  if (!assetCols.has('custodian_person_id')) {
    db.exec('ALTER TABLE assets ADD COLUMN custodian_person_id INTEGER');
  }
  if (!assetCols.has('responsible_division_id')) {
    db.exec('ALTER TABLE assets ADD COLUMN responsible_division_id INTEGER');
  }
  if (!assetCols.has('verification_officer_user_id')) {
    db.exec('ALTER TABLE assets ADD COLUMN verification_officer_user_id INTEGER');
  }
  if (!assetCols.has('approver_user_id')) {
    db.exec('ALTER TABLE assets ADD COLUMN approver_user_id INTEGER');
  }
  if (!assetCols.has('legal_hold')) {
    db.exec('ALTER TABLE assets ADD COLUMN legal_hold INTEGER NOT NULL DEFAULT 0');
  }
  if (!assetCols.has('archived_at')) {
    db.exec('ALTER TABLE assets ADD COLUMN archived_at TEXT');
  }

  const movCols = new Set((db.prepare('PRAGMA table_info(asset_movements)').all() as { name: string }[]).map((c) => c.name));
  if (!movCols.has('from_company_id')) {
    db.exec('ALTER TABLE asset_movements ADD COLUMN from_company_id INTEGER');
  }
  if (!movCols.has('to_company_id')) {
    db.exec('ALTER TABLE asset_movements ADD COLUMN to_company_id INTEGER');
  }
  if (!movCols.has('from_division_id')) {
    db.exec('ALTER TABLE asset_movements ADD COLUMN from_division_id INTEGER');
  }
  if (!movCols.has('to_division_id')) {
    db.exec('ALTER TABLE asset_movements ADD COLUMN to_division_id INTEGER');
  }
  if (!movCols.has('is_cross_company')) {
    db.exec('ALTER TABLE asset_movements ADD COLUMN is_cross_company INTEGER NOT NULL DEFAULT 0');
  }

  const opnameCols = new Set((db.prepare('PRAGMA table_info(stock_opname)').all() as { name: string }[]).map((c) => c.name));
  if (!opnameCols.has('company_id')) {
    db.exec('ALTER TABLE stock_opname ADD COLUMN company_id INTEGER');
  }

  const qrCols = new Set((db.prepare('PRAGMA table_info(asset_qr_codes)').all() as { name: string }[]).map((c) => c.name));
  if (!qrCols.has('public_slug')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN public_slug TEXT');
  }
  if (!qrCols.has('status')) {
    db.exec("ALTER TABLE asset_qr_codes ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'");
  }
  if (!qrCols.has('public_enabled')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN public_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!qrCols.has('public_show_photo')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN public_show_photo INTEGER NOT NULL DEFAULT 1');
  }
  if (!qrCols.has('public_show_location')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN public_show_location INTEGER NOT NULL DEFAULT 1');
  }
  if (!qrCols.has('expires_at')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN expires_at TEXT');
  }
  if (!qrCols.has('revoked_at')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN revoked_at TEXT');
  }
  if (!qrCols.has('revoked_by')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN revoked_by INTEGER');
  }
  if (!qrCols.has('revoked_reason')) {
    db.exec('ALTER TABLE asset_qr_codes ADD COLUMN revoked_reason TEXT');
  }

  const opDetCols = new Set((db.prepare('PRAGMA table_info(stock_opname_details)').all() as { name: string }[]).map((c) => c.name));
  if (!opDetCols.has('gps_latitude')) {
    db.exec('ALTER TABLE stock_opname_details ADD COLUMN gps_latitude REAL');
  }
  if (!opDetCols.has('gps_longitude')) {
    db.exec('ALTER TABLE stock_opname_details ADD COLUMN gps_longitude REAL');
  }
  if (!opDetCols.has('gps_accuracy_m')) {
    db.exec('ALTER TABLE stock_opname_details ADD COLUMN gps_accuracy_m REAL');
  }
  if (!opDetCols.has('field_photo_url')) {
    db.exec('ALTER TABLE stock_opname_details ADD COLUMN field_photo_url TEXT');
  }
}

function backfillFase1GovernanceData() {
  const tx = db.transaction(() => {
    const holdingCount = (db.prepare('SELECT COUNT(*) as c FROM holding_groups').get() as { c: number }).c;
    if (holdingCount === 0) {
      db.prepare('INSERT INTO holding_groups (code, name, description) VALUES (?, ?, ?)').run(
        'INDIKA-GRP',
        'Indika Energy Group',
        'Holding Group induk untuk seluruh entitas operasional dan korporat.'
      );
    }

    const defaultHolding = db.prepare('SELECT id FROM holding_groups ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
    if (defaultHolding) {
      db.prepare('UPDATE companies SET holding_id = ? WHERE holding_id IS NULL').run(defaultHolding.id);
    }

    // Ensure Company 2 (INDIKA) has baseline division, location, and PIC for cross-company workflows
    const indikaCompany = db.prepare("SELECT id FROM companies WHERE code = 'INDIKA'").get() as { id: number } | undefined;
    if (indikaCompany) {
      const indikaDivCount = (db.prepare('SELECT COUNT(*) as c FROM divisions WHERE company_id = ?').get(indikaCompany.id) as { c: number }).c;
      if (indikaDivCount === 0) {
        const divInfo = db
          .prepare('INSERT INTO divisions (company_id, code, name, department) VALUES (?, ?, ?, ?)')
          .run(indikaCompany.id, 'IND-CORP', 'Corporate Holding & Shared Services', 'Group Office');
        const indikaDivId = Number(divInfo.lastInsertRowid);

        const bldInfo = db
          .prepare('INSERT OR IGNORE INTO buildings (company_id, code, name, address) VALUES (?, ?, ?, ?)')
          .run(indikaCompany.id, 'BLD-IND-HO', 'Indika Energy Tower (Graha Mitra)', 'Jl. Jend. Gatot Subroto Kav. 21, Jakarta');
        const bldRow = (bldInfo.lastInsertRowid
          ? { id: Number(bldInfo.lastInsertRowid) }
          : db.prepare("SELECT id FROM buildings WHERE code = 'BLD-IND-HO'").get()) as { id: number } | undefined;

        if (bldRow) {
          const flrInfo = db.prepare('INSERT INTO floors (building_id, name, level_number) VALUES (?, ?, ?)').run(bldRow.id, 'Floor 12', 12);
          const rmInfo = db.prepare('INSERT INTO rooms (floor_id, name, room_code) VALUES (?, ?, ?)').run(Number(flrInfo.lastInsertRowid), 'Group Asset Office', 'RM-IND-12');
          db.prepare(
            'INSERT OR IGNORE INTO locations (company_id, building_id, floor_id, room_id, specific_location, location_code, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(indikaCompany.id, bldRow.id, Number(flrInfo.lastInsertRowid), Number(rmInfo.lastInsertRowid), 'Corporate Holding Desk', 'LOC-IND-HO-F12-CORP', 'Indika Energy Group corporate office');
        }

        db.prepare(
          'INSERT OR IGNORE INTO persons (nik_nip, full_name, company_id, division_id, department, position_title, email, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run('IND-20101', 'Hendra Kusuma', indikaCompany.id, indikaDivId, 'Group Office', 'Corporate Asset Coordinator', 'hendra.kusuma@indikaenergy.co.id', '+62-811-7700-201', 'Active');
      }
    }

    // Backfill 5-role ownership defaults on existing assets
    db.prepare(`
      UPDATE assets SET
        custodian_person_id = COALESCE(custodian_person_id, pic_id),
        responsible_division_id = COALESCE(responsible_division_id, division_id),
        data_owner_user_id = COALESCE(data_owner_user_id, updated_by, created_by)
      WHERE custodian_person_id IS NULL
         OR responsible_division_id IS NULL
         OR (data_owner_user_id IS NULL AND COALESCE(updated_by, created_by) IS NOT NULL)
    `).run();

    // Backfill company/division context on existing movements
    db.prepare(`
      UPDATE asset_movements
      SET from_company_id = COALESCE(from_company_id, (SELECT l.company_id FROM locations l WHERE l.id = asset_movements.from_location_id)),
          to_company_id = COALESCE(to_company_id, (SELECT l.company_id FROM locations l WHERE l.id = asset_movements.to_location_id)),
          from_division_id = COALESCE(from_division_id, (SELECT a.division_id FROM assets a WHERE a.id = asset_movements.asset_id)),
          to_division_id = COALESCE(to_division_id, (SELECT a.division_id FROM assets a WHERE a.id = asset_movements.asset_id))
      WHERE from_company_id IS NULL OR to_company_id IS NULL OR from_division_id IS NULL OR to_division_id IS NULL
    `).run();

    db.prepare(`
      UPDATE asset_movements
      SET is_cross_company = CASE
        WHEN from_company_id IS NOT NULL AND to_company_id IS NOT NULL AND from_company_id != to_company_id THEN 1
        ELSE 0
      END
    `).run();

    // Backfill company_id on existing stock_opname
    db.prepare(`
      UPDATE stock_opname
      SET company_id = COALESCE(company_id, (SELECT l.company_id FROM locations l WHERE l.id = stock_opname.location_id))
      WHERE company_id IS NULL
    `).run();

    // Backfill user_org_scopes for existing users without any scope row
    const usersWithoutScope = db
      .prepare(`
        SELECT u.id, r.code as role_code
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE NOT EXISTS (SELECT 1 FROM user_org_scopes s WHERE s.user_id = u.id)
      `)
      .all() as { id: number; role_code: string | null }[];

    const firstCompany = db.prepare('SELECT id FROM companies ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
    const insScope = db.prepare(
      'INSERT INTO user_org_scopes (user_id, scope_level, holding_id, company_id, division_id, is_default) VALUES (?, ?, ?, ?, ?, 1)'
    );
    for (const u of usersWithoutScope) {
      if (u.role_code === 'super_admin' && defaultHolding) {
        insScope.run(u.id, 'holding', defaultHolding.id, null, null);
      } else if (firstCompany) {
        insScope.run(u.id, 'company', null, firstCompany.id, null);
      }
    }

    // Backfill initial immutable baseline asset_events if ledger is empty
    const eventCount = (db.prepare('SELECT COUNT(*) as c FROM asset_events').get() as { c: number }).c;
    if (eventCount === 0) {
      const existingAssets = db
        .prepare(`
          SELECT a.id, a.asset_code, a.asset_name, a.company_id, a.division_id, a.department,
                 a.location_id, a.pic_id, a.custodian_person_id, a.responsible_division_id,
                 a.data_owner_user_id, a.verification_officer_user_id, a.approver_user_id,
                 a.condition_status, a.asset_status, a.deleted_at, a.created_at, q.id as qr_id
          FROM assets a
          LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
          ORDER BY a.id ASC
        `)
        .all() as Record<string, any>[];

      let prevHash = 'GENESIS';
      const insEv = db.prepare(`
        INSERT INTO asset_events (
          event_uuid, company_id, asset_id, qr_id, event_type,
          actor_user_id, actor_username, reference_type, reference_id,
          reason, previous_state_json, new_state_json, prev_hash, event_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const a of existingAssets) {
        const snapshot = {
          id: a.id,
          asset_code: a.asset_code,
          asset_name: a.asset_name,
          company_id: a.company_id,
          division_id: a.division_id,
          department: a.department,
          location_id: a.location_id,
          pic_id: a.pic_id,
          custodian_person_id: a.custodian_person_id,
          responsible_division_id: a.responsible_division_id,
          data_owner_user_id: a.data_owner_user_id,
          verification_officer_user_id: a.verification_officer_user_id,
          approver_user_id: a.approver_user_id,
          condition_status: a.condition_status,
          asset_status: a.asset_status,
          deleted_at: a.deleted_at,
        };
        const sortedSnapshot: Record<string, unknown> = {};
        for (const k of Object.keys(snapshot).sort()) {
          sortedSnapshot[k] = (snapshot as Record<string, unknown>)[k];
        }
        const newStateJson = JSON.stringify(sortedSnapshot);
        const eventUuid = crypto.randomUUID();
        const createdAt = String(a.created_at || new Date().toISOString().slice(0, 19).replace('T', ' '));
        const material = JSON.stringify({
          prev_hash: prevHash,
          event_uuid: eventUuid,
          company_id: Number(a.company_id),
          asset_id: Number(a.id),
          qr_id: a.qr_id ?? null,
          event_type: 'BASELINE_SNAPSHOT',
          actor_user_id: null,
          actor_username: 'system',
          reference_type: 'asset',
          reference_id: String(a.id),
          reason: 'Initial baseline snapshot for immutable asset event ledger',
          previous_state_json: null,
          new_state_json: newStateJson,
          created_at: createdAt,
        });
        const eventHash = crypto.createHash('sha256').update(material).digest('hex');

        insEv.run(
          eventUuid,
          Number(a.company_id),
          Number(a.id),
          a.qr_id ?? null,
          'BASELINE_SNAPSHOT',
          null,
          'system',
          'asset',
          String(a.id),
          'Initial baseline snapshot for immutable asset event ledger',
          null,
          newStateJson,
          prevHash,
          eventHash,
          createdAt
        );
        prevHash = eventHash;
      }
    }
  });
  tx();
}

function backfillFase2Data() {
  const tx = db.transaction(() => {
    const missingSlugs = db
      .prepare("SELECT id FROM asset_qr_codes WHERE public_slug IS NULL OR trim(public_slug) = ''")
      .all() as { id: number }[];
    const updSlug = db.prepare('UPDATE asset_qr_codes SET public_slug = ? WHERE id = ?');
    for (const row of missingSlugs) {
      const slug = crypto.randomBytes(12).toString('base64url');
      updSlug.run(slug, row.id);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_public_slug ON asset_qr_codes(public_slug)');
  });
  tx();
}

function backfillFase3Data() {
  const tx = db.transaction(() => {
    const fase3Perms: [string, string, string, string][] = [
      ['governance.view', 'governance', 'view', 'View retention policies, SOP controls, integration registry, and Smart AI recommendations'],
      ['governance.manage', 'governance', 'manage', 'Manage retention policies, legal holds, enterprise SOPs, and integration connectors'],
      ['ai.identify', 'ai', 'identify', 'Run Smart Asset Identification (local deduplication or consented Gemini OCR)'],
      ['ai.verify', 'ai', 'verify', 'Review, accept, reject, or confirm-apply Smart AI asset recommendations'],
    ];

    const insPerm = db.prepare(
      'INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES (?, ?, ?, ?)'
    );
    for (const [code, mod, act, desc] of fase3Perms) {
      insPerm.run(code, mod, act, desc);
    }

    const roleGrantMap: Record<string, string[]> = {
      super_admin: ['governance.view', 'governance.manage', 'ai.identify', 'ai.verify'],
      inventory_admin: ['governance.view', 'ai.identify', 'ai.verify'],
      approver: ['governance.view', 'ai.verify'],
      auditor: ['governance.view'],
    };

    const getRole = db.prepare('SELECT id FROM roles WHERE code = ?');
    const getPerm = db.prepare('SELECT id FROM permissions WHERE code = ?');
    const insRP = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

    for (const [roleCode, permCodes] of Object.entries(roleGrantMap)) {
      const rRow = getRole.get(roleCode) as { id: number } | undefined;
      if (!rRow) continue;
      for (const pCode of permCodes) {
        const pRow = getPerm.get(pCode) as { id: number } | undefined;
        if (pRow) {
          insRP.run(rRow.id, pRow.id);
        }
      }
    }

    // Seed AI Kill Switch & governance system settings idempotently
    const upsertSetting = db.prepare(`
      INSERT OR IGNORE INTO system_settings (setting_key, setting_value, category)
      VALUES (?, ?, ?)
    `);
    upsertSetting.run('smart_ai_enabled', 'true', 'ai_governance');
    upsertSetting.run('smart_ai_external_allowed', 'true', 'ai_governance');

    // Seed baseline retention policies
    const insPolicy = db.prepare(`
      INSERT OR IGNORE INTO retention_policies (
        policy_code, record_class, title, description, retention_days, action_mode, is_immutable_ledger, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const defaultPolicies: [string, string, string, string, number, string, number][] = [
      ['RET-LEDGER-01', 'asset_events', 'Immutable Asset Event Ledger (SHA-256)', 'Riwayat event aset hash-chained bersifat permanen dan tidak pernah dihapus atau dimodifikasi oleh proses retensi.', 3650, 'immutable_retain', 1],
      ['RET-AUDIT-01', 'audit_logs', 'Security Audit Trail Logs', 'Log autentikasi, otorisasi, dan perubahan kebijakan keamanan sistem dipertahankan permanen untuk kepatuhan.', 3650, 'immutable_retain', 1],
      ['RET-DISP-01', 'disposed_assets', 'Disposed Assets Archive', 'Aset berstatus Disposed yang melewati masa retensi diarsipkan (archived_at) selama tidak berstatus Legal Hold.', 1825, 'archive_record', 0],
      ['RET-QR-01', 'qr_access_logs', 'QR Public & Scan Access Telemetry', 'Log telemetri akses QR non-ledger yang melampaui masa retensi dapat dipangkas secara terkontrol.', 365, 'purge_non_ledger', 0],
      ['RET-FIELD-01', 'asset_field_captures', 'Field Capture Photo & GPS Evidence', 'Bukti foto lapangan dan koordinat GPS inspeksi disimpan sebagai arsip verifikasi historis.', 1095, 'archive_record', 0],
      ['RET-SOP-01', 'sop_executions', 'SOP Operational Sign-off Records', 'Catatan kepatuhan dan deviasi SOP operasional lintas modul.', 1825, 'archive_record', 0],
      ['RET-AI-01', 'ai_asset_identifications', 'Smart AI Extraction & Verification Queue', 'Rekam jejak rekomendasi OCR/deduplikasi AI dan keputusan verifikasi manusia.', 730, 'archive_record', 0],
    ];
    for (const p of defaultPolicies) {
      insPolicy.run(...p);
    }

    // Seed baseline KIDECO Enterprise SOPs
    const sopCount = (db.prepare('SELECT COUNT(*) as c FROM enterprise_sops').get() as { c: number }).c;
    if (sopCount === 0) {
      const insSop = db.prepare(`
        INSERT INTO enterprise_sops (sop_code, company_id, title, category, version, mandatory_module, checklist_json, is_mandatory, is_active)
        VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 1)
      `);
      insSop.run(
        'SOP-OIMS-001',
        'Registrasi Aset Baru & Penandaan QR Fisik',
        'Asset Onboarding',
        '2.1',
        'register',
        JSON.stringify([
          'Verifikasi faktur / PO pengadaan dan nilai perolehan',
          'Pastikan nomor seri pabrikan tercatat akurat tanpa duplikasi',
          'Tetapkan Penanggung Jawab (PIC) dan Divisi pemilik aset',
          'Tempelkan label QR unik pada bodi aset dan unggah foto dokumentasi',
        ])
      );
      insSop.run(
        'SOP-OIMS-002',
        'Audit Fisik Lapangan & Rekonsiliasi Stock Opname',
        'Field Audit & Reconciliation',
        '2.0',
        'opname',
        JSON.stringify([
          'Pindai QR token atau nomor seri aktual di lokasi fisik',
          'Rekam foto kondisi terkini beserta koordinat GPS verifikasi',
          'Catat temuan ketidaksesuaian ke Reconciliation Engine (tanpa menimpa master otomatis)',
          'Lakukan peninjauan supervisor sebelum otorisasi pembaruan master',
        ])
      );
      insSop.run(
        'SOP-OIMS-003',
        'Persetujuan Perpindahan Lintas Perusahaan & Disposal',
        'Custody & Disposal Control',
        '1.4',
        'movements',
        JSON.stringify([
          'Ajukan permohonan transfer resmi beserta berita acara serah terima',
          'Dapatkan persetujuan approver lintas entitas sebelum memindahkan fisik aset',
          'Pastikan status Legal Hold tidak aktif sebelum proses arsip atau disposal',
        ])
      );
    }

    // Seed baseline Integration Connectors (disabled by default for governance safety)
    const connCount = (db.prepare('SELECT COUNT(*) as c FROM integration_connectors').get() as { c: number }).c;
    if (connCount === 0) {
      const insConn = db.prepare(`
        INSERT INTO integration_connectors (
          connector_code, company_id, name, connector_type, endpoint_url, auth_scheme, env_secret_ref, data_classification, is_enabled
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0)
      `);
      insConn.run(
        'ERP-SAP-SYNC',
        'SAP S/4HANA Fixed Asset Ledger Sync',
        'erp_sync',
        'https://erp-gateway.kideco.internal/api/v1/fixed-assets/sync',
        'Bearer Env',
        'KIDECO_ERP_API_TOKEN',
        'Confidential'
      );
      insConn.run(
        'HRIS-EMP-SYNC',
        'Corporate HRIS Employee & PIC Directory Sync',
        'hris_sync',
        'https://hris.kideco.internal/api/v1/employees/directory',
        'HMAC Header',
        'KIDECO_HRIS_HMAC_SECRET',
        'Internal'
      );
    }
  });
  tx();
}

function backfillFase4Data() {
  const tx = db.transaction(() => {
    const fase4Perms: [string, string, string, string][] = [
      ['ops.health.view', 'operations', 'view', 'View system health monitoring, DR verification logs, BCP runbooks, and Quality Gate status'],
      ['ops.dr.manage', 'operations', 'manage', 'Execute DR integrity checks, dry-run backup verification, BCP drills, and Quality Gate sign-offs'],
    ];

    const insPerm = db.prepare(
      'INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES (?, ?, ?, ?)'
    );
    for (const [code, mod, act, desc] of fase4Perms) {
      insPerm.run(code, mod, act, desc);
    }

    const roleGrantMap: Record<string, string[]> = {
      super_admin: ['ops.health.view', 'ops.dr.manage'],
      auditor: ['ops.health.view'],
    };

    const getRole = db.prepare('SELECT id FROM roles WHERE code = ?');
    const getPerm = db.prepare('SELECT id FROM permissions WHERE code = ?');
    const insRP = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

    for (const [roleCode, permCodes] of Object.entries(roleGrantMap)) {
      const rRow = getRole.get(roleCode) as { id: number } | undefined;
      if (!rRow) continue;
      for (const pCode of permCodes) {
        const pRow = getPerm.get(pCode) as { id: number } | undefined;
        if (pRow) {
          insRP.run(rRow.id, pRow.id);
        }
      }
    }

    const upsertSetting = db.prepare(`
      INSERT OR IGNORE INTO system_settings (setting_key, setting_value, category)
      VALUES (?, ?, ?)
    `);
    upsertSetting.run('bcp_rpo_target_minutes', '15', 'dr_bcp');
    upsertSetting.run('bcp_rto_target_minutes', '60', 'dr_bcp');
    upsertSetting.run('backup_retention_count', '14', 'dr_bcp');

    const runbookCount = (db.prepare('SELECT COUNT(*) as c FROM bcp_runbooks').get() as { c: number }).c;
    if (runbookCount === 0) {
      const insRb = db.prepare(`
        INSERT INTO bcp_runbooks (runbook_code, title, scenario, rto_target_minutes, rpo_target_minutes, owner_role, steps_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insRb.run(
        'BCP-OIMS-001',
        'Pemulihan Kerusakan Database & Verifikasi Rantai Event',
        'db_corruption',
        30,
        15,
        'Super Administrator / DBA',
        JSON.stringify([
          'Hentikan penulisan aplikasi sementara (maintenance window) dan amankan salinan oims.db + WAL + SHM.',
          'Jalankan PRAGMA integrity_check dan validasi SHA-256 Asset Event Ledger.',
          'Jika korup, lakukan uji dry-run snapshot JSON terakhir sebelum memulihkan di lingkungan terpisah.',
          'Pulihkan snapshot terverifikasi atau impor ulang oims.sql ke instansi cadangan, lalu uji login & hash chain.',
        ])
      );
      insRb.run(
        'BCP-OIMS-002',
        'Pemulihan Repositori Foto Aset & Dokumen Lokal',
        'storage_loss',
        60,
        30,
        'Infrastructure / Storage Lead',
        JSON.stringify([
          'Verifikasi kapasitas disk server dan izin tulis direktori /uploads/photos, /uploads/docs, /uploads/field.',
          'Sinkronkan ulang berkas lampiran dari backup penyimpanan harian server (rsync / volume snapshot).',
          'Jalankan pemeriksaan integritas foto lokal di modul Health Monitoring untuk memastikan tidak ada tautan foto yatim.',
        ])
      );
      insRb.run(
        'BCP-OIMS-003',
        'Failover Host Aplikasi & Verifikasi Kesiapan Produksi',
        'server_failover',
        45,
        15,
        'Enterprise Systems Lead',
        JSON.stringify([
          'Siapkan host cadangan dengan variabel environment server (passcode admin, secret sesi, opsi SMTP jika dipakai).',
          'Deploy paket build produksi beserta direktori data/ dan uploads/ dari backup terakhir.',
          'Jalankan Enterprise Quality Gate dan catat waktu pemulihan aktual (RTO) ke log BCP.',
        ])
      );
    }
  });
  tx();
}

function ensureDefaultCompanyLogo() {
  const defaultLogo = '/assets/aistudio/logo_795e174b.png';
  db.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, category)
    VALUES ('company_logo_url', ?, 'branding')
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = CASE WHEN trim(COALESCE(setting_value, '')) = '' THEN excluded.setting_value ELSE setting_value END,
      updated_at = CASE WHEN trim(COALESCE(setting_value, '')) = '' THEN datetime('now') ELSE updated_at END
  `).run(defaultLogo);
}

function seedInitialData() {
  const roleCount = (db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }).c;
  if (roleCount > 0) return;

  const insertRole = db.prepare('INSERT INTO roles (code, name, description) VALUES (?, ?, ?)');
  const rolesData = [
    ['super_admin', 'Super Administrator', 'Full access to all modules, users, security settings, and database backup/restore.'],
    ['inventory_admin', 'Inventory Administrator', 'Manages asset registration, QR tagging, locations, PICs, stock opname, and reports.'],
    ['pic_custodian', 'PIC / Asset Custodian', 'Views assigned assets, reports damage, and submits transfer requests.'],
    ['approver', 'Approver / Supervisor', 'Approves asset movements, maintenance requests, and reviews condition/replacement reports.'],
    ['auditor', 'Viewer / Auditor', 'Read-only access to dashboard, asset inventory, audit logs, and reports.'],
  ];
  for (const r of rolesData) insertRole.run(...r);

  const modules = [
    ['dashboard', ['view']],
    ['assets', ['view', 'create', 'edit', 'delete', 'import', 'export']],
    ['qr', ['view', 'generate', 'scan', 'print']],
    ['locations', ['view', 'create', 'edit', 'delete']],
    ['pic', ['view', 'create', 'edit', 'assign']],
    ['movements', ['view', 'request', 'approve']],
    ['maintenance', ['view', 'report', 'update', 'approve']],
    ['opname', ['view', 'schedule', 'verify']],
    ['replacement', ['view', 'configure', 'plan']],
    ['reports', ['view', 'export']],
    ['users', ['view', 'manage']],
    ['settings', ['view', 'manage', 'backup']],
  ] as const;

  const insertPerm = db.prepare('INSERT INTO permissions (code, module, action, description) VALUES (?, ?, ?, ?)');
  for (const [mod, actions] of modules) {
    for (const act of actions) {
      insertPerm.run(`${mod}.${act}`, mod, act, `${act} access on ${mod}`);
    }
  }

  const allPerms = db.prepare('SELECT id, code FROM permissions').all() as { id: number; code: string }[];
  const allRoles = db.prepare('SELECT id, code FROM roles').all() as { id: number; code: string }[];
  const insertRP = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  const roleMap: Record<string, (code: string) => boolean> = {
    super_admin: () => true,
    inventory_admin: (c) => !c.startsWith('users.') && c !== 'settings.backup' && c !== 'settings.manage',
    pic_custodian: (c) =>
      ['dashboard.view', 'assets.view', 'qr.view', 'qr.scan', 'locations.view', 'pic.view', 'movements.view', 'movements.request', 'maintenance.view', 'maintenance.report', 'opname.view'].includes(c),
    approver: (c) =>
      ['dashboard.view', 'assets.view', 'assets.export', 'qr.view', 'locations.view', 'pic.view', 'movements.view', 'movements.approve', 'maintenance.view', 'maintenance.approve', 'opname.view', 'replacement.view', 'reports.view', 'reports.export'].includes(c),
    auditor: (c) => c.endsWith('.view') || c === 'reports.export' || c === 'assets.export',
  };

  for (const role of allRoles) {
    const matcher = roleMap[role.code] || (() => false);
    for (const perm of allPerms) {
      if (matcher(perm.code)) {
        insertRP.run(role.id, perm.id);
      }
    }
  }

  // Seed Companies
  db.prepare('INSERT INTO companies (code, name, address) VALUES (?, ?, ?)').run(
    'KIDECO',
    'PT Kideco Jaya Agung (KIDECO)',
    'Graha Mitra, Jl. Jend. Gatot Subroto Kav. 21, Jakarta / Batu Kajang Site, East Kalimantan'
  );
  db.prepare('INSERT INTO companies (code, name, address) VALUES (?, ?, ?)').run(
    'INDIKA',
    'PT Indika Energy Tbk',
    'Graha Mitra, Jl. Jend. Gatot Subroto Kav. 21, Jakarta Selatan'
  );

  // Seed Divisions
  const insertDiv = db.prepare('INSERT INTO divisions (company_id, code, name, department) VALUES (?, ?, ?, ?)');
  insertDiv.run(1, 'GA', 'General Affairs', 'Facility & Asset Control');
  insertDiv.run(1, 'IT', 'Information Technology', 'Enterprise Infrastructure');
  insertDiv.run(1, 'OPS', 'Mining Operations Support', 'Site Administration');
  insertDiv.run(1, 'FIN', 'Finance & Accounting', 'Corporate Treasury');
  insertDiv.run(1, 'HSE', 'Health, Safety & Environment', 'Compliance & Risk');

  // Seed Categories & Subcategories
  const insertCat = db.prepare('INSERT INTO categories (code, name, default_useful_life_years) VALUES (?, ?, ?)');
  insertCat.run('IT', 'IT & Computing Equipment', 4);
  insertCat.run('FUR', 'Office Furniture', 7);
  insertCat.run('AV', 'Audio Visual & Conference', 5);
  insertCat.run('FAC', 'Facility & Electrical', 6);

  const insertSub = db.prepare('INSERT INTO subcategories (category_id, code, name) VALUES (?, ?, ?)');
  insertSub.run(1, 'IT-LPT', 'Laptop & Workstation');
  insertSub.run(1, 'IT-PRT', 'Multifunction Printer & Scanner');
  insertSub.run(1, 'IT-NET', 'Network & Server Hardware');
  insertSub.run(2, 'FUR-CHR', 'Ergonomic Chair');
  insertSub.run(2, 'FUR-DSK', 'Workstation Desk & Table');
  insertSub.run(2, 'FUR-CAB', 'Storage & Filing Cabinet');
  insertSub.run(3, 'AV-DSP', 'Smart Conference Display');
  insertSub.run(4, 'FAC-UPS', 'Power Backup & UPS');

  // Seed Buildings -> Floors -> Rooms -> Locations
  db.prepare('INSERT INTO buildings (company_id, code, name, address) VALUES (?, ?, ?, ?)').run(
    1, 'BLD-HO', 'KIDECO Office Building (Graha Mitra)', 'Jl. Jend. Gatot Subroto Kav. 21'
  );
  db.prepare('INSERT INTO buildings (company_id, code, name, address) VALUES (?, ?, ?, ?)').run(
    1, 'BLD-SITE', 'Batu Kajang Site Administration Wing', 'Paser, Kalimantan Timur'
  );

  db.prepare('INSERT INTO floors (building_id, name, level_number) VALUES (?, ?, ?)').run(1, 'Floor 1', 1);
  db.prepare('INSERT INTO floors (building_id, name, level_number) VALUES (?, ?, ?)').run(1, 'Floor 2', 2);
  db.prepare('INSERT INTO floors (building_id, name, level_number) VALUES (?, ?, ?)').run(2, 'Ground Floor', 1);

  db.prepare('INSERT INTO rooms (floor_id, name, room_code) VALUES (?, ?, ?)').run(1, 'General Affairs', 'RM-GA-01');
  db.prepare('INSERT INTO rooms (floor_id, name, room_code) VALUES (?, ?, ?)').run(1, 'IT Operations Center', 'RM-IT-01');
  db.prepare('INSERT INTO rooms (floor_id, name, room_code) VALUES (?, ?, ?)').run(2, 'Executive Boardroom', 'RM-EX-02');
  db.prepare('INSERT INTO rooms (floor_id, name, room_code) VALUES (?, ?, ?)').run(2, 'Finance Workspace', 'RM-FN-02');
  db.prepare('INSERT INTO rooms (floor_id, name, room_code) VALUES (?, ?, ?)').run(3, 'Site Control Office', 'RM-SC-01');

  const insertLoc = db.prepare(
    'INSERT INTO locations (company_id, building_id, floor_id, room_id, specific_location, location_code, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertLoc.run(1, 1, 1, 1, 'Storage Room A', 'LOC-KDC-HO-F1-GA-STR', 'Main GA secured storage');
  insertLoc.run(1, 1, 1, 2, 'Rack & Workstation Bay 2', 'LOC-KDC-HO-F1-IT-BAY2', 'IT provisioning desk');
  insertLoc.run(1, 1, 2, 3, 'Boardroom Main Table', 'LOC-KDC-HO-F2-EX-BRD', 'Executive conference room');
  insertLoc.run(1, 1, 2, 4, 'Accounting Pod B', 'LOC-KDC-HO-F2-FN-PODB', 'Finance staff cubicles');
  insertLoc.run(1, 2, 3, 5, 'Site Dispatch Desk', 'LOC-KDC-BK-GF-SC-DSP', 'Batu Kajang dispatch desk');

  // Seed PICs (Persons)
  const insertPic = db.prepare(
    'INSERT INTO persons (nik_nip, full_name, company_id, division_id, department, position_title, email, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertPic.run('KDC-10421', 'Budi Santoso', 1, 1, 'Facility & Asset Control', 'General Affairs Supervisor', 'budi.santoso@kideco.co.id', '+62-811-9402-110', 'Active');
  insertPic.run('KDC-10893', 'Siti Rahayu', 1, 2, 'Enterprise Infrastructure', 'IT Systems Lead', 'siti.rahayu@kideco.co.id', '+62-812-8830-421', 'Active');
  insertPic.run('KDC-11204', 'Andi Wijaya', 1, 4, 'Corporate Treasury', 'Senior Financial Analyst', 'andi.wijaya@kideco.co.id', '+62-813-4420-901', 'Active');
  insertPic.run('KDC-11560', 'Dewi Lestari', 1, 3, 'Site Administration', 'Site Operations Coordinator', 'dewi.lestari@kideco.co.id', '+62-811-5521-334', 'Active');
  insertPic.run('KDC-11902', 'Rizal Pratama', 1, 5, 'Compliance & Risk', 'HSE Audit Officer', 'rizal.pratama@kideco.co.id', '+62-812-7740-188', 'Active');

  // Seed Assets
  const insertAsset = db.prepare(`
    INSERT INTO assets (
      asset_code, asset_name, category_id, subcategory_id, brand, model, serial_number,
      description, specification, acquisition_date, acquisition_value, supplier, purchase_reference,
      warranty_period_months, acquisition_source, company_id, division_id, department,
      location_id, pic_id, condition_status, asset_status, primary_photo_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const laptopImg = '/src/assets/images/asset_workstation_laptop_1795596197186.jpg';
  const chairImg = '/src/assets/images/asset_ergonomic_chair_1795596197217.jpg';
  const printerImg = '/src/assets/images/asset_multifunction_printer_1795596198376.jpg';

  const seededAssets = [
    ['OIMS-2027-000001', 'Dell Latitude 7450 Executive Workstation', 1, 1, 'Dell', 'Latitude 7450', 'DL7450-KDC-9921A', 'Corporate engineering & finance laptop', 'Intel Core Ultra 7, 32GB RAM, 1TB NVMe SSD, 14" FHD+', '2025-02-14', 24500000, 'PT Bhinneka Mentari Dimensi', 'PO-KDC-2025-0114', 36, 'CAPEX Purchase', 1, 2, 'Enterprise Infrastructure', 2, 2, 'Good', 'Active', laptopImg],
    ['OIMS-2027-000002', 'Herman Miller Aeron Ergonomic Chair', 2, 4, 'Herman Miller', 'Aeron Size B', 'HM-AER-2024-8821', 'Executive mesh ergonomic task chair', 'Graphite Pellicle Mesh, Aluminum Base, Tilt Limiter', '2024-06-10', 19800000, 'PT Graha Interior Nusantara', 'PO-KDC-2024-0482', 60, 'CAPEX Purchase', 1, 1, 'Facility & Asset Control', 3, 1, 'Good', 'Active', chairImg],
    ['OIMS-2027-000003', 'Lexmark CX625adhe Multifunction Printer', 1, 2, 'Lexmark', 'CX625adhe', 'LX-CX625-77310', 'High-speed color laser MFP for GA & Finance', '40 ppm Color Laser, Duplex Scan, Gigabit Ethernet', '2023-08-20', 31200000, 'PT Astra Graphia Tbk', 'PO-KDC-2023-0891', 24, 'CAPEX Purchase', 1, 4, 'Corporate Treasury', 4, 3, 'Minor Damage', 'In Maintenance', printerImg],
    ['OIMS-2027-000004', 'Lenovo ThinkPad T14 Gen 5 Field Unit', 1, 1, 'Lenovo', 'ThinkPad T14 G5', 'LN-T14G5-44102', 'Site operations portable workstation', 'AMD Ryzen 7 PRO, 16GB RAM, 512GB SSD', '2025-01-08', 21400000, 'PT Datascrip Indonesia', 'PO-KDC-2025-0031', 36, 'CAPEX Purchase', 1, 3, 'Site Administration', 5, 4, 'Good', 'Active', laptopImg],
    ['OIMS-2027-000005', 'Samsung 75" Interactive Conference Display', 3, 7, 'Samsung', 'Flip Pro WM75B', 'SM-WM75B-30192', 'Boardroom 4K interactive touch panel', '75-inch 4K UHD, AirPlay/HDMI/USB-C, Mobile Stand', '2024-03-18', 54000000, 'PT Multipolar Technology', 'PO-KDC-2024-0219', 36, 'CAPEX Purchase', 1, 1, 'Facility & Asset Control', 3, 1, 'Good', 'Active', null],
    ['OIMS-2027-000006', 'APC Smart-UPS 3000VA Rackmount', 4, 8, 'APC', 'SMT3000RMI2UC', 'APC-3K-192044', 'Server room primary power protection', '3000VA / 2700W, SmartConnect, LCD Status', '2021-05-12', 28900000, 'PT Schneider Electric IT', 'PO-KDC-2021-0311', 24, 'CAPEX Purchase', 1, 2, 'Enterprise Infrastructure', 2, 2, 'Major Damage', 'In Maintenance', null],
    ['OIMS-2027-000007', 'Steelcase Gesture Ergonomic Chair', 2, 4, 'Steelcase', 'Gesture 442A', 'SC-GST-2022-6610', 'Task seating for Finance Pod B', '3D LiveBack, Adjustable Arms, Charcoal Fabric', '2022-09-05', 16500000, 'PT Vitra Karya Mandiri', 'PO-KDC-2022-0745', 60, 'CAPEX Purchase', 1, 4, 'Corporate Treasury', 4, 3, 'Good', 'Active', chairImg],
    ['OIMS-2027-000008', 'Cisco Catalyst 9200L 48-Port Switch', 1, 3, 'Cisco', 'C9200L-48P-4G', 'CSC-9200-55019', 'Floor 1 PoE+ core distribution switch', '48x PoE+ Ports, 4x 1G SFP Uplinks, Dual PSU', '2020-11-15', 42000000, 'PT Metrodata Electronics', 'PO-KDC-2020-1102', 36, 'CAPEX Purchase', 1, 2, 'Enterprise Infrastructure', 2, 2, 'Good', 'Active', null],
    ['OIMS-2027-000009', 'Modera Executive Modular Desk 180cm', 2, 5, 'Modera', 'E-Class 180', 'MOD-180-2023-004', 'Spare executive desk in GA storage', '180x80cm Melamine Walnut/Charcoal Steel Frame', '2023-04-22', 7800000, 'PT Modera Furintraco', 'PO-KDC-2023-0332', 12, 'OPEX Procurement', 1, 1, 'Facility & Asset Control', 1, null, 'Good', 'Active', null],
    ['OIMS-2027-000010', 'HP LaserJet Pro M404dn Legacy Printer', 1, 2, 'HP', 'M404dn', 'HP-M404-19881', 'Legacy monochrome printer slated for retirement', 'Monochrome Laser, 38 ppm, Network Ready', '2019-07-02', 6200000, 'PT Bhinneka Mentari Dimensi', 'PO-KDC-2019-0604', 12, 'OPEX Procurement', 1, 5, 'Compliance & Risk', 1, 5, 'Unserviceable', 'Active', printerImg],
  ];

  for (const a of seededAssets) {
    insertAsset.run(...a);
  }

  // Generate QR codes for assets 1..9 (leave asset 10 without QR code to showcase the "Missing QR Code" KPI & notification)
  const insertQR = db.prepare('INSERT INTO asset_qr_codes (asset_id, qr_token) VALUES (?, ?)');
  for (let i = 1; i <= 9; i++) {
    const token = `OIMS-QR-${crypto.createHash('sha256').update(`KIDECO-ASSET-${i}-SEED`).digest('hex').slice(0, 16).toUpperCase()}`;
    insertQR.run(i, token);
  }

  // Seed Asset Photos
  db.prepare('INSERT INTO asset_photos (asset_id, file_name, file_url, is_primary) VALUES (?, ?, ?, 1)').run(1, 'dell_latitude_7450.jpg', laptopImg);
  db.prepare('INSERT INTO asset_photos (asset_id, file_name, file_url, is_primary) VALUES (?, ?, ?, 1)').run(2, 'herman_miller_aeron.jpg', chairImg);
  db.prepare('INSERT INTO asset_photos (asset_id, file_name, file_url, is_primary) VALUES (?, ?, ?, 1)').run(3, 'lexmark_cx625.jpg', printerImg);

  // Seed Asset Movements
  const insertMove = db.prepare(`
    INSERT INTO asset_movements (movement_code, asset_id, from_location_id, to_location_id, from_pic_id, to_pic_id, movement_date, reason, officer_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMove.run('MOV-2027-0001', 1, 1, 2, 1, 2, '2026-10-14 09:30:00', 'Initial IT provisioning & handover to IT Systems Lead', 1, 'Completed');
  insertMove.run('MOV-2027-0002', 4, 2, 5, 2, 4, '2026-11-02 14:15:00', 'Site deployment for Batu Kajang field operations', 1, 'Completed');
  insertMove.run('MOV-2027-0003', 7, 1, 4, 1, 3, '2026-11-20 10:00:00', 'Reallocation to Finance Pod B expansion', 1, 'Pending Approval');

  db.prepare('INSERT INTO movement_approvals (movement_id, approver_user_id, decision, notes) VALUES (?, ?, ?, ?)').run(
    1, 1, 'Approved', 'Verified by General Affairs'
  );
  db.prepare('INSERT INTO movement_approvals (movement_id, approver_user_id, decision, notes) VALUES (?, ?, ?, ?)').run(
    2, 1, 'Approved', 'Site dispatch authorized'
  );

  // Seed Maintenance Records
  const insertMaint = db.prepare(`
    INSERT INTO maintenance_records (ticket_code, asset_id, damage_date, damage_type, issue_description, repair_action, vendor_technician, cost, completion_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMaint.run('MNT-2027-0001', 3, '2026-11-10', 'Paper Feed Jam / Roller Wear', 'ADF roller slips during duplex scanning', 'Replace ADF pickup roller assembly', 'Astra Graphia Field Service', 1850000, null, 'In Progress');
  insertMaint.run('MNT-2027-0002', 6, '2026-11-18', 'Battery Cell Degradation', 'UPS battery warning alarm & runtime < 3 min', 'Full battery cartridge replacement required', 'Schneider Authorized Partner', 6400000, null, 'Waiting Approval');
  insertMaint.run('MNT-2027-0003', 8, '2026-06-12', 'Fan Module Noise', 'Cooling fan bearing vibration detected', 'Cleaned chassis and replaced fan tray', 'Metrodata Support', 1200000, '2026-06-16', 'Completed');
  insertMaint.run('MNT-2027-0004', 10, '2026-09-05', 'Fuser Unit Failure', 'Fuser heating element failed; parts discontinued', 'Recommended for disposal & replacement', 'Internal IT', 0, null, 'Reported');

  // Seed Stock Opname
  db.prepare(`
    INSERT INTO stock_opname (opname_code, title, scheduled_date, location_id, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('OPN-2027-Q4-01', 'Q4 2026 Head Office IT & Finance Physical Audit', '2026-11-28', 2, 'In Progress', 'Annual physical verification for IT Operations Center');

  const insertOpDetail = db.prepare(`
    INSERT INTO stock_opname_details (opname_id, asset_id, scanned_code, expected_location_id, actual_location_id, expected_condition, actual_condition, expected_pic_id, actual_pic_id, verification_result, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertOpDetail.run(1, 1, 'OIMS-2027-000001', 2, 2, 'Good', 'Good', 2, 2, 'Verified', 'Physical tag & serial confirmed');
  insertOpDetail.run(1, 6, 'OIMS-2027-000006', 2, 2, 'Good', 'Major Damage', 2, 2, 'Condition Mismatch', 'UPS battery alarm active on rack inspection');
  insertOpDetail.run(1, 8, 'OIMS-2027-000008', 2, 2, 'Good', 'Good', 2, 2, 'Verified', 'Core switch verified in rack');

  // Seed Replacement Plans
  const insertRepl = db.prepare(`
    INSERT INTO replacement_plans (asset_id, assessment_year, asset_age_years, maintenance_count, total_maintenance_cost, priority_level, estimated_replacement_cost, planned_quarter, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRepl.run(10, 2027, 7.4, 2, 1800000, 'Urgent Replacement', 8500000, 'Q1', 'Unserviceable legacy printer past 4-year useful life', 'Approved');
  insertRepl.run(6, 2027, 5.5, 1, 6400000, 'Replacement Recommended', 32000000, 'Q2', 'Major battery/inverter wear nearing 6-year lifecycle', 'Planned');
  insertRepl.run(8, 2027, 6.0, 1, 1200000, 'Monitor', 45000000, 'Q4', 'Operating normally but past 4-year IT lifecycle', 'Planned');

  // Seed System Settings (configurable replacement thresholds, notification rules, branding)
  const insertSetting = db.prepare('INSERT INTO system_settings (setting_key, setting_value, category) VALUES (?, ?, ?)');
  insertSetting.run('company_name', 'KIDECO', 'branding');
  insertSetting.run('company_subtitle', 'Member of Indika Energy Group', 'branding');
  insertSetting.run('company_logo_url', '/assets/aistudio/logo_795e174b.png', 'branding');
  insertSetting.run('asset_code_prefix', 'OIMS', 'assets');
  insertSetting.run('replacement_age_warning_pct', '80', 'replacement');
  insertSetting.run('replacement_age_urgent_pct', '100', 'replacement');
  insertSetting.run('replacement_cost_ratio_pct', '40', 'replacement');
  insertSetting.run('notify_missing_qr', JSON.stringify({ enabled: true, priority: 'Medium' }), 'notifications');
  insertSetting.run('notify_missing_pic', JSON.stringify({ enabled: true, priority: 'High' }), 'notifications');
  insertSetting.run('notify_damaged_asset', JSON.stringify({ enabled: true, priority: 'High' }), 'notifications');
  insertSetting.run('notify_pending_movement', JSON.stringify({ enabled: true, priority: 'Medium' }), 'notifications');
  insertSetting.run('notify_open_maintenance', JSON.stringify({ enabled: true, priority: 'High' }), 'notifications');
  insertSetting.run('notify_opname_mismatch', JSON.stringify({ enabled: true, priority: 'Critical' }), 'notifications');
  insertSetting.run('notify_replacement_due', JSON.stringify({ enabled: true, priority: 'High' }), 'notifications');

  // Initial audit log
  db.prepare('INSERT INTO audit_logs (username, action, module, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)').run(
    'system', 'DATABASE_SEEDED', 'system', 'database', 'oims.db', JSON.stringify({ version: '2027.1', assets: 10 })
  );
}

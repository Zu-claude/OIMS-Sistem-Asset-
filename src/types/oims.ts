export type Lang = 'id' | 'en';

export type ModuleKey =
  | 'dashboard'
  | 'register'
  | 'database'
  | 'qr'
  | 'locations'
  | 'pic'
  | 'movements'
  | 'maintenance'
  | 'opname'
  | 'replacement'
  | 'reports'
  | 'governance'
  | 'operations'
  | 'users'
  | 'settings'
  | 'account';

export interface UserOrgScope {
  id: number;
  scope_level: 'holding' | 'company' | 'division';
  holding_id: number | null;
  holding_name: string | null;
  company_id: number | null;
  company_name: string | null;
  company_code: string | null;
  division_id: number | null;
  division_name: string | null;
  is_default: number;
}

export interface HoldingGroup {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  created_at?: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  phone?: string | null;
  department?: string | null;
  position_title?: string | null;
  avatar_url: string | null;
  last_login_at?: string | null;
  role_code: string;
  role_name: string;
  permissions: string[];
  org_scopes?: UserOrgScope[];
  is_holding_scope?: boolean;
  allowed_company_ids?: number[];
  company_wide_ids?: number[];
  division_scoped_ids?: number[];
}

export interface GovernanceUserOption {
  id: number;
  username: string;
  full_name: string;
  position_title?: string | null;
  role_code?: string | null;
  role_name?: string | null;
}

export interface MasterData {
  holdingGroups?: HoldingGroup[];
  companies: { id: number; holding_id?: number | null; code: string; name: string; address?: string }[];
  divisions: { id: number; company_id: number; code: string; name: string; department?: string; company_name?: string }[];
  categories: { id: number; code: string; name: string; default_useful_life_years: number }[];
  subcategories: { id: number; category_id: number; code: string; name: string }[];
  buildings: { id: number; company_id: number; code: string; name: string }[];
  floors: { id: number; building_id: number; name: string; level_number: number }[];
  rooms: { id: number; floor_id: number; name: string; room_code?: string }[];
  locations: {
    id: number;
    company_id: number;
    building_id: number;
    floor_id: number;
    room_id: number;
    specific_location: string;
    location_code: string;
    notes?: string;
    company_name: string;
    building_name: string;
    floor_name: string;
    room_name: string;
    asset_count: number;
  }[];
  persons: {
    id: number;
    nik_nip: string;
    full_name: string;
    company_id: number;
    division_id: number;
    department?: string;
    position_title: string;
    email: string;
    phone?: string;
    status: 'Active' | 'Inactive';
    company_name: string;
    division_name: string;
    asset_count: number;
  }[];
  governanceUsers?: GovernanceUserOption[];
  transferTargets?: {
    locations: {
      id: number;
      company_id: number;
      building_id: number;
      floor_id: number;
      room_id: number;
      specific_location: string;
      location_code: string;
      company_name: string;
      building_name: string;
      floor_name: string;
      room_name: string;
    }[];
    divisions: { id: number; company_id: number; code: string; name: string; department?: string; company_name?: string }[];
    persons: {
      id: number;
      nik_nip: string;
      full_name: string;
      company_id: number;
      division_id: number;
      position_title: string;
      status: 'Active' | 'Inactive';
      company_name?: string;
      division_name?: string;
    }[];
  };
}

export interface AssetRow {
  id: number;
  asset_code: string;
  asset_name: string;
  category_id: number;
  category_name: string;
  subcategory_id?: number | null;
  subcategory_name?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  description?: string | null;
  specification?: string | null;
  acquisition_date: string;
  acquisition_value: number;
  supplier?: string | null;
  purchase_reference?: string | null;
  warranty_period_months?: number;
  acquisition_source?: string;
  company_id: number;
  company_code?: string;
  company_name: string;
  division_id: number;
  division_name: string;
  responsible_division_id?: number | null;
  responsible_division_name?: string | null;
  department?: string | null;
  location_id: number;
  building_name: string;
  floor_name: string;
  room_name: string;
  specific_location: string;
  location_code: string;
  pic_id?: number | null;
  pic_name?: string | null;
  pic_nik?: string | null;
  custodian_person_id?: number | null;
  custodian_name?: string | null;
  data_owner_user_id?: number | null;
  data_owner_name?: string | null;
  verification_officer_user_id?: number | null;
  verification_officer_name?: string | null;
  approver_user_id?: number | null;
  approver_name?: string | null;
  condition_status: 'Good' | 'Minor Damage' | 'Major Damage' | 'Unserviceable';
  asset_status: 'Active' | 'In Maintenance' | 'Pending Transfer' | 'Missing' | 'Disposed';
  primary_photo_url?: string | null;
  photo_count?: number;
  qr_token?: string | null;
  public_slug?: string | null;
  qr_status?: 'Active' | 'Revoked' | null;
  public_enabled?: number;
  public_show_photo?: number;
  public_show_location?: number;
  qr_expires_at?: string | null;
  qr_generated_at?: string | null;
  legal_hold?: number;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type QrAccessTier = 'public' | 'authenticated' | 'administrative';

export interface QrAccessLogRow {
  id: number;
  qr_id?: number | null;
  asset_id?: number | null;
  asset_code?: string | null;
  asset_name?: string | null;
  token_attempted?: string | null;
  access_tier: QrAccessTier | 'denied';
  outcome: 'granted' | 'revoked' | 'expired' | 'public_disabled' | 'forbidden' | 'rate_limited' | 'not_found';
  user_id?: number | null;
  username?: string | null;
  user_full_name?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  accessed_at: string;
}

export interface FieldCaptureRow {
  id: number;
  company_id: number;
  asset_id: number;
  asset_code?: string | null;
  asset_name?: string | null;
  qr_id?: number | null;
  opname_id?: number | null;
  captured_by_user_id?: number | null;
  captured_by_username?: string | null;
  captured_by_name?: string | null;
  capture_context: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters?: number | null;
  photo_url?: string | null;
  condition_observed?: string | null;
  notes?: string | null;
  captured_at: string;
}

export type ReconciliationStatus =
  | 'MATCHED'
  | 'LOCATION_MISMATCH'
  | 'CONDITION_MISMATCH'
  | 'UNIDENTIFIED_ASSET'
  | 'MISSING_ASSET'
  | 'DUPLICATE_SUSPECTED'
  | 'INCOMPLETE_DATA'
  | 'QR_MISMATCH'
  | 'PENDING_REVIEW';

export interface ReconciliationFindingRow {
  id: number;
  finding_code: string;
  company_id: number;
  company_name?: string | null;
  company_code?: string | null;
  opname_id?: number | null;
  opname_code?: string | null;
  asset_id?: number | null;
  asset_code?: string | null;
  asset_name?: string | null;
  scanned_code?: string | null;
  reconciliation_status: ReconciliationStatus;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  title: string;
  discrepancy_summary: string;
  expected_snapshot_json?: string | null;
  observed_snapshot_json?: string | null;
  evidence_photo_url?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  assigned_to_user_id?: number | null;
  assigned_to_name?: string | null;
  resolution_status: 'Open' | 'In Review' | 'Resolved' | 'Dismissed';
  resolution_notes?: string | null;
  master_updated: number;
  resolved_by_user_id?: number | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReconciliationSummary {
  total: number;
  open_count: number;
  matched_count: number;
  missing_count: number;
  location_mismatch_count: number;
  condition_mismatch_count: number;
  unidentified_count: number;
  duplicate_count: number;
  other_anomaly_count: number;
}

export interface AssetEventRow {
  id: number;
  event_uuid: string;
  company_id: number;
  company_name?: string;
  company_code?: string;
  asset_id?: number | null;
  asset_code?: string | null;
  asset_name?: string | null;
  qr_id?: number | null;
  event_type: string;
  actor_user_id?: number | null;
  actor_username?: string | null;
  actor_full_name?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  reason?: string | null;
  previous_state_json?: string | null;
  new_state_json?: string | null;
  prev_hash: string;
  event_hash: string;
  created_at: string;
}

export interface AssetOwnershipHistoryRow {
  id: number;
  asset_id: number;
  from_company_id?: number | null;
  to_company_id: number;
  from_company_name?: string | null;
  to_company_name?: string | null;
  from_division_id?: number | null;
  to_division_id: number;
  from_division_name?: string | null;
  to_division_name?: string | null;
  from_custodian_person_id?: number | null;
  to_custodian_person_id?: number | null;
  from_custodian_name?: string | null;
  to_custodian_name?: string | null;
  movement_id?: number | null;
  changed_by_user_id?: number | null;
  changed_by_name?: string | null;
  reason?: string | null;
  changed_at: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  title: string;
  message: string;
  entity_type?: string;
  entity_id?: number;
  is_read: number;
  created_at: string;
}

export interface RetentionPolicyRow {
  id: number;
  policy_code: string;
  record_class: string;
  title: string;
  description?: string | null;
  retention_days: number;
  action_mode: 'immutable_retain' | 'archive_record' | 'purge_non_ledger';
  is_immutable_ledger: number;
  is_active: number;
  last_evaluated_at?: string | null;
  updated_at: string;
}

export interface LegalHoldRow {
  id: number;
  hold_code: string;
  company_id: number;
  company_name?: string;
  company_code?: string;
  asset_id: number;
  asset_code?: string;
  asset_name?: string;
  asset_status?: string;
  legal_hold?: number;
  hold_reason: string;
  status: 'Active' | 'Released';
  placed_by_name?: string | null;
  placed_at: string;
  released_by_name?: string | null;
  released_at?: string | null;
  release_notes?: string | null;
}

export interface EnterpriseSopRow {
  id: number;
  sop_code: string;
  company_id?: number | null;
  company_name?: string | null;
  title: string;
  category: string;
  version: string;
  mandatory_module: string;
  checklist_json: string;
  is_mandatory: number;
  is_active: number;
  updated_at: string;
}

export interface SopExecutionRow {
  id: number;
  execution_code: string;
  sop_id: number;
  sop_code?: string;
  sop_title?: string;
  sop_category?: string;
  company_id: number;
  company_name?: string;
  asset_id?: number | null;
  asset_code?: string | null;
  asset_name?: string | null;
  module_context: string;
  executed_by_name?: string | null;
  checklist_results_json: string;
  compliance_status: 'Compliant' | 'Deviation';
  deviation_notes?: string | null;
  signed_off_at: string;
}

export interface IntegrationConnectorRow {
  id: number;
  connector_code: string;
  company_id?: number | null;
  company_name?: string | null;
  name: string;
  connector_type: 'erp_sync' | 'hris_sync' | 'procurement_sync' | 'webhook';
  endpoint_url: string;
  auth_scheme: 'None' | 'Bearer Env' | 'HMAC Header';
  env_secret_ref?: string | null;
  env_secret_configured?: boolean;
  data_classification: 'Public' | 'Internal' | 'Confidential';
  is_enabled: number;
  last_test_status?: string | null;
  last_tested_at?: string | null;
}

export interface IntegrationLogRow {
  id: number;
  connector_id: number;
  connector_code?: string;
  connector_name?: string;
  direction: 'outbound' | 'dry_run';
  status: 'Success' | 'DryRun' | 'Blocked' | 'Failed';
  http_status?: number | null;
  request_summary?: string | null;
  response_summary?: string | null;
  triggered_by_username?: string | null;
  created_at: string;
}

export interface AiSettingsStatus {
  smart_ai_enabled: boolean;
  smart_ai_external_allowed: boolean;
  geminiKeyConfigured: boolean;
}

export interface AiIdentificationRow {
  id: number;
  identification_code: string;
  company_id: number;
  company_name?: string;
  asset_id?: number | null;
  asset_code?: string | null;
  asset_name?: string | null;
  master_serial_number?: string | null;
  master_brand?: string | null;
  master_model?: string | null;
  master_specification?: string | null;
  master_category_id?: number | null;
  source_photo_url: string;
  photo_sha256?: string | null;
  analysis_mode: 'local_dedup_similarity' | 'gemini_vision_ocr';
  external_consent_confirmed: number;
  model_used?: string | null;
  extracted_serial_number?: string | null;
  extracted_label?: string | null;
  extracted_brand?: string | null;
  extracted_model?: string | null;
  extracted_specs?: string | null;
  recommended_category_id?: number | null;
  recommended_category_name?: string | null;
  duplicate_matches_json?: string | null;
  similarity_matches_json?: string | null;
  verification_status: 'Pending Review' | 'Accepted' | 'Rejected' | 'Applied';
  applied_fields_json?: string | null;
  requested_by_name?: string | null;
  verified_by_name?: string | null;
  verified_at?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface SystemHealthReport {
  collectedAt: string;
  overallStatus: 'Healthy' | 'Attention Required';
  database: {
    engine: string;
    quickCheck: string;
    foreignKeyViolations: number;
    tableCount: number;
    expectedTableCount: number;
    dbFileSizeBytes: number;
    walFileSizeBytes: number;
    shmFileSizeBytes: number;
    totalDbBytes: number;
  };
  storage: {
    uploadsFileCount: number;
    uploadsTotalBytes: number;
    photosFileCount: number;
    photosBytes: number;
    docsFileCount: number;
    docsBytes: number;
    fieldFileCount: number;
    fieldBytes: number;
    diskTotalBytes: number | null;
    diskFreeBytes: number | null;
    diskUsedPct: number | null;
  };
  operations: {
    totalAssets: number;
    activeAssets: number;
    archivedAssets: number;
    legalHoldAssets: number;
    activeQrCodes: number;
    revokedQrCodes: number;
    qrScans24h: number;
    qrGranted24h: number;
    qrDenied24h: number;
    qrRateLimited24h: number;
    assetPhotosRecords: number;
    assetDocumentsRecords: number;
    fieldCapturesRecords: number;
    failedIntegrations7d: number;
    failedAuthOrUpload7d: number;
    openReconciliationFindings: number;
    sopDeviations7d: number;
    eventChainValid: boolean;
    eventChainCheckedCount: number;
    brokenEventId: number | null;
  };
  runtime: {
    uptimeSeconds: number;
    nodeVersion: string;
    rssMb: number;
    heapUsedMb: number;
    rpoTargetMinutes: number;
    rtoTargetMinutes: number;
    backupRetentionCount: number;
  };
  readiness: {
    googleCloudConnected: boolean;
    localSelfContainedStorage: boolean;
    envPasscodeConfigured: boolean;
    smtpConfigured: boolean;
    geminiApiKeyConfigured: boolean;
    smartAiKillSwitchEnabled: boolean;
  };
}

export interface DrBackupVerificationRow {
  id: number;
  verification_code: string;
  verification_type: string;
  backup_version?: string | null;
  snapshot_sha256?: string | null;
  table_count: number;
  record_count: number;
  rpo_minutes?: number | null;
  rto_minutes?: number | null;
  status: 'Passed' | 'Warning' | 'Failed';
  summary: string;
  details_json?: string | null;
  verified_by_name?: string | null;
  verified_by_username?: string | null;
  created_at: string;
}

export interface BcpRunbookRow {
  id: number;
  runbook_code: string;
  title: string;
  scenario: string;
  rto_target_minutes: number;
  rpo_target_minutes: number;
  owner_role: string;
  steps_json: string;
  last_tested_at?: string | null;
  last_test_status: 'Not Tested' | 'Passed' | 'Action Required';
  updated_by_name?: string | null;
  updated_at: string;
}

export interface QualityGateCheckItem {
  key: string;
  title: string;
  status: 'Passed' | 'Warning' | 'Failed';
  detail: string;
}

export interface QualityGateReport {
  evaluatedAt: string;
  releaseTag: string;
  overallStatus: 'Passed' | 'Conditional' | 'Failed';
  checksPassed: number;
  checksTotal: number;
  checks: QualityGateCheckItem[];
}

export interface AcceptanceSignoffRow {
  id: number;
  release_tag: string;
  gate_scope: string;
  gate_status: 'Passed' | 'Conditional' | 'Failed';
  checks_passed: number;
  checks_total: number;
  checks_json: string;
  notes?: string | null;
  signed_off_by_name?: string | null;
  signed_off_by_username?: string | null;
  signed_off_at: string;
}

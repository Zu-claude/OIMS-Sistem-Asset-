import crypto from 'crypto';
import { db } from './db';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(canonicalize(value));
}

export function computeAssetEventHash(
  prevHash: string,
  payload: {
    event_uuid: string;
    company_id: number;
    asset_id: number | null;
    qr_id: number | null;
    event_type: string;
    actor_user_id: number | null;
    actor_username: string | null;
    reference_type: string | null;
    reference_id: string | null;
    reason: string | null;
    previous_state_json: string | null;
    new_state_json: string | null;
    created_at: string;
  }
): string {
  const material = JSON.stringify({
    prev_hash: prevHash,
    event_uuid: payload.event_uuid,
    company_id: payload.company_id,
    asset_id: payload.asset_id,
    qr_id: payload.qr_id,
    event_type: payload.event_type,
    actor_user_id: payload.actor_user_id,
    actor_username: payload.actor_username,
    reference_type: payload.reference_type,
    reference_id: payload.reference_id,
    reason: payload.reason,
    previous_state_json: payload.previous_state_json,
    new_state_json: payload.new_state_json,
    created_at: payload.created_at,
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

export function getAssetStateSnapshot(assetId: number): Record<string, unknown> | null {
  const row = db
    .prepare(`
      SELECT id, asset_code, asset_name, company_id, division_id, department,
             location_id, pic_id, custodian_person_id, responsible_division_id,
             data_owner_user_id, verification_officer_user_id, approver_user_id,
             condition_status, asset_status, deleted_at
      FROM assets
      WHERE id = ?
    `)
    .get(assetId) as Record<string, unknown> | undefined;
  return row || null;
}

export interface AppendAssetEventInput {
  companyId: number;
  assetId?: number | null;
  qrId?: number | null;
  eventType: string;
  actorUserId?: number | null;
  actorUsername?: string | null;
  referenceType?: string | null;
  referenceId?: string | number | null;
  reason?: string | null;
  previousState?: unknown;
  newState?: unknown;
  createdAt?: string;
}

export function appendAssetEvent(input: AppendAssetEventInput): { id: number; event_uuid: string; event_hash: string } {
  const latest = db.prepare('SELECT event_hash FROM asset_events ORDER BY id DESC LIMIT 1').get() as
    | { event_hash: string }
    | undefined;
  const prevHash = latest?.event_hash || 'GENESIS';
  const eventUuid = crypto.randomUUID();
  const createdAt = input.createdAt || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const previousStateJson = canonicalJson(input.previousState);
  const newStateJson = canonicalJson(input.newState);
  const refIdStr = input.referenceId !== undefined && input.referenceId !== null ? String(input.referenceId) : null;

  const eventHash = computeAssetEventHash(prevHash, {
    event_uuid: eventUuid,
    company_id: Number(input.companyId),
    asset_id: input.assetId ?? null,
    qr_id: input.qrId ?? null,
    event_type: input.eventType,
    actor_user_id: input.actorUserId ?? null,
    actor_username: input.actorUsername ?? null,
    reference_type: input.referenceType ?? null,
    reference_id: refIdStr,
    reason: input.reason ?? null,
    previous_state_json: previousStateJson,
    new_state_json: newStateJson,
    created_at: createdAt,
  });

  const info = db
    .prepare(`
      INSERT INTO asset_events (
        event_uuid, company_id, asset_id, qr_id, event_type,
        actor_user_id, actor_username, reference_type, reference_id,
        reason, previous_state_json, new_state_json, prev_hash, event_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      eventUuid,
      Number(input.companyId),
      input.assetId ?? null,
      input.qrId ?? null,
      input.eventType,
      input.actorUserId ?? null,
      input.actorUsername ?? null,
      input.referenceType ?? null,
      refIdStr,
      input.reason ?? null,
      previousStateJson,
      newStateJson,
      prevHash,
      eventHash,
      createdAt
    );

  return {
    id: Number(info.lastInsertRowid),
    event_uuid: eventUuid,
    event_hash: eventHash,
  };
}

export interface EventChainVerificationResult {
  valid: boolean;
  checkedCount: number;
  scopedEventCount: number;
  brokenEventId: number | null;
  brokenReason: string | null;
  genesisHash: string;
  latestHash: string | null;
}

export function verifyAssetEventChain(scopedCompanyIds?: number[] | null): EventChainVerificationResult {
  const rows = db
    .prepare(`
      SELECT id, event_uuid, company_id, asset_id, qr_id, event_type,
             actor_user_id, actor_username, reference_type, reference_id,
             reason, previous_state_json, new_state_json, prev_hash, event_hash, created_at
      FROM asset_events
      ORDER BY id ASC
    `)
    .all() as {
      id: number;
      event_uuid: string;
      company_id: number;
      asset_id: number | null;
      qr_id: number | null;
      event_type: string;
      actor_user_id: number | null;
      actor_username: string | null;
      reference_type: string | null;
      reference_id: string | null;
      reason: string | null;
      previous_state_json: string | null;
      new_state_json: string | null;
      prev_hash: string;
      event_hash: string;
      created_at: string;
    }[];

  let expectedPrev = 'GENESIS';
  let latestHash: string | null = null;
  let scopedEventCount = 0;
  const scopeSet = scopedCompanyIds && scopedCompanyIds.length > 0 ? new Set(scopedCompanyIds) : null;

  for (const row of rows) {
    if (!scopeSet || scopeSet.has(row.company_id)) {
      scopedEventCount += 1;
    }

    if (row.prev_hash !== expectedPrev) {
      return {
        valid: false,
        checkedCount: rows.length,
        scopedEventCount,
        brokenEventId: row.id,
        brokenReason: `Previous hash mismatch at event #${row.id}`,
        genesisHash: 'GENESIS',
        latestHash,
      };
    }

    const expectedHash = computeAssetEventHash(row.prev_hash, {
      event_uuid: row.event_uuid,
      company_id: row.company_id,
      asset_id: row.asset_id,
      qr_id: row.qr_id,
      event_type: row.event_type,
      actor_user_id: row.actor_user_id,
      actor_username: row.actor_username,
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      reason: row.reason,
      previous_state_json: row.previous_state_json,
      new_state_json: row.new_state_json,
      created_at: row.created_at,
    });

    if (row.event_hash !== expectedHash) {
      return {
        valid: false,
        checkedCount: rows.length,
        scopedEventCount,
        brokenEventId: row.id,
        brokenReason: `Payload digest mismatch at event #${row.id}`,
        genesisHash: 'GENESIS',
        latestHash,
      };
    }

    expectedPrev = row.event_hash;
    latestHash = row.event_hash;
  }

  return {
    valid: true,
    checkedCount: rows.length,
    scopedEventCount,
    brokenEventId: null,
    brokenReason: null,
    genesisHash: 'GENESIS',
    latestHash,
  };
}

import { db } from './db';

interface RuleConfig {
  enabled: boolean;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
}

function getRule(key: string, fallbackPriority: RuleConfig['priority']): RuleConfig {
  const row = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').get(key) as
    | { setting_value: string }
    | undefined;
  if (!row) return { enabled: true, priority: fallbackPriority };
  try {
    const parsed = JSON.parse(row.setting_value) as RuleConfig;
    return {
      enabled: parsed.enabled !== false,
      priority: parsed.priority || fallbackPriority,
    };
  } catch {
    return { enabled: true, priority: fallbackPriority };
  }
}

export function syncAutomatedNotifications() {
  const insertNotif = db.prepare(`
    INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      priority = excluded.priority,
      title = excluded.title,
      message = excluded.message
  `);

  const activeKeys = new Set<string>();

  // 1. Assets missing QR Code
  const missingQrRule = getRule('notify_missing_qr', 'Medium');
  if (missingQrRule.enabled) {
    const missingQrAssets = db
      .prepare(`
        SELECT a.id, a.asset_code, a.asset_name
        FROM assets a
        LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
        WHERE a.deleted_at IS NULL AND q.id IS NULL
      `)
      .all() as { id: number; asset_code: string; asset_name: string }[];

    for (const a of missingQrAssets) {
      const key = `missing_qr_${a.id}`;
      activeKeys.add(key);
      insertNotif.run(
        'missing_qr',
        missingQrRule.priority,
        `Missing QR Code: ${a.asset_code}`,
        `${a.asset_name} does not have a generated QR tag yet.`,
        'asset',
        a.id,
        key
      );
    }
  }

  // 2. Assets missing PIC
  const missingPicRule = getRule('notify_missing_pic', 'High');
  if (missingPicRule.enabled) {
    const missingPicAssets = db
      .prepare(`
        SELECT id, asset_code, asset_name
        FROM assets
        WHERE deleted_at IS NULL AND pic_id IS NULL
      `)
      .all() as { id: number; asset_code: string; asset_name: string }[];

    for (const a of missingPicAssets) {
      const key = `missing_pic_${a.id}`;
      activeKeys.add(key);
      insertNotif.run(
        'missing_pic',
        missingPicRule.priority,
        `Unassigned PIC: ${a.asset_code}`,
        `${a.asset_name} has no assigned Person In Charge (PIC).`,
        'asset',
        a.id,
        key
      );
    }
  }

  // 3. Damaged / Unserviceable Assets
  const damagedRule = getRule('notify_damaged_asset', 'High');
  if (damagedRule.enabled) {
    const damagedAssets = db
      .prepare(`
        SELECT id, asset_code, asset_name, condition_status
        FROM assets
        WHERE deleted_at IS NULL AND condition_status IN ('Minor Damage', 'Major Damage', 'Unserviceable')
      `)
      .all() as { id: number; asset_code: string; asset_name: string; condition_status: string }[];

    for (const a of damagedAssets) {
      const key = `damaged_asset_${a.id}`;
      activeKeys.add(key);
      insertNotif.run(
        'damaged_asset',
        a.condition_status === 'Unserviceable' ? 'Critical' : damagedRule.priority,
        `Condition Alert (${a.condition_status}): ${a.asset_code}`,
        `${a.asset_name} is marked as ${a.condition_status}.`,
        'asset',
        a.id,
        key
      );
    }
  }

  // 4. Pending Movement Approvals
  const moveRule = getRule('notify_pending_movement', 'Medium');
  if (moveRule.enabled) {
    const pendingMoves = db
      .prepare(`
        SELECT m.id, m.movement_code, a.asset_code, a.asset_name
        FROM asset_movements m
        JOIN assets a ON a.id = m.asset_id
        WHERE m.status = 'Pending Approval'
      `)
      .all() as { id: number; movement_code: string; asset_code: string; asset_name: string }[];

    for (const m of pendingMoves) {
      const key = `pending_movement_${m.id}`;
      activeKeys.add(key);
      insertNotif.run(
        'pending_movement',
        moveRule.priority,
        `Transfer Approval Needed: ${m.movement_code}`,
        `${m.asset_code} (${m.asset_name}) is awaiting supervisor approval.`,
        'movement',
        m.id,
        key
      );
    }
  }

  // 5. Incomplete Maintenance
  const maintRule = getRule('notify_open_maintenance', 'High');
  if (maintRule.enabled) {
    const openMaint = db
      .prepare(`
        SELECT m.id, m.ticket_code, m.status, a.asset_code, a.asset_name
        FROM maintenance_records m
        JOIN assets a ON a.id = m.asset_id
        WHERE m.status IN ('Reported', 'Waiting Approval', 'In Progress')
      `)
      .all() as { id: number; ticket_code: string; status: string; asset_code: string; asset_name: string }[];

    for (const m of openMaint) {
      const key = `open_maintenance_${m.id}`;
      activeKeys.add(key);
      insertNotif.run(
        'open_maintenance',
        maintRule.priority,
        `Open Maintenance (${m.status}): ${m.ticket_code}`,
        `${m.asset_code} (${m.asset_name}) requires maintenance follow-up.`,
        'maintenance',
        m.id,
        key
      );
    }
  }

  // 6. Stock Opname Not Found / Mismatches
  const opnameRule = getRule('notify_opname_mismatch', 'Critical');
  if (opnameRule.enabled) {
    const opnameIssues = db
      .prepare(`
        SELECT d.id, d.scanned_code, d.verification_result, o.opname_code
        FROM stock_opname_details d
        JOIN stock_opname o ON o.id = d.opname_id
        WHERE d.verification_result IN ('Not Found', 'Location Mismatch', 'Condition Mismatch', 'QR Code Missing')
      `)
      .all() as { id: number; scanned_code: string; verification_result: string; opname_code: string }[];

    for (const d of opnameIssues) {
      const key = `opname_issue_${d.id}`;
      activeKeys.add(key);
      insertNotif.run(
        'opname_mismatch',
        d.verification_result === 'Not Found' ? 'Critical' : opnameRule.priority,
        `Opname Variance (${d.verification_result}): ${d.scanned_code}`,
        `Audit ${d.opname_code} flagged ${d.scanned_code} as ${d.verification_result}.`,
        'opname',
        d.id,
        key
      );
    }
  }

  // 7. Urgent / Recommended Replacements
  const replRule = getRule('notify_replacement_due', 'High');
  if (replRule.enabled) {
    const replDue = db
      .prepare(`
        SELECT r.id, r.priority_level, a.asset_code, a.asset_name
        FROM replacement_plans r
        JOIN assets a ON a.id = r.asset_id
        WHERE r.priority_level IN ('Replacement Recommended', 'Urgent Replacement') AND r.status != 'Procured'
      `)
      .all() as { id: number; priority_level: string; asset_code: string; asset_name: string }[];

    for (const r of replDue) {
      const key = `replacement_due_${r.id}`;
      activeKeys.add(key);
      insertNotif.run(
        'replacement_due',
        r.priority_level === 'Urgent Replacement' ? 'Critical' : replRule.priority,
        `${r.priority_level}: ${r.asset_code}`,
        `${r.asset_name} is queued for lifecycle replacement planning.`,
        'replacement',
        r.id,
        key
      );
    }
  }

  // 8. SOP Operational Deviations
  const sopDeviations = db
    .prepare(`
      SELECT se.id, se.execution_code, se.module_context, s.sop_code, s.title as sop_title, a.asset_code
      FROM sop_executions se
      JOIN enterprise_sops s ON s.id = se.sop_id
      LEFT JOIN assets a ON a.id = se.asset_id
      WHERE se.compliance_status = 'Deviation'
      ORDER BY se.id DESC
      LIMIT 50
    `)
    .all() as {
      id: number;
      execution_code: string;
      module_context: string;
      sop_code: string;
      sop_title: string;
      asset_code: string | null;
    }[];

  for (const d of sopDeviations) {
    const key = `sop_deviation_${d.id}`;
    activeKeys.add(key);
    insertNotif.run(
      'sop_deviation',
      'High',
      `SOP Deviation (${d.sop_code}): ${d.execution_code}`,
      `${d.sop_title}${d.asset_code ? ` · Asset ${d.asset_code}` : ''} (${d.module_context}) flagged non-compliance.`,
      'sop_execution',
      d.id,
      key
    );
  }

  // Clean up resolved auto-notifications
  const existing = db.prepare('SELECT id, dedupe_key FROM notifications WHERE dedupe_key IS NOT NULL').all() as {
    id: number;
    dedupe_key: string;
  }[];
  const del = db.prepare('DELETE FROM notifications WHERE id = ?');
  for (const row of existing) {
    if (!activeKeys.has(row.dedupe_key)) {
      del.run(row.id);
    }
  }
}

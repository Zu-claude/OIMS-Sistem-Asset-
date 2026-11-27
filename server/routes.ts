import express, { type Express } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import QRCode from 'qrcode';
import { db, initDatabase } from './db';
import {
  authenticate,
  requirePermission,
  hashPassword,
  verifyPassword,
  signSessionToken,
  getUserWithPermissions,
  checkAuthRateLimit,
  logAudit,
  resolveRequestOrgScope,
  buildAssetScopeSql,
  buildCompanyScopeSql,
  canUserAccessRecord,
  type AuthenticatedRequest,
} from './auth';
import { syncAutomatedNotifications } from './notifications';
import { generateMysqlDump } from './mysql-export';
import { isEmailConfigured, sendPasswordResetConfirmationEmail, sendPasswordResetEmail } from './mailer';
import { appendAssetEvent, getAssetStateSnapshot, verifyAssetEventChain } from './events';
import {
  findCrossAssetPhotoDuplicates,
  findSimilarAssetsAndCategory,
  isGeminiApiKeyConfigured,
  readLocalAssetPhotoWithHash,
  runGeminiVisionAssetOcr,
  validateExternalEndpointUrl,
} from './ai';
import {
  BACKUP_ORDERED_TABLES,
  EXPECTED_SCHEMA_TABLES,
  collectSystemHealthReport,
  runDrIntegrityVerification,
  runEnterpriseQualityGate,
  verifySnapshotPayloadDryRun,
} from './health';

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// Disk storage retained strictly for System Settings custom corporate branding logo
const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_IMAGE_EXTS.has(ext) ? ext : '.png';
    cb(null, `logo-${Date.now()}-${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype) && ALLOWED_IMAGE_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported logo file type. Allowed: JPG, PNG, WEBP'));
    }
  },
});

// Local disk storage for asset photos & invoice/supporting documents
const assetFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTS.has(ext) ? ext : '.bin';
    const rawKind = String((req as any).body?.kind || 'file') === 'document' ? 'doc' : 'photo';
    cb(null, `asset-${rawKind}-${Date.now()}-${crypto.randomUUID()}${safeExt}`);
  },
});

const assetFileUpload = multer({
  storage: assetFileStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.has(file.mimetype) && ALLOWED_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: JPG, PNG, WEBP, PDF'));
    }
  },
});

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authUser?.id ?? 'user';
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_IMAGE_EXTS.has(ext) ? ext : '.png';
      cb(null, `avatar-${uid}-${Date.now()}-${crypto.randomUUID()}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype) && ALLOWED_IMAGE_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported profile photo format. Allowed: JPG, PNG, WEBP'));
    }
  },
});

function runAvatarUploadSingle(req: express.Request, res: express.Response): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadAvatar.single('avatar')(req, res, (err: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function deleteOwnedLocalAvatar(avatarUrl: string | null | undefined, userId: number) {
  if (!avatarUrl || !avatarUrl.startsWith(`/uploads/avatar-${userId}-`)) return;
  const filename = path.basename(avatarUrl);
  const resolved = path.resolve(uploadsDir, filename);
  if (resolved.startsWith(uploadsDir + path.sep) && fs.existsSync(resolved)) {
    try {
      fs.unlinkSync(resolved);
    } catch {
      // ignore cleanup failure
    }
  }
}

function runAssetFileUploadSingle(req: express.Request, res: express.Response): Promise<void> {
  return new Promise((resolve, reject) => {
    assetFileUpload.single('file')(req, res, (err: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function isValidLocalAssetUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  const trimmed = rawUrl.trim();
  if (
    trimmed.startsWith('/src/assets/images/') ||
    trimmed.startsWith('/assets/aistudio/') ||
    trimmed.startsWith('/uploads/')
  ) {
    return !trimmed.includes('..');
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeFileName(rawName: string): string {
  const base = path.basename(rawName || 'attachment');
  return base.replace(/[^\w.\-() ]+/g, '_').slice(0, 180) || 'attachment';
}

function generateNextAssetCode(): string {
  const year = new Date().getFullYear() < 2027 ? 2027 : new Date().getFullYear();
  const prefix = `OIMS-${year}-`;
  const row = db
    .prepare('SELECT asset_code FROM assets WHERE asset_code LIKE ? ORDER BY id DESC LIMIT 1')
    .get(`${prefix}%`) as { asset_code: string } | undefined;
  let seq = 1;
  if (row) {
    const parts = row.asset_code.split('-');
    const lastNum = parseInt(parts[2] || '0', 10);
    if (!Number.isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

function generateQrSlug(): string {
  return crypto.randomBytes(12).toString('base64url');
}

const publicQrRateMap = new Map<string, { count: number; resetAt: number }>();

function checkPublicQrRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const key = ip || 'unknown';
  const entry = publicQrRateMap.get(key);
  if (!entry || entry.resetAt < now) {
    publicQrRateMap.set(key, { count: 1, resetAt: now + 60 * 1000 });
    return { allowed: true };
  }
  if (entry.count >= 30) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { allowed: true };
}

function extractQrSlugOrToken(rawInput: string): string {
  let clean = String(rawInput || '').trim();
  if (!clean) return '';
  if (clean.includes('qr=')) {
    clean = clean.split('qr=').pop()!.split('&')[0];
  } else if (clean.includes('token=')) {
    clean = clean.split('token=').pop()!.split('&')[0];
  } else if (clean.includes('/qr/')) {
    clean = clean.split('/qr/').pop()!.split('?')[0].split('#')[0];
  }
  return clean.trim().slice(0, 160);
}

function recordQrAccessLog(params: {
  qrId?: number | null;
  assetId?: number | null;
  tokenAttempted: string;
  accessTier: 'public' | 'authenticated' | 'administrative' | 'denied';
  outcome: 'granted' | 'revoked' | 'expired' | 'not_found' | 'rate_limited' | 'forbidden' | 'public_disabled';
  userId?: number | null;
  req: express.Request;
}) {
  try {
    const ip = String(params.req.ip || params.req.headers['x-forwarded-for'] || 'unknown').slice(0, 64);
    const ua = String(params.req.headers['user-agent'] || '').slice(0, 300);
    db.prepare(`
      INSERT INTO qr_access_logs (qr_id, asset_id, token_attempted, access_tier, outcome, user_id, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.qrId ?? null,
      params.assetId ?? null,
      params.tokenAttempted.slice(0, 160) || 'empty',
      params.accessTier,
      params.outcome,
      params.userId ?? null,
      ip,
      ua || null
    );
  } catch {
    // non-fatal logging fallback
  }
}

function getQrAccessTier(authUser: AuthenticatedRequest['authUser']): 'authenticated' | 'administrative' {
  if (!authUser) return 'authenticated';
  if (
    authUser.role_code === 'super_admin' ||
    authUser.role_code === 'approver' ||
    authUser.role_code === 'auditor' ||
    authUser.permissions.includes('assets.edit') ||
    authUser.permissions.includes('settings.view')
  ) {
    return 'administrative';
  }
  return 'authenticated';
}

export function registerRoutes(app: Express) {
  // Serve uploaded files safely with nosniff and path confinement
  app.get('/uploads/:filename', (req, res) => {
    const rawName = path.basename(req.params.filename);
    const resolved = path.resolve(uploadsDir, rawName);
    if (!resolved.startsWith(uploadsDir + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(resolved);
  });

  // =========================================================================
  // DATABASE INSTALLER CHECK & INITIAL SUPER ADMINISTRATOR SETUP
  // =========================================================================
  function inspectInstallerState() {
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    const tables = tableRows.map((r) => r.name);
    const tablesReady = tables.includes('users') && tables.includes('roles') && tables.includes('user_roles');

    let adminCount = 0;
    if (tablesReady) {
      adminCount = (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'super_admin' AND u.password_hash IS NOT NULL"
          )
          .get() as { c: number }
      ).c;
    }

    return {
      tables,
      tableCount: tables.length,
      expectedTableCount: EXPECTED_SCHEMA_TABLES,
      tablesReady,
      hasAdminUser: adminCount > 0,
      needsInstall: !tablesReady || adminCount === 0,
    };
  }

  app.get('/api/install/status', (_req, res) => {
    const state = inspectInstallerState();
    res.json(state);
  });

  app.get('/api/auth/status', (_req, res) => {
    const adminPasscodeSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim());
    const state = inspectInstallerState();

    let branding: Record<string, string> = {};
    if (state.tables.includes('system_settings')) {
      const brandRows = db
        .prepare("SELECT setting_key, setting_value FROM system_settings WHERE category = 'branding'")
        .all() as { setting_key: string; setting_value: string }[];
      for (const r of brandRows) branding[r.setting_key] = r.setting_value;
    }

    res.json({
      needsSetup: state.needsInstall,
      installStatus: {
        tableCount: state.tableCount,
        expectedTableCount: state.expectedTableCount,
        tablesReady: state.tablesReady,
        hasAdminUser: state.hasAdminUser,
      },
      hasEnvPasscode: adminPasscodeSet,
      smtpConfigured: isEmailConfigured(),
      branding,
    });
  });

  const handleInstallOrSetup = (req: express.Request, res: express.Response) => {
    const rate = checkAuthRateLimit(req.ip || 'unknown');
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many attempts. Retry in ${rate.retryAfterSec}s` });
      return;
    }

    let state = inspectInstallerState();
    if (!state.tablesReady) {
      initDatabase();
      state = inspectInstallerState();
    }

    if (state.hasAdminUser) {
      res.status(403).json({ error: 'Installation already complete. Super Administrator already exists in users table.' });
      return;
    }

    const { username, email, full_name, password, confirmPassword, seedRoleAccounts } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
    if (!emailValid) {
      res.status(400).json({ error: 'Please enter a valid Super Administrator email address.' });
      return;
    }
    if (!password || String(password).length < 8) {
      res.status(400).json({ error: 'Super Administrator password must be at least 8 characters.' });
      return;
    }
    if (confirmPassword !== undefined && String(password) !== String(confirmPassword)) {
      res.status(400).json({ error: 'Password confirmation does not match.' });
      return;
    }

    const derivedUsername = cleanEmail.split('@')[0]?.replace(/[^a-z0-9._-]/g, '') || 'admin';
    const cleanUsername = String(username || derivedUsername).trim().toLowerCase();
    const cleanName = String(full_name || 'Super Administrator').trim() || 'Super Administrator';
    const avatarUrl = '/src/assets/images/avatar_corporate_admin_1795596196529.jpg';

    try {
      const tx = db.transaction(() => {
        const hash = hashPassword(String(password));
        // If a passwordless placeholder admin row was previously created via ADMIN_PASSCODE login, upgrade it; otherwise insert new row
        const existingPlaceholder = db
          .prepare('SELECT id FROM users WHERE lower(username) = ? OR lower(email) = ?')
          .get(cleanUsername, cleanEmail) as { id: number } | undefined;

        let adminId: number;
        if (existingPlaceholder) {
          db.prepare(
            "UPDATE users SET username = ?, email = ?, full_name = ?, password_hash = ?, avatar_url = COALESCE(avatar_url, ?), is_active = 1, updated_at = datetime('now') WHERE id = ?"
          ).run(cleanUsername, cleanEmail, cleanName, hash, avatarUrl, existingPlaceholder.id);
          adminId = existingPlaceholder.id;
        } else {
          const info = db
            .prepare('INSERT INTO users (username, email, full_name, password_hash, avatar_url, is_active) VALUES (?, ?, ?, ?, ?, 1)')
            .run(cleanUsername, cleanEmail, cleanName, hash, avatarUrl);
          adminId = Number(info.lastInsertRowid);
        }

        const superRole = db.prepare("SELECT id FROM roles WHERE code = 'super_admin'").get() as { id: number };
        db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(adminId, superRole.id);
        const defaultHolding = db.prepare('SELECT id FROM holding_groups ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
        if (defaultHolding) {
          const hasScope = db.prepare('SELECT id FROM user_org_scopes WHERE user_id = ? LIMIT 1').get(adminId);
          if (!hasScope) {
            db.prepare('INSERT INTO user_org_scopes (user_id, scope_level, holding_id, is_default) VALUES (?, ?, ?, 1)').run(
              adminId,
              'holding',
              defaultHolding.id
            );
          }
        }

        if (seedRoleAccounts) {
          const sampleUsers = [
            ['inv.admin', 'inventory@kideco.co.id', 'Rina Kusuma (Inventory Admin)', 'inventory_admin'],
            ['pic.budi', 'budi.santoso@kideco.co.id', 'Budi Santoso (PIC Custodian)', 'pic_custodian'],
            ['sup.hendra', 'hendra.wijaya@kideco.co.id', 'Hendra Wijaya (Supervisor)', 'approver'],
            ['audit.maya', 'maya.putri@kideco.co.id', 'Maya Putri (Internal Auditor)', 'auditor'],
          ];
          const insU = db.prepare('INSERT OR IGNORE INTO users (username, email, full_name, password_hash, is_active, created_by) VALUES (?, ?, ?, ?, 1, ?)');
          const insUR = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
          const insScope = db.prepare('INSERT INTO user_org_scopes (user_id, scope_level, company_id, is_default) VALUES (?, ?, ?, 1)');
          const primaryCompany = db.prepare('SELECT id FROM companies ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
          for (const [u, e, n, rCode] of sampleUsers) {
            const rRow = db.prepare('SELECT id FROM roles WHERE code = ?').get(rCode) as { id: number } | undefined;
            const resU = insU.run(u, e, n, hash, adminId);
            if (rRow && resU.lastInsertRowid) {
              const newUid = Number(resU.lastInsertRowid);
              insUR.run(newUid, rRow.id);
              if (primaryCompany) {
                insScope.run(newUid, 'company', primaryCompany.id);
              }
            }
          }
        }
        return adminId;
      });

      const adminId = tx();
      syncAutomatedNotifications();
      const user = getUserWithPermissions(adminId)!;
      const token = signSessionToken(user.id, user.username);
      db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        user.id,
        user.username,
        'INSTALLER_ADMIN_CREATED',
        'installer',
        'user',
        String(user.id),
        JSON.stringify({ email: user.email, tablesReady: true })
      );
      res.status(201).json({ token, user, tableCount: inspectInstallerState().tableCount });
    } catch (err: any) {
      res.status(409).json({ error: err.message || 'Failed to populate Super Administrator account.' });
    }
  };

  app.post('/api/install/run', handleInstallOrSetup);
  app.post('/api/auth/setup', handleInstallOrSetup);

  app.post('/api/auth/login', (req, res) => {
    const rate = checkAuthRateLimit(req.ip || 'unknown');
    if (!rate.allowed) {
      const ident = String(req.body?.identifier || '').trim().toLowerCase().slice(0, 120) || 'unknown';
      db.prepare('INSERT INTO audit_logs (username, action, module, entity_type, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)').run(
        ident,
        'LOGIN_RATE_LIMITED',
        'auth',
        'user',
        JSON.stringify({ retry_after_sec: rate.retryAfterSec }),
        req.ip ?? null
      );
      res.status(429).json({ error: `Too many login attempts. Retry in ${rate.retryAfterSec}s` });
      return;
    }

    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/email and password are required.' });
      return;
    }

    const ident = String(identifier).trim().toLowerCase().slice(0, 120);
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();

    // Support env ADMIN_PASSCODE override for super admin login
    if (envPasscode && password === envPasscode && (ident === 'admin' || ident === 'admin@kideco.co.id')) {
      let adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin' OR email = 'admin@kideco.co.id'").get() as { id: number } | undefined;
      if (!adminUser) {
        const info = db
          .prepare('INSERT INTO users (username, email, full_name, avatar_url, is_active) VALUES (?, ?, ?, ?, 1)')
          .run('admin', 'admin@kideco.co.id', 'KIDECO Super Administrator', '/src/assets/images/avatar_corporate_admin_1795596196529.jpg');
        const superRole = db.prepare("SELECT id FROM roles WHERE code = 'super_admin'").get() as { id: number };
        db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(Number(info.lastInsertRowid), superRole.id);
        adminUser = { id: Number(info.lastInsertRowid) };
        const defaultHolding = db.prepare('SELECT id FROM holding_groups ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
        if (defaultHolding) {
          db.prepare('INSERT INTO user_org_scopes (user_id, scope_level, holding_id, is_default) VALUES (?, ?, ?, 1)').run(
            adminUser.id,
            'holding',
            defaultHolding.id
          );
        }
      }
      db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(adminUser.id);
      const user = getUserWithPermissions(adminUser.id)!;
      const token = signSessionToken(user.id, user.username);
      syncAutomatedNotifications();
      db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        user.id,
        user.username,
        'LOGIN_SUCCESS',
        'auth',
        'user',
        String(user.id),
        JSON.stringify({ method: 'admin_passcode' }),
        req.ip ?? null
      );
      res.json({ token, user });
      return;
    }

    const row = db
      .prepare('SELECT id, username, password_hash, is_active FROM users WHERE lower(username) = ? OR lower(email) = ?')
      .get(ident, ident) as { id: number; username: string; password_hash: string | null; is_active: number } | undefined;

    if (!row || !row.password_hash || !verifyPassword(String(password), row.password_hash)) {
      db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        row?.id ?? null,
        row?.username || ident,
        'LOGIN_FAILED',
        'auth',
        'user',
        row ? String(row.id) : null,
        JSON.stringify({ identifier: ident, reason: 'invalid_credentials' }),
        req.ip ?? null
      );
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    if (!row.is_active) {
      db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        row.id,
        row.username,
        'LOGIN_FAILED',
        'auth',
        'user',
        String(row.id),
        JSON.stringify({ identifier: ident, reason: 'account_inactive' }),
        req.ip ?? null
      );
      res.status(403).json({ error: 'Account is deactivated. Contact Super Administrator.' });
      return;
    }

    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
    const user = getUserWithPermissions(row.id);
    if (!user) {
      db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        row.id,
        row.username,
        'LOGIN_FAILED',
        'auth',
        'user',
        String(row.id),
        JSON.stringify({ identifier: ident, reason: 'no_role_assigned' }),
        req.ip ?? null
      );
      res.status(403).json({ error: 'No role assigned to account.' });
      return;
    }
    const token = signSessionToken(user.id, user.username);
    syncAutomatedNotifications();
    db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      user.id,
      user.username,
      'LOGIN_SUCCESS',
      'auth',
      'user',
      String(user.id),
      JSON.stringify({ method: 'password' }),
      req.ip ?? null
    );
    res.json({ token, user });
  });

  app.get('/api/auth/me', authenticate, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser });
  });

  app.post('/api/auth/logout', authenticate, (req: AuthenticatedRequest, res) => {
    logAudit(req, 'LOGOUT', 'auth', 'user', req.authUser?.id);
    res.json({ ok: true });
  });

  // =========================================================================
  // FORGOT PASSWORD & EMAIL CONFIRMATION RESET FLOW
  // =========================================================================
  function resolveAppBaseUrl(req: express.Request): string {
    const envUrl = process.env.APP_URL?.trim();
    if (envUrl && envUrl !== 'MY_APP_URL') {
      try {
        const parsed = new URL(envUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.origin;
        }
      } catch {
        // fallback below
      }
    }
    const rawHost = String(req.get('x-forwarded-host') || req.get('host') || '').trim();
    const safeHost = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawHost) ? rawHost : 'localhost:3000';
    const proto = req.protocol === 'https' ? 'https' : 'http';
    return `${proto}://${safeHost}`;
  }

  function sha256Hex(val: string): string {
    return crypto.createHash('sha256').update(val).digest('hex');
  }

  function safeHashEquals(aHex: string, bHex: string): boolean {
    if (aHex.length !== bHex.length) return false;
    return crypto.timingSafeEqual(Buffer.from(aHex, 'utf8'), Buffer.from(bHex, 'utf8'));
  }

  app.post('/api/auth/forgot-password', async (req, res) => {
    const rate = checkAuthRateLimit(req.ip || 'unknown');
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many requests. Retry in ${rate.retryAfterSec}s` });
      return;
    }

    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 190) {
      res.status(400).json({ error: 'Please enter a valid corporate email address.' });
      return;
    }

    if (!isEmailConfigured()) {
      res.status(503).json({
        code: 'SMTP_NOT_CONFIGURED',
        error: 'Email service (SMTP) is not configured on this server. Configure SMTP_HOST, SMTP_USER, and SMTP_PASS in Secrets.',
      });
      return;
    }

    const user = db
      .prepare('SELECT id, username, email, full_name, is_active FROM users WHERE lower(email) = ?')
      .get(cleanEmail) as
      | { id: number; username: string; email: string; full_name: string; is_active: number }
      | undefined;

    if (user && user.is_active === 1) {
      // Enforce 60-second per-account resend cooldown
      const recent = db
        .prepare("SELECT id FROM password_reset_tokens WHERE user_id = ? AND created_at > datetime('now', '-60 seconds') ORDER BY id DESC LIMIT 1")
        .get(user.id) as { id: number } | undefined;

      if (!recent) {
        const rawCode = String(crypto.randomInt(100000, 1000000));
        const rawToken = crypto.randomBytes(32).toString('hex');
        const codeHash = sha256Hex(rawCode);
        const tokenHash = sha256Hex(rawToken);

        let insertedId = 0;
        const tx = db.transaction(() => {
          db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(
            user.id
          );
          const info = db
            .prepare(`
              INSERT INTO password_reset_tokens (user_id, email, code_hash, token_hash, expires_at, request_ip)
              VALUES (?, ?, ?, ?, datetime('now', '+15 minutes'), ?)
            `)
            .run(user.id, user.email, codeHash, tokenHash, req.ip ?? null);
          insertedId = Number(info.lastInsertRowid);
        });
        tx();

        const resetUrl = `${resolveAppBaseUrl(req)}/?reset_token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(user.email)}`;
        try {
          await sendPasswordResetEmail({
            toEmail: user.email,
            fullName: user.full_name,
            code: rawCode,
            resetUrl,
            expiresMinutes: 15,
          });
          db.prepare(
            'INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(
            user.id,
            user.username,
            'PASSWORD_RESET_REQUESTED',
            'auth',
            'user',
            String(user.id),
            JSON.stringify({ email: user.email }),
            req.ip ?? null
          );
        } catch (mailErr: any) {
          // Clean up token if mail delivery fails
          if (insertedId) {
            db.prepare('DELETE FROM password_reset_tokens WHERE id = ?').run(insertedId);
          }
          console.error('Failed to send password reset email:', mailErr?.message || mailErr);
          res.status(502).json({
            code: 'SMTP_DELIVERY_FAILED',
            error: 'Failed to deliver confirmation email. Please verify server SMTP configuration.',
          });
          return;
        }
      }
    }

    res.json({
      ok: true,
      message: 'If the email is registered and active, a verification code and reset link have been sent.',
    });
  });

  function validateResetVerification(params: { email: string; code?: string; token?: string }) {
    const cleanEmail = params.email.trim().toLowerCase();
    const user = db
      .prepare('SELECT id, username, email, full_name, is_active FROM users WHERE lower(email) = ?')
      .get(cleanEmail) as
      | { id: number; username: string; email: string; full_name: string; is_active: number }
      | undefined;

    if (!user || user.is_active !== 1) {
      return { ok: false as const, error: 'Invalid or expired verification code.' };
    }

    const row = db
      .prepare(`
        SELECT id, code_hash, token_hash, attempts, max_attempts
        FROM password_reset_tokens
        WHERE user_id = ? AND used_at IS NULL AND expires_at > datetime('now')
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(user.id) as
      | { id: number; code_hash: string; token_hash: string; attempts: number; max_attempts: number }
      | undefined;

    if (!row || row.attempts >= row.max_attempts) {
      return { ok: false as const, error: 'Invalid or expired verification code.' };
    }

    const rawToken = typeof params.token === 'string' ? params.token.trim() : '';
    const rawCode = typeof params.code === 'string' ? params.code.trim() : '';

    let matched = false;
    if (/^[a-f0-9]{64}$/i.test(rawToken)) {
      matched = safeHashEquals(sha256Hex(rawToken.toLowerCase()), row.token_hash);
    } else if (/^\d{6}$/.test(rawCode)) {
      matched = safeHashEquals(sha256Hex(rawCode), row.code_hash);
    }

    if (!matched) {
      const nextAttempts = row.attempts + 1;
      if (nextAttempts >= row.max_attempts) {
        db.prepare("UPDATE password_reset_tokens SET attempts = ?, used_at = datetime('now') WHERE id = ?").run(
          nextAttempts,
          row.id
        );
      } else {
        db.prepare('UPDATE password_reset_tokens SET attempts = ? WHERE id = ?').run(nextAttempts, row.id);
      }
      return { ok: false as const, error: 'Invalid or expired verification code.', user };
    }

    return { ok: true as const, user, tokenRowId: row.id };
  }

  app.post('/api/auth/verify-reset-code', (req, res) => {
    const rate = checkAuthRateLimit(req.ip || 'unknown');
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many attempts. Retry in ${rate.retryAfterSec}s` });
      return;
    }

    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const token = String(req.body?.token || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || (!code && !token)) {
      res.status(400).json({ error: 'Email and verification code are required.' });
      return;
    }

    const check = validateResetVerification({ email: cleanEmail, code, token });
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }

    res.json({ ok: true, verified: true });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const rate = checkAuthRateLimit(req.ip || 'unknown');
    if (!rate.allowed) {
      res.status(429).json({ error: `Too many attempts. Retry in ${rate.retryAfterSec}s` });
      return;
    }

    const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.new_password || '');
    const confirmPassword = req.body?.confirm_password;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || (!code && !token)) {
      res.status(400).json({ error: 'Email and verification code are required.' });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'New password must be between 8 and 128 characters.' });
      return;
    }
    if (confirmPassword !== undefined && newPassword !== String(confirmPassword)) {
      res.status(400).json({ error: 'Password confirmation does not match.' });
      return;
    }

    const check = validateResetVerification({ email: cleanEmail, code, token });
    if (!check.ok) {
      if (check.user) {
        db.prepare(
          'INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          check.user.id,
          check.user.username,
          'PASSWORD_RESET_FAILED',
          'auth',
          'user',
          String(check.user.id),
          JSON.stringify({ reason: 'invalid_code_or_token' }),
          req.ip ?? null
        );
      }
      res.status(400).json({ error: check.error });
      return;
    }

    const newHash = hashPassword(newPassword);
    const tx = db.transaction(() => {
      const consumeRes = db
        .prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL")
        .run(check.tokenRowId);
      if (consumeRes.changes !== 1) {
        throw new Error('Verification token has already been used.');
      }
      db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(
        check.user.id
      );
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
        newHash,
        check.user.id,
        check.user.id
      );
      db.prepare(
        'INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        check.user.id,
        check.user.username,
        'PASSWORD_RESET_COMPLETED',
        'auth',
        'user',
        String(check.user.id),
        JSON.stringify({ email: check.user.email }),
        req.ip ?? null
      );
    });

    try {
      tx();
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to reset password.' });
      return;
    }

    sendPasswordResetConfirmationEmail({
      toEmail: check.user.email,
      fullName: check.user.full_name,
    }).catch((err) => {
      console.warn('Password reset confirmation email skipped:', err?.message || err);
    });

    res.json({ ok: true });
  });

  // =========================================================================
  // SELF-SERVICE ACCOUNT SETTINGS (Personal Data, Username, Password, Photo)
  // =========================================================================
  app.get('/api/account/profile', authenticate, (req: AuthenticatedRequest, res) => {
    const freshUser = getUserWithPermissions(req.authUser!.id);
    res.json({ user: freshUser });
  });

  app.put('/api/account/profile', authenticate, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const body = req.body || {};
    const cleanUsername = String(body.username || '').trim().toLowerCase();
    const cleanFullName = String(body.full_name || '').trim();
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const cleanPhone = body.phone !== undefined && body.phone !== null ? String(body.phone).trim().slice(0, 50) : null;
    const cleanDepartment = body.department !== undefined && body.department !== null ? String(body.department).trim().slice(0, 120) : null;
    const cleanPosition = body.position_title !== undefined && body.position_title !== null ? String(body.position_title).trim().slice(0, 120) : null;

    if (!/^[a-z0-9._-]{3,50}$/.test(cleanUsername)) {
      res.status(400).json({ error: 'Username must be 3-50 characters (lowercase letters, numbers, dot, underscore, hyphen).' });
      return;
    }
    if (cleanFullName.length < 2 || cleanFullName.length > 150) {
      res.status(400).json({ error: 'Full name must be between 2 and 150 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid corporate email address.' });
      return;
    }

    const dupUsername = db
      .prepare('SELECT id FROM users WHERE lower(username) = ? AND id != ?')
      .get(cleanUsername, userId) as { id: number } | undefined;
    if (dupUsername) {
      res.status(409).json({ error: 'Username is already taken by another account.' });
      return;
    }

    const dupEmail = db
      .prepare('SELECT id FROM users WHERE lower(email) = ? AND id != ?')
      .get(cleanEmail, userId) as { id: number } | undefined;
    if (dupEmail) {
      res.status(409).json({ error: 'Email address is already used by another account.' });
      return;
    }

    const previousUsername = req.authUser!.username;

    db.prepare(`
      UPDATE users
      SET username = ?, full_name = ?, email = ?, phone = ?, department = ?, position_title = ?,
          updated_at = datetime('now'), updated_by = ?
      WHERE id = ?
    `).run(
      cleanUsername,
      cleanFullName,
      cleanEmail,
      cleanPhone || null,
      cleanDepartment || null,
      cleanPosition || null,
      userId,
      userId
    );

    const updatedUser = getUserWithPermissions(userId)!;
    const refreshedToken = previousUsername !== updatedUser.username
      ? signSessionToken(updatedUser.id, updatedUser.username)
      : undefined;

    logAudit(req, 'ACCOUNT_PROFILE_UPDATED', 'account', 'user', userId, {
      username_changed: previousUsername !== updatedUser.username,
      new_username: updatedUser.username,
    });

    res.json({ user: updatedUser, ...(refreshedToken ? { token: refreshedToken } : {}) });
  });

  app.put('/api/account/password', authenticate, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const { current_password, new_password, confirm_password } = req.body || {};

    if (!new_password || String(new_password).length < 8 || String(new_password).length > 128) {
      res.status(400).json({ error: 'New password must be between 8 and 128 characters.' });
      return;
    }
    if (confirm_password !== undefined && String(new_password) !== String(confirm_password)) {
      res.status(400).json({ error: 'Password confirmation does not match.' });
      return;
    }

    const row = db
      .prepare('SELECT id, password_hash FROM users WHERE id = ?')
      .get(userId) as { id: number; password_hash: string | null } | undefined;
    if (!row) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (row.password_hash) {
      if (!current_password || !verifyPassword(String(current_password), row.password_hash)) {
        res.status(401).json({ error: 'Current password is incorrect.' });
        return;
      }
      if (String(current_password) === String(new_password)) {
        res.status(400).json({ error: 'New password must be different from your current password.' });
        return;
      }
    } else if (envPasscode && String(current_password || '') !== envPasscode) {
      res.status(401).json({ error: 'Current passcode is incorrect.' });
      return;
    }

    const newHash = hashPassword(String(new_password));
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
      newHash,
      userId,
      userId
    );

    logAudit(req, 'ACCOUNT_PASSWORD_CHANGED', 'account', 'user', userId);
    res.json({ ok: true });
  });

  app.post('/api/account/avatar', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
      await runAvatarUploadSingle(req, res);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to upload profile photo.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Profile photo file is required.' });
      return;
    }

    const userId = req.authUser!.id;
    const prev = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(userId) as { avatar_url: string | null } | undefined;
    const nextUrl = `/uploads/${req.file.filename}`;

    db.prepare("UPDATE users SET avatar_url = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
      nextUrl,
      userId,
      userId
    );

    deleteOwnedLocalAvatar(prev?.avatar_url, userId);
    const updatedUser = getUserWithPermissions(userId)!;
    logAudit(req, 'ACCOUNT_AVATAR_UPDATED', 'account', 'user', userId, { storage: 'local' });
    res.json({ avatar_url: nextUrl, user: updatedUser });
  });

  app.delete('/api/account/avatar', authenticate, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const prev = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(userId) as { avatar_url: string | null } | undefined;
    db.prepare("UPDATE users SET avatar_url = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(userId, userId);
    deleteOwnedLocalAvatar(prev?.avatar_url, userId);
    const updatedUser = getUserWithPermissions(userId)!;
    logAudit(req, 'ACCOUNT_AVATAR_REMOVED', 'account', 'user', userId);
    res.json({ user: updatedUser });
  });

  // =========================================================================
  // MASTER DATA (Holding, Companies, Divisions, Categories, Locations, PICs)
  // =========================================================================
  app.get('/api/master/all', authenticate, (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const userCompIds = req.authUser!.allowed_company_ids;
    const allAllowedCompFilter =
      req.authUser!.is_holding_scope || userCompIds.length === 0
        ? { clause: '1=1', params: [] as unknown[] }
        : {
            clause: `id IN (${userCompIds.map(() => '?').join(',')})`,
            params: [...userCompIds] as unknown[],
          };

    const compScope = buildCompanyScopeSql(scope, 'company_id');
    const locCompScope = buildCompanyScopeSql(scope, 'l.company_id');
    const picCompScope = buildCompanyScopeSql(scope, 'p.company_id');

    const holdingGroups = db.prepare('SELECT * FROM holding_groups ORDER BY id ASC').all();
    const companies = db
      .prepare(`SELECT * FROM companies WHERE ${allAllowedCompFilter.clause} ORDER BY name`)
      .all(...allAllowedCompFilter.params);

    const divFilter =
      !scope.isHoldingScope && scope.activeCompanyId === null && scope.divisionScopedIds.length > 0 && scope.companyWideIds.length === 0
        ? {
            clause: `id IN (${scope.divisionScopedIds.map(() => '?').join(',')})`,
            params: [...scope.divisionScopedIds] as unknown[],
          }
        : compScope;

    const divisions = db
      .prepare(`SELECT * FROM divisions WHERE ${divFilter.clause} ORDER BY name`)
      .all(...divFilter.params);
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    const subcategories = db.prepare('SELECT * FROM subcategories ORDER BY name').all();
    const buildings = db
      .prepare(`SELECT * FROM buildings WHERE ${compScope.clause} ORDER BY name`)
      .all(...compScope.params);
    const floors = db
      .prepare(`
        SELECT f.* FROM floors f
        JOIN buildings b ON b.id = f.building_id
        WHERE ${buildCompanyScopeSql(scope, 'b.company_id').clause}
        ORDER BY f.building_id, f.level_number
      `)
      .all(...buildCompanyScopeSql(scope, 'b.company_id').params);
    const rooms = db
      .prepare(`
        SELECT r.* FROM rooms r
        JOIN floors f ON f.id = r.floor_id
        JOIN buildings b ON b.id = f.building_id
        WHERE ${buildCompanyScopeSql(scope, 'b.company_id').clause}
        ORDER BY r.floor_id, r.name
      `)
      .all(...buildCompanyScopeSql(scope, 'b.company_id').params);
    const locations = db
      .prepare(`
        SELECT l.*, c.name as company_name, b.name as building_name, f.name as floor_name, r.name as room_name,
               (SELECT COUNT(*) FROM assets a WHERE a.location_id = l.id AND a.deleted_at IS NULL) as asset_count
        FROM locations l
        JOIN companies c ON c.id = l.company_id
        JOIN buildings b ON b.id = l.building_id
        JOIN floors f ON f.id = l.floor_id
        JOIN rooms r ON r.id = l.room_id
        WHERE ${locCompScope.clause}
        ORDER BY c.name, b.name, f.level_number, r.name, l.specific_location
      `)
      .all(...locCompScope.params);
    const persons = db
      .prepare(`
        SELECT p.*, c.name as company_name, d.name as division_name,
               (SELECT COUNT(*) FROM assets a WHERE a.pic_id = p.id AND a.deleted_at IS NULL) as asset_count
        FROM persons p
        JOIN companies c ON c.id = p.company_id
        JOIN divisions d ON d.id = p.division_id
        WHERE ${picCompScope.clause}
        ORDER BY p.full_name
      `)
      .all(...picCompScope.params);

    const governanceUsers = db
      .prepare(`
        SELECT DISTINCT u.id, u.username, u.full_name, u.position_title, r.code as role_code, r.name as role_name
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        LEFT JOIN user_org_scopes s ON s.user_id = u.id
        WHERE u.is_active = 1
          AND (
            r.code = 'super_admin'
            OR s.scope_level = 'holding'
            OR ${scope.allowedCompanyIds.length > 0 ? `s.company_id IN (${scope.allowedCompanyIds.map(() => '?').join(',')})` : '1=0'}
          )
        ORDER BY u.full_name ASC
      `)
      .all(...(scope.allowedCompanyIds.length > 0 ? scope.allowedCompanyIds : []));

    // Cross-company transfer targets visible for authorized holding/multi-company users
    const allTargetLocations = req.authUser!.is_holding_scope || req.authUser!.allowed_company_ids.length > 1
      ? db
          .prepare(`
            SELECT l.*, c.name as company_name, b.name as building_name, f.name as floor_name, r.name as room_name
            FROM locations l
            JOIN companies c ON c.id = l.company_id
            JOIN buildings b ON b.id = l.building_id
            JOIN floors f ON f.id = l.floor_id
            JOIN rooms r ON r.id = l.room_id
            WHERE ${allAllowedCompFilter.clause.replace(/\bid\b/g, 'l.company_id')}
            ORDER BY c.name, b.name, f.level_number, r.name, l.specific_location
          `)
          .all(...allAllowedCompFilter.params)
      : locations;

    const allTargetDivisions = req.authUser!.is_holding_scope || req.authUser!.allowed_company_ids.length > 1
      ? db
          .prepare(`
            SELECT d.*, c.name as company_name
            FROM divisions d
            JOIN companies c ON c.id = d.company_id
            WHERE ${allAllowedCompFilter.clause.replace(/\bid\b/g, 'd.company_id')}
            ORDER BY c.name, d.name
          `)
          .all(...allAllowedCompFilter.params)
      : divisions;

    const allTargetPersons = req.authUser!.is_holding_scope || req.authUser!.allowed_company_ids.length > 1
      ? db
          .prepare(`
            SELECT p.*, c.name as company_name, d.name as division_name
            FROM persons p
            JOIN companies c ON c.id = p.company_id
            JOIN divisions d ON d.id = p.division_id
            WHERE ${allAllowedCompFilter.clause.replace(/\bid\b/g, 'p.company_id')}
            ORDER BY p.full_name
          `)
          .all(...allAllowedCompFilter.params)
      : persons;

    res.json({
      holdingGroups,
      companies,
      divisions,
      categories,
      subcategories,
      buildings,
      floors,
      rooms,
      locations,
      persons,
      governanceUsers,
      transferTargets: {
        locations: allTargetLocations,
        divisions: allTargetDivisions,
        persons: allTargetPersons,
      },
    });
  });

  function buildScopedNotificationsWhere(scope: ReturnType<typeof resolveRequestOrgScope>): { clause: string; params: unknown[] } {
    if (!scope || scope.isHoldingScope && scope.activeCompanyId === null) {
      return { clause: '1=1', params: [] };
    }
    const aScope = buildAssetScopeSql(scope, 'a');
    const opScope = buildCompanyScopeSql(scope, 'o.company_id');
    const sopScope = buildCompanyScopeSql(scope, 'se.company_id');
    return {
      clause: `(
        entity_type IS NULL
        OR (entity_type = 'asset' AND EXISTS (SELECT 1 FROM assets a WHERE a.id = notifications.entity_id AND ${aScope.clause}))
        OR (entity_type = 'movement' AND EXISTS (SELECT 1 FROM asset_movements m JOIN assets a ON a.id = m.asset_id WHERE m.id = notifications.entity_id AND ${aScope.clause}))
        OR (entity_type = 'maintenance' AND EXISTS (SELECT 1 FROM maintenance_records mr JOIN assets a ON a.id = mr.asset_id WHERE mr.id = notifications.entity_id AND ${aScope.clause}))
        OR (entity_type = 'opname' AND EXISTS (SELECT 1 FROM stock_opname_details d JOIN stock_opname o ON o.id = d.opname_id WHERE d.id = notifications.entity_id AND ${opScope.clause}))
        OR (entity_type = 'replacement' AND EXISTS (SELECT 1 FROM replacement_plans rp JOIN assets a ON a.id = rp.asset_id WHERE rp.id = notifications.entity_id AND ${aScope.clause}))
        OR (entity_type = 'sop_execution' AND EXISTS (SELECT 1 FROM sop_executions se WHERE se.id = notifications.entity_id AND ${sopScope.clause}))
      )`,
      params: [...aScope.params, ...aScope.params, ...aScope.params, ...opScope.params, ...aScope.params, ...sopScope.params],
    };
  }

  // =========================================================================
  // MODULE 01 – DASHBOARD
  // =========================================================================
  app.get('/api/dashboard', authenticate, requirePermission('dashboard.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    syncAutomatedNotifications();

    const assetScope = buildAssetScopeSql(scope, 'a');
    const locScope = buildCompanyScopeSql(scope, 'l.company_id');
    const movScope = buildCompanyScopeSql(scope, 'COALESCE(m.to_company_id, m.from_company_id, a.company_id)');

    const totalAssets = (db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;
    const totalValue = (db.prepare(`SELECT COALESCE(SUM(a.acquisition_value), 0) as v FROM assets a WHERE a.deleted_at IS NULL AND ${assetScope.clause}`).get(...assetScope.params) as { v: number }).v;
    const goodCount = (db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND a.condition_status = 'Good' AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;
    const minorDamageCount = (db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND a.condition_status = 'Minor Damage' AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;
    const majorDamageCount = (db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND a.condition_status = 'Major Damage' AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;
    const unserviceableCount = (db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND a.condition_status = 'Unserviceable' AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;
    const inMaintenanceCount = (db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND a.asset_status = 'In Maintenance' AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;
    const missingPicCount = (db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND a.pic_id IS NULL AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;
    const missingQrCount = (db.prepare(`SELECT COUNT(*) as c FROM assets a LEFT JOIN asset_qr_codes q ON q.asset_id = a.id WHERE a.deleted_at IS NULL AND q.id IS NULL AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }).c;

    const byCategory = db
      .prepare(`
        SELECT c.name, COUNT(a.id) as count, COALESCE(SUM(a.acquisition_value), 0) as value
        FROM categories c
        LEFT JOIN assets a ON a.category_id = c.id AND a.deleted_at IS NULL AND ${assetScope.clause}
        GROUP BY c.id
        ORDER BY count DESC
      `)
      .all(...assetScope.params);

    const byLocation = db
      .prepare(`
        SELECT
          l.id as location_id,
          b.name || ' · ' || r.name as name,
          l.specific_location,
          b.name as building_name,
          f.name as floor_name,
          r.name as room_name,
          c.name as company_name,
          COUNT(a.id) as count,
          COALESCE(SUM(a.acquisition_value), 0) as total_value
        FROM locations l
        JOIN companies c ON c.id = l.company_id
        JOIN buildings b ON b.id = l.building_id
        JOIN floors f ON f.id = l.floor_id
        JOIN rooms r ON r.id = l.room_id
        LEFT JOIN assets a ON a.location_id = l.id AND a.deleted_at IS NULL AND ${assetScope.clause}
        WHERE ${locScope.clause}
        GROUP BY l.id
        ORDER BY count DESC, total_value DESC, l.specific_location ASC
      `)
      .all(...assetScope.params, ...locScope.params);

    const byCondition = db
      .prepare(`
        SELECT a.condition_status as name, COUNT(*) as count
        FROM assets a
        WHERE a.deleted_at IS NULL AND ${assetScope.clause}
        GROUP BY a.condition_status
      `)
      .all(...assetScope.params);

    const acquisitionByYear = db
      .prepare(`
        SELECT substr(a.acquisition_date, 1, 4) as year, COUNT(*) as count, COALESCE(SUM(a.acquisition_value), 0) as value
        FROM assets a
        WHERE a.deleted_at IS NULL AND ${assetScope.clause}
        GROUP BY substr(a.acquisition_date, 1, 4)
        ORDER BY year ASC
      `)
      .all(...assetScope.params);

    const maintenanceByStatus = db
      .prepare(`
        SELECT mr.status as name, COUNT(*) as count
        FROM maintenance_records mr
        JOIN assets a ON a.id = mr.asset_id
        WHERE ${assetScope.clause}
        GROUP BY mr.status
      `)
      .all(...assetScope.params);

    const movementHistoryChart = db
      .prepare(`
        SELECT substr(m.movement_date, 1, 7) as month, COUNT(*) as count
        FROM asset_movements m
        JOIN assets a ON a.id = m.asset_id
        WHERE ${movScope.clause}
        GROUP BY substr(m.movement_date, 1, 7)
        ORDER BY month ASC
      `)
      .all(...movScope.params);

    const recentMovements = db
      .prepare(`
        SELECT m.*, a.asset_code, a.asset_name,
               fl.specific_location || ' (' || fb.name || ')' as from_location_label,
               tl.specific_location || ' (' || tb.name || ')' as to_location_label,
               fp.full_name as from_pic_name, tp.full_name as to_pic_name
        FROM asset_movements m
        JOIN assets a ON a.id = m.asset_id
        JOIN locations fl ON fl.id = m.from_location_id
        JOIN buildings fb ON fb.id = fl.building_id
        JOIN locations tl ON tl.id = m.to_location_id
        JOIN buildings tb ON tb.id = tl.building_id
        LEFT JOIN persons fp ON fp.id = m.from_pic_id
        LEFT JOIN persons tp ON tp.id = m.to_pic_id
        WHERE ${movScope.clause}
        ORDER BY m.created_at DESC
        LIMIT 8
      `)
      .all(...movScope.params);

    const notifScope = buildScopedNotificationsWhere(scope);
    const notifications = db
      .prepare(`SELECT * FROM notifications WHERE ${notifScope.clause} ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, created_at DESC LIMIT 12`)
      .all(...notifScope.params);

    // Recent Activity: latest 5 asset registrations or status changes with thumbnail URLs (scoped)
    const auditEvents = db
      .prepare(`
        SELECT l.id as log_id, l.action, l.entity_type, l.entity_id, l.username, l.created_at as event_at,
               u.full_name as actor_name,
               CASE
                 WHEN l.entity_type = 'asset' THEN CAST(l.entity_id AS INTEGER)
                 WHEN l.entity_type = 'movement' THEN (SELECT m.asset_id FROM asset_movements m WHERE m.id = CAST(l.entity_id AS INTEGER))
                 WHEN l.entity_type = 'maintenance_record' THEN (SELECT mr.asset_id FROM maintenance_records mr WHERE mr.id = CAST(l.entity_id AS INTEGER))
                 ELSE NULL
               END as resolved_asset_id
        FROM audit_logs l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.action IN (
          'ASSET_CREATED', 'ASSET_REGISTERED', 'ASSET_UPDATED',
          'MOVEMENT_REQUESTED', 'MOVEMENT_APPROVED', 'MOVEMENT_REJECTED',
          'MAINTENANCE_REPORTED', 'MAINTENANCE_UPDATED'
        )
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 30
      `)
      .all() as {
        log_id: number;
        action: string;
        entity_type: string;
        entity_id: string;
        username: string | null;
        event_at: string;
        actor_name: string | null;
        resolved_asset_id: number | null;
      }[];

    const assetDetailStmt = db.prepare(`
      SELECT a.id, a.asset_code, a.asset_name, a.condition_status, a.asset_status,
             a.created_at, a.updated_at,
             c.name as category_name,
             b.name || ' · ' || l.specific_location as location_label,
             COALESCE(a.primary_photo_url, (
               SELECT ap.file_url FROM asset_photos ap
               WHERE ap.asset_id = a.id
               ORDER BY ap.is_primary DESC, ap.created_at DESC LIMIT 1
             )) as primary_photo_url
      FROM assets a
      JOIN categories c ON c.id = a.category_id
      JOIN locations l ON l.id = a.location_id
      JOIN buildings b ON b.id = l.building_id
      WHERE a.id = ? AND a.deleted_at IS NULL AND ${assetScope.clause}
    `);

    const actionLabels: Record<string, string> = {
      ASSET_CREATED: 'Registered',
      ASSET_REGISTERED: 'Registered',
      ASSET_UPDATED: 'Updated',
      MOVEMENT_REQUESTED: 'Transfer Requested',
      MOVEMENT_APPROVED: 'Transfer Approved',
      MOVEMENT_REJECTED: 'Transfer Rejected',
      MAINTENANCE_REPORTED: 'Maintenance Reported',
      MAINTENANCE_UPDATED: 'Maintenance Updated',
    };

    const recentActivity: any[] = [];
    const seenKeys = new Set<string>();

    for (const ev of auditEvents) {
      if (!ev.resolved_asset_id) continue;
      const asset = assetDetailStmt.get(ev.resolved_asset_id, ...assetScope.params) as Record<string, any> | undefined;
      if (!asset) continue;
      const dedupe = `${asset.id}:${ev.action}:${String(ev.event_at).slice(0, 16)}`;
      if (seenKeys.has(dedupe)) continue;
      seenKeys.add(dedupe);
      recentActivity.push({
        activity_id: `audit-${ev.log_id}`,
        asset_id: asset.id,
        asset_code: asset.asset_code,
        asset_name: asset.asset_name,
        category_name: asset.category_name,
        location_label: asset.location_label,
        condition_status: asset.condition_status,
        asset_status: asset.asset_status,
        primary_photo_url: asset.primary_photo_url,
        action: ev.action,
        activity_label: actionLabels[ev.action] || ev.action,
        actor_name: ev.actor_name || ev.username || 'System',
        occurred_at: ev.event_at,
      });
      if (recentActivity.length >= 5) break;
    }

    if (recentActivity.length < 5) {
      const latestAssets = db
        .prepare(`
          SELECT a.id, a.asset_code, a.asset_name, a.condition_status, a.asset_status,
                 a.created_at, a.updated_at,
                 c.name as category_name,
                 b.name || ' · ' || l.specific_location as location_label,
                 COALESCE(a.primary_photo_url, (
                   SELECT ap.file_url FROM asset_photos ap
                   WHERE ap.asset_id = a.id
                   ORDER BY ap.is_primary DESC, ap.created_at DESC LIMIT 1
                 )) as primary_photo_url
          FROM assets a
          JOIN categories c ON c.id = a.category_id
          JOIN locations l ON l.id = a.location_id
          JOIN buildings b ON b.id = l.building_id
          WHERE a.deleted_at IS NULL AND ${assetScope.clause}
          ORDER BY datetime(a.updated_at) DESC, a.id DESC
          LIMIT 10
        `)
        .all(...assetScope.params) as Record<string, any>[];

      const existingAssetIds = new Set(recentActivity.map((r) => r.asset_id));
      for (const a of latestAssets) {
        if (existingAssetIds.has(a.id)) continue;
        const isUpdated = a.updated_at && a.created_at && a.updated_at !== a.created_at;
        recentActivity.push({
          activity_id: `asset-${a.id}`,
          asset_id: a.id,
          asset_code: a.asset_code,
          asset_name: a.asset_name,
          category_name: a.category_name,
          location_label: a.location_label,
          condition_status: a.condition_status,
          asset_status: a.asset_status,
          primary_photo_url: a.primary_photo_url,
          action: isUpdated ? 'ASSET_UPDATED' : 'ASSET_REGISTERED',
          activity_label: isUpdated ? 'Updated' : 'Registered',
          actor_name: 'System Seed',
          occurred_at: a.updated_at || a.created_at,
        });
        if (recentActivity.length >= 5) break;
      }
    }

    const now = new Date();
    const monthSlots: { month: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const month = `${yyyy}-${mm}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      monthSlots.push({ month, label });
    }
    const startMonth = monthSlots[0].month;
    const endMonth = monthSlots[monthSlots.length - 1].month;

    const acqMonthlyRows = db
      .prepare(`
        SELECT substr(a.acquisition_date, 1, 7) as month,
               COUNT(*) as count,
               COALESCE(SUM(a.acquisition_value), 0) as value
        FROM assets a
        WHERE substr(a.acquisition_date, 1, 7) >= ?
          AND substr(a.acquisition_date, 1, 7) <= ?
          AND ${assetScope.clause}
        GROUP BY substr(a.acquisition_date, 1, 7)
      `)
      .all(startMonth, endMonth, ...assetScope.params) as { month: string; count: number; value: number }[];

    const retMonthlyRows = db
      .prepare(`
        SELECT retire_month as month,
               COUNT(*) as count,
               COALESCE(SUM(acquisition_value), 0) as value
        FROM (
          SELECT a.id,
                 a.acquisition_value,
                 substr(
                   COALESCE(
                     a.deleted_at,
                     (SELECT mr.damage_date FROM maintenance_records mr WHERE mr.asset_id = a.id ORDER BY mr.damage_date DESC LIMIT 1),
                     a.updated_at
                   ),
                   1, 7
                 ) as retire_month
          FROM assets a
          WHERE (a.deleted_at IS NOT NULL
             OR a.asset_status = 'Disposed'
             OR a.condition_status = 'Unserviceable')
            AND ${assetScope.clause}
        )
        WHERE retire_month >= ? AND retire_month <= ?
        GROUP BY retire_month
      `)
      .all(...assetScope.params, startMonth, endMonth) as { month: string; count: number; value: number }[];

    const acqMap = new Map(acqMonthlyRows.map((r) => [r.month, r]));
    const retMap = new Map(retMonthlyRows.map((r) => [r.month, r]));

    const monthlyLifecycleTrends = monthSlots.map(({ month, label }) => {
      const acq = acqMap.get(month);
      const ret = retMap.get(month);
      const acquisitions = acq ? acq.count : 0;
      const retirements = ret ? ret.count : 0;
      return {
        month,
        label,
        acquisitions,
        retirements,
        acquisitionValue: acq ? acq.value : 0,
        retirementValue: ret ? ret.value : 0,
        netChange: acquisitions - retirements,
      };
    });

    res.json({
      kpis: {
        totalAssets,
        totalValue,
        goodCount,
        minorDamageCount,
        majorDamageCount,
        unserviceableCount,
        inMaintenanceCount,
        missingPicCount,
        missingQrCount,
      },
      charts: {
        byCategory,
        byLocation,
        byCondition,
        acquisitionByYear,
        maintenanceByStatus,
        movementHistoryChart,
        monthlyLifecycleTrends,
      },
      recentActivity,
      recentMovements,
      notifications,
    });
  });

  // =========================================================================
  // MODULE 02 & 04 – ASSET REGISTRATION & DATABASE
  // =========================================================================
  app.get('/api/assets/next-code', authenticate, (_req, res) => {
    res.json({ nextCode: generateNextAssetCode() });
  });

  app.get('/api/assets', authenticate, requirePermission('assets.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const search = String(req.query.search || '').trim();
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const locationId = req.query.location_id ? Number(req.query.location_id) : null;
    const divisionId = req.query.division_id ? Number(req.query.division_id) : null;
    const picId = req.query.pic_id ? Number(req.query.pic_id) : null;
    const condition = String(req.query.condition || '').trim();
    const status = String(req.query.status || '').trim();
    const sortBy = String(req.query.sortBy || 'id');
    const sortDir = String(req.query.sortDir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const allowedSort: Record<string, string> = {
      id: 'a.id',
      asset_code: 'a.asset_code',
      asset_name: 'a.asset_name',
      acquisition_date: 'a.acquisition_date',
      acquisition_value: 'a.acquisition_value',
      condition_status: 'a.condition_status',
    };
    const orderCol = allowedSort[sortBy] || 'a.id';

    const assetScope = buildAssetScopeSql(scope, 'a');
    const where: string[] = ['a.deleted_at IS NULL', assetScope.clause];
    const params: unknown[] = [...assetScope.params];

    if (search) {
      where.push('(a.asset_code LIKE ? OR a.asset_name LIKE ? OR a.serial_number LIKE ? OR a.brand LIKE ? OR p.full_name LIKE ? OR b.name LIKE ? OR co.name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like, like);
    }
    if (categoryId) {
      where.push('a.category_id = ?');
      params.push(categoryId);
    }
    if (locationId) {
      where.push('a.location_id = ?');
      params.push(locationId);
    }
    if (divisionId) {
      where.push('a.division_id = ?');
      params.push(divisionId);
    }
    if (picId) {
      where.push('a.pic_id = ?');
      params.push(picId);
    }
    if (condition) {
      where.push('a.condition_status = ?');
      params.push(condition);
    }
    if (status) {
      where.push('a.asset_status = ?');
      params.push(status);
    }

    const sql = `
      SELECT a.*, c.name as category_name, sc.name as subcategory_name,
             co.name as company_name, co.code as company_code, d.name as division_name,
             COALESCE(rd.name, d.name) as responsible_division_name,
             b.name as building_name, f.name as floor_name, r.name as room_name, l.specific_location, l.location_code,
             p.full_name as pic_name, p.nik_nip as pic_nik,
             COALESCE(cp.full_name, p.full_name) as custodian_name,
             owner_u.full_name as data_owner_name,
             verif_u.full_name as verification_officer_name,
             app_u.full_name as approver_name,
             q.qr_token, q.public_slug, q.status as qr_status, q.public_enabled, q.public_show_photo, q.public_show_location, q.expires_at as qr_expires_at, q.generated_at as qr_generated_at,
             COALESCE(a.primary_photo_url, (SELECT ap.file_url FROM asset_photos ap WHERE ap.asset_id = a.id ORDER BY ap.is_primary DESC, ap.created_at DESC LIMIT 1)) as primary_photo_url,
             (SELECT COUNT(*) FROM asset_photos ap WHERE ap.asset_id = a.id) as photo_count
      FROM assets a
      JOIN categories c ON c.id = a.category_id
      LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
      JOIN companies co ON co.id = a.company_id
      JOIN divisions d ON d.id = a.division_id
      LEFT JOIN divisions rd ON rd.id = a.responsible_division_id
      JOIN locations l ON l.id = a.location_id
      JOIN buildings b ON b.id = l.building_id
      JOIN floors f ON f.id = l.floor_id
      JOIN rooms r ON r.id = l.room_id
      LEFT JOIN persons p ON p.id = a.pic_id
      LEFT JOIN persons cp ON cp.id = a.custodian_person_id
      LEFT JOIN users owner_u ON owner_u.id = a.data_owner_user_id
      LEFT JOIN users verif_u ON verif_u.id = a.verification_officer_user_id
      LEFT JOIN users app_u ON app_u.id = a.approver_user_id
      LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderCol} ${sortDir}
    `;
    const rows = db.prepare(sql).all(...params);
    res.json({ assets: rows });
  });

  app.get('/api/assets/:id', authenticate, requirePermission('assets.view'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const asset = db
      .prepare(`
        SELECT a.*, c.name as category_name, c.default_useful_life_years, sc.name as subcategory_name,
               co.name as company_name, co.code as company_code, d.name as division_name,
               COALESCE(rd.name, d.name) as responsible_division_name,
               b.name as building_name, f.name as floor_name, r.name as room_name, l.specific_location, l.location_code,
               p.full_name as pic_name, p.nik_nip as pic_nik, p.email as pic_email, p.phone as pic_phone,
               COALESCE(cp.full_name, p.full_name) as custodian_name,
               owner_u.full_name as data_owner_name,
               verif_u.full_name as verification_officer_name,
               app_u.full_name as approver_name,
               q.qr_token, q.public_slug, q.status as qr_status, q.public_enabled, q.public_show_photo, q.public_show_location, q.expires_at as qr_expires_at, q.generated_at as qr_generated_at, q.scan_count, q.last_scanned_at
        FROM assets a
        JOIN categories c ON c.id = a.category_id
        LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
        JOIN companies co ON co.id = a.company_id
        JOIN divisions d ON d.id = a.division_id
        LEFT JOIN divisions rd ON rd.id = a.responsible_division_id
        JOIN locations l ON l.id = a.location_id
        JOIN buildings b ON b.id = l.building_id
        JOIN floors f ON f.id = l.floor_id
        JOIN rooms r ON r.id = l.room_id
        LEFT JOIN persons p ON p.id = a.pic_id
        LEFT JOIN persons cp ON cp.id = a.custodian_person_id
        LEFT JOIN users owner_u ON owner_u.id = a.data_owner_user_id
        LEFT JOIN users verif_u ON verif_u.id = a.verification_officer_user_id
        LEFT JOIN users app_u ON app_u.id = a.approver_user_id
        LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
        WHERE a.id = ? AND a.deleted_at IS NULL
      `)
      .get(id) as Record<string, any> | undefined;

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    if (!canUserAccessRecord(req.authUser!, Number(asset.company_id), Number(asset.division_id))) {
      res.status(403).json({ error: 'Cross-company/division access denied for this asset.' });
      return;
    }

    const photos = db.prepare('SELECT * FROM asset_photos WHERE asset_id = ? ORDER BY is_primary DESC, created_at DESC').all(id);
    const documents = db.prepare('SELECT * FROM asset_documents WHERE asset_id = ? ORDER BY created_at DESC').all(id);
    const movements = db
      .prepare(`
        SELECT m.*, fl.specific_location as from_loc, fb.name as from_bld, tl.specific_location as to_loc, tb.name as to_bld,
               fp.full_name as from_pic, tp.full_name as to_pic,
               fc.name as from_company_name, tc.name as to_company_name,
               fd.name as from_division_name, td.name as to_division_name
        FROM asset_movements m
        JOIN locations fl ON fl.id = m.from_location_id
        JOIN buildings fb ON fb.id = fl.building_id
        JOIN locations tl ON tl.id = m.to_location_id
        JOIN buildings tb ON tb.id = tl.building_id
        LEFT JOIN persons fp ON fp.id = m.from_pic_id
        LEFT JOIN persons tp ON tp.id = m.to_pic_id
        LEFT JOIN companies fc ON fc.id = m.from_company_id
        LEFT JOIN companies tc ON tc.id = m.to_company_id
        LEFT JOIN divisions fd ON fd.id = m.from_division_id
        LEFT JOIN divisions td ON td.id = m.to_division_id
        WHERE m.asset_id = ?
        ORDER BY m.movement_date DESC
      `)
      .all(id);
    const maintenance = db.prepare('SELECT * FROM maintenance_records WHERE asset_id = ? ORDER BY damage_date DESC').all(id);
    const events = db
      .prepare(`
        SELECT e.*, u.full_name as actor_full_name
        FROM asset_events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.asset_id = ?
        ORDER BY e.id DESC
        LIMIT 100
      `)
      .all(id);
    const ownershipHistory = db
      .prepare(`
        SELECT h.*, fc.name as from_company_name, tc.name as to_company_name,
               fd.name as from_division_name, td.name as to_division_name,
               fp.full_name as from_custodian_name, tp.full_name as to_custodian_name,
               u.full_name as changed_by_name
        FROM asset_ownership_history h
        LEFT JOIN companies fc ON fc.id = h.from_company_id
        LEFT JOIN companies tc ON tc.id = h.to_company_id
        LEFT JOIN divisions fd ON fd.id = h.from_division_id
        LEFT JOIN divisions td ON td.id = h.to_division_id
        LEFT JOIN persons fp ON fp.id = h.from_custodian_person_id
        LEFT JOIN persons tp ON tp.id = h.to_custodian_person_id
        LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE h.asset_id = ?
        ORDER BY h.id DESC
      `)
      .all(id);

    res.json({ asset, photos, documents, movements, maintenance, events, ownershipHistory });
  });

  app.post('/api/assets', authenticate, requirePermission('assets.create'), (req: AuthenticatedRequest, res) => {
    const body = req.body || {};
    if (!body.asset_name || !body.category_id) {
      res.status(400).json({ error: 'Missing required asset registration fields (asset_name, category_id).' });
      return;
    }

    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    let companyId = body.company_id ? Number(body.company_id) : 0;
    if (!companyId) {
      if (scope.allowedCompanyIds.length > 0) {
        companyId = scope.allowedCompanyIds[0];
      } else {
        const firstComp = db.prepare('SELECT id FROM companies ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
        companyId = firstComp?.id || 0;
      }
    }

    let divisionId = body.division_id ? Number(body.division_id) : 0;
    if (!divisionId && companyId) {
      const firstDiv = db.prepare('SELECT id FROM divisions WHERE company_id = ? ORDER BY id ASC LIMIT 1').get(companyId) as { id: number } | undefined;
      divisionId = firstDiv?.id || 0;
    }

    let locationId = body.location_id ? Number(body.location_id) : 0;
    if (!locationId && companyId) {
      const firstLoc = db.prepare('SELECT id FROM locations WHERE company_id = ? ORDER BY id ASC LIMIT 1').get(companyId) as { id: number } | undefined;
      locationId = firstLoc?.id || 0;
    }

    const acquisitionDate = body.acquisition_date
      ? String(body.acquisition_date).trim()
      : new Date().toISOString().slice(0, 10);

    if (!companyId || !divisionId || !locationId) {
      res.status(400).json({ error: 'Company, division, or location master record is unavailable for asset registration.' });
      return;
    }

    if (!canUserAccessRecord(req.authUser!, companyId, divisionId)) {
      res.status(403).json({ error: 'Cannot register asset outside your organization scope.' });
      return;
    }

    const locRow = db.prepare('SELECT id, company_id FROM locations WHERE id = ?').get(locationId) as
      | { id: number; company_id: number }
      | undefined;
    if (!locRow || locRow.company_id !== companyId) {
      res.status(400).json({ error: 'Selected location does not belong to the selected company.' });
      return;
    }

    const divRow = db.prepare('SELECT id, company_id FROM divisions WHERE id = ?').get(divisionId) as
      | { id: number; company_id: number }
      | undefined;
    if (!divRow || divRow.company_id !== companyId) {
      res.status(400).json({ error: 'Selected division does not belong to the selected company.' });
      return;
    }

    const serial = body.serial_number ? String(body.serial_number).trim() : null;
    if (serial) {
      const dupSerial = db.prepare('SELECT id, asset_code FROM assets WHERE lower(serial_number) = lower(?) AND deleted_at IS NULL').get(serial) as { id: number; asset_code: string } | undefined;
      if (dupSerial) {
        res.status(409).json({ error: `Duplicate Serial Number already registered on ${dupSerial.asset_code}` });
        return;
      }
    }

    const primaryPhotoUrl = body.primary_photo_url ? String(body.primary_photo_url).trim() : null;
    if (primaryPhotoUrl && !isValidLocalAssetUrl(primaryPhotoUrl)) {
      res.status(400).json({ error: 'Invalid asset photo URL.' });
      return;
    }

    const invoiceDoc = body.invoice_doc && typeof body.invoice_doc === 'object' ? body.invoice_doc : null;
    if (invoiceDoc && !isValidLocalAssetUrl(invoiceDoc.file_url)) {
      res.status(400).json({ error: 'Invalid invoice document URL.' });
      return;
    }

    const picId = body.pic_id ? Number(body.pic_id) : null;
    const custodianId = body.custodian_person_id ? Number(body.custodian_person_id) : picId;
    const responsibleDivisionId = body.responsible_division_id ? Number(body.responsible_division_id) : divisionId;
    const dataOwnerUserId = body.data_owner_user_id ? Number(body.data_owner_user_id) : req.authUser!.id;
    const verificationOfficerUserId = body.verification_officer_user_id ? Number(body.verification_officer_user_id) : req.authUser!.id;
    const approverUserId = body.approver_user_id ? Number(body.approver_user_id) : req.authUser!.id;

    const tx = db.transaction(() => {
      const assetCode = body.asset_code ? String(body.asset_code).trim().toUpperCase() : generateNextAssetCode();
      const dupCode = db.prepare('SELECT id FROM assets WHERE asset_code = ?').get(assetCode);
      if (dupCode) {
        throw new Error(`DUPLICATE_CODE:${assetCode}`);
      }

      const info = db
        .prepare(`
          INSERT INTO assets (
            asset_code, asset_name, category_id, subcategory_id, brand, model, serial_number,
            description, specification, acquisition_date, acquisition_value, supplier, purchase_reference,
            warranty_period_months, acquisition_source, company_id, division_id, department,
            location_id, pic_id, condition_status, asset_status, primary_photo_url,
            data_owner_user_id, custodian_person_id, responsible_division_id,
            verification_officer_user_id, approver_user_id, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          assetCode,
          String(body.asset_name).trim(),
          Number(body.category_id),
          body.subcategory_id ? Number(body.subcategory_id) : null,
          body.brand || null,
          body.model || null,
          serial,
          body.description || null,
          body.specification || null,
          acquisitionDate,
          Number(body.acquisition_value || 0),
          body.supplier || null,
          body.purchase_reference || null,
          Number(body.warranty_period_months || 12),
          body.acquisition_source || 'CAPEX Purchase',
          companyId,
          divisionId,
          body.department || null,
          locationId,
          picId,
          body.condition_status || 'Good',
          body.asset_status || 'Active',
          primaryPhotoUrl,
          dataOwnerUserId,
          custodianId,
          responsibleDivisionId,
          verificationOfficerUserId,
          approverUserId,
          req.authUser!.id,
          req.authUser!.id
        );

      const newId = Number(info.lastInsertRowid);
      let qrId: number | null = null;
      if (body.auto_generate_qr !== false) {
        const token = `OIMS-QR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
        const slug = generateQrSlug();
        const qrInfo = db
          .prepare('INSERT INTO asset_qr_codes (asset_id, qr_token, public_slug, generated_by) VALUES (?, ?, ?, ?)')
          .run(newId, token, slug, req.authUser!.id);
        qrId = Number(qrInfo.lastInsertRowid);
      }

      if (primaryPhotoUrl) {
        db.prepare(
          'INSERT INTO asset_photos (asset_id, file_name, file_url, drive_file_id, drive_web_view_link, mime_type, file_size_bytes, is_primary, uploaded_by) VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?)'
        ).run(
          newId,
          sanitizeFileName(String(body.primary_photo_name || 'asset_photo')),
          primaryPhotoUrl,
          body.primary_photo_mime_type ? String(body.primary_photo_mime_type) : null,
          body.primary_photo_size_bytes ? Number(body.primary_photo_size_bytes) : null,
          req.authUser!.id
        );
      }

      if (invoiceDoc) {
        db.prepare(
          'INSERT INTO asset_documents (asset_id, doc_type, file_name, file_url, drive_file_id, drive_web_view_link, mime_type, file_size_bytes, uploaded_by) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)'
        ).run(
          newId,
          String(invoiceDoc.doc_type || 'Invoice / Purchase Document'),
          sanitizeFileName(String(invoiceDoc.file_name || 'invoice_document')),
          String(invoiceDoc.file_url),
          invoiceDoc.mime_type ? String(invoiceDoc.mime_type) : null,
          invoiceDoc.file_size_bytes ? Number(invoiceDoc.file_size_bytes) : null,
          req.authUser!.id
        );
      }

      db.prepare(`
        INSERT INTO asset_ownership_history (
          asset_id, from_company_id, to_company_id, from_division_id, to_division_id,
          from_custodian_person_id, to_custodian_person_id, movement_id, changed_by_user_id, reason
        ) VALUES (?, NULL, ?, NULL, ?, NULL, ?, NULL, ?, ?)
      `).run(newId, companyId, divisionId, custodianId, req.authUser!.id, 'Initial Asset Registration');

      const newState = getAssetStateSnapshot(newId);
      appendAssetEvent({
        companyId,
        assetId: newId,
        qrId,
        eventType: 'ASSET_REGISTERED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'asset',
        referenceId: newId,
        reason: 'Asset registered into enterprise master catalog',
        previousState: null,
        newState,
      });

      if (qrId) {
        appendAssetEvent({
          companyId,
          assetId: newId,
          qrId,
          eventType: 'QR_GENERATED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'asset_qr',
          referenceId: qrId,
          reason: 'Auto-generated QR tag during registration',
          previousState: null,
          newState: { qr_id: qrId, asset_code: assetCode },
        });
      }

      if (primaryPhotoUrl) {
        appendAssetEvent({
          companyId,
          assetId: newId,
          qrId,
          eventType: 'PHOTO_CAPTURED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'asset',
          referenceId: newId,
          reason: 'Primary asset photo captured during registration',
          previousState: null,
          newState: { primary_photo_url: primaryPhotoUrl },
        });
      }

      return { id: newId, asset_code: assetCode };
    });

    try {
      const created = tx();
      logAudit(req, 'ASSET_CREATED', 'assets', 'asset', created.id, { asset_code: created.asset_code, company_id: companyId });
      syncAutomatedNotifications();
      res.status(201).json(created);
    } catch (err: any) {
      if (String(err.message).startsWith('DUPLICATE_CODE:')) {
        res.status(409).json({ error: `Duplicate Asset Code: ${err.message.split(':')[1]}` });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to register asset' });
    }
  });

  app.put('/api/assets/:id', authenticate, requirePermission('assets.edit'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(id) as Record<string, any> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    if (!canUserAccessRecord(req.authUser!, Number(existing.company_id), Number(existing.division_id))) {
      res.status(403).json({ error: 'Cross-company/division access denied for this asset.' });
      return;
    }

    const body = req.body || {};
    const nextCompanyId = body.company_id !== undefined ? Number(body.company_id) : Number(existing.company_id);
    const nextDivisionId = body.division_id !== undefined ? Number(body.division_id) : Number(existing.division_id);
    if (!canUserAccessRecord(req.authUser!, nextCompanyId, nextDivisionId)) {
      res.status(403).json({ error: 'Cannot assign asset to an organization outside your scope.' });
      return;
    }

    const serial = body.serial_number !== undefined ? (body.serial_number ? String(body.serial_number).trim() : null) : existing.serial_number;
    if (serial) {
      const dupSerial = db.prepare('SELECT id, asset_code FROM assets WHERE lower(serial_number) = lower(?) AND id != ? AND deleted_at IS NULL').get(serial, id) as { id: number; asset_code: string } | undefined;
      if (dupSerial) {
        res.status(409).json({ error: `Serial Number already used by ${dupSerial.asset_code}` });
        return;
      }
    }

    const nextCondition = body.condition_status ?? existing.condition_status;
    const nextStatus = body.asset_status ?? existing.asset_status;
    const nextLocation = body.location_id !== undefined ? Number(body.location_id) : Number(existing.location_id);
    const nextPic = body.pic_id !== undefined ? (body.pic_id ? Number(body.pic_id) : null) : existing.pic_id;
    const nextCustodian = body.custodian_person_id !== undefined
      ? (body.custodian_person_id ? Number(body.custodian_person_id) : null)
      : (body.pic_id !== undefined ? nextPic : (existing.custodian_person_id ?? nextPic));
    const nextResponsibleDiv = body.responsible_division_id !== undefined
      ? Number(body.responsible_division_id)
      : (body.division_id !== undefined ? nextDivisionId : (existing.responsible_division_id ?? nextDivisionId));
    const nextDataOwner = body.data_owner_user_id !== undefined
      ? (body.data_owner_user_id ? Number(body.data_owner_user_id) : null)
      : existing.data_owner_user_id;
    const nextVerificationOfficer = body.verification_officer_user_id !== undefined
      ? (body.verification_officer_user_id ? Number(body.verification_officer_user_id) : null)
      : existing.verification_officer_user_id;
    const nextApprover = body.approver_user_id !== undefined
      ? (body.approver_user_id ? Number(body.approver_user_id) : null)
      : existing.approver_user_id;
    const nextName = body.asset_name ?? existing.asset_name;

    const changedFields: string[] = [];
    if (String(nextName) !== String(existing.asset_name)) changedFields.push('asset_name');
    if (String(serial || '') !== String(existing.serial_number || '')) changedFields.push('serial_number');
    if (nextCompanyId !== Number(existing.company_id)) changedFields.push('company_id');
    if (nextDivisionId !== Number(existing.division_id)) changedFields.push('division_id');
    if (nextLocation !== Number(existing.location_id)) changedFields.push('location_id');
    if (Number(nextPic || 0) !== Number(existing.pic_id || 0)) changedFields.push('pic_id');
    if (Number(nextCustodian || 0) !== Number(existing.custodian_person_id || 0)) changedFields.push('custodian_person_id');
    if (Number(nextDataOwner || 0) !== Number(existing.data_owner_user_id || 0)) changedFields.push('data_owner_user_id');
    if (Number(nextVerificationOfficer || 0) !== Number(existing.verification_officer_user_id || 0)) changedFields.push('verification_officer_user_id');
    if (Number(nextApprover || 0) !== Number(existing.approver_user_id || 0)) changedFields.push('approver_user_id');
    if (String(nextCondition) !== String(existing.condition_status)) changedFields.push('condition_status');
    if (String(nextStatus) !== String(existing.asset_status)) changedFields.push('asset_status');

    const tx = db.transaction(() => {
      const prevState = getAssetStateSnapshot(id);
      db.prepare(`
        UPDATE assets SET
          asset_name = ?, category_id = ?, subcategory_id = ?, brand = ?, model = ?, serial_number = ?,
          description = ?, specification = ?, acquisition_date = ?, acquisition_value = ?, supplier = ?,
          purchase_reference = ?, warranty_period_months = ?, acquisition_source = ?, company_id = ?,
          division_id = ?, department = ?, location_id = ?, pic_id = ?, condition_status = ?,
          asset_status = ?, data_owner_user_id = ?, custodian_person_id = ?, responsible_division_id = ?,
          verification_officer_user_id = ?, approver_user_id = ?, updated_at = datetime('now'), updated_by = ?
        WHERE id = ?
      `).run(
        nextName,
        body.category_id ?? existing.category_id,
        body.subcategory_id !== undefined ? body.subcategory_id : existing.subcategory_id,
        body.brand !== undefined ? body.brand : existing.brand,
        body.model !== undefined ? body.model : existing.model,
        serial,
        body.description !== undefined ? body.description : existing.description,
        body.specification !== undefined ? body.specification : existing.specification,
        body.acquisition_date ?? existing.acquisition_date,
        body.acquisition_value ?? existing.acquisition_value,
        body.supplier !== undefined ? body.supplier : existing.supplier,
        body.purchase_reference !== undefined ? body.purchase_reference : existing.purchase_reference,
        body.warranty_period_months ?? existing.warranty_period_months,
        body.acquisition_source ?? existing.acquisition_source,
        nextCompanyId,
        nextDivisionId,
        body.department !== undefined ? body.department : existing.department,
        nextLocation,
        nextPic,
        nextCondition,
        nextStatus,
        nextDataOwner,
        nextCustodian,
        nextResponsibleDiv,
        nextVerificationOfficer,
        nextApprover,
        req.authUser!.id,
        id
      );

      if (
        nextCompanyId !== Number(existing.company_id) ||
        nextDivisionId !== Number(existing.division_id) ||
        Number(nextCustodian || 0) !== Number(existing.custodian_person_id || existing.pic_id || 0)
      ) {
        db.prepare(`
          INSERT INTO asset_ownership_history (
            asset_id, from_company_id, to_company_id, from_division_id, to_division_id,
            from_custodian_person_id, to_custodian_person_id, movement_id, changed_by_user_id, reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(
          id,
          Number(existing.company_id),
          nextCompanyId,
          Number(existing.division_id),
          nextDivisionId,
          existing.custodian_person_id ?? existing.pic_id ?? null,
          nextCustodian,
          req.authUser!.id,
          body.reason ? String(body.reason) : 'Direct Master Data & Ownership Update'
        );
      }

      const newState = getAssetStateSnapshot(id);
      const eventType =
        changedFields.length === 1 && changedFields[0] === 'condition_status'
          ? 'CONDITION_CHANGED'
          : changedFields.length === 1 && changedFields[0] === 'location_id'
          ? 'LOCATION_CHANGED'
          : 'ASSET_UPDATED';

      appendAssetEvent({
        companyId: nextCompanyId,
        assetId: id,
        eventType,
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'asset',
        referenceId: id,
        reason: body.reason ? String(body.reason) : `Updated fields: ${changedFields.join(', ') || 'metadata'}`,
        previousState: prevState,
        newState,
      });
    });

    tx();

    logAudit(req, 'ASSET_UPDATED', 'assets', 'asset', id, {
      asset_code: existing.asset_code,
      changed_fields: changedFields,
      condition_status: nextCondition,
      asset_status: nextStatus,
    });
    syncAutomatedNotifications();
    res.json({ ok: true });
  });

  app.delete('/api/assets/:id', authenticate, requirePermission('assets.delete'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, asset_code, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: number; asset_code: string; company_id: number; division_id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, existing.company_id, existing.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for this asset.' });
      return;
    }

    const tx = db.transaction(() => {
      const prevState = getAssetStateSnapshot(id);
      db.prepare("UPDATE assets SET deleted_at = datetime('now'), updated_by = ? WHERE id = ?").run(req.authUser!.id, id);
      const newState = getAssetStateSnapshot(id);
      appendAssetEvent({
        companyId: existing.company_id,
        assetId: id,
        eventType: 'ASSET_DEACTIVATED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'asset',
        referenceId: id,
        reason: 'Soft deleted from active asset catalog',
        previousState: prevState,
        newState,
      });
    });
    tx();

    logAudit(req, 'ASSET_SOFT_DELETED', 'assets', 'asset', id, { asset_code: existing.asset_code });
    syncAutomatedNotifications();
    res.json({ ok: true });
  });

  // Local server disk upload handler for asset photos & invoice/supporting documents
  app.post('/api/uploads/asset-file', authenticate, requirePermission('assets.create'), async (req: AuthenticatedRequest, res) => {
    try {
      await runAssetFileUploadSingle(req, res);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid file upload' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'File upload is required' });
      return;
    }

    const kind = String(req.body?.kind || 'photo') === 'document' ? 'document' : 'photo';
    if (kind === 'photo' && !ALLOWED_IMAGE_MIMES.has(req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore cleanup error
      }
      res.status(400).json({ error: 'Asset photos must be JPG, PNG, or WEBP images.' });
      return;
    }

    const docType = String(req.body?.doc_type || (kind === 'photo' ? 'Asset Photo' : 'Invoice / Purchase Document'));
    const fileName = sanitizeFileName(req.file.originalname);
    const fileUrl = `/uploads/${req.file.filename}`;

    logAudit(req, 'LOCAL_ASSET_FILE_UPLOADED', 'assets', 'asset_file', req.file.filename, {
      kind,
      docType,
      fileName,
      fileSizeBytes: req.file.size,
    });

    res.status(201).json({
      ok: true,
      kind,
      docType,
      fileName,
      fileUrl,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
    });
  });

  // Local server upload endpoint for Field / Stock Opname verification photos
  app.post('/api/uploads/field-photo', authenticate, async (req: AuthenticatedRequest, res) => {
    const perms = req.authUser!.permissions || [];
    const allowed =
      req.authUser!.role_code === 'super_admin' ||
      perms.includes('opname.verify') ||
      perms.includes('qr.scan') ||
      perms.includes('assets.create') ||
      perms.includes('assets.edit') ||
      perms.includes('ai.identify');
    if (!allowed) {
      res.status(403).json({ error: 'Permission required for field photo upload.' });
      return;
    }

    try {
      await runAssetFileUploadSingle(req, res);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid field photo upload' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Photo file is required' });
      return;
    }

    if (!ALLOWED_IMAGE_MIMES.has(req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore cleanup error
      }
      res.status(400).json({ error: 'Field photo must be JPG, PNG, or WEBP.' });
      return;
    }

    const fileName = sanitizeFileName(req.file.originalname);
    const fileUrl = `/uploads/${req.file.filename}`;
    logAudit(req, 'FIELD_PHOTO_UPLOADED', 'opname', 'field_photo', req.file.filename, {
      fileName,
      fileSizeBytes: req.file.size,
    });

    res.status(201).json({
      ok: true,
      fileName,
      fileUrl,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
    });
  });

  // Upload Photo or Invoice/Supporting Document locally for an existing asset
  app.post('/api/assets/:id/upload', authenticate, requirePermission('assets.edit'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, asset_code, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: number; asset_code: string; company_id: number; division_id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, existing.company_id, existing.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for this asset.' });
      return;
    }

    try {
      await runAssetFileUploadSingle(req, res);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid file upload' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'File upload is required.' });
      return;
    }

    const kind = String(req.body?.kind || 'photo') === 'document' ? 'document' : 'photo';
    const docType = String(req.body?.doc_type || (kind === 'photo' ? 'Asset Photo' : 'Invoice / Purchase Document'));

    if (kind === 'photo' && !ALLOWED_IMAGE_MIMES.has(req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore cleanup error
      }
      res.status(400).json({ error: 'Asset photos must be JPG, PNG, or WEBP images.' });
      return;
    }

    const fileName = sanitizeFileName(req.file.originalname);
    const fileUrl = `/uploads/${req.file.filename}`;
    const mimeType = req.file.mimetype;
    const fileSizeBytes = req.file.size;

    const tx = db.transaction(() => {
      if (kind === 'photo') {
        db.prepare('UPDATE asset_photos SET is_primary = 0 WHERE asset_id = ?').run(id);
        db.prepare(
          'INSERT INTO asset_photos (asset_id, file_name, file_url, drive_file_id, drive_web_view_link, mime_type, file_size_bytes, is_primary, uploaded_by) VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?)'
        ).run(id, fileName, fileUrl, mimeType, fileSizeBytes || null, req.authUser!.id);
        db.prepare("UPDATE assets SET primary_photo_url = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
          fileUrl,
          req.authUser!.id,
          id
        );
      } else {
        db.prepare(
          'INSERT INTO asset_documents (asset_id, doc_type, file_name, file_url, drive_file_id, drive_web_view_link, mime_type, file_size_bytes, uploaded_by) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)'
        ).run(id, docType, fileName, fileUrl, mimeType, fileSizeBytes || null, req.authUser!.id);
      }

      appendAssetEvent({
        companyId: existing.company_id,
        assetId: id,
        eventType: kind === 'photo' ? 'PHOTO_CAPTURED' : 'DOCUMENT_ATTACHED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'asset',
        referenceId: id,
        reason: `${docType}: ${fileName}`,
        previousState: null,
        newState: { kind, docType, fileName, fileUrl },
      });
    });
    tx();

    logAudit(req, 'ASSET_FILE_ATTACHED', 'assets', 'asset', id, {
      storage: 'local',
      kind,
      docType,
      fileName,
      mimeType,
      fileSizeBytes,
    });

    res.status(201).json({
      ok: true,
      kind,
      docType,
      fileName,
      fileUrl,
      mimeType,
      fileSizeBytes,
    });
  });

  // Validate & Commit Asset Import (CSV / Excel rows)
  app.post('/api/assets/import/validate', authenticate, requirePermission('assets.import'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const compScope = buildCompanyScopeSql(scope, 'id');
    const divScope = buildCompanyScopeSql(scope, 'company_id');
    const locScope = buildCompanyScopeSql(scope, 'company_id');
    const picScope = buildCompanyScopeSql(scope, 'company_id');

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const defaultCompanyId = req.body?.default_company_id ? Number(req.body.default_company_id) : scope.activeCompanyId;
    const defaultDivisionId = req.body?.default_division_id ? Number(req.body.default_division_id) : null;

    const companies = db.prepare(`SELECT id, code, name FROM companies WHERE ${compScope.clause} ORDER BY id ASC`).all(...compScope.params) as { id: number; code: string; name: string }[];
    const divisions = db.prepare(`SELECT id, company_id, code, name FROM divisions WHERE ${divScope.clause} ORDER BY id ASC`).all(...divScope.params) as { id: number; company_id: number; code: string; name: string }[];
    const categories = db.prepare('SELECT id, name, code FROM categories').all() as { id: number; name: string; code: string }[];
    const locations = db.prepare(`SELECT id, company_id, location_code, specific_location FROM locations WHERE ${locScope.clause} ORDER BY id ASC`).all(...locScope.params) as { id: number; company_id: number; location_code: string; specific_location: string }[];
    const persons = db.prepare(`SELECT id, company_id, division_id, nik_nip, full_name FROM persons WHERE ${picScope.clause} ORDER BY id ASC`).all(...picScope.params) as { id: number; company_id: number; division_id: number; nik_nip: string; full_name: string }[];

    const existingCodes = new Set((db.prepare('SELECT asset_code FROM assets').all() as { asset_code: string }[]).map((r) => r.asset_code.toUpperCase()));
    const existingSerials = new Set((db.prepare('SELECT serial_number FROM assets WHERE serial_number IS NOT NULL').all() as { serial_number: string }[]).map((r) => r.serial_number.toLowerCase()));

    const seenCodes = new Set<string>();
    const results = rows.map((row: Record<string, any>, idx: number) => {
      const errors: string[] = [];
      const name = String(row.asset_name || '').trim();
      const code = row.asset_code ? String(row.asset_code).trim().toUpperCase() : '';
      const serial = row.serial_number ? String(row.serial_number).trim() : '';
      const compInput = String(row.company || row.company_code || '').trim().toLowerCase();
      const divInput = String(row.division || row.division_code || '').trim().toLowerCase();
      const catInput = String(row.category || '').trim().toLowerCase();
      const locInput = String(row.location || '').trim().toLowerCase();
      const picInput = String(row.pic || '').trim().toLowerCase();

      if (!name) errors.push('Missing asset_name');
      if (code) {
        if (existingCodes.has(code)) errors.push(`Duplicate Asset Code in DB (${code})`);
        if (seenCodes.has(code)) errors.push(`Duplicate Asset Code in file (${code})`);
        seenCodes.add(code);
      }
      if (serial && existingSerials.has(serial.toLowerCase())) {
        errors.push(`Duplicate Serial Number (${serial})`);
      }

      let matchedComp = compInput
        ? companies.find((c) => c.name.toLowerCase() === compInput || c.code.toLowerCase() === compInput)
        : undefined;
      if (!matchedComp && defaultCompanyId) {
        matchedComp = companies.find((c) => c.id === defaultCompanyId);
      }
      if (!matchedComp) matchedComp = companies[0];

      if (!matchedComp) {
        errors.push('No permitted company found for import');
      }

      const compDivs = matchedComp ? divisions.filter((d) => d.company_id === matchedComp!.id) : [];
      let matchedDiv = divInput
        ? compDivs.find((d) => d.name.toLowerCase() === divInput || d.code.toLowerCase() === divInput)
        : undefined;
      if (!matchedDiv && defaultDivisionId) {
        matchedDiv = compDivs.find((d) => d.id === defaultDivisionId);
      }
      if (!matchedDiv) matchedDiv = compDivs[0];
      if (!matchedDiv) errors.push('No permitted division found for selected company');

      const compLocs = matchedComp ? locations.filter((l) => l.company_id === matchedComp!.id) : locations;
      const matchedLoc = (locInput
        ? compLocs.find((l) => l.location_code.toLowerCase() === locInput || l.specific_location.toLowerCase() === locInput)
        : undefined) || compLocs[0];
      if (!matchedLoc) errors.push('No permitted location found for selected company');

      const matchedCat = categories.find((c) => c.name.toLowerCase() === catInput || c.code.toLowerCase() === catInput) || categories[0];
      const compPics = matchedComp ? persons.filter((p) => p.company_id === matchedComp!.id) : persons;
      const matchedPic = picInput ? compPics.find((p) => p.full_name.toLowerCase() === picInput || p.nik_nip.toLowerCase() === picInput) : undefined;

      if (matchedComp && matchedDiv && !canUserAccessRecord(req.authUser!, matchedComp.id, matchedDiv.id)) {
        errors.push('Unauthorized company/division scope');
      }

      return {
        rowIndex: idx + 1,
        valid: errors.length === 0,
        errors,
        normalized: {
          asset_code: code || null,
          asset_name: name,
          company_id: matchedComp ? matchedComp.id : null,
          company_name: matchedComp ? matchedComp.name : '',
          division_id: matchedDiv ? matchedDiv.id : null,
          division_name: matchedDiv ? matchedDiv.name : '',
          category_id: matchedCat.id,
          category_name: matchedCat.name,
          brand: row.brand || '',
          model: row.model || '',
          serial_number: serial || null,
          acquisition_date: row.acquisition_date || new Date().toISOString().slice(0, 10),
          acquisition_value: Number(row.acquisition_value || 0),
          location_id: matchedLoc ? matchedLoc.id : null,
          location_name: matchedLoc ? matchedLoc.specific_location : '',
          pic_id: matchedPic ? matchedPic.id : null,
          pic_name: matchedPic ? matchedPic.full_name : null,
          condition_status: ['Good', 'Minor Damage', 'Major Damage', 'Unserviceable'].includes(row.condition_status) ? row.condition_status : 'Good',
        },
      };
    });

    res.json({
      total: results.length,
      validCount: results.filter((r: any) => r.valid).length,
      errorCount: results.filter((r: any) => !r.valid).length,
      results,
    });
  });

  app.post('/api/assets/import/commit', authenticate, requirePermission('assets.import'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      res.status(400).json({ error: 'No valid rows to import' });
      return;
    }

    for (const item of items) {
      const locRow = item.location_id
        ? (db.prepare('SELECT company_id FROM locations WHERE id = ?').get(Number(item.location_id)) as { company_id: number } | undefined)
        : undefined;
      const targetCompanyId = Number(item.company_id || locRow?.company_id || scope.activeCompanyId || scope.allowedCompanyIds[0] || 1);
      const targetDivisionId = Number(
        item.division_id ||
          (db.prepare('SELECT id FROM divisions WHERE company_id = ? ORDER BY id ASC LIMIT 1').get(targetCompanyId) as { id: number } | undefined)?.id ||
          1
      );
      if (!canUserAccessRecord(req.authUser!, targetCompanyId, targetDivisionId)) {
        res.status(403).json({ error: 'Import blocked: contains asset outside your permitted organization scope.' });
        return;
      }
    }

    const tx = db.transaction(() => {
      let inserted = 0;
      for (const item of items) {
        const locRow = item.location_id
          ? (db.prepare('SELECT company_id FROM locations WHERE id = ?').get(Number(item.location_id)) as { company_id: number } | undefined)
          : undefined;
        const companyId = Number(item.company_id || locRow?.company_id || scope.activeCompanyId || scope.allowedCompanyIds[0] || 1);
        const divisionId = Number(
          item.division_id ||
            (db.prepare('SELECT id FROM divisions WHERE company_id = ? ORDER BY id ASC LIMIT 1').get(companyId) as { id: number } | undefined)?.id ||
            1
        );
        const picId = item.pic_id ? Number(item.pic_id) : null;
        const code = item.asset_code || generateNextAssetCode();

        const info = db
          .prepare(`
            INSERT INTO assets (
              asset_code, asset_name, category_id, brand, model, serial_number,
              acquisition_date, acquisition_value, company_id, division_id, location_id, pic_id,
              condition_status, asset_status, data_owner_user_id, custodian_person_id,
              responsible_division_id, verification_officer_user_id, approver_user_id, created_by, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            code,
            item.asset_name,
            item.category_id,
            item.brand || null,
            item.model || null,
            item.serial_number || null,
            item.acquisition_date,
            Number(item.acquisition_value || 0),
            companyId,
            divisionId,
            item.location_id,
            picId,
            item.condition_status || 'Good',
            req.authUser!.id,
            picId,
            divisionId,
            req.authUser!.id,
            req.authUser!.id,
            req.authUser!.id,
            req.authUser!.id
          );
        const newId = Number(info.lastInsertRowid);
        const token = `OIMS-QR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
        const slug = generateQrSlug();
        const qrInfo = db.prepare('INSERT INTO asset_qr_codes (asset_id, qr_token, public_slug, generated_by) VALUES (?, ?, ?, ?)').run(
          newId,
          token,
          slug,
          req.authUser!.id
        );
        const qrId = Number(qrInfo.lastInsertRowid);

        db.prepare(`
          INSERT INTO asset_ownership_history (
            asset_id, from_company_id, to_company_id, from_division_id, to_division_id,
            from_custodian_person_id, to_custodian_person_id, movement_id, changed_by_user_id, reason
          ) VALUES (?, NULL, ?, NULL, ?, NULL, ?, NULL, ?, ?)
        `).run(newId, companyId, divisionId, picId, req.authUser!.id, 'Bulk CSV/Excel Asset Import');

        appendAssetEvent({
          companyId,
          assetId: newId,
          qrId,
          eventType: 'ASSET_IMPORTED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'import',
          referenceId: code,
          reason: 'Imported via CSV/Excel batch',
          previousState: null,
          newState: getAssetStateSnapshot(newId),
        });

        inserted += 1;
      }
      return inserted;
    });

    const count = tx();
    logAudit(req, 'ASSETS_IMPORTED', 'assets', 'import', String(count), { count });
    syncAutomatedNotifications();
    res.json({ imported: count });
  });

  // =========================================================================
  // MODULE 03 – QR CODE TAGGING, PRIVACY & 3-TIER ACCESS CONTROL + FIELD CAPTURE
  // =========================================================================
  app.post('/api/qr/generate/:assetId', authenticate, requirePermission('qr.generate'), async (req: AuthenticatedRequest, res) => {
    const assetId = Number(req.params.assetId);
    const asset = db
      .prepare('SELECT id, asset_code, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(assetId) as { id: number; asset_code: string; company_id: number; division_id: number } | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for QR generation.' });
      return;
    }

    let qrRow = db.prepare('SELECT * FROM asset_qr_codes WHERE asset_id = ?').get(assetId) as
      | { id: number; qr_token: string; public_slug: string | null; status: string }
      | undefined;

    if (!qrRow) {
      const tx = db.transaction(() => {
        const token = `OIMS-QR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
        const slug = generateQrSlug();
        const info = db
          .prepare('INSERT INTO asset_qr_codes (asset_id, qr_token, public_slug, generated_by) VALUES (?, ?, ?, ?)')
          .run(assetId, token, slug, req.authUser!.id);
        const qrId = Number(info.lastInsertRowid);
        appendAssetEvent({
          companyId: asset.company_id,
          assetId,
          qrId,
          eventType: 'QR_GENERATED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'asset_qr',
          referenceId: qrId,
          reason: `QR generated for ${asset.asset_code}`,
          previousState: null,
          newState: { qr_id: qrId, asset_code: asset.asset_code, public_slug: slug },
        });
        return { id: qrId, qr_token: token, public_slug: slug, status: 'Active' };
      });
      qrRow = tx();
      logAudit(req, 'QR_GENERATED', 'qr', 'asset', assetId, { token: qrRow.qr_token, public_slug: qrRow.public_slug });
      syncAutomatedNotifications();
    } else if (!qrRow.public_slug) {
      const slug = generateQrSlug();
      db.prepare('UPDATE asset_qr_codes SET public_slug = ? WHERE id = ?').run(slug, qrRow.id);
      qrRow.public_slug = slug;
    }

    const dataUrl = await QRCode.toDataURL(qrRow.qr_token, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    res.json({ qr_token: qrRow.qr_token, public_slug: qrRow.public_slug, status: qrRow.status, dataUrl });
  });

  app.post('/api/qr/bulk-generate', authenticate, requirePermission('qr.generate'), async (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const rawIds = Array.isArray(req.body?.assetIds)
      ? Array.from(new Set((req.body.assetIds as unknown[]).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)))
      : [];
    const missingOnly = Boolean(req.body?.missingOnly);

    if (!missingOnly && rawIds.length === 0) {
      res.status(400).json({ error: 'Select at least one asset or enable missingOnly.' });
      return;
    }

    if (rawIds.length > 500) {
      res.status(400).json({ error: 'Batch limit is 500 assets per request.' });
      return;
    }

    const assetScope = buildAssetScopeSql(scope, 'a');

    const tx = db.transaction(() => {
      let targets: { id: number; asset_code: string; company_id: number; qr_token: string | null; public_slug: string | null }[];

      if (missingOnly && rawIds.length === 0) {
        targets = db
          .prepare(`
            SELECT a.id, a.asset_code, a.company_id, q.qr_token, q.public_slug
            FROM assets a
            LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
            WHERE a.deleted_at IS NULL AND q.id IS NULL AND ${assetScope.clause}
            ORDER BY a.id ASC
            LIMIT 500
          `)
          .all(...assetScope.params) as { id: number; asset_code: string; company_id: number; qr_token: string | null; public_slug: string | null }[];
      } else {
        const placeholders = rawIds.map(() => '?').join(',');
        const extraWhere = missingOnly ? 'AND q.id IS NULL' : '';
        targets = db
          .prepare(`
            SELECT a.id, a.asset_code, a.company_id, q.qr_token, q.public_slug
            FROM assets a
            LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
            WHERE a.deleted_at IS NULL AND a.id IN (${placeholders}) AND ${assetScope.clause} ${extraWhere}
            ORDER BY a.id ASC
          `)
          .all(...rawIds, ...assetScope.params) as { id: number; asset_code: string; company_id: number; qr_token: string | null; public_slug: string | null }[];
      }

      const insertStmt = db.prepare('INSERT INTO asset_qr_codes (asset_id, qr_token, public_slug, generated_by) VALUES (?, ?, ?, ?)');
      let generatedCount = 0;
      const resolved: { assetId: number; asset_code: string; qr_token: string; public_slug: string }[] = [];

      for (const row of targets) {
        let token = row.qr_token;
        let slug = row.public_slug;
        if (!token) {
          token = `OIMS-QR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
          slug = generateQrSlug();
          const qrInfo = insertStmt.run(row.id, token, slug, req.authUser!.id);
          const qrId = Number(qrInfo.lastInsertRowid);
          appendAssetEvent({
            companyId: row.company_id,
            assetId: row.id,
            qrId,
            eventType: 'QR_GENERATED',
            actorUserId: req.authUser!.id,
            actorUsername: req.authUser!.username,
            referenceType: 'asset_qr',
            referenceId: qrId,
            reason: `Bulk QR generated for ${row.asset_code}`,
            previousState: null,
            newState: { qr_id: qrId, asset_code: row.asset_code, public_slug: slug },
          });
          generatedCount += 1;
        } else if (!slug) {
          slug = generateQrSlug();
          db.prepare('UPDATE asset_qr_codes SET public_slug = ? WHERE asset_id = ?').run(slug, row.id);
        }
        resolved.push({
          assetId: row.id,
          asset_code: row.asset_code,
          qr_token: token,
          public_slug: slug,
        });
      }

      return { generatedCount, resolved };
    });

    const { generatedCount, resolved } = tx();

    const items = await Promise.all(
      resolved.map(async (item) => {
        const dataUrl = await QRCode.toDataURL(item.qr_token, {
          width: 400,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        return { ...item, dataUrl };
      })
    );

    if (generatedCount > 0) {
      logAudit(req, 'QR_BULK_GENERATED', 'qr', 'asset_qr_codes', String(generatedCount), {
        generatedCount,
        totalRequested: resolved.length,
      });
      syncAutomatedNotifications();
    }

    res.json({
      generatedCount,
      totalCount: items.length,
      items,
    });
  });

  app.get('/api/qr/image/:token', authenticate, async (req, res) => {
    const token = String(req.params.token);
    const dataUrl = await QRCode.toDataURL(token, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    res.json({ dataUrl });
  });

  // Update QR Public Privacy & Expiration settings
  app.put('/api/qr/:assetId/settings', authenticate, requirePermission('qr.generate'), (req: AuthenticatedRequest, res) => {
    const assetId = Number(req.params.assetId);
    const asset = db
      .prepare('SELECT id, asset_code, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(assetId) as { id: number; asset_code: string; company_id: number; division_id: number } | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied.' });
      return;
    }

    const qrRow = db.prepare('SELECT * FROM asset_qr_codes WHERE asset_id = ?').get(assetId) as Record<string, any> | undefined;
    if (!qrRow) {
      res.status(404).json({ error: 'QR code has not been generated for this asset yet.' });
      return;
    }

    const body = req.body || {};
    const publicEnabled = body.public_enabled !== undefined ? (body.public_enabled ? 1 : 0) : Number(qrRow.public_enabled ?? 1);
    const publicShowPhoto = body.public_show_photo !== undefined ? (body.public_show_photo ? 1 : 0) : Number(qrRow.public_show_photo ?? 1);
    const publicShowLocation = body.public_show_location !== undefined ? (body.public_show_location ? 1 : 0) : Number(qrRow.public_show_location ?? 1);
    const expiresAt = body.expires_at === null || body.expires_at === '' ? null : String(body.expires_at ?? qrRow.expires_at ?? '').trim() || null;

    if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
      res.status(400).json({ error: 'Invalid expiration timestamp.' });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE asset_qr_codes SET
          public_enabled = ?,
          public_show_photo = ?,
          public_show_location = ?,
          expires_at = ?
        WHERE id = ?
      `).run(publicEnabled, publicShowPhoto, publicShowLocation, expiresAt, qrRow.id);

      appendAssetEvent({
        companyId: asset.company_id,
        assetId,
        qrId: qrRow.id,
        eventType: 'QR_PRIVACY_UPDATED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'asset_qr',
        referenceId: qrRow.id,
        reason: 'QR public visibility / expiration updated',
        previousState: {
          public_enabled: qrRow.public_enabled,
          public_show_photo: qrRow.public_show_photo,
          public_show_location: qrRow.public_show_location,
          expires_at: qrRow.expires_at,
        },
        newState: {
          public_enabled: publicEnabled,
          public_show_photo: publicShowPhoto,
          public_show_location: publicShowLocation,
          expires_at: expiresAt,
        },
      });
    });
    tx();
    logAudit(req, 'QR_PRIVACY_UPDATED', 'qr', 'asset_qr_codes', qrRow.id, {
      asset_code: asset.asset_code,
      publicEnabled,
      publicShowPhoto,
      publicShowLocation,
      expiresAt,
    });
    res.json({ ok: true });
  });

  // Revoke or Rotate/Replace QR Token
  app.post('/api/qr/:assetId/revoke', authenticate, requirePermission('qr.generate'), async (req: AuthenticatedRequest, res) => {
    const assetId = Number(req.params.assetId);
    const asset = db
      .prepare('SELECT id, asset_code, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(assetId) as { id: number; asset_code: string; company_id: number; division_id: number } | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied.' });
      return;
    }

    const qrRow = db.prepare('SELECT * FROM asset_qr_codes WHERE asset_id = ?').get(assetId) as Record<string, any> | undefined;
    if (!qrRow) {
      res.status(404).json({ error: 'QR code record not found for this asset.' });
      return;
    }

    const reissue = Boolean(req.body?.reissue);
    const reason = String(req.body?.reason || (reissue ? 'QR token rotated & reissued' : 'QR token revoked by administrator')).trim();

    const result = db.transaction(() => {
      if (reissue) {
        const newToken = `OIMS-QR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
        const newSlug = generateQrSlug();
        db.prepare(`
          UPDATE asset_qr_codes SET
            qr_token = ?,
            public_slug = ?,
            status = 'Active',
            revoked_at = NULL,
            revoked_by = NULL,
            revoked_reason = NULL,
            generated_at = datetime('now'),
            generated_by = ?
          WHERE id = ?
        `).run(newToken, newSlug, req.authUser!.id, qrRow.id);

        appendAssetEvent({
          companyId: asset.company_id,
          assetId,
          qrId: qrRow.id,
          eventType: 'QR_REPLACED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'asset_qr',
          referenceId: qrRow.id,
          reason,
          previousState: { qr_token: qrRow.qr_token, public_slug: qrRow.public_slug, status: qrRow.status },
          newState: { qr_token: newToken, public_slug: newSlug, status: 'Active' },
        });
        return { qr_token: newToken, public_slug: newSlug, status: 'Active' };
      } else {
        db.prepare(`
          UPDATE asset_qr_codes SET
            status = 'Revoked',
            revoked_at = datetime('now'),
            revoked_by = ?,
            revoked_reason = ?
          WHERE id = ?
        `).run(req.authUser!.id, reason, qrRow.id);

        appendAssetEvent({
          companyId: asset.company_id,
          assetId,
          qrId: qrRow.id,
          eventType: 'QR_REVOKED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'asset_qr',
          referenceId: qrRow.id,
          reason,
          previousState: { qr_token: qrRow.qr_token, status: qrRow.status },
          newState: { qr_token: qrRow.qr_token, status: 'Revoked' },
        });
        return { qr_token: qrRow.qr_token, public_slug: qrRow.public_slug, status: 'Revoked' };
      }
    })();

    logAudit(req, reissue ? 'QR_REPLACED' : 'QR_REVOKED', 'qr', 'asset_qr_codes', qrRow.id, {
      asset_code: asset.asset_code,
      reason,
      reissue,
    });

    const dataUrl = reissue
      ? await QRCode.toDataURL(result.qr_token, {
          width: 400,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#FFFFFF' },
        })
      : null;

    res.json({ ok: true, ...result, dataUrl });
  });

  // View QR Access Logs (Scoped)
  app.get('/api/qr/access-logs', authenticate, requirePermission('qr.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 80)));

    const compScope = buildCompanyScopeSql(scope, 'a.company_id');
    const logs = db
      .prepare(`
        SELECT l.*, a.asset_code, a.asset_name, u.username, u.full_name as user_full_name
        FROM qr_access_logs l
        LEFT JOIN assets a ON a.id = l.asset_id
        LEFT JOIN users u ON u.id = l.user_id
        WHERE (l.asset_id IS NULL OR ${compScope.clause})
        ORDER BY l.id DESC
        LIMIT ?
      `)
      .all(...compScope.params, limit);
    res.json({ logs });
  });

  // Public Tier-1 Asset View (Unauthenticated, Anti-Enumeration, Rate-Limited)
  app.get('/api/public/qr/:slugOrToken', (req, res) => {
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
    const tokenAttempted = extractQrSlugOrToken(decodeURIComponent(String(req.params.slugOrToken || '')));

    const rl = checkPublicQrRateLimit(ip);
    if (!rl.allowed) {
      recordQrAccessLog({
        tokenAttempted,
        accessTier: 'denied',
        outcome: 'rate_limited',
        req,
      });
      res.setHeader('Retry-After', String(rl.retryAfterSec || 60));
      res.status(429).json({
        error: 'Too many QR lookup requests from this address. Please wait before retrying.',
        code: 'RATE_LIMITED',
        retryAfterSec: rl.retryAfterSec || 60,
      });
      return;
    }

    // Anti-enumeration: reject empty or plain asset-code/numeric guesses — require opaque public_slug or qr_token
    if (!tokenAttempted || tokenAttempted.length < 10) {
      recordQrAccessLog({
        tokenAttempted,
        accessTier: 'denied',
        outcome: 'not_found',
        req,
      });
      res.status(404).json({ error: 'QR asset record not found.', code: 'NOT_FOUND' });
      return;
    }

    const row = db
      .prepare(`
        SELECT q.id as qr_id, q.asset_id, q.qr_token, q.public_slug, q.status as qr_status,
               q.public_enabled, q.public_show_photo, q.public_show_location, q.expires_at, q.revoked_at,
               a.asset_code, a.asset_name, a.brand, a.model, a.condition_status, a.asset_status,
               c.name as category_name, co.name as company_name, b.name as building_name,
               COALESCE(a.primary_photo_url, (SELECT ap.file_url FROM asset_photos ap WHERE ap.asset_id = a.id ORDER BY ap.is_primary DESC, ap.created_at DESC LIMIT 1)) as primary_photo_url
        FROM asset_qr_codes q
        JOIN assets a ON a.id = q.asset_id
        JOIN categories c ON c.id = a.category_id
        JOIN companies co ON co.id = a.company_id
        JOIN locations l ON l.id = a.location_id
        JOIN buildings b ON b.id = l.building_id
        WHERE a.deleted_at IS NULL
          AND (q.public_slug = ? OR q.qr_token = ?)
        LIMIT 1
      `)
      .get(tokenAttempted, tokenAttempted) as Record<string, any> | undefined;

    if (!row) {
      recordQrAccessLog({
        tokenAttempted,
        accessTier: 'denied',
        outcome: 'not_found',
        req,
      });
      res.status(404).json({ error: 'QR asset record not found.', code: 'NOT_FOUND' });
      return;
    }

    if (row.qr_status === 'Revoked') {
      recordQrAccessLog({
        qrId: row.qr_id,
        assetId: row.asset_id,
        tokenAttempted,
        accessTier: 'denied',
        outcome: 'revoked',
        req,
      });
      res.status(410).json({
        error: 'This QR code has been revoked and is no longer valid.',
        code: 'QR_REVOKED',
        revoked_at: row.revoked_at,
      });
      return;
    }

    if (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) {
      recordQrAccessLog({
        qrId: row.qr_id,
        assetId: row.asset_id,
        tokenAttempted,
        accessTier: 'denied',
        outcome: 'expired',
        req,
      });
      res.status(410).json({
        error: 'This QR verification link has expired.',
        code: 'QR_EXPIRED',
        expires_at: row.expires_at,
      });
      return;
    }

    if (!Number(row.public_enabled)) {
      recordQrAccessLog({
        qrId: row.qr_id,
        assetId: row.asset_id,
        tokenAttempted,
        accessTier: 'denied',
        outcome: 'public_disabled',
        req,
      });
      res.status(403).json({
        error: 'Public viewing is disabled for this asset. Please sign in to inspect.',
        code: 'PUBLIC_DISABLED',
      });
      return;
    }

    db.prepare("UPDATE asset_qr_codes SET scan_count = scan_count + 1, last_scanned_at = datetime('now') WHERE id = ?").run(row.qr_id);
    recordQrAccessLog({
      qrId: row.qr_id,
      assetId: row.asset_id,
      tokenAttempted,
      accessTier: 'public',
      outcome: 'granted',
      req,
    });

    // Strictly limited Tier-1 Public Asset View payload
    res.json({
      access_tier: 'public',
      asset: {
        asset_code: row.asset_code,
        asset_name: row.asset_name,
        category_name: row.category_name,
        brand: row.brand,
        model: row.model,
        condition_status: row.condition_status,
        asset_status: row.asset_status,
        public_slug: row.public_slug,
        qr_status: row.qr_status,
        company_name: Number(row.public_show_location) ? row.company_name : null,
        general_location: Number(row.public_show_location) ? row.building_name : null,
        primary_photo_url: Number(row.public_show_photo) ? row.primary_photo_url : null,
      },
    });
  });

  // Tier-2 (Authenticated) & Tier-3 (Administrative) QR Resolve
  app.get('/api/qr/resolve/:codeOrToken', authenticate, requirePermission('qr.scan'), (req: AuthenticatedRequest, res) => {
    const input = decodeURIComponent(String(req.params.codeOrToken));
    const clean = extractQrSlugOrToken(input);
    const tier = getQrAccessTier(req.authUser);

    const match = db
      .prepare(`
        SELECT a.id, a.company_id, a.division_id, q.id as qr_id, q.qr_token, q.public_slug,
               q.status as qr_status, q.expires_at, q.revoked_at
        FROM assets a
        LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
        WHERE a.deleted_at IS NULL
          AND (
            q.qr_token = ?
            OR q.public_slug = ?
            OR upper(a.asset_code) = upper(?)
            OR (a.serial_number IS NOT NULL AND trim(a.serial_number) != '' AND upper(a.serial_number) = upper(?))
          )
        LIMIT 1
      `)
      .get(clean, clean, clean, clean) as
      | {
          id: number;
          company_id: number;
          division_id: number;
          qr_id: number | null;
          qr_token: string | null;
          public_slug: string | null;
          qr_status: string | null;
          expires_at: string | null;
          revoked_at: string | null;
        }
      | undefined;

    if (!match) {
      recordQrAccessLog({
        tokenAttempted: clean,
        accessTier: 'denied',
        outcome: 'not_found',
        userId: req.authUser!.id,
        req,
      });
      res.status(404).json({ error: 'No matching asset found for scanned QR / Asset Code / Serial Number.' });
      return;
    }

    if (!canUserAccessRecord(req.authUser!, match.company_id, match.division_id)) {
      recordQrAccessLog({
        qrId: match.qr_id,
        assetId: match.id,
        tokenAttempted: clean,
        accessTier: 'denied',
        outcome: 'forbidden',
        userId: req.authUser!.id,
        req,
      });
      res.status(403).json({ error: 'Access denied: asset belongs to another company/division scope.' });
      return;
    }

    const scannedViaQrToken = Boolean(
      (match.qr_token && match.qr_token === clean) || (match.public_slug && match.public_slug === clean)
    );

    if (scannedViaQrToken && match.qr_status === 'Revoked') {
      recordQrAccessLog({
        qrId: match.qr_id,
        assetId: match.id,
        tokenAttempted: clean,
        accessTier: 'denied',
        outcome: 'revoked',
        userId: req.authUser!.id,
        req,
      });
      res.status(410).json({ error: 'This QR token has been revoked.', code: 'QR_REVOKED' });
      return;
    }

    if (scannedViaQrToken && match.expires_at && new Date(String(match.expires_at)).getTime() <= Date.now()) {
      recordQrAccessLog({
        qrId: match.qr_id,
        assetId: match.id,
        tokenAttempted: clean,
        accessTier: 'denied',
        outcome: 'expired',
        userId: req.authUser!.id,
        req,
      });
      res.status(410).json({ error: 'This QR access token has expired.', code: 'QR_EXPIRED' });
      return;
    }

    if (match.qr_id) {
      db.prepare("UPDATE asset_qr_codes SET scan_count = scan_count + 1, last_scanned_at = datetime('now') WHERE id = ?").run(match.qr_id);
    }

    recordQrAccessLog({
      qrId: match.qr_id,
      assetId: match.id,
      tokenAttempted: clean,
      accessTier: tier,
      outcome: 'granted',
      userId: req.authUser!.id,
      req,
    });

    const rawAsset = db
      .prepare(`
        SELECT a.*, c.name as category_name, c.default_useful_life_years, sc.name as subcategory_name,
               co.name as company_name, co.code as company_code, d.name as division_name,
               COALESCE(rd.name, d.name) as responsible_division_name,
               b.name as building_name, f.name as floor_name, r.name as room_name, l.specific_location, l.location_code,
               p.full_name as pic_name, p.nik_nip as pic_nik, p.email as pic_email, p.phone as pic_phone,
               q.qr_token, q.public_slug, q.status as qr_status, q.public_enabled, q.public_show_photo, q.public_show_location, q.expires_at as qr_expires_at,
               q.generated_at as qr_generated_at, q.scan_count, q.last_scanned_at,
               COALESCE(a.primary_photo_url, (SELECT ap.file_url FROM asset_photos ap WHERE ap.asset_id = a.id ORDER BY ap.is_primary DESC, ap.created_at DESC LIMIT 1)) as primary_photo_url
        FROM assets a
        JOIN categories c ON c.id = a.category_id
        LEFT JOIN subcategories sc ON sc.id = a.subcategory_id
        JOIN companies co ON co.id = a.company_id
        JOIN divisions d ON d.id = a.division_id
        LEFT JOIN divisions rd ON rd.id = a.responsible_division_id
        JOIN locations l ON l.id = a.location_id
        JOIN buildings b ON b.id = l.building_id
        JOIN floors f ON f.id = l.floor_id
        JOIN rooms r ON r.id = l.room_id
        LEFT JOIN persons p ON p.id = a.pic_id
        LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
        WHERE a.id = ?
      `)
      .get(match.id) as Record<string, any>;

    const photos = db
      .prepare('SELECT * FROM asset_photos WHERE asset_id = ? ORDER BY is_primary DESC, created_at DESC')
      .all(match.id);
    const fieldCaptures = db
      .prepare(`
        SELECT fc.*, u.username as captured_by_username, u.full_name as captured_by_name
        FROM asset_field_captures fc
        LEFT JOIN users u ON u.id = fc.captured_by_user_id
        WHERE fc.asset_id = ?
        ORDER BY fc.id DESC
        LIMIT 25
      `)
      .all(match.id);

    const movements = db
      .prepare(`
        SELECT m.id, m.movement_code, m.movement_date, m.status, m.reason,
               fb.name || ' · ' || fl.specific_location as from_loc, tb.name || ' · ' || tl.specific_location as to_loc
        FROM asset_movements m
        JOIN locations fl ON fl.id = m.from_location_id
        JOIN buildings fb ON fb.id = fl.building_id
        JOIN locations tl ON tl.id = m.to_location_id
        JOIN buildings tb ON tb.id = tl.building_id
        WHERE m.asset_id = ?
        ORDER BY m.movement_date DESC
      `)
      .all(match.id);
    const maintenance = db
      .prepare('SELECT id, ticket_code, damage_date, damage_type, status, completion_date FROM maintenance_records WHERE asset_id = ? ORDER BY damage_date DESC')
      .all(match.id);

    if (tier === 'administrative') {
      const documents = db
        .prepare('SELECT * FROM asset_documents WHERE asset_id = ? ORDER BY created_at DESC')
        .all(match.id);
      const events = db
        .prepare(`
          SELECT e.*, u.full_name as actor_full_name
          FROM asset_events e
          LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.asset_id = ?
          ORDER BY e.id DESC
          LIMIT 50
        `)
        .all(match.id);
      const ownershipHistory = db
        .prepare(`
          SELECT h.*, fc.name as from_company_name, tc.name as to_company_name,
                 fd.name as from_division_name, td.name as to_division_name
          FROM asset_ownership_history h
          LEFT JOIN companies fc ON fc.id = h.from_company_id
          LEFT JOIN companies tc ON tc.id = h.to_company_id
          LEFT JOIN divisions fd ON fd.id = h.from_division_id
          LEFT JOIN divisions td ON td.id = h.to_division_id
          WHERE h.asset_id = ?
          ORDER BY h.id DESC
        `)
        .all(match.id);

      logAudit(req, 'QR_SCANNED', 'qr', 'asset', match.id, { input: clean, access_tier: tier });
      res.json({
        access_tier: tier,
        asset: rawAsset,
        photos,
        documents,
        movements,
        maintenance,
        events,
        ownershipHistory,
        fieldCaptures,
      });
      return;
    }

    // Tier-2 Authenticated Asset View: redact financial/procurement/contact PII fields
    const redactedAsset = {
      ...rawAsset,
      acquisition_value: null,
      supplier: null,
      purchase_reference: null,
      pic_email: null,
      pic_phone: null,
    };
    logAudit(req, 'QR_SCANNED', 'qr', 'asset', match.id, { input: clean, access_tier: tier });
    res.json({
      access_tier: tier,
      asset: redactedAsset,
      photos,
      documents: [],
      movements,
      maintenance,
      events: [],
      ownershipHistory: [],
      fieldCaptures,
    });
  });

  // =========================================================================
  // MOBILE / FIELD CAPTURE (PHOTO + GPS TELEMETRY, NON-DESTRUCTIVE EVIDENCE)
  // =========================================================================
  app.post('/api/field/capture', authenticate, async (req: AuthenticatedRequest, res) => {
    const perms = req.authUser!.permissions || [];
    const allowed =
      req.authUser!.role_code === 'super_admin' ||
      perms.includes('qr.scan') ||
      perms.includes('opname.verify') ||
      perms.includes('assets.edit');
    if (!allowed) {
      res.status(403).json({ error: 'Permission required for field capture.' });
      return;
    }

    if (req.is('multipart/form-data')) {
      try {
        await runAssetFileUploadSingle(req, res);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Invalid field photo upload' });
        return;
      }
    }

    const assetId = Number(req.body?.asset_id);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      res.status(400).json({ error: 'Valid asset_id is required for field capture.' });
      return;
    }

    const asset = db
      .prepare('SELECT id, asset_code, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(assetId) as { id: number; asset_code: string; company_id: number; division_id: number } | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for field capture.' });
      return;
    }

    const latRaw = req.body?.latitude !== undefined && req.body?.latitude !== '' ? Number(req.body.latitude) : null;
    const lngRaw = req.body?.longitude !== undefined && req.body?.longitude !== '' ? Number(req.body.longitude) : null;
    const accRaw = req.body?.accuracy_meters !== undefined && req.body?.accuracy_meters !== '' ? Number(req.body.accuracy_meters) : null;

    if (latRaw !== null && (!Number.isFinite(latRaw) || latRaw < -90 || latRaw > 90)) {
      res.status(400).json({ error: 'Invalid GPS latitude (-90 to 90).' });
      return;
    }
    if (lngRaw !== null && (!Number.isFinite(lngRaw) || lngRaw < -180 || lngRaw > 180)) {
      res.status(400).json({ error: 'Invalid GPS longitude (-180 to 180).' });
      return;
    }

    let photoUrl: string | null = null;
    let photoFileName: string | null = null;
    if (req.file) {
      if (!ALLOWED_IMAGE_MIMES.has(req.file.mimetype)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
        res.status(400).json({ error: 'Field photo must be JPG, PNG, or WEBP.' });
        return;
      }
      photoUrl = `/uploads/${req.file.filename}`;
      photoFileName = sanitizeFileName(req.file.originalname);
    }

    if (latRaw === null && lngRaw === null && !photoUrl) {
      res.status(400).json({ error: 'Provide GPS coordinates or a field photo.' });
      return;
    }

    const opnameId = req.body?.opname_id ? Number(req.body.opname_id) : null;
    const captureContext = String(req.body?.capture_context || 'field_scan').slice(0, 40);
    const conditionObserved = req.body?.condition_observed ? String(req.body.condition_observed).slice(0, 60) : null;
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;
    const qrRow = db.prepare('SELECT id FROM asset_qr_codes WHERE asset_id = ?').get(assetId) as { id: number } | undefined;

    const captureId = db.transaction(() => {
      const info = db
        .prepare(`
          INSERT INTO asset_field_captures (
            company_id, asset_id, qr_id, opname_id, captured_by_user_id, capture_context,
            latitude, longitude, accuracy_meters, photo_url, condition_observed, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          asset.company_id,
          assetId,
          qrRow?.id ?? null,
          opnameId,
          req.authUser!.id,
          captureContext,
          latRaw,
          lngRaw,
          accRaw,
          photoUrl,
          conditionObserved,
          notes
        );

      if (photoUrl && photoFileName) {
        db.prepare(
          'INSERT INTO asset_photos (asset_id, file_name, file_url, drive_file_id, drive_web_view_link, mime_type, file_size_bytes, is_primary, uploaded_by) VALUES (?, ?, ?, NULL, NULL, ?, ?, 0, ?)'
        ).run(assetId, photoFileName, photoUrl, req.file!.mimetype, req.file!.size || null, req.authUser!.id);

        appendAssetEvent({
          companyId: asset.company_id,
          assetId,
          qrId: qrRow?.id ?? null,
          eventType: 'PHOTO_CAPTURED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'field_capture',
          referenceId: Number(info.lastInsertRowid),
          reason: notes || `Field photo captured (${captureContext})`,
          previousState: null,
          newState: { photo_url: photoUrl, capture_context: captureContext },
        });
      }

      if (latRaw !== null && lngRaw !== null) {
        appendAssetEvent({
          companyId: asset.company_id,
          assetId,
          qrId: qrRow?.id ?? null,
          eventType: 'GPS_RECORDED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'field_capture',
          referenceId: Number(info.lastInsertRowid),
          reason: notes || `Field GPS coordinates recorded (${captureContext})`,
          previousState: null,
          newState: {
            latitude: latRaw,
            longitude: lngRaw,
            accuracy_meters: accRaw,
            condition_observed: conditionObserved,
          },
        });
      }

      return Number(info.lastInsertRowid);
    })();

    logAudit(req, 'FIELD_CAPTURE_RECORDED', 'qr', 'asset', assetId, {
      captureId,
      hasGps: latRaw !== null && lngRaw !== null,
      hasPhoto: Boolean(photoUrl),
    });

    res.status(201).json({
      id: captureId,
      asset_id: assetId,
      latitude: latRaw,
      longitude: lngRaw,
      accuracy_meters: accRaw,
      photo_url: photoUrl,
      condition_observed: conditionObserved,
    });
  });

  app.get('/api/field/captures', authenticate, requirePermission('assets.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    const compScope = buildCompanyScopeSql(scope, 'fc.company_id');
    const where = [compScope.clause];
    const params: unknown[] = [...compScope.params];

    if (req.query.asset_id) {
      where.push('fc.asset_id = ?');
      params.push(Number(req.query.asset_id));
    }
    if (req.query.opname_id) {
      where.push('fc.opname_id = ?');
      params.push(Number(req.query.opname_id));
    }

    const captures = db
      .prepare(`
        SELECT fc.*, a.asset_code, a.asset_name, u.username as captured_by_username, u.full_name as captured_by_name
        FROM asset_field_captures fc
        JOIN assets a ON a.id = fc.asset_id
        LEFT JOIN users u ON u.id = fc.captured_by_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY fc.id DESC
        LIMIT 100
      `)
      .all(...params);
    res.json({ captures });
  });

  // =========================================================================
  // MODULE 05 – ASSET LOCATION MANAGEMENT
  // =========================================================================
  app.post('/api/locations', authenticate, requirePermission('locations.create'), (req: AuthenticatedRequest, res) => {
    const { company_id, building_name, floor_name, room_name, specific_location, location_code, notes } = req.body || {};
    if (!company_id || !building_name || !floor_name || !room_name || !specific_location) {
      res.status(400).json({ error: 'All 5 location hierarchy tiers are required.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, Number(company_id))) {
      res.status(403).json({ error: 'Cannot create location outside your permitted company scope.' });
      return;
    }

    const tx = db.transaction(() => {
      let bld = db.prepare('SELECT id FROM buildings WHERE company_id = ? AND lower(name) = lower(?)').get(Number(company_id), building_name.trim()) as { id: number } | undefined;
      if (!bld) {
        const code = `BLD-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        bld = { id: Number(db.prepare('INSERT INTO buildings (company_id, code, name) VALUES (?, ?, ?)').run(Number(company_id), code, building_name.trim()).lastInsertRowid) };
      }

      let flr = db.prepare('SELECT id FROM floors WHERE building_id = ? AND lower(name) = lower(?)').get(bld.id, floor_name.trim()) as { id: number } | undefined;
      if (!flr) {
        flr = { id: Number(db.prepare('INSERT INTO floors (building_id, name, level_number) VALUES (?, ?, 1)').run(bld.id, floor_name.trim()).lastInsertRowid) };
      }

      let rm = db.prepare('SELECT id FROM rooms WHERE floor_id = ? AND lower(name) = lower(?)').get(flr.id, room_name.trim()) as { id: number } | undefined;
      if (!rm) {
        rm = { id: Number(db.prepare('INSERT INTO rooms (floor_id, name) VALUES (?, ?)').run(flr.id, room_name.trim()).lastInsertRowid) };
      }

      const locCode = location_code ? String(location_code).trim().toUpperCase() : `LOC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const info = db
        .prepare('INSERT INTO locations (company_id, building_id, floor_id, room_id, specific_location, location_code, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(Number(company_id), bld.id, flr.id, rm.id, specific_location.trim(), locCode, notes || null);
      return Number(info.lastInsertRowid);
    });

    try {
      const id = tx();
      logAudit(req, 'LOCATION_CREATED', 'locations', 'location', id);
      res.status(201).json({ id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/locations/:id', authenticate, requirePermission('locations.edit'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const loc = db.prepare('SELECT id, company_id FROM locations WHERE id = ?').get(id) as { id: number; company_id: number } | undefined;
    if (!loc) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, loc.company_id)) {
      res.status(403).json({ error: 'Cross-company access denied for this location.' });
      return;
    }
    const { specific_location, notes } = req.body || {};
    if (!specific_location) {
      res.status(400).json({ error: 'Specific location name required' });
      return;
    }
    db.prepare("UPDATE locations SET specific_location = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").run(
      specific_location.trim(),
      notes || null,
      id
    );
    logAudit(req, 'LOCATION_UPDATED', 'locations', 'location', id);
    res.json({ ok: true });
  });

  app.delete('/api/locations/:id', authenticate, requirePermission('locations.delete'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const loc = db.prepare('SELECT id, company_id FROM locations WHERE id = ?').get(id) as { id: number; company_id: number } | undefined;
    if (!loc) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, loc.company_id)) {
      res.status(403).json({ error: 'Cross-company access denied for this location.' });
      return;
    }
    const inUseAssets = (db.prepare('SELECT COUNT(*) as c FROM assets WHERE location_id = ? AND deleted_at IS NULL').get(id) as { c: number }).c;
    const inUseMoves = (db.prepare('SELECT COUNT(*) as c FROM asset_movements WHERE from_location_id = ? OR to_location_id = ?').get(id, id) as { c: number }).c;
    if (inUseAssets > 0 || inUseMoves > 0) {
      res.status(409).json({ error: 'Cannot delete location: assigned to existing assets or historical movement records.' });
      return;
    }
    db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    logAudit(req, 'LOCATION_DELETED', 'locations', 'location', id);
    res.json({ ok: true });
  });

  // =========================================================================
  // MODULE 06 – PIC MANAGEMENT
  // =========================================================================
  app.post('/api/persons', authenticate, requirePermission('pic.create'), (req: AuthenticatedRequest, res) => {
    const b = req.body || {};
    if (!b.nik_nip || !b.full_name || !b.company_id || !b.division_id || !b.position_title || !b.email) {
      res.status(400).json({ error: 'Missing required PIC fields' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, Number(b.company_id), Number(b.division_id))) {
      res.status(403).json({ error: 'Cannot create PIC outside your organization scope.' });
      return;
    }
    try {
      const info = db
        .prepare('INSERT INTO persons (nik_nip, full_name, company_id, division_id, department, position_title, email, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(b.nik_nip.trim(), b.full_name.trim(), Number(b.company_id), Number(b.division_id), b.department || null, b.position_title.trim(), b.email.trim(), b.phone || null, b.status || 'Active');
      logAudit(req, 'PIC_CREATED', 'pic', 'person', Number(info.lastInsertRowid));
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'NIK/NIP already exists or invalid data' });
    }
  });

  app.put('/api/persons/:id', authenticate, requirePermission('pic.edit'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id, company_id, division_id FROM persons WHERE id = ?').get(id) as
      | { id: number; company_id: number; division_id: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'PIC record not found' });
      return;
    }
    const b = req.body || {};
    const targetCompanyId = Number(b.company_id || existing.company_id);
    const targetDivisionId = Number(b.division_id || existing.division_id);
    if (
      !canUserAccessRecord(req.authUser!, existing.company_id, existing.division_id) ||
      !canUserAccessRecord(req.authUser!, targetCompanyId, targetDivisionId)
    ) {
      res.status(403).json({ error: 'Cross-company/division access denied for this PIC.' });
      return;
    }
    db.prepare(`
      UPDATE persons SET full_name = ?, company_id = ?, division_id = ?, department = ?, position_title = ?, email = ?, phone = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(b.full_name, targetCompanyId, targetDivisionId, b.department || null, b.position_title, b.email, b.phone || null, b.status || 'Active', id);
    logAudit(req, 'PIC_UPDATED', 'pic', 'person', id);
    res.json({ ok: true });
  });

  // =========================================================================
  // MODULE 07 – ASSET MOVEMENT HISTORY (Atomic Transactions & Cross-Company Transfers)
  // =========================================================================
  app.get('/api/movements', authenticate, requirePermission('movements.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    let movClause = '1=1';
    let movParams: unknown[] = [];

    if (scope.activeCompanyId !== null) {
      if (scope.isHoldingScope || scope.companyWideIds.includes(scope.activeCompanyId)) {
        movClause = '(COALESCE(m.from_company_id, a.company_id) = ? OR COALESCE(m.to_company_id, a.company_id) = ?)';
        movParams = [scope.activeCompanyId, scope.activeCompanyId];
      } else if (scope.divisionScopedIds.length > 0) {
        const ph = scope.divisionScopedIds.map(() => '?').join(',');
        movClause = `((COALESCE(m.from_company_id, a.company_id) = ? OR COALESCE(m.to_company_id, a.company_id) = ?) AND (COALESCE(m.from_division_id, a.division_id) IN (${ph}) OR COALESCE(m.to_division_id, a.division_id) IN (${ph})))`;
        movParams = [scope.activeCompanyId, scope.activeCompanyId, ...scope.divisionScopedIds, ...scope.divisionScopedIds];
      } else {
        movClause = '1=0';
      }
    } else if (!scope.isHoldingScope) {
      const parts: string[] = [];
      if (scope.companyWideIds.length > 0) {
        const ph = scope.companyWideIds.map(() => '?').join(',');
        parts.push(`(COALESCE(m.from_company_id, a.company_id) IN (${ph}) OR COALESCE(m.to_company_id, a.company_id) IN (${ph}))`);
        movParams.push(...scope.companyWideIds, ...scope.companyWideIds);
      }
      if (scope.divisionScopedIds.length > 0) {
        const ph = scope.divisionScopedIds.map(() => '?').join(',');
        parts.push(`(COALESCE(m.from_division_id, a.division_id) IN (${ph}) OR COALESCE(m.to_division_id, a.division_id) IN (${ph}))`);
        movParams.push(...scope.divisionScopedIds, ...scope.divisionScopedIds);
      }
      movClause = parts.length > 0 ? `(${parts.join(' OR ')})` : '1=0';
    }

    const rows = db
      .prepare(`
        SELECT m.*, a.asset_code, a.asset_name,
               fb.name || ' · ' || fr.name || ' · ' || fl.specific_location as from_location_label,
               tb.name || ' · ' || tr.name || ' · ' || tl.specific_location as to_location_label,
               fc.name as from_company_name, fc.code as from_company_code,
               tc.name as to_company_name, tc.code as to_company_code,
               fd.name as from_division_name, td.name as to_division_name,
               fp.full_name as from_pic_name, tp.full_name as to_pic_name,
               u.full_name as officer_name,
               ma.decision as approval_decision, ma.notes as approval_notes, ma.decided_at
        FROM asset_movements m
        JOIN assets a ON a.id = m.asset_id
        JOIN locations fl ON fl.id = m.from_location_id
        JOIN buildings fb ON fb.id = fl.building_id
        JOIN rooms fr ON fr.id = fl.room_id
        JOIN locations tl ON tl.id = m.to_location_id
        JOIN buildings tb ON tb.id = tl.building_id
        JOIN rooms tr ON tr.id = tl.room_id
        LEFT JOIN companies fc ON fc.id = COALESCE(m.from_company_id, a.company_id)
        LEFT JOIN companies tc ON tc.id = COALESCE(m.to_company_id, a.company_id)
        LEFT JOIN divisions fd ON fd.id = COALESCE(m.from_division_id, a.division_id)
        LEFT JOIN divisions td ON td.id = COALESCE(m.to_division_id, a.division_id)
        LEFT JOIN persons fp ON fp.id = m.from_pic_id
        LEFT JOIN persons tp ON tp.id = m.to_pic_id
        LEFT JOIN users u ON u.id = m.officer_user_id
        LEFT JOIN movement_approvals ma ON ma.movement_id = m.id
        WHERE ${movClause}
        ORDER BY m.created_at DESC
      `)
      .all(...movParams);
    res.json({ movements: rows });
  });

  app.post('/api/movements', authenticate, requirePermission('movements.request'), (req: AuthenticatedRequest, res) => {
    const { asset_id, to_location_id, to_pic_id, to_division_id, movement_date, reason, proof_doc_url } = req.body || {};
    if (!asset_id || !to_location_id || !reason) {
      res.status(400).json({ error: 'Asset, destination location, and transfer reason are required.' });
      return;
    }

    const asset = db
      .prepare('SELECT id, asset_code, company_id, division_id, location_id, pic_id FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(Number(asset_id)) as
      | { id: number; asset_code: string; company_id: number; division_id: number; location_id: number; pic_id: number | null }
      | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for source asset.' });
      return;
    }

    const destLoc = db.prepare('SELECT id, company_id FROM locations WHERE id = ?').get(Number(to_location_id)) as
      | { id: number; company_id: number }
      | undefined;
    if (!destLoc) {
      res.status(400).json({ error: 'Destination location not found.' });
      return;
    }

    const toCompanyId = destLoc.company_id;
    let resolvedToDivisionId = to_division_id ? Number(to_division_id) : null;
    if (resolvedToDivisionId) {
      const divCheck = db.prepare('SELECT id, company_id FROM divisions WHERE id = ?').get(resolvedToDivisionId) as
        | { id: number; company_id: number }
        | undefined;
      if (!divCheck || divCheck.company_id !== toCompanyId) {
        res.status(400).json({ error: 'Destination division does not belong to destination company.' });
        return;
      }
    } else if (to_pic_id) {
      const picRow = db.prepare('SELECT company_id, division_id FROM persons WHERE id = ?').get(Number(to_pic_id)) as
        | { company_id: number; division_id: number }
        | undefined;
      if (picRow && picRow.company_id === toCompanyId) {
        resolvedToDivisionId = picRow.division_id;
      }
    }
    if (!resolvedToDivisionId) {
      if (toCompanyId === asset.company_id) {
        resolvedToDivisionId = asset.division_id;
      } else {
        const firstDestDiv = db.prepare('SELECT id FROM divisions WHERE company_id = ? ORDER BY id ASC LIMIT 1').get(toCompanyId) as
          | { id: number }
          | undefined;
        resolvedToDivisionId = firstDestDiv ? firstDestDiv.id : asset.division_id;
      }
    }

    const isCrossCompany = toCompanyId !== asset.company_id ? 1 : 0;
    if (isCrossCompany && !req.authUser!.is_holding_scope && !canUserAccessRecord(req.authUser!, toCompanyId, resolvedToDivisionId)) {
      res.status(403).json({ error: 'Cross-company transfer requires holding or multi-company access.' });
      return;
    }

    const nextPicId = to_pic_id ? Number(to_pic_id) : isCrossCompany ? null : asset.pic_id;

    const tx = db.transaction(() => {
      const prevState = getAssetStateSnapshot(asset.id);
      const movCode = `MOV-${new Date().getFullYear()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const info = db
        .prepare(`
          INSERT INTO asset_movements (
            movement_code, asset_id, from_location_id, to_location_id, from_pic_id, to_pic_id,
            from_company_id, to_company_id, from_division_id, to_division_id, is_cross_company,
            movement_date, reason, officer_user_id, proof_doc_url, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Approval')
        `)
        .run(
          movCode,
          asset.id,
          asset.location_id,
          Number(to_location_id),
          asset.pic_id,
          nextPicId,
          asset.company_id,
          toCompanyId,
          asset.division_id,
          resolvedToDivisionId,
          isCrossCompany,
          movement_date || new Date().toISOString().slice(0, 19).replace('T', ' '),
          reason.trim(),
          req.authUser!.id,
          proof_doc_url || null
        );
      const movId = Number(info.lastInsertRowid);
      db.prepare("UPDATE assets SET asset_status = 'Pending Transfer', updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
        req.authUser!.id,
        asset.id
      );
      const newState = getAssetStateSnapshot(asset.id);

      appendAssetEvent({
        companyId: asset.company_id,
        assetId: asset.id,
        eventType: 'TRANSFER_REQUESTED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'movement',
        referenceId: movId,
        reason: reason.trim(),
        previousState: prevState,
        newState,
      });

      return movId;
    });

    const id = tx();
    logAudit(req, 'MOVEMENT_REQUESTED', 'movements', 'movement', id, { isCrossCompany, toCompanyId });
    syncAutomatedNotifications();
    res.status(201).json({ id, is_cross_company: isCrossCompany });
  });

  app.post('/api/movements/:id/decide', authenticate, requirePermission('movements.approve'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { decision, notes } = req.body || {};
    if (!['Approved', 'Rejected'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be Approved or Rejected' });
      return;
    }

    const mov = db.prepare('SELECT * FROM asset_movements WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!mov || mov.status !== 'Pending Approval') {
      res.status(400).json({ error: 'Movement request is not pending approval' });
      return;
    }

    const assetRow = db.prepare('SELECT company_id, division_id FROM assets WHERE id = ?').get(mov.asset_id) as
      | { company_id: number; division_id: number }
      | undefined;
    const fromCompanyId = Number(mov.from_company_id || assetRow?.company_id || 1);
    const toCompanyId = Number(mov.to_company_id || fromCompanyId);
    const fromDivisionId = Number(mov.from_division_id || assetRow?.division_id || 1);
    const toDivisionId = Number(mov.to_division_id || fromDivisionId);
    const isCrossCompany = Number(mov.is_cross_company || 0) === 1 || toCompanyId !== fromCompanyId;

    if (isCrossCompany) {
      const canApproveCross =
        req.authUser!.is_holding_scope ||
        (canUserAccessRecord(req.authUser!, fromCompanyId, fromDivisionId) &&
          canUserAccessRecord(req.authUser!, toCompanyId, toDivisionId));
      if (!canApproveCross) {
        res.status(403).json({ error: 'Cross-company transfer approval requires holding or dual-company authorization.' });
        return;
      }
    } else if (!canUserAccessRecord(req.authUser!, fromCompanyId, fromDivisionId)) {
      res.status(403).json({ error: 'Cross-company/division access denied for this movement approval.' });
      return;
    }

    const tx = db.transaction(() => {
      const prevState = getAssetStateSnapshot(mov.asset_id);
      db.prepare('INSERT INTO movement_approvals (movement_id, approver_user_id, decision, notes) VALUES (?, ?, ?, ?)').run(
        id, req.authUser!.id, decision, notes || null
      );

      if (decision === 'Approved') {
        db.prepare("UPDATE asset_movements SET status = 'Completed', updated_at = datetime('now') WHERE id = ?").run(id);
        db.prepare(`
          UPDATE assets SET
            company_id = ?, division_id = ?, responsible_division_id = ?,
            location_id = ?, pic_id = ?, custodian_person_id = ?,
            asset_status = 'Active', updated_at = datetime('now'), updated_by = ?
          WHERE id = ?
        `).run(
          toCompanyId,
          toDivisionId,
          toDivisionId,
          mov.to_location_id,
          mov.to_pic_id,
          mov.to_pic_id,
          req.authUser!.id,
          mov.asset_id
        );

        if (
          toCompanyId !== fromCompanyId ||
          toDivisionId !== fromDivisionId ||
          Number(mov.to_pic_id || 0) !== Number(mov.from_pic_id || 0)
        ) {
          db.prepare(`
            INSERT INTO asset_ownership_history (
              asset_id, from_company_id, to_company_id, from_division_id, to_division_id,
              from_custodian_person_id, to_custodian_person_id, movement_id, changed_by_user_id, reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            mov.asset_id,
            fromCompanyId,
            toCompanyId,
            fromDivisionId,
            toDivisionId,
            mov.from_pic_id ?? null,
            mov.to_pic_id ?? null,
            id,
            req.authUser!.id,
            notes ? `${mov.reason} (${notes})` : mov.reason
          );
        }

        const newState = getAssetStateSnapshot(mov.asset_id);
        appendAssetEvent({
          companyId: toCompanyId,
          assetId: mov.asset_id,
          eventType: isCrossCompany ? 'OWNERSHIP_TRANSFERRED' : 'ASSET_TRANSFERRED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'movement',
          referenceId: id,
          reason: notes || mov.reason,
          previousState: prevState,
          newState,
        });
      } else {
        db.prepare("UPDATE asset_movements SET status = 'Rejected', updated_at = datetime('now') WHERE id = ?").run(id);
        db.prepare("UPDATE assets SET asset_status = 'Active', updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
          req.authUser!.id, mov.asset_id
        );
        const newState = getAssetStateSnapshot(mov.asset_id);
        appendAssetEvent({
          companyId: fromCompanyId,
          assetId: mov.asset_id,
          eventType: 'TRANSFER_REJECTED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'movement',
          referenceId: id,
          reason: notes || 'Transfer request rejected',
          previousState: prevState,
          newState,
        });
      }
    });

    tx();
    logAudit(req, `MOVEMENT_${decision.toUpperCase()}`, 'movements', 'movement', id, { notes, isCrossCompany });
    syncAutomatedNotifications();
    res.json({ ok: true });
  });

  // =========================================================================
  // MODULE 08 – MAINTENANCE MANAGEMENT
  // =========================================================================
  app.get('/api/maintenance', authenticate, requirePermission('maintenance.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    const assetScope = buildAssetScopeSql(scope, 'a');

    const rows = db
      .prepare(`
        SELECT m.*, a.asset_code, a.asset_name, a.condition_status as asset_condition,
               co.name as company_name, b.name || ' · ' || l.specific_location as location_label
        FROM maintenance_records m
        JOIN assets a ON a.id = m.asset_id
        JOIN companies co ON co.id = a.company_id
        JOIN locations l ON l.id = a.location_id
        JOIN buildings b ON b.id = l.building_id
        WHERE ${assetScope.clause}
        ORDER BY m.created_at DESC
      `)
      .all(...assetScope.params);
    res.json({ records: rows });
  });

  app.post('/api/maintenance', authenticate, requirePermission('maintenance.report'), (req: AuthenticatedRequest, res) => {
    const b = req.body || {};
    if (!b.asset_id || !b.damage_date || !b.damage_type || !b.issue_description) {
      res.status(400).json({ error: 'Missing required maintenance fields' });
      return;
    }

    const asset = db.prepare('SELECT id, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(b.asset_id)) as
      | { id: number; company_id: number; division_id: number }
      | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for this asset.' });
      return;
    }

    const tx = db.transaction(() => {
      const prevState = getAssetStateSnapshot(asset.id);
      const ticket = `MNT-${new Date().getFullYear()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const info = db
        .prepare(`
          INSERT INTO maintenance_records (ticket_code, asset_id, damage_date, damage_type, issue_description, repair_action, vendor_technician, cost, status, before_photo_url, reported_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          ticket,
          asset.id,
          b.damage_date,
          b.damage_type.trim(),
          b.issue_description.trim(),
          b.repair_action || null,
          b.vendor_technician || null,
          Number(b.cost || 0),
          b.status || 'Reported',
          b.before_photo_url || null,
          req.authUser!.id
        );

      if (b.asset_condition) {
        db.prepare("UPDATE assets SET condition_status = ?, asset_status = 'In Maintenance', updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
          b.asset_condition, req.authUser!.id, asset.id
        );
      }
      const mntId = Number(info.lastInsertRowid);
      const newState = getAssetStateSnapshot(asset.id);
      appendAssetEvent({
        companyId: asset.company_id,
        assetId: asset.id,
        eventType: 'MAINTENANCE_STARTED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'maintenance',
        referenceId: mntId,
        reason: `${b.damage_type.trim()}: ${b.issue_description.trim()}`,
        previousState: prevState,
        newState,
      });

      return mntId;
    });

    const id = tx();
    logAudit(req, 'MAINTENANCE_REPORTED', 'maintenance', 'maintenance_record', id);
    syncAutomatedNotifications();
    res.status(201).json({ id });
  });

  app.put('/api/maintenance/:id', authenticate, requirePermission('maintenance.update'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db
      .prepare(`
        SELECT m.*, a.company_id, a.division_id
        FROM maintenance_records m
        JOIN assets a ON a.id = m.asset_id
        WHERE m.id = ?
      `)
      .get(id) as Record<string, any> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Maintenance record not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, Number(existing.company_id), Number(existing.division_id))) {
      res.status(403).json({ error: 'Cross-company/division access denied for this maintenance ticket.' });
      return;
    }
    const b = req.body || {};
    const nextStatus = b.status || existing.status;

    const tx = db.transaction(() => {
      const prevState = getAssetStateSnapshot(existing.asset_id);
      db.prepare(`
        UPDATE maintenance_records SET
          repair_action = ?, vendor_technician = ?, cost = ?, completion_date = ?, status = ?, after_photo_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        b.repair_action ?? existing.repair_action,
        b.vendor_technician ?? existing.vendor_technician,
        b.cost !== undefined ? Number(b.cost) : existing.cost,
        nextStatus === 'Completed' ? (b.completion_date || new Date().toISOString().slice(0, 10)) : (b.completion_date ?? existing.completion_date),
        nextStatus,
        b.after_photo_url ?? existing.after_photo_url,
        id
      );

      if (nextStatus === 'Completed') {
        db.prepare("UPDATE assets SET condition_status = ?, asset_status = 'Active', updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
          b.resolved_condition || 'Good', req.authUser!.id, existing.asset_id
        );
      } else if (nextStatus === 'In Progress') {
        db.prepare("UPDATE assets SET asset_status = 'In Maintenance', updated_at = datetime('now') WHERE id = ?").run(existing.asset_id);
      }

      const newState = getAssetStateSnapshot(existing.asset_id);
      appendAssetEvent({
        companyId: Number(existing.company_id),
        assetId: existing.asset_id,
        eventType: nextStatus === 'Completed' ? 'MAINTENANCE_COMPLETED' : 'MAINTENANCE_UPDATED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'maintenance',
        referenceId: id,
        reason: b.repair_action || `Maintenance status updated to ${nextStatus}`,
        previousState: prevState,
        newState,
      });
    });

    tx();
    logAudit(req, 'MAINTENANCE_UPDATED', 'maintenance', 'maintenance_record', id, { status: nextStatus });
    syncAutomatedNotifications();
    res.json({ ok: true });
  });

  // =========================================================================
  // MODULE 09 – STOCK OPNAME / ASSET VERIFICATION
  // =========================================================================
  app.get('/api/opname', authenticate, requirePermission('opname.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    const opScope = buildCompanyScopeSql(scope, 'COALESCE(o.company_id, l.company_id)');

    const schedules = db
      .prepare(`
        SELECT o.*, b.name || ' · ' || r.name || ' · ' || l.specific_location as location_label,
               co.name as company_name,
               (SELECT COUNT(*) FROM stock_opname_details d WHERE d.opname_id = o.id) as checked_count,
               (SELECT COUNT(*) FROM assets a WHERE a.location_id = o.location_id AND a.deleted_at IS NULL) as expected_count,
               (SELECT COUNT(*) FROM stock_opname_details d WHERE d.opname_id = o.id AND d.verification_result != 'Verified') as variance_count
        FROM stock_opname o
        JOIN locations l ON l.id = o.location_id
        JOIN companies co ON co.id = COALESCE(o.company_id, l.company_id)
        JOIN buildings b ON b.id = l.building_id
        JOIN rooms r ON r.id = l.room_id
        WHERE ${opScope.clause}
        ORDER BY o.scheduled_date DESC
      `)
      .all(...opScope.params);

    const details = db
      .prepare(`
        SELECT d.*, a.asset_code, a.asset_name, a.serial_number,
               el.specific_location as expected_loc_name, al.specific_location as actual_loc_name,
               ep.full_name as expected_pic_name, ap.full_name as actual_pic_name
        FROM stock_opname_details d
        JOIN stock_opname o ON o.id = d.opname_id
        JOIN locations l ON l.id = o.location_id
        LEFT JOIN assets a ON a.id = d.asset_id
        LEFT JOIN locations el ON el.id = d.expected_location_id
        LEFT JOIN locations al ON al.id = d.actual_location_id
        LEFT JOIN persons ep ON ep.id = d.expected_pic_id
        LEFT JOIN persons ap ON ap.id = d.actual_pic_id
        WHERE ${opScope.clause}
        ORDER BY d.verified_at DESC
      `)
      .all(...opScope.params);

    res.json({ schedules, details });
  });

  app.post('/api/opname', authenticate, requirePermission('opname.schedule'), (req: AuthenticatedRequest, res) => {
    const { title, scheduled_date, location_id, notes } = req.body || {};
    if (!title || !scheduled_date || !location_id) {
      res.status(400).json({ error: 'Title, date, and location are required.' });
      return;
    }
    const locRow = db.prepare('SELECT id, company_id FROM locations WHERE id = ?').get(Number(location_id)) as
      | { id: number; company_id: number }
      | undefined;
    if (!locRow) {
      res.status(400).json({ error: 'Selected location not found.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, locRow.company_id)) {
      res.status(403).json({ error: 'Cannot schedule stock opname outside your company scope.' });
      return;
    }

    const code = `OPN-${new Date().getFullYear()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const info = db
      .prepare("INSERT INTO stock_opname (opname_code, company_id, title, scheduled_date, location_id, status, conducted_by, notes) VALUES (?, ?, ?, ?, ?, 'In Progress', ?, ?)")
      .run(code, locRow.company_id, title.trim(), scheduled_date, Number(location_id), req.authUser!.id, notes || null);
    logAudit(req, 'OPNAME_CREATED', 'opname', 'stock_opname', Number(info.lastInsertRowid));
    res.status(201).json({ id: Number(info.lastInsertRowid), opname_code: code });
  });

  app.post('/api/opname/:id/verify', authenticate, requirePermission('opname.verify'), (req: AuthenticatedRequest, res) => {
    const opnameId = Number(req.params.id);
    const {
      scanned_code,
      actual_location_id,
      actual_condition,
      actual_pic_id,
      manual_result,
      notes,
      gps_latitude,
      gps_longitude,
      gps_accuracy_m,
      field_photo_url,
    } = req.body || {};
    const schedule = db
      .prepare(`
        SELECT o.id, o.opname_code, o.location_id, COALESCE(o.company_id, l.company_id) as company_id
        FROM stock_opname o
        JOIN locations l ON l.id = o.location_id
        WHERE o.id = ?
      `)
      .get(opnameId) as { id: number; opname_code: string; location_id: number; company_id: number } | undefined;
    if (!schedule) {
      res.status(404).json({ error: 'Stock opname schedule not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, schedule.company_id)) {
      res.status(403).json({ error: 'Cross-company access denied for this opname schedule.' });
      return;
    }

    const clean = extractQrSlugOrToken(String(scanned_code || ''));

    const asset = db
      .prepare(`
        SELECT a.*, q.id as qr_id, q.qr_token, q.public_slug, q.status as qr_status
        FROM assets a
        LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
        WHERE a.deleted_at IS NULL
          AND (
            q.qr_token = ?
            OR q.public_slug = ?
            OR upper(a.asset_code) = upper(?)
            OR (a.serial_number IS NOT NULL AND trim(a.serial_number) != '' AND upper(a.serial_number) = upper(?))
          )
        LIMIT 1
      `)
      .get(clean, clean, clean, clean) as any;

    if (asset && !canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Scanned asset belongs to another restricted company/division.' });
      return;
    }

    const latVal = gps_latitude !== undefined && gps_latitude !== null && gps_latitude !== '' ? Number(gps_latitude) : null;
    const lngVal = gps_longitude !== undefined && gps_longitude !== null && gps_longitude !== '' ? Number(gps_longitude) : null;
    const accVal = gps_accuracy_m !== undefined && gps_accuracy_m !== null && gps_accuracy_m !== '' ? Number(gps_accuracy_m) : null;
    const safeFieldPhoto = field_photo_url && isValidLocalAssetUrl(String(field_photo_url)) ? String(field_photo_url).trim() : null;

    let result = manual_result || 'Verified';
    if (!asset) {
      result = manual_result || 'Unregistered Asset';
    } else if ((!asset.qr_token || asset.qr_status === 'Revoked') && result === 'Verified') {
      result = 'QR Code Missing';
    } else if (actual_location_id && Number(actual_location_id) !== asset.location_id) {
      result = 'Location Mismatch';
    } else if (actual_condition && actual_condition !== asset.condition_status) {
      result = 'Condition Mismatch';
    }

    const tx = db.transaction(() => {
      const info = db
        .prepare(`
          INSERT INTO stock_opname_details (
            opname_id, asset_id, scanned_code, expected_location_id, actual_location_id,
            expected_condition, actual_condition, expected_pic_id, actual_pic_id, verification_result, notes,
            gps_latitude, gps_longitude, gps_accuracy_m, field_photo_url, verified_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          opnameId,
          asset ? asset.id : null,
          asset ? asset.asset_code : clean,
          asset ? asset.location_id : schedule.location_id,
          actual_location_id ? Number(actual_location_id) : schedule.location_id,
          asset ? asset.condition_status : null,
          actual_condition || (asset ? asset.condition_status : null),
          asset ? asset.pic_id : null,
          actual_pic_id ? Number(actual_pic_id) : (asset ? asset.pic_id : null),
          result,
          notes || null,
          latVal,
          lngVal,
          accVal,
          safeFieldPhoto,
          req.authUser!.id
        );
      const detailId = Number(info.lastInsertRowid);

      if (asset) {
        if ((latVal !== null && lngVal !== null) || safeFieldPhoto) {
          db.prepare(`
            INSERT INTO asset_field_captures (
              company_id, asset_id, qr_id, opname_id, captured_by_user_id, capture_context,
              latitude, longitude, accuracy_meters, photo_url, condition_observed, notes
            ) VALUES (?, ?, ?, ?, ?, 'stock_opname', ?, ?, ?, ?, ?, ?)
          `).run(
            asset.company_id,
            asset.id,
            asset.qr_id ?? null,
            opnameId,
            req.authUser!.id,
            latVal,
            lngVal,
            accVal,
            safeFieldPhoto,
            actual_condition || asset.condition_status,
            notes || `Stock Opname ${schedule.opname_code}`
          );
          if (latVal !== null && lngVal !== null) {
            appendAssetEvent({
              companyId: asset.company_id,
              assetId: asset.id,
              qrId: asset.qr_id ?? null,
              eventType: 'GPS_RECORDED',
              actorUserId: req.authUser!.id,
              actorUsername: req.authUser!.username,
              referenceType: 'opname',
              referenceId: schedule.opname_code,
              reason: `GPS recorded during Stock Opname ${schedule.opname_code}`,
              previousState: null,
              newState: { latitude: latVal, longitude: lngVal, accuracy_meters: accVal },
            });
          }
        }

        appendAssetEvent({
          companyId: asset.company_id,
          assetId: asset.id,
          qrId: asset.qr_id ?? null,
          eventType: 'ASSET_VERIFIED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'opname',
          referenceId: schedule.opname_code,
          reason: `Stock Opname verification result: ${result}`,
          previousState: { location_id: asset.location_id, condition_status: asset.condition_status },
          newState: {
            opname_id: opnameId,
            detail_id: detailId,
            actual_location_id: actual_location_id ? Number(actual_location_id) : schedule.location_id,
            actual_condition: actual_condition || asset.condition_status,
            verification_result: result,
          },
        });
      }

      return detailId;
    });

    const detailId = tx();
    logAudit(req, 'OPNAME_ITEM_VERIFIED', 'opname', 'stock_opname_detail', detailId, { result, scanned_code: clean });
    syncAutomatedNotifications();
    res.status(201).json({
      id: detailId,
      verification_result: result,
      scanned_code: clean,
      asset: asset
        ? {
            id: asset.id,
            asset_code: asset.asset_code,
            asset_name: asset.asset_name,
            serial_number: asset.serial_number,
          }
        : null,
    });
  });

  app.post('/api/opname/:id/complete', authenticate, requirePermission('opname.verify'), (req: AuthenticatedRequest, res) => {
    const opnameId = Number(req.params.id);
    const schedule = db
      .prepare('SELECT o.id, COALESCE(o.company_id, l.company_id) as company_id FROM stock_opname o JOIN locations l ON l.id = o.location_id WHERE o.id = ?')
      .get(opnameId) as { id: number; company_id: number } | undefined;
    if (!schedule) {
      res.status(404).json({ error: 'Stock opname schedule not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, schedule.company_id)) {
      res.status(403).json({ error: 'Cross-company access denied for this opname schedule.' });
      return;
    }
    db.prepare("UPDATE stock_opname SET status = 'Completed', completed_at = datetime('now') WHERE id = ?").run(opnameId);
    logAudit(req, 'OPNAME_COMPLETED', 'opname', 'stock_opname', opnameId);
    res.json({ ok: true });
  });

  // =========================================================================
  // ASSET RECONCILIATION ENGINE (NON-DESTRUCTIVE COMPARISON & RESOLUTION)
  // =========================================================================
  app.post('/api/reconciliation/run', authenticate, requirePermission('opname.verify'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const opnameId = req.body?.opname_id ? Number(req.body.opname_id) : null;
    const locationId = req.body?.location_id ? Number(req.body.location_id) : null;

    let schedule: { id: number; opname_code: string; location_id: number; company_id: number } | undefined;
    if (opnameId) {
      schedule = db
        .prepare('SELECT o.id, o.opname_code, o.location_id, COALESCE(o.company_id, l.company_id) as company_id FROM stock_opname o JOIN locations l ON l.id = o.location_id WHERE o.id = ?')
        .get(opnameId) as { id: number; opname_code: string; location_id: number; company_id: number } | undefined;
      if (!schedule) {
        res.status(404).json({ error: 'Selected Stock Opname schedule not found.' });
        return;
      }
      if (!canUserAccessRecord(req.authUser!, schedule.company_id)) {
        res.status(403).json({ error: 'Cross-company access denied for reconciliation.' });
        return;
      }
    }

    const assetScope = buildAssetScopeSql(scope, 'a');
    const assetWhere: string[] = ['a.deleted_at IS NULL', assetScope.clause];
    const assetParams: unknown[] = [...assetScope.params];
    if (schedule) {
      assetWhere.push('a.location_id = ?');
      assetParams.push(schedule.location_id);
    } else if (locationId) {
      assetWhere.push('a.location_id = ?');
      assetParams.push(locationId);
    }

    const targetAssets = db
      .prepare(`
        SELECT a.*, q.id as qr_id, q.qr_token, q.status as qr_status, q.expires_at as qr_expires_at,
               l.specific_location, b.name as building_name,
               (SELECT COUNT(*) FROM asset_photos ap WHERE ap.asset_id = a.id) as photo_table_count,
               (SELECT COUNT(*) FROM asset_documents ad WHERE ad.asset_id = a.id) as doc_count
        FROM assets a
        LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
        JOIN locations l ON l.id = a.location_id
        JOIN buildings b ON b.id = l.building_id
        WHERE ${assetWhere.join(' AND ')}
        ORDER BY a.id ASC
      `)
      .all(...assetParams) as Record<string, any>[];

    const opDetails = schedule
      ? (db
          .prepare('SELECT * FROM stock_opname_details WHERE opname_id = ? ORDER BY id DESC')
          .all(schedule.id) as Record<string, any>[])
      : (db
          .prepare(`
            SELECT d.*, COALESCE(o.company_id, l.company_id) as company_id
            FROM stock_opname_details d
            JOIN stock_opname o ON o.id = d.opname_id
            JOIN locations l ON l.id = o.location_id
            WHERE ${buildCompanyScopeSql(scope, 'COALESCE(o.company_id, l.company_id)').clause}
            ORDER BY d.id DESC
            LIMIT 500
          `)
          .all(...buildCompanyScopeSql(scope, 'COALESCE(o.company_id, l.company_id)').params) as Record<string, any>[]);

    const fieldCaptures = db
      .prepare(`
        SELECT fc.*
        FROM asset_field_captures fc
        WHERE ${buildCompanyScopeSql(scope, 'fc.company_id').clause}
        ORDER BY fc.id DESC
      `)
      .all(...buildCompanyScopeSql(scope, 'fc.company_id').params) as Record<string, any>[];

    const latestDetailByAsset = new Map<number, Record<string, any>>();
    const detailCountByAsset = new Map<number, number>();
    for (const d of opDetails) {
      if (d.asset_id) {
        detailCountByAsset.set(Number(d.asset_id), (detailCountByAsset.get(Number(d.asset_id)) || 0) + 1);
        if (!latestDetailByAsset.has(Number(d.asset_id))) {
          latestDetailByAsset.set(Number(d.asset_id), d);
        }
      }
    }

    const latestCaptureByAsset = new Map<number, Record<string, any>>();
    for (const fc of fieldCaptures) {
      if (!latestCaptureByAsset.has(Number(fc.asset_id))) {
        latestCaptureByAsset.set(Number(fc.asset_id), fc);
      }
    }

    // Duplicate serial detection across company scope
    const serialGroups = new Map<string, Record<string, any>[]>();
    for (const a of targetAssets) {
      const sn = String(a.serial_number || '').trim().toLowerCase();
      if (sn) {
        const list = serialGroups.get(sn) || [];
        list.push(a);
        serialGroups.set(sn, list);
      }
    }

    const counts: Record<string, number> = {
      MATCHED: 0,
      LOCATION_MISMATCH: 0,
      CONDITION_MISMATCH: 0,
      UNIDENTIFIED_ASSET: 0,
      MISSING_ASSET: 0,
      DUPLICATE_SUSPECTED: 0,
      INCOMPLETE_DATA: 0,
      QR_MISMATCH: 0,
      PENDING_REVIEW: 0,
    };
    let createdCount = 0;
    let refreshedCount = 0;

    const upsertFinding = (payload: {
      companyId: number;
      opnameId: number | null;
      assetId: number | null;
      scannedCode: string | null;
      status: keyof typeof counts;
      priority: 'Low' | 'Medium' | 'High' | 'Critical';
      title: string;
      summary: string;
      expectedJson: string | null;
      observedJson: string | null;
      photoUrl: string | null;
      lat: number | null;
      lng: number | null;
      assignedTo: number | null;
    }) => {
      counts[payload.status] = (counts[payload.status] || 0) + 1;
      const existing = db
        .prepare(`
          SELECT id FROM asset_reconciliation_findings
          WHERE company_id = ?
            AND COALESCE(opname_id, 0) = COALESCE(?, 0)
            AND COALESCE(asset_id, 0) = COALESCE(?, 0)
            AND COALESCE(scanned_code, '') = COALESCE(?, '')
            AND reconciliation_status = ?
            AND resolution_status IN ('Open', 'In Review')
          LIMIT 1
        `)
        .get(payload.companyId, payload.opnameId, payload.assetId, payload.scannedCode, payload.status) as { id: number } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE asset_reconciliation_findings SET
            priority = ?,
            title = ?,
            discrepancy_summary = ?,
            expected_snapshot_json = ?,
            observed_snapshot_json = ?,
            evidence_photo_url = COALESCE(?, evidence_photo_url),
            gps_latitude = COALESCE(?, gps_latitude),
            gps_longitude = COALESCE(?, gps_longitude),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          payload.priority,
          payload.title,
          payload.summary,
          payload.expectedJson,
          payload.observedJson,
          payload.photoUrl,
          payload.lat,
          payload.lng,
          existing.id
        );
        refreshedCount += 1;
      } else {
        const findingCode = `REC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        db.prepare(`
          INSERT INTO asset_reconciliation_findings (
            finding_code, company_id, opname_id, asset_id, scanned_code,
            reconciliation_status, priority, title, discrepancy_summary,
            expected_snapshot_json, observed_snapshot_json,
            evidence_photo_url, gps_latitude, gps_longitude, assigned_to_user_id, resolution_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          findingCode,
          payload.companyId,
          payload.opnameId,
          payload.assetId,
          payload.scannedCode,
          payload.status,
          payload.priority,
          payload.title,
          payload.summary,
          payload.expectedJson,
          payload.observedJson,
          payload.photoUrl,
          payload.lat,
          payload.lng,
          payload.assignedTo,
          payload.status === 'MATCHED' ? 'Resolved' : 'Open'
        );
        createdCount += 1;
      }
    };

    const tx = db.transaction(() => {
      for (const a of targetAssets) {
        const detail = latestDetailByAsset.get(Number(a.id));
        const capture = latestCaptureByAsset.get(Number(a.id));
        const evidencePhoto = detail?.field_photo_url || capture?.photo_url || null;
        const lat = detail?.gps_latitude ?? capture?.latitude ?? null;
        const lng = detail?.gps_longitude ?? capture?.longitude ?? null;
        const expectedSnap = JSON.stringify({
          asset_code: a.asset_code,
          location_id: a.location_id,
          location: `${a.building_name} · ${a.specific_location}`,
          condition_status: a.condition_status,
          asset_status: a.asset_status,
          serial_number: a.serial_number,
        });

        let hasAnomaly = false;

        // 1. Missing asset check
        if (a.asset_status === 'Missing' || detail?.verification_result === 'Not Found' || (schedule && !detail)) {
          hasAnomaly = true;
          upsertFinding({
            companyId: a.company_id,
            opnameId: schedule?.id ?? (detail?.opname_id || null),
            assetId: a.id,
            scannedCode: a.asset_code,
            status: 'MISSING_ASSET',
            priority: 'Critical',
            title: `${a.asset_code} · Asset Missing / Not Verified in Field`,
            summary: schedule
              ? `Registered at ${a.building_name} · ${a.specific_location}, but not physically scanned in ${schedule.opname_code}.`
              : `Asset status is marked Missing or recorded Not Found in opname.`,
            expectedJson: expectedSnap,
            observedJson: detail ? JSON.stringify(detail) : null,
            photoUrl: evidencePhoto,
            lat,
            lng,
            assignedTo: a.verification_officer_user_id || a.data_owner_user_id || null,
          });
        }

        // 2. Location mismatch check
        if (detail?.verification_result === 'Location Mismatch') {
          hasAnomaly = true;
          upsertFinding({
            companyId: a.company_id,
            opnameId: detail.opname_id || schedule?.id || null,
            assetId: a.id,
            scannedCode: detail.scanned_code || a.asset_code,
            status: 'LOCATION_MISMATCH',
            priority: 'High',
            title: `${a.asset_code} · Physical Location Mismatch`,
            summary: `Expected location_id=${a.location_id}, observed actual_location_id=${detail.actual_location_id}. Master asset was not auto-overwritten.`,
            expectedJson: expectedSnap,
            observedJson: JSON.stringify({ actual_location_id: detail.actual_location_id, notes: detail.notes }),
            photoUrl: evidencePhoto,
            lat,
            lng,
            assignedTo: a.verification_officer_user_id || a.data_owner_user_id || null,
          });
        }

        // 3. Condition mismatch check
        if (
          detail?.verification_result === 'Condition Mismatch' ||
          (capture?.condition_observed && capture.condition_observed !== a.condition_status)
        ) {
          hasAnomaly = true;
          const observedCond = detail?.actual_condition || capture?.condition_observed;
          upsertFinding({
            companyId: a.company_id,
            opnameId: detail?.opname_id || schedule?.id || null,
            assetId: a.id,
            scannedCode: a.asset_code,
            status: 'CONDITION_MISMATCH',
            priority: observedCond === 'Major Damage' || observedCond === 'Unserviceable' ? 'High' : 'Medium',
            title: `${a.asset_code} · Physical Condition Mismatch`,
            summary: `Master condition is "${a.condition_status}", field observation reported "${observedCond}".`,
            expectedJson: expectedSnap,
            observedJson: JSON.stringify({ actual_condition: observedCond }),
            photoUrl: evidencePhoto,
            lat,
            lng,
            assignedTo: a.verification_officer_user_id || a.data_owner_user_id || null,
          });
        }

        // 4. QR mismatch / missing / revoked
        if (!a.qr_token || a.qr_status === 'Revoked' || detail?.verification_result === 'QR Code Missing') {
          hasAnomaly = true;
          upsertFinding({
            companyId: a.company_id,
            opnameId: detail?.opname_id || schedule?.id || null,
            assetId: a.id,
            scannedCode: a.asset_code,
            status: 'QR_MISMATCH',
            priority: 'Medium',
            title: `${a.asset_code} · QR Tag Missing or Revoked`,
            summary: a.qr_status === 'Revoked'
              ? 'Active asset references a revoked QR tag and requires re-issuance.'
              : 'Asset has no active physical QR tag linked.',
            expectedJson: expectedSnap,
            observedJson: JSON.stringify({ qr_token: a.qr_token, qr_status: a.qr_status }),
            photoUrl: evidencePhoto,
            lat,
            lng,
            assignedTo: a.verification_officer_user_id || a.data_owner_user_id || null,
          });
        }

        // 5. Duplicate suspected (duplicate serial or duplicate scan in same opname)
        const sn = String(a.serial_number || '').trim().toLowerCase();
        const dupList = sn ? serialGroups.get(sn) || [] : [];
        const scanCountInOpname = detailCountByAsset.get(Number(a.id)) || 0;
        if (dupList.length > 1 || (schedule && scanCountInOpname > 1)) {
          hasAnomaly = true;
          upsertFinding({
            companyId: a.company_id,
            opnameId: schedule?.id ?? null,
            assetId: a.id,
            scannedCode: a.asset_code,
            status: 'DUPLICATE_SUSPECTED',
            priority: 'Critical',
            title: `${a.asset_code} · Duplicate Serial / Repeated Scan Suspected`,
            summary: dupList.length > 1
              ? `Serial number "${a.serial_number}" appears on ${dupList.length} asset records.`
              : `Scanned ${scanCountInOpname} times in opname ${schedule?.opname_code}.`,
            expectedJson: expectedSnap,
            observedJson: JSON.stringify({ duplicate_count: Math.max(dupList.length, scanCountInOpname) }),
            photoUrl: evidencePhoto,
            lat,
            lng,
            assignedTo: a.verification_officer_user_id || a.data_owner_user_id || null,
          });
        }

        // 6. Incomplete data check
        const missingFields: string[] = [];
        if (!a.serial_number || !String(a.serial_number).trim()) missingFields.push('serial_number');
        if (!a.primary_photo_url && Number(a.photo_table_count || 0) === 0) missingFields.push('photo');
        if (!a.custodian_person_id && !a.pic_id) missingFields.push('custodian');
        if (!a.data_owner_user_id) missingFields.push('data_owner');
        if (missingFields.length > 0) {
          hasAnomaly = true;
          upsertFinding({
            companyId: a.company_id,
            opnameId: schedule?.id ?? null,
            assetId: a.id,
            scannedCode: a.asset_code,
            status: 'INCOMPLETE_DATA',
            priority: 'Low',
            title: `${a.asset_code} · Incomplete Master Asset Data`,
            summary: `Missing governance/identification attributes: ${missingFields.join(', ')}.`,
            expectedJson: expectedSnap,
            observedJson: JSON.stringify({ missingFields }),
            photoUrl: evidencePhoto,
            lat,
            lng,
            assignedTo: a.data_owner_user_id || a.verification_officer_user_id || null,
          });
        }

        // 7. Matched
        if (detail?.verification_result === 'Verified' && !hasAnomaly) {
          upsertFinding({
            companyId: a.company_id,
            opnameId: detail.opname_id || schedule?.id || null,
            assetId: a.id,
            scannedCode: a.asset_code,
            status: 'MATCHED',
            priority: 'Low',
            title: `${a.asset_code} · Verified & Reconciled`,
            summary: `Physical presence, location, condition, QR tag, and governance metadata match master records.`,
            expectedJson: expectedSnap,
            observedJson: JSON.stringify(detail),
            photoUrl: evidencePhoto,
            lat,
            lng,
            assignedTo: null,
          });
        }
      }

      // 8. Unidentified assets scanned in opname
      for (const d of opDetails) {
        if (!d.asset_id || d.verification_result === 'Unregistered Asset') {
          const companyId = Number(d.company_id || schedule?.company_id || scope.activeCompanyId || 1);
          upsertFinding({
            companyId,
            opnameId: d.opname_id || schedule?.id || null,
            assetId: null,
            scannedCode: d.scanned_code,
            status: 'UNIDENTIFIED_ASSET',
            priority: 'High',
            title: `Unidentified Physical Asset · ${d.scanned_code}`,
            summary: `Scanned in field opname (${d.scanned_code}) with no matching master asset record.`,
            expectedJson: null,
            observedJson: JSON.stringify(d),
            photoUrl: d.field_photo_url || null,
            lat: d.gps_latitude ?? null,
            lng: d.gps_longitude ?? null,
            assignedTo: req.authUser!.id,
          });
        }
      }
    });

    tx();
    logAudit(req, 'RECONCILIATION_RUN', 'opname', 'reconciliation', schedule?.opname_code || 'scope', {
      evaluatedAssets: targetAssets.length,
      createdCount,
      refreshedCount,
      counts,
    });
    res.json({
      ok: true,
      evaluatedAssets: targetAssets.length,
      createdCount,
      refreshedCount,
      counts,
    });
  });

  app.get('/api/reconciliation/findings', authenticate, requirePermission('opname.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const compScope = buildCompanyScopeSql(scope, 'f.company_id');
    const where: string[] = [compScope.clause];
    const params: unknown[] = [...compScope.params];

    const statusFilter = String(req.query.status || '').trim();
    const priorityFilter = String(req.query.priority || '').trim();
    const resolutionFilter = String(req.query.resolution_status || '').trim();
    const opnameId = req.query.opname_id ? Number(req.query.opname_id) : null;
    const search = String(req.query.search || '').trim();

    if (statusFilter && statusFilter !== 'all') {
      where.push('f.reconciliation_status = ?');
      params.push(statusFilter);
    }
    if (priorityFilter && priorityFilter !== 'all') {
      where.push('f.priority = ?');
      params.push(priorityFilter);
    }
    if (resolutionFilter && resolutionFilter !== 'all') {
      where.push('f.resolution_status = ?');
      params.push(resolutionFilter);
    }
    if (opnameId) {
      where.push('f.opname_id = ?');
      params.push(opnameId);
    }
    if (search) {
      const q = `%${search.toLowerCase()}%`;
      where.push(`(
        lower(f.finding_code) LIKE ?
        OR lower(f.title) LIKE ?
        OR lower(f.discrepancy_summary) LIKE ?
        OR lower(COALESCE(f.scanned_code, '')) LIKE ?
        OR lower(COALESCE(a.asset_code, '')) LIKE ?
        OR lower(COALESCE(a.asset_name, '')) LIKE ?
      )`);
      params.push(q, q, q, q, q, q);
    }

    const findings = db
      .prepare(`
        SELECT f.*, a.asset_code, a.asset_name, co.name as company_name, co.code as company_code,
               o.opname_code, au.full_name as assigned_to_name, ru.full_name as resolved_by_name
        FROM asset_reconciliation_findings f
        LEFT JOIN assets a ON a.id = f.asset_id
        LEFT JOIN companies co ON co.id = f.company_id
        LEFT JOIN stock_opname o ON o.id = f.opname_id
        LEFT JOIN users au ON au.id = f.assigned_to_user_id
        LEFT JOIN users ru ON ru.id = f.resolved_by_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE f.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, f.id DESC
        LIMIT 300
      `)
      .all(...params);

    const summary = db
      .prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN f.resolution_status IN ('Open', 'In Review') THEN 1 ELSE 0 END) as open_count,
               SUM(CASE WHEN f.reconciliation_status = 'MATCHED' THEN 1 ELSE 0 END) as matched_count,
               SUM(CASE WHEN f.reconciliation_status = 'MISSING_ASSET' THEN 1 ELSE 0 END) as missing_count,
               SUM(CASE WHEN f.reconciliation_status = 'LOCATION_MISMATCH' THEN 1 ELSE 0 END) as location_mismatch_count,
               SUM(CASE WHEN f.reconciliation_status = 'CONDITION_MISMATCH' THEN 1 ELSE 0 END) as condition_mismatch_count,
               SUM(CASE WHEN f.reconciliation_status = 'UNIDENTIFIED_ASSET' THEN 1 ELSE 0 END) as unidentified_count,
               SUM(CASE WHEN f.reconciliation_status = 'DUPLICATE_SUSPECTED' THEN 1 ELSE 0 END) as duplicate_count,
               SUM(CASE WHEN f.reconciliation_status IN ('INCOMPLETE_DATA', 'QR_MISMATCH', 'PENDING_REVIEW') THEN 1 ELSE 0 END) as other_anomaly_count
        FROM asset_reconciliation_findings f
        WHERE ${compScope.clause}
      `)
      .get(...compScope.params);

    res.json({ findings, summary });
  });

  app.put('/api/reconciliation/findings/:id', authenticate, requirePermission('opname.verify'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const finding = db.prepare('SELECT * FROM asset_reconciliation_findings WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!finding) {
      res.status(404).json({ error: 'Reconciliation finding not found.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, Number(finding.company_id))) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }

    const body = req.body || {};
    const nextPriority = ['Low', 'Medium', 'High', 'Critical'].includes(body.priority) ? body.priority : finding.priority;
    const nextResolution = ['Open', 'In Review', 'Resolved', 'Dismissed'].includes(body.resolution_status)
      ? body.resolution_status
      : finding.resolution_status;
    const assignedTo = body.assigned_to_user_id !== undefined
      ? (body.assigned_to_user_id ? Number(body.assigned_to_user_id) : null)
      : finding.assigned_to_user_id;
    const resolutionNotes = body.resolution_notes !== undefined ? String(body.resolution_notes || '') : finding.resolution_notes;
    const authorizeMasterUpdate = Boolean(body.authorize_master_update);

    if (authorizeMasterUpdate) {
      const canEditAssets = req.authUser!.role_code === 'super_admin' || req.authUser!.permissions.includes('assets.edit');
      if (!canEditAssets) {
        res.status(403).json({ error: 'Authorizing master asset updates requires assets.edit permission.' });
        return;
      }
      if (!String(resolutionNotes || '').trim()) {
        res.status(400).json({ error: 'Resolution notes / authorization reason is required before modifying master asset data.' });
        return;
      }
    }

    let masterUpdated = Number(finding.master_updated || 0);

    db.transaction(() => {
      if (authorizeMasterUpdate && finding.asset_id) {
        const prevState = getAssetStateSnapshot(Number(finding.asset_id));
        const obs = (() => {
          try { return JSON.parse(String(finding.observed_snapshot_json || '{}')); } catch { return {}; }
        })();

        if (finding.reconciliation_status === 'LOCATION_MISMATCH' && obs.actual_location_id) {
          const loc = db.prepare('SELECT id, company_id FROM locations WHERE id = ?').get(Number(obs.actual_location_id)) as { id: number; company_id: number } | undefined;
          if (loc && loc.company_id === Number(finding.company_id)) {
            db.prepare("UPDATE assets SET location_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
              loc.id,
              req.authUser!.id,
              finding.asset_id
            );
            masterUpdated = 1;
            appendAssetEvent({
              companyId: Number(finding.company_id),
              assetId: Number(finding.asset_id),
              eventType: 'LOCATION_CHANGED',
              actorUserId: req.authUser!.id,
              actorUsername: req.authUser!.username,
              referenceType: 'reconciliation',
              referenceId: finding.finding_code,
              reason: `Authorized reconciliation update: ${resolutionNotes}`,
              previousState: prevState,
              newState: getAssetStateSnapshot(Number(finding.asset_id)),
            });
          }
        } else if (finding.reconciliation_status === 'CONDITION_MISMATCH' && obs.actual_condition) {
          db.prepare("UPDATE assets SET condition_status = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
            String(obs.actual_condition),
            req.authUser!.id,
            finding.asset_id
          );
          masterUpdated = 1;
          appendAssetEvent({
            companyId: Number(finding.company_id),
            assetId: Number(finding.asset_id),
            eventType: 'CONDITION_CHANGED',
            actorUserId: req.authUser!.id,
            actorUsername: req.authUser!.username,
            referenceType: 'reconciliation',
            referenceId: finding.finding_code,
            reason: `Authorized reconciliation update: ${resolutionNotes}`,
            previousState: prevState,
            newState: getAssetStateSnapshot(Number(finding.asset_id)),
          });
        }
      }

      const isClosed = nextResolution === 'Resolved' || nextResolution === 'Dismissed';
      db.prepare(`
        UPDATE asset_reconciliation_findings SET
          priority = ?,
          assigned_to_user_id = ?,
          resolution_status = ?,
          resolution_notes = ?,
          master_updated = ?,
          resolved_by_user_id = CASE WHEN ? = 1 THEN ? ELSE resolved_by_user_id END,
          resolved_at = CASE WHEN ? = 1 THEN COALESCE(resolved_at, datetime('now')) ELSE NULL END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        nextPriority,
        assignedTo,
        nextResolution,
        resolutionNotes || null,
        masterUpdated,
        isClosed ? 1 : 0,
        req.authUser!.id,
        isClosed ? 1 : 0,
        id
      );
    })();

    logAudit(req, 'RECONCILIATION_FINDING_UPDATED', 'opname', 'reconciliation', finding.finding_code, {
      resolution_status: nextResolution,
      priority: nextPriority,
      masterUpdated,
    });
    res.json({ ok: true, master_updated: masterUpdated });
  });

  // =========================================================================
  // MODULE 10 – ASSET REPLACEMENT PLANNING
  // =========================================================================
  app.get('/api/replacement', authenticate, requirePermission('replacement.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    const assetScope = buildAssetScopeSql(scope, 'a');

    const settingsRows = db.prepare("SELECT setting_key, setting_value FROM system_settings WHERE category = 'replacement'").all() as {
      setting_key: string;
      setting_value: string;
    }[];
    const thresholds: Record<string, number> = {
      replacement_age_warning_pct: 80,
      replacement_age_urgent_pct: 100,
      replacement_cost_ratio_pct: 40,
    };
    for (const s of settingsRows) {
      thresholds[s.setting_key] = Number(s.setting_value);
    }

    const assets = db
      .prepare(`
        SELECT a.id, a.asset_code, a.asset_name, a.acquisition_date, a.acquisition_value, a.condition_status,
               c.name as category_name, c.default_useful_life_years,
               co.name as company_name, d.name as division_name,
               COALESCE((SELECT COUNT(*) FROM maintenance_records m WHERE m.asset_id = a.id), 0) as maintenance_count,
               COALESCE((SELECT SUM(m.cost) FROM maintenance_records m WHERE m.asset_id = a.id), 0) as total_maintenance_cost
        FROM assets a
        JOIN categories c ON c.id = a.category_id
        JOIN companies co ON co.id = a.company_id
        JOIN divisions d ON d.id = a.division_id
        WHERE a.deleted_at IS NULL AND ${assetScope.clause}
      `)
      .all(...assetScope.params) as any[];

    const nowMs = Date.now();
    const evaluated = assets.map((a) => {
      const acqMs = new Date(a.acquisition_date).getTime();
      const ageYears = Math.max(0, Number(((nowMs - acqMs) / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1)));
      const lifePct = (ageYears / (a.default_useful_life_years || 5)) * 100;
      const costRatioPct = a.acquisition_value > 0 ? (a.total_maintenance_cost / a.acquisition_value) * 100 : 0;

      let priority: 'Normal' | 'Monitor' | 'Repair Required' | 'Replacement Recommended' | 'Urgent Replacement' = 'Normal';
      if (a.condition_status === 'Unserviceable' || lifePct >= thresholds.replacement_age_urgent_pct) {
        priority = 'Urgent Replacement';
      } else if (a.condition_status === 'Major Damage' || costRatioPct >= thresholds.replacement_cost_ratio_pct) {
        priority = 'Replacement Recommended';
      } else if (a.condition_status === 'Minor Damage') {
        priority = 'Repair Required';
      } else if (lifePct >= thresholds.replacement_age_warning_pct) {
        priority = 'Monitor';
      }

      return {
        ...a,
        age_years: ageYears,
        life_pct: Math.round(lifePct),
        cost_ratio_pct: Math.round(costRatioPct),
        recommended_priority: priority,
      };
    });

    const savedPlans = db
      .prepare(`
        SELECT r.*, a.asset_code, a.asset_name, c.name as category_name, co.name as company_name
        FROM replacement_plans r
        JOIN assets a ON a.id = r.asset_id
        JOIN companies co ON co.id = a.company_id
        JOIN categories c ON c.id = a.category_id
        WHERE ${assetScope.clause}
        ORDER BY r.assessment_year ASC, CASE r.priority_level WHEN 'Urgent Replacement' THEN 1 WHEN 'Replacement Recommended' THEN 2 WHEN 'Repair Required' THEN 3 WHEN 'Monitor' THEN 4 ELSE 5 END
      `)
      .all(...assetScope.params);

    res.json({ thresholds, evaluated, savedPlans });
  });

  app.post('/api/replacement/thresholds', authenticate, requirePermission('replacement.configure'), (req: AuthenticatedRequest, res) => {
    const { replacement_age_warning_pct, replacement_age_urgent_pct, replacement_cost_ratio_pct } = req.body || {};
    const upsert = db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, category, updated_at, updated_by)
      VALUES (?, ?, 'replacement', datetime('now'), ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now'), updated_by = excluded.updated_by
    `);
    upsert.run('replacement_age_warning_pct', String(Number(replacement_age_warning_pct || 80)), req.authUser!.id);
    upsert.run('replacement_age_urgent_pct', String(Number(replacement_age_urgent_pct || 100)), req.authUser!.id);
    upsert.run('replacement_cost_ratio_pct', String(Number(replacement_cost_ratio_pct || 40)), req.authUser!.id);
    logAudit(req, 'REPLACEMENT_THRESHOLDS_UPDATED', 'replacement', 'settings', 'replacement');
    res.json({ ok: true });
  });

  app.post('/api/replacement/plan', authenticate, requirePermission('replacement.plan'), (req: AuthenticatedRequest, res) => {
    const b = req.body || {};
    if (!b.asset_id || !b.assessment_year || !b.priority_level) {
      res.status(400).json({ error: 'Asset, year, and priority level required' });
      return;
    }
    const asset = db.prepare('SELECT id, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(b.asset_id)) as
      | { id: number; company_id: number; division_id: number }
      | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for replacement planning.' });
      return;
    }
    const info = db
      .prepare(`
        INSERT INTO replacement_plans (asset_id, assessment_year, asset_age_years, maintenance_count, total_maintenance_cost, priority_level, estimated_replacement_cost, planned_quarter, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        asset.id,
        Number(b.assessment_year),
        Number(b.asset_age_years || 0),
        Number(b.maintenance_count || 0),
        Number(b.total_maintenance_cost || 0),
        b.priority_level,
        Number(b.estimated_replacement_cost || 0),
        b.planned_quarter || 'Q1',
        b.notes || null,
        b.status || 'Planned'
      );
    logAudit(req, 'REPLACEMENT_PLAN_ADDED', 'replacement', 'replacement_plan', Number(info.lastInsertRowid));
    syncAutomatedNotifications();
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // =========================================================================
  // MODULE 11 – REPORTING CENTER (All 12 Reports – Multi-Company & Division Scoped)
  // =========================================================================
  app.get('/api/reports/:type', authenticate, requirePermission('reports.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const type = String(req.params.type);
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const locationId = req.query.location_id ? Number(req.query.location_id) : null;
    const divisionId = req.query.division_id ? Number(req.query.division_id) : null;
    const condition = String(req.query.condition || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();

    if (divisionId && !scope.isHoldingScope && scope.divisionScopedIds.length > 0 && !scope.divisionScopedIds.includes(divisionId)) {
      const divCompany = db.prepare('SELECT company_id FROM divisions WHERE id = ?').get(divisionId) as { company_id: number } | undefined;
      if (!divCompany || !scope.companyWideIds.includes(divCompany.company_id)) {
        res.status(403).json({ error: 'Cross-division report access denied.' });
        return;
      }
    }

    const assetScope = buildAssetScopeSql(scope, 'a');
    const assetFilter: string[] = ['a.deleted_at IS NULL', assetScope.clause];
    const params: unknown[] = [...assetScope.params];
    if (categoryId) { assetFilter.push('a.category_id = ?'); params.push(categoryId); }
    if (locationId) { assetFilter.push('a.location_id = ?'); params.push(locationId); }
    if (divisionId) { assetFilter.push('a.division_id = ?'); params.push(divisionId); }
    if (condition) { assetFilter.push('a.condition_status = ?'); params.push(condition); }
    if (dateFrom) { assetFilter.push('a.acquisition_date >= ?'); params.push(dateFrom); }
    if (dateTo) { assetFilter.push('a.acquisition_date <= ?'); params.push(dateTo); }

    const whereSql = assetFilter.join(' AND ');

    const assetJoinExtraParts: string[] = [assetScope.clause];
    const assetJoinExtraParams: unknown[] = [...assetScope.params];
    if (divisionId) {
      assetJoinExtraParts.push('a.division_id = ?');
      assetJoinExtraParams.push(divisionId);
    }
    const assetJoinScopeSql = assetJoinExtraParts.join(' AND ');

    const locScope = buildCompanyScopeSql(scope, 'l.company_id');
    const divScope = buildCompanyScopeSql(scope, 'd.company_id');
    const picScope = buildCompanyScopeSql(scope, 'p.company_id');
    const movScope = buildCompanyScopeSql(scope, 'COALESCE(m.to_company_id, m.from_company_id, a.company_id)');
    const opScope = buildCompanyScopeSql(scope, 'COALESCE(o.company_id, l.company_id)');

    switch (type) {
      case 'master_register': {
        const rows = db.prepare(`
          SELECT a.asset_code, a.asset_name, co.name as company, c.name as category, a.brand, a.model, a.serial_number,
                 a.acquisition_date, a.acquisition_value, d.name as division,
                 b.name || ' - ' || l.specific_location as location, COALESCE(p.full_name, 'Unassigned') as pic,
                 a.condition_status as condition, a.asset_status as status
          FROM assets a
          JOIN companies co ON co.id = a.company_id
          JOIN categories c ON c.id = a.category_id
          JOIN divisions d ON d.id = a.division_id
          JOIN locations l ON l.id = a.location_id
          JOIN buildings b ON b.id = l.building_id
          LEFT JOIN persons p ON p.id = a.pic_id
          WHERE ${whereSql}
          ORDER BY a.asset_code ASC
        `).all(...params);
        res.json({ rows });
        return;
      }
      case 'by_category': {
        const rows = db.prepare(`
          SELECT c.code as category_code, c.name as category_name, COUNT(a.id) as total_assets,
                 SUM(CASE WHEN a.condition_status = 'Good' THEN 1 ELSE 0 END) as good_count,
                 SUM(CASE WHEN a.condition_status != 'Good' THEN 1 ELSE 0 END) as damaged_count,
                 COALESCE(SUM(a.acquisition_value), 0) as total_value
          FROM categories c
          LEFT JOIN assets a ON a.category_id = c.id AND a.deleted_at IS NULL AND ${assetJoinScopeSql}
          GROUP BY c.id
        `).all(...assetJoinExtraParams);
        res.json({ rows });
        return;
      }
      case 'by_location': {
        const rows = db.prepare(`
          SELECT co.name as company, l.location_code, b.name as building, f.name as floor, r.name as room, l.specific_location,
                 COUNT(a.id) as total_assets, COALESCE(SUM(a.acquisition_value), 0) as total_value
          FROM locations l
          JOIN companies co ON co.id = l.company_id
          JOIN buildings b ON b.id = l.building_id
          JOIN floors f ON f.id = l.floor_id
          JOIN rooms r ON r.id = l.room_id
          LEFT JOIN assets a ON a.location_id = l.id AND a.deleted_at IS NULL AND ${assetJoinScopeSql}
          WHERE ${locScope.clause}
          GROUP BY l.id
        `).all(...assetJoinExtraParams, ...locScope.params);
        res.json({ rows });
        return;
      }
      case 'by_division': {
        const divFilterExtra = divisionId ? 'AND d.id = ?' : '';
        const divParams = divisionId ? [...assetJoinExtraParams, ...divScope.params, divisionId] : [...assetJoinExtraParams, ...divScope.params];
        const rows = db.prepare(`
          SELECT co.name as company, d.code as division_code, d.name as division_name, d.department,
                 COUNT(a.id) as total_assets, COALESCE(SUM(a.acquisition_value), 0) as total_value
          FROM divisions d
          JOIN companies co ON co.id = d.company_id
          LEFT JOIN assets a ON a.division_id = d.id AND a.deleted_at IS NULL AND ${assetJoinScopeSql}
          WHERE ${divScope.clause} ${divFilterExtra}
          GROUP BY d.id
        `).all(...divParams);
        res.json({ rows });
        return;
      }
      case 'by_pic': {
        const picDivFilter = divisionId ? 'AND p.division_id = ?' : '';
        const picParams = divisionId ? [...assetJoinExtraParams, ...picScope.params, divisionId] : [...assetJoinExtraParams, ...picScope.params];
        const rows = db.prepare(`
          SELECT co.name as company, p.nik_nip, p.full_name, d.name as division, p.position_title,
                 COUNT(a.id) as assigned_assets, COALESCE(SUM(a.acquisition_value), 0) as total_value
          FROM persons p
          JOIN companies co ON co.id = p.company_id
          JOIN divisions d ON d.id = p.division_id
          LEFT JOIN assets a ON a.pic_id = p.id AND a.deleted_at IS NULL AND ${assetJoinScopeSql}
          WHERE ${picScope.clause} ${picDivFilter}
          GROUP BY p.id
        `).all(...picParams);
        res.json({ rows });
        return;
      }
      case 'condition_report': {
        const rows = db.prepare(`
          SELECT a.asset_code, a.asset_name, co.name as company, d.name as division, c.name as category,
                 b.name || ' - ' || l.specific_location as location,
                 COALESCE(p.full_name, 'Unassigned') as pic, a.condition_status as condition, a.asset_status as status
          FROM assets a
          JOIN companies co ON co.id = a.company_id
          JOIN divisions d ON d.id = a.division_id
          JOIN categories c ON c.id = a.category_id
          JOIN locations l ON l.id = a.location_id
          JOIN buildings b ON b.id = l.building_id
          LEFT JOIN persons p ON p.id = a.pic_id
          WHERE ${whereSql}
          ORDER BY CASE a.condition_status WHEN 'Unserviceable' THEN 1 WHEN 'Major Damage' THEN 2 WHEN 'Minor Damage' THEN 3 ELSE 4 END
        `).all(...params);
        res.json({ rows });
        return;
      }
      case 'movement_report': {
        const movFilter: string[] = [movScope.clause];
        const movParams: unknown[] = [...movScope.params];
        if (divisionId) {
          movFilter.push('(COALESCE(m.from_division_id, a.division_id) = ? OR COALESCE(m.to_division_id, a.division_id) = ?)');
          movParams.push(divisionId, divisionId);
        }
        const rows = db.prepare(`
          SELECT m.movement_code, a.asset_code, a.asset_name,
                 COALESCE(fc.name, '-') as from_company, COALESCE(tc.name, '-') as to_company,
                 fl.specific_location as from_location, tl.specific_location as to_location,
                 COALESCE(fp.full_name, '-') as from_pic, COALESCE(tp.full_name, '-') as to_pic,
                 m.movement_date, m.reason, m.status
          FROM asset_movements m
          JOIN assets a ON a.id = m.asset_id
          JOIN locations fl ON fl.id = m.from_location_id
          JOIN locations tl ON tl.id = m.to_location_id
          LEFT JOIN companies fc ON fc.id = m.from_company_id
          LEFT JOIN companies tc ON tc.id = m.to_company_id
          LEFT JOIN persons fp ON fp.id = m.from_pic_id
          LEFT JOIN persons tp ON tp.id = m.to_pic_id
          WHERE ${movFilter.join(' AND ')}
          ORDER BY m.movement_date DESC
        `).all(...movParams);
        res.json({ rows });
        return;
      }
      case 'maintenance_report': {
        const rows = db.prepare(`
          SELECT m.ticket_code, co.name as company, a.asset_code, a.asset_name, m.damage_date, m.damage_type,
                 COALESCE(m.vendor_technician, '-') as vendor, m.cost, m.completion_date, m.status
          FROM maintenance_records m
          JOIN assets a ON a.id = m.asset_id
          JOIN companies co ON co.id = a.company_id
          WHERE ${whereSql}
          ORDER BY m.damage_date DESC
        `).all(...params);
        res.json({ rows });
        return;
      }
      case 'opname_report': {
        const rows = db.prepare(`
          SELECT o.opname_code, co.name as company, o.title, d.scanned_code, COALESCE(a.asset_name, 'Unregistered') as asset_name,
                 d.verification_result, d.expected_condition, d.actual_condition, d.verified_at, d.notes
          FROM stock_opname_details d
          JOIN stock_opname o ON o.id = d.opname_id
          JOIN locations l ON l.id = o.location_id
          JOIN companies co ON co.id = COALESCE(o.company_id, l.company_id)
          LEFT JOIN assets a ON a.id = d.asset_id
          WHERE ${opScope.clause}
          ORDER BY d.verified_at DESC
        `).all(...opScope.params);
        res.json({ rows });
        return;
      }
      case 'missing_asset_report': {
        const rows = db.prepare(`
          SELECT a.asset_code, a.asset_name, co.name as company, d.name as division, c.name as category,
                 l.specific_location as last_known_location,
                 COALESCE(p.full_name, 'Unassigned') as pic,
                 CASE WHEN q.id IS NULL THEN 'QR Missing' WHEN a.pic_id IS NULL THEN 'PIC Missing' ELSE a.asset_status END as issue_flag
          FROM assets a
          JOIN companies co ON co.id = a.company_id
          JOIN divisions d ON d.id = a.division_id
          JOIN categories c ON c.id = a.category_id
          JOIN locations l ON l.id = a.location_id
          LEFT JOIN persons p ON p.id = a.pic_id
          LEFT JOIN asset_qr_codes q ON q.asset_id = a.id
          WHERE ${whereSql} AND (a.asset_status = 'Missing' OR a.pic_id IS NULL OR q.id IS NULL
            OR EXISTS (SELECT 1 FROM stock_opname_details sd WHERE sd.asset_id = a.id AND sd.verification_result = 'Not Found'))
        `).all(...params);
        res.json({ rows });
        return;
      }
      case 'replacement_plan': {
        const rows = db.prepare(`
          SELECT a.asset_code, a.asset_name, co.name as company, c.name as category, r.assessment_year, r.asset_age_years,
                 r.maintenance_count, r.total_maintenance_cost, r.priority_level, r.estimated_replacement_cost,
                 r.planned_quarter, r.status
          FROM replacement_plans r
          JOIN assets a ON a.id = r.asset_id
          JOIN companies co ON co.id = a.company_id
          JOIN categories c ON c.id = a.category_id
          WHERE ${whereSql}
          ORDER BY r.assessment_year ASC
        `).all(...params);
        res.json({ rows });
        return;
      }
      case 'acquisition_report': {
        const rows = db.prepare(`
          SELECT a.asset_code, a.asset_name, co.name as company, d.name as division, c.name as category,
                 a.acquisition_date, a.acquisition_value,
                 a.supplier, a.purchase_reference, a.acquisition_source, a.warranty_period_months
          FROM assets a
          JOIN companies co ON co.id = a.company_id
          JOIN divisions d ON d.id = a.division_id
          JOIN categories c ON c.id = a.category_id
          WHERE ${whereSql}
          ORDER BY a.acquisition_date DESC
        `).all(...params);
        res.json({ rows });
        return;
      }
      default:
        res.status(404).json({ error: 'Unknown report type' });
    }
  });

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================
  app.get('/api/notifications', authenticate, (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    syncAutomatedNotifications();
    const notifScope = buildScopedNotificationsWhere(scope);
    const rows = db
      .prepare(`SELECT * FROM notifications WHERE ${notifScope.clause} ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, created_at DESC`)
      .all(...notifScope.params);
    res.json({ notifications: rows });
  });

  app.post('/api/notifications/:id/read', authenticate, (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // =========================================================================
  // RBAC USER MANAGEMENT, ORG SCOPES & AUDIT LOGS
  // =========================================================================
  app.get('/api/users', authenticate, requirePermission('users.view'), (req: AuthenticatedRequest, res) => {
    const users = db
      .prepare(`
        SELECT u.id, u.username, u.email, u.full_name, u.phone, u.department, u.position_title, u.avatar_url, u.is_active, u.last_login_at, u.created_at,
               r.id as role_id, r.code as role_code, r.name as role_name
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        ORDER BY u.id ASC
      `)
      .all() as Record<string, any>[];

    const allScopes = db
      .prepare(`
        SELECT s.*, h.name as holding_name,
               COALESCE(s.company_id, d.company_id) as company_id,
               c.name as company_name, c.code as company_code,
               d.name as division_name
        FROM user_org_scopes s
        LEFT JOIN holding_groups h ON h.id = s.holding_id
        LEFT JOIN divisions d ON d.id = s.division_id
        LEFT JOIN companies c ON c.id = COALESCE(s.company_id, d.company_id)
        ORDER BY s.is_default DESC, s.id ASC
      `)
      .all() as Record<string, any>[];

    const scopeMap = new Map<number, Record<string, any>[]>();
    for (const s of allScopes) {
      const uid = Number(s.user_id);
      if (!scopeMap.has(uid)) scopeMap.set(uid, []);
      scopeMap.get(uid)!.push(s);
    }

    const enrichedUsers = users.map((u) => ({
      ...u,
      org_scopes: scopeMap.get(Number(u.id)) || [],
    }));

    const roles = db.prepare('SELECT * FROM roles ORDER BY id ASC').all();
    const permissions = db.prepare('SELECT * FROM permissions ORDER BY module, action').all();
    const rolePermissions = db.prepare('SELECT * FROM role_permissions').all();
    const holdingGroups = db.prepare('SELECT * FROM holding_groups ORDER BY id ASC').all();
    const companies = req.authUser!.is_holding_scope
      ? db.prepare('SELECT * FROM companies ORDER BY id ASC').all()
      : db
          .prepare(
            `SELECT * FROM companies WHERE ${req.authUser!.allowed_company_ids.length > 0 ? `id IN (${req.authUser!.allowed_company_ids.map(() => '?').join(',')})` : '1=0'} ORDER BY id ASC`
          )
          .all(...req.authUser!.allowed_company_ids);
    const divisions = req.authUser!.is_holding_scope
      ? db.prepare('SELECT d.*, c.name as company_name FROM divisions d JOIN companies c ON c.id = d.company_id ORDER BY c.id, d.name').all()
      : db
          .prepare(
            `SELECT d.*, c.name as company_name FROM divisions d JOIN companies c ON c.id = d.company_id WHERE ${req.authUser!.allowed_company_ids.length > 0 ? `d.company_id IN (${req.authUser!.allowed_company_ids.map(() => '?').join(',')})` : '1=0'} ORDER BY c.id, d.name`
          )
          .all(...req.authUser!.allowed_company_ids);

    res.json({ users: enrichedUsers, roles, permissions, rolePermissions, holdingGroups, companies, divisions });
  });

  app.post('/api/users', authenticate, requirePermission('users.manage'), (req: AuthenticatedRequest, res) => {
    const { username, email, full_name, password, role_id, scope_level, company_id, division_id } = req.body || {};
    if (!username || !email || !full_name || !password || String(password).length < 8 || !role_id) {
      res.status(400).json({ error: 'All fields required and password must be at least 8 characters' });
      return;
    }

    const targetRole = db.prepare('SELECT id, code FROM roles WHERE id = ?').get(Number(role_id)) as
      | { id: number; code: string }
      | undefined;
    if (!targetRole) {
      res.status(400).json({ error: 'Selected role not found' });
      return;
    }

    const resolvedScopeLevel: 'holding' | 'company' | 'division' =
      scope_level === 'holding' || scope_level === 'division' || scope_level === 'company'
        ? scope_level
        : targetRole.code === 'super_admin'
        ? 'holding'
        : 'company';

    if (resolvedScopeLevel === 'holding' && !req.authUser!.is_holding_scope) {
      res.status(403).json({ error: 'Only holding-scope administrators can assign holding-wide access.' });
      return;
    }

    let resolvedCompanyId: number | null = company_id ? Number(company_id) : null;
    const resolvedDivisionId: number | null = division_id ? Number(division_id) : null;

    if (resolvedScopeLevel === 'division') {
      if (!resolvedDivisionId) {
        res.status(400).json({ error: 'Division selection is required for division-level scope.' });
        return;
      }
      const divRow = db.prepare('SELECT id, company_id FROM divisions WHERE id = ?').get(resolvedDivisionId) as
        | { id: number; company_id: number }
        | undefined;
      if (!divRow) {
        res.status(400).json({ error: 'Selected division not found.' });
        return;
      }
      resolvedCompanyId = divRow.company_id;
    } else if (resolvedScopeLevel === 'company') {
      if (!resolvedCompanyId) {
        resolvedCompanyId = req.authUser!.allowed_company_ids[0] || 1;
      }
    }

    if (resolvedScopeLevel !== 'holding' && resolvedCompanyId && !canUserAccessRecord(req.authUser!, resolvedCompanyId, resolvedDivisionId)) {
      res.status(403).json({ error: 'Cannot assign user scope outside your permitted organization.' });
      return;
    }

    const defaultHolding = db.prepare('SELECT id FROM holding_groups ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;

    try {
      const tx = db.transaction(() => {
        const hash = hashPassword(String(password));
        const info = db
          .prepare('INSERT INTO users (username, email, full_name, password_hash, is_active, created_by) VALUES (?, ?, ?, ?, 1, ?)')
          .run(username.trim().toLowerCase(), email.trim().toLowerCase(), full_name.trim(), hash, req.authUser!.id);
        const uid = Number(info.lastInsertRowid);
        db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(uid, Number(role_id));
        db.prepare(`
          INSERT INTO user_org_scopes (user_id, scope_level, holding_id, company_id, division_id, is_default)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(
          uid,
          resolvedScopeLevel,
          resolvedScopeLevel === 'holding' ? (defaultHolding?.id || 1) : null,
          resolvedScopeLevel === 'holding' ? null : resolvedCompanyId,
          resolvedScopeLevel === 'division' ? resolvedDivisionId : null
        );
        return uid;
      });
      const uid = tx();
      logAudit(req, 'USER_CREATED', 'users', 'user', uid, { username, scope_level: resolvedScopeLevel, company_id: resolvedCompanyId });
      res.status(201).json({ id: uid });
    } catch {
      res.status(409).json({ error: 'Username or email already exists' });
    }
  });

  app.put('/api/users/:id', authenticate, requirePermission('users.manage'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { full_name, email, is_active, role_id, new_password, scope_level, company_id, division_id } = req.body || {};

    if (scope_level) {
      if (scope_level === 'holding' && !req.authUser!.is_holding_scope) {
        res.status(403).json({ error: 'Only holding-scope administrators can assign holding-wide access.' });
        return;
      }
      if (scope_level !== 'holding' && company_id && !canUserAccessRecord(req.authUser!, Number(company_id), division_id ? Number(division_id) : null)) {
        res.status(403).json({ error: 'Cannot assign organization scope outside your permitted scope.' });
        return;
      }
    }

    const defaultHolding = db.prepare('SELECT id FROM holding_groups ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;

    const tx = db.transaction(() => {
      db.prepare("UPDATE users SET full_name = ?, email = ?, is_active = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
        full_name, email, is_active ? 1 : 0, req.authUser!.id, id
      );
      if (new_password && String(new_password).length >= 8) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(new_password)), id);
      }
      if (role_id) {
        db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
        db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, Number(role_id));
      }
      if (scope_level === 'holding' || scope_level === 'company' || scope_level === 'division') {
        let resolvedCompanyId: number | null = company_id ? Number(company_id) : null;
        const resolvedDivisionId: number | null = division_id ? Number(division_id) : null;
        if (scope_level === 'division' && resolvedDivisionId) {
          const dRow = db.prepare('SELECT company_id FROM divisions WHERE id = ?').get(resolvedDivisionId) as { company_id: number } | undefined;
          if (dRow) resolvedCompanyId = dRow.company_id;
        }
        db.prepare('DELETE FROM user_org_scopes WHERE user_id = ?').run(id);
        db.prepare(`
          INSERT INTO user_org_scopes (user_id, scope_level, holding_id, company_id, division_id, is_default)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(
          id,
          scope_level,
          scope_level === 'holding' ? (defaultHolding?.id || 1) : null,
          scope_level === 'holding' ? null : (resolvedCompanyId || 1),
          scope_level === 'division' ? resolvedDivisionId : null
        );
      }
    });
    tx();
    logAudit(req, 'USER_UPDATED', 'users', 'user', id, { scope_level });
    res.json({ ok: true });
  });

  app.put('/api/roles/:id/permissions', authenticate, requirePermission('users.manage'), (req: AuthenticatedRequest, res) => {
    const roleId = Number(req.params.id);
    const permissionIds = Array.isArray(req.body?.permissionIds) ? req.body.permissionIds.map(Number) : [];
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
      const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
      for (const pid of permissionIds) ins.run(roleId, pid);
    });
    tx();
    logAudit(req, 'ROLE_PERMISSIONS_UPDATED', 'users', 'role', roleId, { count: permissionIds.length });
    res.json({ ok: true });
  });

  app.get('/api/audit-logs', authenticate, requirePermission('users.view'), (_req, res) => {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 150').all();
    res.json({ logs });
  });

  // =========================================================================
  // FASE 1 GOVERNANCE – IMMUTABLE ASSET EVENT LEDGER & ORG HIERARCHY
  // (Strictly separated from Security Audit Logs; append-only, no DELETE/PUT)
  // =========================================================================
  app.get('/api/asset-events', authenticate, requirePermission('assets.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const assetId = req.query.asset_id ? Number(req.query.asset_id) : null;
    const eventType = String(req.query.event_type || '').trim();
    const search = String(req.query.search || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const limit = Math.min(500, Math.max(10, Number(req.query.limit || 200)));

    const compScope = buildCompanyScopeSql(scope, 'e.company_id');
    const where: string[] = [compScope.clause];
    const params: unknown[] = [...compScope.params];

    if (!scope.isHoldingScope && scope.divisionScopedIds.length > 0 && scope.companyWideIds.length === 0) {
      const ph = scope.divisionScopedIds.map(() => '?').join(',');
      where.push(`(e.asset_id IS NULL OR EXISTS (SELECT 1 FROM assets sa WHERE sa.id = e.asset_id AND sa.division_id IN (${ph})))`);
      params.push(...scope.divisionScopedIds);
    }

    if (assetId) {
      where.push('e.asset_id = ?');
      params.push(assetId);
    }
    if (eventType && eventType !== 'all') {
      where.push('e.event_type = ?');
      params.push(eventType);
    }
    if (dateFrom) {
      where.push('substr(e.created_at, 1, 10) >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push('substr(e.created_at, 1, 10) <= ?');
      params.push(dateTo);
    }
    if (search) {
      const q = `%${search.toLowerCase()}%`;
      where.push(`(
        lower(e.event_uuid) LIKE ?
        OR lower(e.event_type) LIKE ?
        OR lower(COALESCE(e.actor_username, '')) LIKE ?
        OR lower(COALESCE(e.reason, '')) LIKE ?
        OR lower(COALESCE(a.asset_code, '')) LIKE ?
        OR lower(COALESCE(a.asset_name, '')) LIKE ?
      )`);
      params.push(q, q, q, q, q, q);
    }

    const whereSql = where.join(' AND ');
    const events = db
      .prepare(`
        SELECT e.*, a.asset_code, a.asset_name, c.name as company_name, c.code as company_code,
               u.full_name as actor_full_name
        FROM asset_events e
        LEFT JOIN assets a ON a.id = e.asset_id
        LEFT JOIN companies c ON c.id = e.company_id
        LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE ${whereSql}
        ORDER BY e.id DESC
        LIMIT ?
      `)
      .all(...params, limit);

    const summary = db
      .prepare(`
        SELECT COUNT(*) as totalEvents,
               COUNT(DISTINCT e.asset_id) as trackedAssets,
               SUM(CASE WHEN e.event_type IN ('ASSET_TRANSFERRED', 'OWNERSHIP_TRANSFERRED') THEN 1 ELSE 0 END) as transferEvents,
               SUM(CASE WHEN e.event_type = 'ASSET_VERIFIED' THEN 1 ELSE 0 END) as verificationEvents
        FROM asset_events e
        LEFT JOIN assets a ON a.id = e.asset_id
        WHERE ${whereSql}
      `)
      .get(...params);

    res.json({ events, summary });
  });

  app.get('/api/system/event-chain/verify', authenticate, requirePermission('settings.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;
    const scopedCompanies = scope.isHoldingScope && scope.activeCompanyId === null ? null : scope.allowedCompanyIds;
    const verification = verifyAssetEventChain(scopedCompanies);
    res.json(verification);
  });

  app.get('/api/org/structure', authenticate, requirePermission('settings.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const compScope = buildCompanyScopeSql(scope, 'c.id');
    const divScope = buildCompanyScopeSql(scope, 'd.company_id');

    const holdingGroups = db.prepare('SELECT * FROM holding_groups ORDER BY id ASC').all();
    const companies = db
      .prepare(`
        SELECT c.*, h.name as holding_name, h.code as holding_code,
               (SELECT COUNT(*) FROM divisions d WHERE d.company_id = c.id) as division_count,
               (SELECT COUNT(*) FROM assets a WHERE a.company_id = c.id AND a.deleted_at IS NULL) as asset_count
        FROM companies c
        LEFT JOIN holding_groups h ON h.id = c.holding_id
        WHERE ${compScope.clause}
        ORDER BY c.id ASC
      `)
      .all(...compScope.params);
    const divisions = db
      .prepare(`
        SELECT d.*, c.name as company_name, c.code as company_code,
               (SELECT COUNT(*) FROM assets a WHERE a.division_id = d.id AND a.deleted_at IS NULL) as asset_count
        FROM divisions d
        JOIN companies c ON c.id = d.company_id
        WHERE ${divScope.clause}
        ORDER BY c.id ASC, d.name ASC
      `)
      .all(...divScope.params);

    res.json({ holdingGroups, companies, divisions });
  });

  app.post('/api/org/companies', authenticate, requirePermission('settings.manage'), (req: AuthenticatedRequest, res) => {
    if (!req.authUser!.is_holding_scope) {
      res.status(403).json({ error: 'Only holding-scope administrators can create new operating companies.' });
      return;
    }
    const { code, name, holding_id, address } = req.body || {};
    if (!code || !name) {
      res.status(400).json({ error: 'Company code and name are required.' });
      return;
    }
    const defaultHolding = db.prepare('SELECT id FROM holding_groups ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
    try {
      const info = db
        .prepare('INSERT INTO companies (holding_id, code, name, address) VALUES (?, ?, ?, ?)')
        .run(holding_id ? Number(holding_id) : (defaultHolding?.id || 1), String(code).trim().toUpperCase(), String(name).trim(), address ? String(address).trim() : null);
      const cid = Number(info.lastInsertRowid);
      logAudit(req, 'COMPANY_CREATED', 'settings', 'company', cid, { code: String(code).trim().toUpperCase() });
      res.status(201).json({ id: cid });
    } catch {
      res.status(409).json({ error: 'Company code already exists.' });
    }
  });

  app.post('/api/org/divisions', authenticate, requirePermission('settings.manage'), (req: AuthenticatedRequest, res) => {
    const { company_id, code, name, department } = req.body || {};
    if (!company_id || !code || !name) {
      res.status(400).json({ error: 'Company, division code, and division name are required.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, Number(company_id))) {
      res.status(403).json({ error: 'Cannot create division for an unauthorized company.' });
      return;
    }
    try {
      const info = db
        .prepare('INSERT INTO divisions (company_id, code, name, department) VALUES (?, ?, ?, ?)')
        .run(Number(company_id), String(code).trim().toUpperCase(), String(name).trim(), department ? String(department).trim() : null);
      const did = Number(info.lastInsertRowid);
      logAudit(req, 'DIVISION_CREATED', 'settings', 'division', did, { company_id: Number(company_id), code: String(code).trim().toUpperCase() });
      res.status(201).json({ id: did });
    } catch {
      res.status(409).json({ error: 'Division code already exists or invalid company.' });
    }
  });

  // =========================================================================
  // FASE 3 GOVERNANCE – RETENTION, LEGAL HOLDS, ENTERPRISE SOP, INTEGRATION GOVERNANCE & SMART AI
  // =========================================================================

  function getAiSettingsState(): { smart_ai_enabled: boolean; smart_ai_external_allowed: boolean; geminiKeyConfigured: boolean } {
    const rows = db
      .prepare("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('smart_ai_enabled', 'smart_ai_external_allowed')")
      .all() as { setting_key: string; setting_value: string }[];
    const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      smart_ai_enabled: map.get('smart_ai_enabled') !== 'false',
      smart_ai_external_allowed: map.get('smart_ai_external_allowed') !== 'false',
      geminiKeyConfigured: isGeminiApiKeyConfigured(),
    };
  }

  // 1. Asset Data Retention & Record Management
  app.get('/api/governance/retention', authenticate, requirePermission('governance.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const policies = db.prepare('SELECT * FROM retention_policies ORDER BY is_immutable_ledger DESC, id ASC').all() as Record<string, any>[];
    const holdScope = buildCompanyScopeSql(scope, 'h.company_id');
    const holds = db
      .prepare(`
        SELECT h.*, a.asset_code, a.asset_name, a.asset_status, a.legal_hold, c.name as company_name, c.code as company_code,
               pu.full_name as placed_by_name, ru.full_name as released_by_name
        FROM record_retention_holds h
        JOIN assets a ON a.id = h.asset_id
        JOIN companies c ON c.id = h.company_id
        LEFT JOIN users pu ON pu.id = h.placed_by_user_id
        LEFT JOIN users ru ON ru.id = h.released_by_user_id
        WHERE ${holdScope.clause}
        ORDER BY CASE h.status WHEN 'Active' THEN 1 ELSE 2 END, h.id DESC
      `)
      .all(...holdScope.params);

    const aScope = buildAssetScopeSql(scope, 'a');
    const stats = db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM assets a WHERE a.deleted_at IS NULL AND a.legal_hold = 1 AND ${aScope.clause}) as heldAssetsCount,
          (SELECT COUNT(*) FROM assets a WHERE a.deleted_at IS NULL AND a.archived_at IS NOT NULL AND ${aScope.clause}) as archivedAssetsCount,
          (SELECT COUNT(*) FROM assets a WHERE a.deleted_at IS NULL AND a.asset_status = 'Disposed' AND a.legal_hold = 0 AND a.archived_at IS NULL AND ${aScope.clause}) as disposedPendingArchiveCount,
          (SELECT COUNT(*) FROM asset_events) as immutableEventsCount,
          (SELECT COUNT(*) FROM audit_logs) as auditLogsCount
      `)
      .get(...aScope.params, ...aScope.params, ...aScope.params);

    res.json({ policies, holds, stats });
  });

  app.put('/api/governance/retention/:id', authenticate, requirePermission('governance.manage'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM retention_policies WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Retention policy not found.' });
      return;
    }

    const retentionDays = req.body?.retention_days !== undefined ? Number(req.body.retention_days) : Number(existing.retention_days);
    if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 36500) {
      res.status(400).json({ error: 'Retention period must be between 30 and 36500 days.' });
      return;
    }

    let actionMode = req.body?.action_mode ? String(req.body.action_mode) : String(existing.action_mode);
    let isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : Number(existing.is_active);

    if (Number(existing.is_immutable_ledger) === 1) {
      if (actionMode !== 'immutable_retain' || isActive === 0) {
        res.status(400).json({
          error: 'Guardrail: Immutable ledger classes (asset_events / audit_logs) cannot be disabled or switched away from immutable_retain.',
        });
        return;
      }
      actionMode = 'immutable_retain';
      isActive = 1;
    } else if (!['immutable_retain', 'archive_record', 'purge_non_ledger'].includes(actionMode)) {
      res.status(400).json({ error: 'Invalid retention action_mode.' });
      return;
    }

    db.prepare(`
      UPDATE retention_policies SET
        retention_days = ?,
        action_mode = ?,
        is_active = ?,
        updated_by = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(retentionDays, actionMode, isActive, req.authUser!.id, id);

    logAudit(req, 'RETENTION_POLICY_UPDATED', 'governance', 'retention_policy', id, {
      policy_code: existing.policy_code,
      record_class: existing.record_class,
      retention_days: retentionDays,
      action_mode: actionMode,
      is_active: isActive,
    });
    res.json({ ok: true });
  });

  app.post('/api/governance/retention/evaluate', authenticate, requirePermission('governance.manage'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const execute = Boolean(req.body?.execute);
    const policies = db.prepare('SELECT * FROM retention_policies ORDER BY id ASC').all() as Record<string, any>[];
    const results: {
      policy_code: string;
      record_class: string;
      action_mode: string;
      retention_days: number;
      eligible_count: number;
      processed_count: number;
      skipped_reason: string | null;
    }[] = [];

    const tx = db.transaction(() => {
      for (const p of policies) {
        const days = Number(p.retention_days);
        const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');

        if (Number(p.is_immutable_ledger) === 1 || p.record_class === 'asset_events' || p.record_class === 'audit_logs') {
          results.push({
            policy_code: p.policy_code,
            record_class: p.record_class,
            action_mode: p.action_mode,
            retention_days: days,
            eligible_count: 0,
            processed_count: 0,
            skipped_reason: 'Protected immutable ledger: never purged or mutated by retention automation.',
          });
          if (execute) {
            db.prepare("UPDATE retention_policies SET last_evaluated_at = datetime('now') WHERE id = ?").run(p.id);
          }
          continue;
        }

        if (!Number(p.is_active)) {
          results.push({
            policy_code: p.policy_code,
            record_class: p.record_class,
            action_mode: p.action_mode,
            retention_days: days,
            eligible_count: 0,
            processed_count: 0,
            skipped_reason: 'Policy is inactive.',
          });
          continue;
        }

        if (p.record_class === 'disposed_assets') {
          const aScope = buildAssetScopeSql(scope, 'a');
          const eligibleRows = db
            .prepare(`
              SELECT a.id, a.company_id, a.asset_code
              FROM assets a
              WHERE a.deleted_at IS NULL
                AND a.asset_status = 'Disposed'
                AND a.legal_hold = 0
                AND a.archived_at IS NULL
                AND a.updated_at <= ?
                AND ${aScope.clause}
            `)
            .all(cutoff, ...aScope.params) as { id: number; company_id: number; asset_code: string }[];

          let processed = 0;
          if (execute && p.action_mode === 'archive_record' && eligibleRows.length > 0) {
            const upd = db.prepare("UPDATE assets SET archived_at = datetime('now'), updated_by = ? WHERE id = ? AND legal_hold = 0");
            for (const row of eligibleRows) {
              const info = upd.run(req.authUser!.id, row.id);
              if (info.changes > 0) {
                processed += 1;
                appendAssetEvent({
                  companyId: row.company_id,
                  assetId: row.id,
                  eventType: 'ASSET_ARCHIVED',
                  actorUserId: req.authUser!.id,
                  actorUsername: req.authUser!.username,
                  referenceType: 'retention_policy',
                  referenceId: p.policy_code,
                  reason: `Retention policy ${p.policy_code} (${days}d) archived disposed asset`,
                  previousState: { archived_at: null },
                  newState: { archived_at: 'ARCHIVED' },
                });
              }
            }
          }

          if (execute) {
            db.prepare("UPDATE retention_policies SET last_evaluated_at = datetime('now') WHERE id = ?").run(p.id);
          }

          results.push({
            policy_code: p.policy_code,
            record_class: p.record_class,
            action_mode: p.action_mode,
            retention_days: days,
            eligible_count: eligibleRows.length,
            processed_count: processed,
            skipped_reason: null,
          });
          continue;
        }

        if (p.record_class === 'qr_access_logs') {
          const eligibleCount = (
            db.prepare('SELECT COUNT(*) as c FROM qr_access_logs WHERE created_at <= ?').get(cutoff) as { c: number }
          ).c;
          let processed = 0;
          if (execute && p.action_mode === 'purge_non_ledger' && eligibleCount > 0) {
            const info = db.prepare('DELETE FROM qr_access_logs WHERE created_at <= ?').run(cutoff);
            processed = info.changes;
          }
          if (execute) {
            db.prepare("UPDATE retention_policies SET last_evaluated_at = datetime('now') WHERE id = ?").run(p.id);
          }
          results.push({
            policy_code: p.policy_code,
            record_class: p.record_class,
            action_mode: p.action_mode,
            retention_days: days,
            eligible_count: eligibleCount,
            processed_count: processed,
            skipped_reason: null,
          });
          continue;
        }

        // Other archival classes (asset_field_captures, sop_executions, ai_asset_identifications)
        const tableMap: Record<string, string> = {
          asset_field_captures: 'captured_at',
          sop_executions: 'signed_off_at',
          ai_asset_identifications: 'created_at',
        };
        const dateCol = tableMap[p.record_class];
        let eligibleCount = 0;
        if (dateCol) {
          eligibleCount = (
            db.prepare(`SELECT COUNT(*) as c FROM ${p.record_class} WHERE ${dateCol} <= ?`).get(cutoff) as { c: number }
          ).c;
        }
        if (execute) {
          db.prepare("UPDATE retention_policies SET last_evaluated_at = datetime('now') WHERE id = ?").run(p.id);
        }
        results.push({
          policy_code: p.policy_code,
          record_class: p.record_class,
          action_mode: p.action_mode,
          retention_days: days,
          eligible_count: eligibleCount,
          processed_count: 0,
          skipped_reason: p.action_mode === 'immutable_retain' ? 'Retained permanently.' : 'Historical evidence retained in archive index.',
        });
      }
    });

    tx();
    logAudit(req, execute ? 'RETENTION_EVALUATED_EXECUTED' : 'RETENTION_EVALUATED_DRY_RUN', 'governance', 'retention', 'batch', {
      execute,
      policyCount: results.length,
    });
    res.json({ ok: true, execute, results });
  });

  app.post('/api/governance/legal-hold', authenticate, requirePermission('governance.manage'), (req: AuthenticatedRequest, res) => {
    const assetId = Number(req.body?.asset_id);
    const action = req.body?.action === 'release' ? 'release' : 'place';
    const reason = String(req.body?.reason || '').trim();

    if (!Number.isInteger(assetId) || assetId <= 0) {
      res.status(400).json({ error: 'Valid asset_id is required.' });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: 'Alasan penetapan / pelepasan Legal Hold wajib diisi.' });
      return;
    }

    const asset = db
      .prepare('SELECT id, asset_code, company_id, division_id, legal_hold FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(assetId) as { id: number; asset_code: string; company_id: number; division_id: number; legal_hold: number } | undefined;

    if (!asset) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, asset.company_id, asset.division_id)) {
      res.status(403).json({ error: 'Cross-company/division access denied for legal hold.' });
      return;
    }

    const tx = db.transaction(() => {
      if (action === 'place') {
        const holdCode = `LH-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const info = db
          .prepare(`
            INSERT INTO record_retention_holds (hold_code, company_id, asset_id, hold_reason, status, placed_by_user_id)
            VALUES (?, ?, ?, ?, 'Active', ?)
          `)
          .run(holdCode, asset.company_id, asset.id, reason, req.authUser!.id);
        db.prepare("UPDATE assets SET legal_hold = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
          req.authUser!.id,
          asset.id
        );
        appendAssetEvent({
          companyId: asset.company_id,
          assetId: asset.id,
          eventType: 'LEGAL_HOLD_UPDATED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'legal_hold',
          referenceId: holdCode,
          reason,
          previousState: { legal_hold: asset.legal_hold },
          newState: { legal_hold: 1, hold_code: holdCode, status: 'Active' },
        });
        return { holdId: Number(info.lastInsertRowid), holdCode, legal_hold: 1 };
      } else {
        db.prepare(`
          UPDATE record_retention_holds SET
            status = 'Released',
            released_by_user_id = ?,
            released_at = datetime('now'),
            release_notes = ?
          WHERE asset_id = ? AND status = 'Active'
        `).run(req.authUser!.id, reason, asset.id);
        db.prepare("UPDATE assets SET legal_hold = 0, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
          req.authUser!.id,
          asset.id
        );
        appendAssetEvent({
          companyId: asset.company_id,
          assetId: asset.id,
          eventType: 'LEGAL_HOLD_UPDATED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'legal_hold',
          referenceId: asset.asset_code,
          reason,
          previousState: { legal_hold: asset.legal_hold },
          newState: { legal_hold: 0, status: 'Released' },
        });
        return { holdId: null, holdCode: null, legal_hold: 0 };
      }
    });

    const out = tx();
    logAudit(req, action === 'place' ? 'LEGAL_HOLD_PLACED' : 'LEGAL_HOLD_RELEASED', 'governance', 'asset', asset.id, {
      asset_code: asset.asset_code,
      reason,
      ...out,
    });
    res.json({ ok: true, ...out });
  });

  // 2. Enterprise SOP & Operational Control
  app.get('/api/governance/sops', authenticate, requirePermission('governance.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const compScope = buildCompanyScopeSql(scope, 's.company_id');
    const sops = db
      .prepare(`
        SELECT s.*, c.name as company_name, c.code as company_code
        FROM enterprise_sops s
        LEFT JOIN companies c ON c.id = s.company_id
        WHERE (s.company_id IS NULL OR ${compScope.clause})
        ORDER BY s.is_active DESC, s.sop_code ASC
      `)
      .all(...compScope.params);

    const execScope = buildCompanyScopeSql(scope, 'se.company_id');
    const executions = db
      .prepare(`
        SELECT se.*, s.sop_code, s.title as sop_title, s.category as sop_category,
               a.asset_code, a.asset_name, c.name as company_name, u.full_name as executed_by_name
        FROM sop_executions se
        JOIN enterprise_sops s ON s.id = se.sop_id
        JOIN companies c ON c.id = se.company_id
        LEFT JOIN assets a ON a.id = se.asset_id
        LEFT JOIN users u ON u.id = se.executed_by_user_id
        WHERE ${execScope.clause}
        ORDER BY se.id DESC
        LIMIT 120
      `)
      .all(...execScope.params) as Record<string, any>[];

    const totalExec = executions.length;
    const compliantCount = executions.filter((e) => e.compliance_status === 'Compliant').length;
    const deviationCount = executions.filter((e) => e.compliance_status === 'Deviation').length;

    res.json({
      sops,
      executions,
      summary: {
        activeSops: (sops as Record<string, any>[]).filter((s) => Number(s.is_active) === 1).length,
        totalExecutions: totalExec,
        compliantCount,
        deviationCount,
        complianceRatePct: totalExec > 0 ? Math.round((compliantCount / totalExec) * 100) : 100,
      },
    });
  });

  app.post('/api/governance/sops', authenticate, requirePermission('governance.manage'), (req: AuthenticatedRequest, res) => {
    const { sop_code, company_id, title, category, version, mandatory_module, checklist_steps, is_mandatory, is_active } = req.body || {};
    const cleanTitle = String(title || '').trim();
    const cleanCat = String(category || 'Operational Control').trim();
    const cleanMod = String(mandatory_module || 'database').trim();
    const steps = Array.isArray(checklist_steps)
      ? checklist_steps.map((s) => String(s).trim()).filter(Boolean)
      : String(checklist_steps || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);

    if (!cleanTitle || steps.length === 0) {
      res.status(400).json({ error: 'Judul SOP dan minimal 1 langkah checklist wajib diisi.' });
      return;
    }

    const scopedCompanyId = company_id ? Number(company_id) : null;
    if (scopedCompanyId && !canUserAccessRecord(req.authUser!, scopedCompanyId)) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }
    if (scopedCompanyId === null && !req.authUser!.is_holding_scope) {
      res.status(403).json({ error: 'Only holding-scope administrators can create group-wide SOPs.' });
      return;
    }

    const code = String(sop_code || `SOP-OIMS-${crypto.randomBytes(2).toString('hex').toUpperCase()}`)
      .trim()
      .toUpperCase();

    try {
      const info = db
        .prepare(`
          INSERT INTO enterprise_sops (
            sop_code, company_id, title, category, version, mandatory_module, checklist_json, is_mandatory, is_active, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          code,
          scopedCompanyId,
          cleanTitle,
          cleanCat,
          String(version || '1.0').trim(),
          cleanMod,
          JSON.stringify(steps),
          is_mandatory !== false ? 1 : 0,
          is_active !== false ? 1 : 0,
          req.authUser!.id
        );
      const id = Number(info.lastInsertRowid);
      logAudit(req, 'ENTERPRISE_SOP_CREATED', 'governance', 'enterprise_sop', id, { sop_code: code, title: cleanTitle });
      res.status(201).json({ id, sop_code: code });
    } catch {
      res.status(409).json({ error: 'Kode SOP sudah terdaftar.' });
    }
  });

  app.put('/api/governance/sops/:id', authenticate, requirePermission('governance.manage'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM enterprise_sops WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'SOP not found.' });
      return;
    }
    if (existing.company_id && !canUserAccessRecord(req.authUser!, Number(existing.company_id))) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }

    const { title, category, version, mandatory_module, checklist_steps, is_mandatory, is_active } = req.body || {};
    const steps = checklist_steps !== undefined
      ? (Array.isArray(checklist_steps)
          ? checklist_steps.map((s) => String(s).trim()).filter(Boolean)
          : String(checklist_steps || '')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean))
      : JSON.parse(existing.checklist_json || '[]');

    db.prepare(`
      UPDATE enterprise_sops SET
        title = ?,
        category = ?,
        version = ?,
        mandatory_module = ?,
        checklist_json = ?,
        is_mandatory = ?,
        is_active = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title ? String(title).trim() : existing.title,
      category ? String(category).trim() : existing.category,
      version ? String(version).trim() : existing.version,
      mandatory_module ? String(mandatory_module).trim() : existing.mandatory_module,
      JSON.stringify(steps),
      is_mandatory !== undefined ? (is_mandatory ? 1 : 0) : existing.is_mandatory,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      id
    );
    logAudit(req, 'ENTERPRISE_SOP_UPDATED', 'governance', 'enterprise_sop', id, { sop_code: existing.sop_code });
    res.json({ ok: true });
  });

  app.post('/api/governance/sop-executions', authenticate, (req: AuthenticatedRequest, res) => {
    const perms = req.authUser!.permissions || [];
    const allowed =
      req.authUser!.role_code === 'super_admin' ||
      perms.includes('governance.view') ||
      perms.includes('governance.manage') ||
      perms.includes('assets.edit') ||
      perms.includes('opname.verify');
    if (!allowed) {
      res.status(403).json({ error: 'Permission required to submit SOP checklist execution.' });
      return;
    }

    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const { sop_id, asset_id, module_context, checklist_results, deviation_notes } = req.body || {};
    const sop = db.prepare('SELECT * FROM enterprise_sops WHERE id = ?').get(Number(sop_id)) as Record<string, any> | undefined;
    if (!sop || !Number(sop.is_active)) {
      res.status(404).json({ error: 'Active SOP definition not found.' });
      return;
    }

    let companyId = req.body?.company_id ? Number(req.body.company_id) : (scope.activeCompanyId || scope.allowedCompanyIds[0] || 1);
    let resolvedAssetId: number | null = null;
    let divisionId: number | null = null;

    if (asset_id) {
      const asset = db
        .prepare('SELECT id, company_id, division_id FROM assets WHERE id = ? AND deleted_at IS NULL')
        .get(Number(asset_id)) as { id: number; company_id: number; division_id: number } | undefined;
      if (!asset) {
        res.status(404).json({ error: 'Linked asset not found.' });
        return;
      }
      resolvedAssetId = asset.id;
      companyId = asset.company_id;
      divisionId = asset.division_id;
    }

    if (!canUserAccessRecord(req.authUser!, companyId, divisionId)) {
      res.status(403).json({ error: 'Cross-company/division access denied.' });
      return;
    }

    const rawResults = Array.isArray(checklist_results) ? checklist_results : [];
    const normalizedResults = rawResults.map((item: any) => ({
      step: String(item.step || ''),
      checked: Boolean(item.checked),
      notes: item.notes ? String(item.notes) : '',
    }));

    const hasUnchecked = normalizedResults.length === 0 || normalizedResults.some((r) => !r.checked);
    const complianceStatus = hasUnchecked ? 'Deviation' : 'Compliant';
    if (complianceStatus === 'Deviation' && !String(deviation_notes || '').trim()) {
      res.status(400).json({ error: 'Catatan deviasi wajib diisi jika ada checklist SOP yang belum terpenuhi.' });
      return;
    }

    const execCode = `SOPX-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const modCtx = String(module_context || sop.mandatory_module || 'governance').slice(0, 60);

    const execId = db.transaction(() => {
      const info = db
        .prepare(`
          INSERT INTO sop_executions (
            execution_code, sop_id, company_id, asset_id, module_context, executed_by_user_id,
            checklist_results_json, compliance_status, deviation_notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          execCode,
          sop.id,
          companyId,
          resolvedAssetId,
          modCtx,
          req.authUser!.id,
          JSON.stringify(normalizedResults),
          complianceStatus,
          deviation_notes ? String(deviation_notes).trim() : null
        );
      const id = Number(info.lastInsertRowid);

      if (resolvedAssetId) {
        appendAssetEvent({
          companyId,
          assetId: resolvedAssetId,
          eventType: 'SOP_EXECUTED',
          actorUserId: req.authUser!.id,
          actorUsername: req.authUser!.username,
          referenceType: 'sop_execution',
          referenceId: execCode,
          reason: `${sop.sop_code} (${complianceStatus})${deviation_notes ? `: ${String(deviation_notes).trim()}` : ''}`,
          previousState: null,
          newState: {
            execution_code: execCode,
            sop_code: sop.sop_code,
            compliance_status: complianceStatus,
          },
        });
      }

      return id;
    })();

    syncAutomatedNotifications();
    logAudit(req, 'SOP_EXECUTION_RECORDED', 'governance', 'sop_execution', execId, {
      execution_code: execCode,
      sop_code: sop.sop_code,
      compliance_status: complianceStatus,
      asset_id: resolvedAssetId,
    });
    res.status(201).json({ id: execId, execution_code: execCode, compliance_status: complianceStatus });
  });

  // 3. System Integration Governance (Zero Google Cloud/Workspace)
  app.get('/api/governance/integrations', authenticate, requirePermission('governance.view'), (req: AuthenticatedRequest, res) => {
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const compScope = buildCompanyScopeSql(scope, 'ic.company_id');
    const connectors = db
      .prepare(`
        SELECT ic.*, c.name as company_name, c.code as company_code
        FROM integration_connectors ic
        LEFT JOIN companies c ON c.id = ic.company_id
        WHERE (ic.company_id IS NULL OR ${compScope.clause})
        ORDER BY ic.id ASC
      `)
      .all(...compScope.params) as Record<string, any>[];

    const safeConnectors = connectors.map((conn) => ({
      ...conn,
      env_secret_configured: conn.env_secret_ref ? Boolean(process.env[String(conn.env_secret_ref)]?.trim()) : false,
    }));

    const logScope = buildCompanyScopeSql(scope, 'il.company_id');
    const logs = db
      .prepare(`
        SELECT il.*, ic.connector_code, ic.name as connector_name, u.username as triggered_by_username
        FROM integration_logs il
        JOIN integration_connectors ic ON ic.id = il.connector_id
        LEFT JOIN users u ON u.id = il.triggered_by_user_id
        WHERE (il.company_id IS NULL OR ${logScope.clause})
        ORDER BY il.id DESC
        LIMIT 80
      `)
      .all(...logScope.params);

    res.json({ connectors: safeConnectors, logs });
  });

  app.post('/api/governance/integrations', authenticate, requirePermission('governance.manage'), (req: AuthenticatedRequest, res) => {
    const { connector_code, company_id, name, connector_type, endpoint_url, auth_scheme, env_secret_ref, data_classification, is_enabled } = req.body || {};

    if (!name || !endpoint_url || !connector_type) {
      res.status(400).json({ error: 'Nama konektor, tipe, dan endpoint URL wajib diisi.' });
      return;
    }

    const urlCheck = validateExternalEndpointUrl(String(endpoint_url));
    if (!urlCheck.valid) {
      res.status(400).json({ error: urlCheck.reason || 'Invalid endpoint URL.' });
      return;
    }

    const cleanSecretRef = env_secret_ref ? String(env_secret_ref).trim().toUpperCase() : null;
    if (cleanSecretRef && !/^[A-Z0-9_]{2,80}$/.test(cleanSecretRef)) {
      res.status(400).json({ error: 'Referensi secret env var harus berupa nama variabel environment (huruf kapital, angka, underscore) — jangan masukkan nilai secret asli.' });
      return;
    }

    const scopedCompanyId = company_id ? Number(company_id) : null;
    if (scopedCompanyId && !canUserAccessRecord(req.authUser!, scopedCompanyId)) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }
    if (scopedCompanyId === null && !req.authUser!.is_holding_scope) {
      res.status(403).json({ error: 'Only holding-scope administrators can register global connectors.' });
      return;
    }

    const code = String(connector_code || `INT-${crypto.randomBytes(2).toString('hex').toUpperCase()}`).trim().toUpperCase();
    try {
      const info = db
        .prepare(`
          INSERT INTO integration_connectors (
            connector_code, company_id, name, connector_type, endpoint_url, auth_scheme, env_secret_ref, data_classification, is_enabled, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          code,
          scopedCompanyId,
          String(name).trim(),
          String(connector_type),
          urlCheck.parsedUrl!.toString(),
          String(auth_scheme || 'Bearer Env'),
          cleanSecretRef,
          String(data_classification || 'Internal'),
          is_enabled ? 1 : 0,
          req.authUser!.id
        );
      const id = Number(info.lastInsertRowid);
      logAudit(req, 'INTEGRATION_CONNECTOR_CREATED', 'governance', 'integration_connector', id, {
        connector_code: code,
        connector_type,
        data_classification,
      });
      res.status(201).json({ id, connector_code: code });
    } catch {
      res.status(409).json({ error: 'Kode konektor sudah digunakan.' });
    }
  });

  app.put('/api/governance/integrations/:id', authenticate, requirePermission('governance.manage'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM integration_connectors WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Integration connector not found.' });
      return;
    }
    if (existing.company_id && !canUserAccessRecord(req.authUser!, Number(existing.company_id))) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }

    const endpointUrl = req.body?.endpoint_url ? String(req.body.endpoint_url) : String(existing.endpoint_url);
    const urlCheck = validateExternalEndpointUrl(endpointUrl);
    if (!urlCheck.valid) {
      res.status(400).json({ error: urlCheck.reason || 'Invalid endpoint URL.' });
      return;
    }

    const cleanSecretRef = req.body?.env_secret_ref !== undefined
      ? (req.body.env_secret_ref ? String(req.body.env_secret_ref).trim().toUpperCase() : null)
      : existing.env_secret_ref;

    if (cleanSecretRef && !/^[A-Z0-9_]{2,80}$/.test(cleanSecretRef)) {
      res.status(400).json({ error: 'Referensi secret env var harus berupa nama variabel environment (A-Z, 0-9, _).' });
      return;
    }

    const isEnabled = req.body?.is_enabled !== undefined ? (req.body.is_enabled ? 1 : 0) : Number(existing.is_enabled);

    db.prepare(`
      UPDATE integration_connectors SET
        name = ?,
        endpoint_url = ?,
        auth_scheme = ?,
        env_secret_ref = ?,
        data_classification = ?,
        is_enabled = ?,
        updated_by = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      req.body?.name ? String(req.body.name).trim() : existing.name,
      urlCheck.parsedUrl!.toString(),
      req.body?.auth_scheme ? String(req.body.auth_scheme) : existing.auth_scheme,
      cleanSecretRef,
      req.body?.data_classification ? String(req.body.data_classification) : existing.data_classification,
      isEnabled,
      req.authUser!.id,
      id
    );

    logAudit(req, 'INTEGRATION_CONNECTOR_UPDATED', 'governance', 'integration_connector', id, {
      connector_code: existing.connector_code,
      is_enabled: isEnabled,
    });
    res.json({ ok: true });
  });

  app.post('/api/governance/integrations/:id/test-dispatch', authenticate, requirePermission('governance.manage'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const connector = db.prepare('SELECT * FROM integration_connectors WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!connector) {
      res.status(404).json({ error: 'Integration connector not found.' });
      return;
    }
    if (connector.company_id && !canUserAccessRecord(req.authUser!, Number(connector.company_id))) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }

    const dryRun = req.body?.dry_run !== false;
    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    if (!Number(connector.is_enabled)) {
      db.prepare(`
        INSERT INTO integration_logs (connector_id, company_id, direction, status, http_status, request_summary, response_summary, triggered_by_user_id)
        VALUES (?, ?, ?, 'Blocked', 403, ?, ?, ?)
      `).run(
        connector.id,
        connector.company_id ?? scope.activeCompanyId ?? null,
        dryRun ? 'dry_run' : 'outbound',
        `Connector ${connector.connector_code} dispatch attempted while disabled`,
        'Blocked by Integration Kill Switch (is_enabled = 0)',
        req.authUser!.id
      );
      db.prepare("UPDATE integration_connectors SET last_test_status = 'Blocked (Disabled)', last_tested_at = datetime('now') WHERE id = ?").run(connector.id);
      res.status(403).json({ error: `Konektor ${connector.connector_code} sedang dinonaktifkan (Kill Switch aktif).` });
      return;
    }

    const urlCheck = validateExternalEndpointUrl(String(connector.endpoint_url));
    if (!urlCheck.valid) {
      db.prepare(`
        INSERT INTO integration_logs (connector_id, company_id, direction, status, http_status, request_summary, response_summary, triggered_by_user_id)
        VALUES (?, ?, ?, 'Blocked', 400, ?, ?, ?)
      `).run(
        connector.id,
        connector.company_id ?? scope.activeCompanyId ?? null,
        dryRun ? 'dry_run' : 'outbound',
        String(connector.endpoint_url),
        urlCheck.reason || 'Blocked by SSRF guard',
        req.authUser!.id
      );
      res.status(400).json({ error: urlCheck.reason || 'Endpoint blocked by SSRF policy.' });
      return;
    }

    const assetScope = buildAssetScopeSql(scope, 'a');
    const summaryCount = (
      db.prepare(`SELECT COUNT(*) as c FROM assets a WHERE a.deleted_at IS NULL AND ${assetScope.clause}`).get(...assetScope.params) as { c: number }
    ).c;

    const samplePayload = {
      source: 'KIDECO-OIMS',
      connector_code: connector.connector_code,
      connector_type: connector.connector_type,
      classification: connector.data_classification,
      timestamp: new Date().toISOString(),
      scoped_asset_count: summaryCount,
      dry_run: dryRun,
    };

    if (dryRun) {
      db.prepare(`
        INSERT INTO integration_logs (connector_id, company_id, direction, status, http_status, request_summary, response_summary, triggered_by_user_id)
        VALUES (?, ?, 'dry_run', 'DryRun', 200, ?, ?, ?)
      `).run(
        connector.id,
        connector.company_id ?? scope.activeCompanyId ?? null,
        JSON.stringify(samplePayload),
        `Dry-run payload validated (target: ${urlCheck.parsedUrl!.origin}, auth: ${connector.auth_scheme}, env_ref: ${connector.env_secret_ref || 'none'})`,
        req.authUser!.id
      );
      db.prepare("UPDATE integration_connectors SET last_test_status = 'DryRun OK', last_tested_at = datetime('now') WHERE id = ?").run(connector.id);
      logAudit(req, 'INTEGRATION_DRY_RUN', 'governance', 'integration_connector', connector.id, {
        connector_code: connector.connector_code,
      });
      res.json({ ok: true, mode: 'dry_run', payload: samplePayload });
      return;
    }

    // Live outbound HTTP dispatch with strict timeout & env secret resolution
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'KIDECO-OIMS-Governance/3.0',
    };
    const secretVal = connector.env_secret_ref ? process.env[String(connector.env_secret_ref)]?.trim() : '';
    if (connector.auth_scheme === 'Bearer Env') {
      if (!secretVal) {
        res.status(400).json({ error: `Environment variable ${connector.env_secret_ref || '(unset)'} belum tersedia di server.` });
        return;
      }
      headers.Authorization = `Bearer ${secretVal}`;
    } else if (connector.auth_scheme === 'HMAC Header') {
      if (!secretVal) {
        res.status(400).json({ error: `Environment variable ${connector.env_secret_ref || '(unset)'} belum tersedia di server.` });
        return;
      }
      headers['X-OIMS-Signature'] = crypto.createHmac('sha256', secretVal).update(JSON.stringify(samplePayload)).digest('hex');
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const upstream = await fetch(urlCheck.parsedUrl!.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(samplePayload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const statusText = upstream.ok ? 'Success' : 'Failed';
      db.prepare(`
        INSERT INTO integration_logs (connector_id, company_id, direction, status, http_status, request_summary, response_summary, triggered_by_user_id)
        VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?)
      `).run(
        connector.id,
        connector.company_id ?? scope.activeCompanyId ?? null,
        statusText,
        upstream.status,
        `POST ${urlCheck.parsedUrl!.origin}${urlCheck.parsedUrl!.pathname}`,
        `HTTP ${upstream.status} ${upstream.statusText}`,
        req.authUser!.id
      );
      db.prepare("UPDATE integration_connectors SET last_test_status = ?, last_tested_at = datetime('now') WHERE id = ?").run(
        `HTTP ${upstream.status}`,
        connector.id
      );
      logAudit(req, 'INTEGRATION_LIVE_DISPATCH', 'governance', 'integration_connector', connector.id, {
        connector_code: connector.connector_code,
        http_status: upstream.status,
      });
      res.status(upstream.ok ? 200 : 502).json({ ok: upstream.ok, httpStatus: upstream.status });
    } catch (err: any) {
      db.prepare(`
        INSERT INTO integration_logs (connector_id, company_id, direction, status, http_status, request_summary, response_summary, triggered_by_user_id)
        VALUES (?, ?, 'outbound', 'Failed', NULL, ?, ?, ?)
      `).run(
        connector.id,
        connector.company_id ?? scope.activeCompanyId ?? null,
        `POST ${urlCheck.parsedUrl!.origin}${urlCheck.parsedUrl!.pathname}`,
        String(err?.message || 'Network timeout / connection failed').slice(0, 300),
        req.authUser!.id
      );
      db.prepare("UPDATE integration_connectors SET last_test_status = 'Failed', last_tested_at = datetime('now') WHERE id = ?").run(connector.id);
      res.status(502).json({ error: `Dispatch gagal: ${err?.message || 'Network error'}` });
    }
  });

  // 4. Smart Asset Identification (Poin 55 - Optional, Opt-In, Human-in-the-Loop, Admin Kill Switch)
  app.get('/api/ai/status', authenticate, (_req, res) => {
    res.json(getAiSettingsState());
  });

  app.put('/api/ai/settings', authenticate, requirePermission('settings.manage'), (req: AuthenticatedRequest, res) => {
    const smartAiEnabled = req.body?.smart_ai_enabled !== undefined ? Boolean(req.body.smart_ai_enabled) : undefined;
    const smartAiExternalAllowed = req.body?.smart_ai_external_allowed !== undefined ? Boolean(req.body.smart_ai_external_allowed) : undefined;

    const upsert = db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, category, updated_at, updated_by)
      VALUES (?, ?, 'ai_governance', datetime('now'), ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now'), updated_by = excluded.updated_by
    `);

    const tx = db.transaction(() => {
      if (smartAiEnabled !== undefined) {
        upsert.run('smart_ai_enabled', smartAiEnabled ? 'true' : 'false', req.authUser!.id);
      }
      if (smartAiExternalAllowed !== undefined) {
        upsert.run('smart_ai_external_allowed', smartAiExternalAllowed ? 'true' : 'false', req.authUser!.id);
      }
    });
    tx();

    const current = getAiSettingsState();
    logAudit(req, 'AI_SETTINGS_UPDATED', 'ai', 'system_settings', 'smart_ai', current);
    res.json({ ok: true, ...current });
  });

  app.get('/api/ai/identifications', authenticate, (req: AuthenticatedRequest, res) => {
    const perms = req.authUser!.permissions || [];
    const allowed =
      req.authUser!.role_code === 'super_admin' ||
      perms.includes('governance.view') ||
      perms.includes('ai.identify') ||
      perms.includes('ai.verify') ||
      perms.includes('assets.view');
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied.' });
      return;
    }

    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const compScope = buildCompanyScopeSql(scope, 'ai.company_id');
    const rows = db
      .prepare(`
        SELECT ai.*, a.asset_code, a.asset_name, a.serial_number as master_serial_number,
               a.brand as master_brand, a.model as master_model, a.specification as master_specification,
               a.category_id as master_category_id,
               c.name as company_name, cat.name as recommended_category_name,
               ru.full_name as requested_by_name, vu.full_name as verified_by_name
        FROM ai_asset_identifications ai
        JOIN companies c ON c.id = ai.company_id
        LEFT JOIN assets a ON a.id = ai.asset_id
        LEFT JOIN categories cat ON cat.id = ai.recommended_category_id
        LEFT JOIN users ru ON ru.id = ai.requested_by_user_id
        LEFT JOIN users vu ON vu.id = ai.verified_by_user_id
        WHERE ${compScope.clause}
        ORDER BY ai.id DESC
        LIMIT 100
      `)
      .all(...compScope.params) as Record<string, any>[];

    res.json({
      identifications: rows,
      aiStatus: getAiSettingsState(),
    });
  });

  app.post('/api/ai/identify', authenticate, requirePermission('ai.identify'), async (req: AuthenticatedRequest, res) => {
    const aiState = getAiSettingsState();
    if (!aiState.smart_ai_enabled) {
      res.status(403).json({
        error: 'Modul Smart Asset Identification dinonaktifkan oleh Administrator (Kill Switch aktif).',
        code: 'AI_KILL_SWITCH_ACTIVE',
      });
      return;
    }

    const scope = resolveRequestOrgScope(req, res);
    if (!scope) return;

    const { asset_id, photo_url, analysis_mode, external_consent_confirmed, hint_text } = req.body || {};
    const mode: 'local_dedup_similarity' | 'gemini_vision_ocr' =
      analysis_mode === 'gemini_vision_ocr' ? 'gemini_vision_ocr' : 'local_dedup_similarity';

    if (mode === 'gemini_vision_ocr') {
      if (!aiState.smart_ai_external_allowed) {
        res.status(403).json({
          error: 'Pengiriman gambar ke layanan AI eksternal (Gemini Vision) dinonaktifkan oleh Administrator.',
          code: 'EXTERNAL_AI_DISABLED',
        });
        return;
      }
      if (external_consent_confirmed !== true) {
        res.status(400).json({
          error: 'Persetujuan eksplisit pengguna wajib dikonfirmasi sebelum mengirim foto aset ke layanan Gemini Vision eksternal.',
          code: 'EXTERNAL_AI_CONSENT_REQUIRED',
        });
        return;
      }
    }

    let companyId = req.body?.company_id ? Number(req.body.company_id) : (scope.activeCompanyId || scope.allowedCompanyIds[0] || 1);
    let targetAsset: { id: number; company_id: number; division_id: number; asset_code: string; asset_name: string; brand: string | null; model: string | null; primary_photo_url: string | null } | undefined;

    if (asset_id) {
      targetAsset = db
        .prepare('SELECT id, company_id, division_id, asset_code, asset_name, brand, model, primary_photo_url FROM assets WHERE id = ? AND deleted_at IS NULL')
        .get(Number(asset_id)) as typeof targetAsset;
      if (!targetAsset) {
        res.status(404).json({ error: 'Target asset not found.' });
        return;
      }
      if (!canUserAccessRecord(req.authUser!, targetAsset.company_id, targetAsset.division_id)) {
        res.status(403).json({ error: 'Cross-company/division access denied.' });
        return;
      }
      companyId = targetAsset.company_id;
    } else if (!canUserAccessRecord(req.authUser!, companyId)) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }

    const sourcePhotoUrl = String(photo_url || targetAsset?.primary_photo_url || '').trim();
    if (!sourcePhotoUrl) {
      res.status(400).json({ error: 'Unggah foto aset atau pilih aset yang memiliki foto untuk dianalisis.' });
      return;
    }

    let filePayload;
    try {
      filePayload = readLocalAssetPhotoWithHash(sourcePhotoUrl);
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: err.message || 'Failed to read local photo.' });
      return;
    }

    const duplicates = findCrossAssetPhotoDuplicates({
      sourcePhotoUrl,
      photoSha256: filePayload.sha256,
      excludeAssetId: targetAsset?.id ?? null,
      allowedCompanyIds: scope.allowedCompanyIds,
      isHoldingScope: scope.isHoldingScope,
    });

    const categories = db.prepare('SELECT id, code, name FROM categories ORDER BY id ASC').all() as {
      id: number;
      code: string;
      name: string;
    }[];

    let extractedSerial: string | null = null;
    let extractedLabel: string | null = null;
    let extractedBrand: string | null = null;
    let extractedModel: string | null = null;
    let extractedSpecs: string | null = null;
    let recommendedCategoryId: number | null = null;
    let modelUsed = 'local-sha256-matcher-v1';
    let rawAiJson: string | null = null;
    let notes: string | null = null;

    if (mode === 'gemini_vision_ocr') {
      try {
        const ocr = await runGeminiVisionAssetOcr({
          buffer: filePayload.buffer,
          mimeType: filePayload.mimeType,
          categories,
        });
        modelUsed = ocr.modelUsed;
        extractedSerial = ocr.serial_number;
        extractedLabel = ocr.asset_label;
        extractedBrand = ocr.brand;
        extractedModel = ocr.model;
        extractedSpecs = ocr.specifications;
        notes = ocr.confidence_notes;
        rawAiJson = ocr.raw_json;

        if (ocr.recommended_category_code) {
          const matchedCat = categories.find(
            (c) =>
              c.code.toLowerCase() === ocr.recommended_category_code!.toLowerCase() ||
              c.name.toLowerCase() === ocr.recommended_category_code!.toLowerCase()
          );
          if (matchedCat) recommendedCategoryId = matchedCat.id;
        }
      } catch (err: any) {
        res.status(err.statusCode || 502).json({ error: err.message || 'Gemini Vision OCR error.' });
        return;
      }
    }

    const combinedHints = [
      hint_text || '',
      extractedSerial || '',
      extractedLabel || '',
      extractedBrand || '',
      extractedModel || '',
      extractedSpecs || '',
      targetAsset?.asset_name || '',
      targetAsset?.brand || '',
      targetAsset?.model || '',
    ].join(' ');

    const localSim = findSimilarAssetsAndCategory({
      hintText: combinedHints,
      sourcePhotoUrl,
      companyIds: scope.allowedCompanyIds,
      isHoldingScope: scope.isHoldingScope,
      excludeAssetId: targetAsset?.id ?? null,
    });

    if (!recommendedCategoryId) {
      recommendedCategoryId = localSim.recommendedCategoryId;
    }

    const identCode = `AIID-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const info = db
      .prepare(`
        INSERT INTO ai_asset_identifications (
          identification_code, company_id, asset_id, source_photo_url, photo_sha256, analysis_mode,
          external_consent_confirmed, model_used, extracted_serial_number, extracted_label,
          extracted_brand, extracted_model, extracted_specs, recommended_category_id,
          duplicate_matches_json, similarity_matches_json, raw_ai_json, verification_status,
          requested_by_user_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Review', ?, ?)
      `)
      .run(
        identCode,
        companyId,
        targetAsset?.id ?? null,
        sourcePhotoUrl,
        filePayload.sha256,
        mode,
        mode === 'gemini_vision_ocr' ? 1 : 0,
        modelUsed,
        extractedSerial,
        extractedLabel,
        extractedBrand,
        extractedModel,
        extractedSpecs,
        recommendedCategoryId,
        JSON.stringify(duplicates),
        JSON.stringify(localSim.similarityMatches),
        rawAiJson,
        req.authUser!.id,
        notes || (mode === 'local_dedup_similarity' ? 'Analisis lokal SHA-256 & kemiripan metadata selesai (Pending Review).' : null)
      );

    const id = Number(info.lastInsertRowid);
    const created = db
      .prepare(`
        SELECT ai.*, cat.name as recommended_category_name, a.asset_code, a.asset_name
        FROM ai_asset_identifications ai
        LEFT JOIN categories cat ON cat.id = ai.recommended_category_id
        LEFT JOIN assets a ON a.id = ai.asset_id
        WHERE ai.id = ?
      `)
      .get(id);

    logAudit(req, 'AI_ASSET_IDENTIFIED', 'ai', 'ai_asset_identification', id, {
      identification_code: identCode,
      analysis_mode: mode,
      duplicate_count: duplicates.length,
      similarity_count: localSim.similarityMatches.length,
      auto_master_modified: false,
    });

    res.status(201).json({ identification: created });
  });

  app.put('/api/ai/identifications/:id/verify', authenticate, requirePermission('ai.verify'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const record = db.prepare('SELECT * FROM ai_asset_identifications WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!record) {
      res.status(404).json({ error: 'AI identification record not found.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, Number(record.company_id))) {
      res.status(403).json({ error: 'Cross-company access denied.' });
      return;
    }

    const decision = String(req.body?.decision || '');
    const notes = req.body?.notes ? String(req.body.notes).trim() : record.notes;

    if (!['Accept', 'Reject', 'Apply'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be Accept, Reject, or Apply.' });
      return;
    }

    if (decision === 'Accept' || decision === 'Reject') {
      const nextStatus = decision === 'Accept' ? 'Accepted' : 'Rejected';
      db.prepare(`
        UPDATE ai_asset_identifications SET
          verification_status = ?,
          verified_by_user_id = ?,
          verified_at = datetime('now'),
          notes = ?
        WHERE id = ?
      `).run(nextStatus, req.authUser!.id, notes || null, id);

      logAudit(req, `AI_RECOMMENDATION_${nextStatus.toUpperCase()}`, 'ai', 'ai_asset_identification', id, {
        identification_code: record.identification_code,
      });
      res.json({ ok: true, verification_status: nextStatus });
      return;
    }

    // decision === 'Apply' -> Explicit Human-in-the-Loop confirmation + assets.edit permission required
    const perms = req.authUser!.permissions || [];
    if (req.authUser!.role_code !== 'super_admin' && !perms.includes('assets.edit')) {
      res.status(403).json({ error: 'Permission denied: requires assets.edit to apply AI recommendation to master asset.' });
      return;
    }
    if (req.body?.confirm_apply !== true) {
      res.status(400).json({ error: 'Konfirmasi eksplisit petugas (confirm_apply: true) wajib sebelum memperbarui master aset.' });
      return;
    }

    const targetAssetId = req.body?.asset_id ? Number(req.body.asset_id) : (record.asset_id ? Number(record.asset_id) : 0);
    if (!targetAssetId) {
      res.status(400).json({ error: 'Target asset_id wajib dipilih sebelum menerapkan rekomendasi AI ke master aset.' });
      return;
    }

    const asset = db
      .prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL')
      .get(targetAssetId) as Record<string, any> | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Target asset not found.' });
      return;
    }
    if (!canUserAccessRecord(req.authUser!, Number(asset.company_id), Number(asset.division_id))) {
      res.status(403).json({ error: 'Cross-company/division access denied.' });
      return;
    }

    const allowedFields = new Set(['serial_number', 'brand', 'model', 'specification', 'category_id']);
    const selectedFields = Array.isArray(req.body?.apply_fields)
      ? (req.body.apply_fields as string[]).filter((f) => allowedFields.has(f))
      : [];

    const updates: Record<string, unknown> = {};
    if (selectedFields.includes('serial_number') && (req.body?.override_values?.serial_number || record.extracted_serial_number)) {
      updates.serial_number = String(req.body?.override_values?.serial_number || record.extracted_serial_number).trim();
    }
    if (selectedFields.includes('brand') && (req.body?.override_values?.brand || record.extracted_brand)) {
      updates.brand = String(req.body?.override_values?.brand || record.extracted_brand).trim();
    }
    if (selectedFields.includes('model') && (req.body?.override_values?.model || record.extracted_model)) {
      updates.model = String(req.body?.override_values?.model || record.extracted_model).trim();
    }
    if (selectedFields.includes('specification') && (req.body?.override_values?.specification || record.extracted_specs)) {
      updates.specification = String(req.body?.override_values?.specification || record.extracted_specs).trim();
    }
    if (selectedFields.includes('category_id') && (req.body?.override_values?.category_id || record.recommended_category_id)) {
      updates.category_id = Number(req.body?.override_values?.category_id || record.recommended_category_id);
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu field hasil ekstraksi yang valid untuk diterapkan.' });
      return;
    }

    const tx = db.transaction(() => {
      const prevSnapshot = getAssetStateSnapshot(targetAssetId);
      const setClauses = Object.keys(updates).map((col) => `${col} = ?`);
      setClauses.push("updated_at = datetime('now')", 'updated_by = ?');
      const values = [...Object.values(updates), req.authUser!.id, targetAssetId];

      db.prepare(`UPDATE assets SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

      db.prepare(`
        UPDATE ai_asset_identifications SET
          asset_id = ?,
          verification_status = 'Applied',
          applied_fields_json = ?,
          verified_by_user_id = ?,
          verified_at = datetime('now'),
          notes = ?
        WHERE id = ?
      `).run(targetAssetId, JSON.stringify(updates), req.authUser!.id, notes || null, id);

      const newSnapshot = getAssetStateSnapshot(targetAssetId);
      appendAssetEvent({
        companyId: Number(asset.company_id),
        assetId: targetAssetId,
        eventType: 'ASSET_UPDATED',
        actorUserId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        referenceType: 'ai_identification',
        referenceId: record.identification_code,
        reason: `Human-confirmed AI recommendation applied (${Object.keys(updates).join(', ')})`,
        previousState: prevSnapshot,
        newState: { ...newSnapshot, applied_from_ai: updates },
      });
    });

    tx();
    logAudit(req, 'AI_RECOMMENDATION_APPLIED', 'ai', 'asset', targetAssetId, {
      identification_code: record.identification_code,
      applied_fields: Object.keys(updates),
    });
    res.json({ ok: true, verification_status: 'Applied', applied_fields: Object.keys(updates) });
  });

  // =========================================================================
  // SYSTEM SETTINGS, AUDIT TRAIL, BRANDING, BACKUP / RESTORE & MYSQL EXPORT
  // =========================================================================
  app.get('/api/system/audit-trail', authenticate, requirePermission('settings.view'), (req, res) => {
    const moduleFilter = String(req.query.module || '').trim();
    const search = String(req.query.search || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const limit = Math.min(500, Math.max(10, Number(req.query.limit || 200)));

    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    if (moduleFilter && moduleFilter !== 'all') {
      where.push('l.module = ?');
      params.push(moduleFilter);
    }
    if (dateFrom) {
      where.push('substr(l.created_at, 1, 10) >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push('substr(l.created_at, 1, 10) <= ?');
      params.push(dateTo);
    }
    if (search) {
      const q = `%${search.toLowerCase()}%`;
      where.push(`(
        lower(COALESCE(l.username, '')) LIKE ?
        OR lower(COALESCE(u.full_name, '')) LIKE ?
        OR lower(l.action) LIKE ?
        OR lower(l.module) LIKE ?
        OR lower(COALESCE(l.entity_type, '')) LIKE ?
        OR lower(COALESCE(l.entity_id, '')) LIKE ?
        OR lower(COALESCE(l.details_json, '')) LIKE ?
        OR lower(COALESCE(l.ip_address, '')) LIKE ?
      )`);
      params.push(q, q, q, q, q, q, q, q);
    }

    const logs = db
      .prepare(`
        SELECT l.*, u.full_name as actor_full_name, u.email as actor_email
        FROM audit_logs l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ?
      `)
      .all(...params, limit);

    const summary = db
      .prepare(`
        SELECT
          COUNT(*) as totalEvents,
          SUM(CASE WHEN action = 'LOGIN_SUCCESS' THEN 1 ELSE 0 END) as loginSuccessCount,
          SUM(CASE WHEN action IN ('LOGIN_FAILED', 'LOGIN_RATE_LIMITED') THEN 1 ELSE 0 END) as loginFailedCount,
          SUM(CASE WHEN module IN ('assets', 'movements', 'maintenance', 'opname') THEN 1 ELSE 0 END) as inventoryEventCount
        FROM audit_logs
      `)
      .get() as {
        totalEvents: number;
        loginSuccessCount: number;
        loginFailedCount: number;
        inventoryEventCount: number;
      };

    res.json({ logs, summary });
  });

  app.get('/api/system/settings', authenticate, requirePermission('settings.view'), (_req, res) => {
    const settings = db.prepare('SELECT * FROM system_settings ORDER BY category, setting_key').all();
    res.json({ settings });
  });

  app.put('/api/system/settings', authenticate, requirePermission('settings.manage'), (req: AuthenticatedRequest, res) => {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const upsert = db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, category, updated_at, updated_by)
      VALUES (?, ?, ?, datetime('now'), ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now'), updated_by = excluded.updated_by
    `);
    const tx = db.transaction(() => {
      for (const e of entries) {
        upsert.run(String(e.setting_key), String(e.setting_value), String(e.category || 'general'), req.authUser!.id);
      }
    });
    tx();
    syncAutomatedNotifications();
    logAudit(req, 'SYSTEM_SETTINGS_UPDATED', 'settings', 'system_settings', 'batch');
    res.json({ ok: true });
  });

  app.post('/api/system/logo', authenticate, requirePermission('settings.manage'), upload.single('logo'), (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Logo file required' });
      return;
    }
    const url = `/uploads/${req.file.filename}`;
    db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, category, updated_at, updated_by)
      VALUES ('company_logo_url', ?, 'branding', datetime('now'), ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now'), updated_by = excluded.updated_by
    `).run(url, req.authUser!.id);
    logAudit(req, 'LOGO_UPDATED', 'settings', 'branding', 'company_logo_url');
    res.json({ logoUrl: url });
  });

  app.get('/api/system/oims-sql', authenticate, requirePermission('settings.view'), (req: AuthenticatedRequest, res) => {
    const sqlText = generateMysqlDump();
    logAudit(req, 'MYSQL_SQL_EXPORTED', 'settings', 'database', 'oims.sql');
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="oims.sql"');
    res.send(sqlText);
  });

  app.get('/api/system/install-php', authenticate, requirePermission('settings.view'), (req: AuthenticatedRequest, res) => {
    const installPhpPath = path.resolve(process.cwd(), 'database', 'install.php');
    if (!fs.existsSync(installPhpPath)) {
      res.status(404).json({ error: 'install.php script not found' });
      return;
    }
    logAudit(req, 'INSTALL_PHP_EXPORTED', 'settings', 'database', 'install.php');
    res.setHeader('Content-Type', 'application/x-httpd-php; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="install.php"');
    res.sendFile(installPhpPath);
  });

  app.get('/api/system/backup', authenticate, requirePermission('settings.backup'), (req: AuthenticatedRequest, res) => {
    const snapshot: Record<string, unknown[]> = {};
    for (const t of BACKUP_ORDERED_TABLES) {
      snapshot[t] = db.prepare(`SELECT * FROM ${t}`).all();
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 'OIMS-2027.4-FASE4',
      tables: snapshot,
    };
    logAudit(req, 'DATABASE_BACKUP_EXPORTED', 'settings', 'database', 'json_snapshot');
    res.json(payload);
  });

  app.post('/api/system/restore', authenticate, requirePermission('settings.backup'), (req: AuthenticatedRequest, res) => {
    const tables = req.body?.tables;
    if (!tables || typeof tables !== 'object') {
      res.status(400).json({ error: 'Invalid backup snapshot format' });
      return;
    }

    try {
      const tx = db.transaction(() => {
        db.pragma('foreign_keys = OFF');
        for (const t of [...BACKUP_ORDERED_TABLES].reverse()) {
          if (Array.isArray(tables[t])) {
            db.prepare(`DELETE FROM ${t}`).run();
          }
        }
        for (const t of BACKUP_ORDERED_TABLES) {
          const rows = tables[t];
          if (!Array.isArray(rows) || rows.length === 0) continue;
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`);
          for (const row of rows) {
            stmt.run(...cols.map((c) => row[c]));
          }
        }
        db.pragma('foreign_keys = ON');
      });
      tx();
      syncAutomatedNotifications();
      logAudit(req, 'DATABASE_RESTORED', 'settings', 'database', 'restore_snapshot');
      res.json({ ok: true });
    } catch (err: any) {
      db.pragma('foreign_keys = ON');
      res.status(400).json({ error: `Restore failed: ${err.message}` });
    }
  });

  // ---------------------------------------------------------------------------
  // FASE 4: SYSTEM HEALTH MONITORING, DR / BCP & ENTERPRISE QUALITY GATE
  // ---------------------------------------------------------------------------
  app.get('/api/ops/health', authenticate, requirePermission('ops.health.view'), (_req: AuthenticatedRequest, res) => {
    const health = collectSystemHealthReport();
    const verifications = db
      .prepare(`
        SELECT v.*, u.full_name as verified_by_name, u.username as verified_by_username
        FROM dr_backup_verifications v
        LEFT JOIN users u ON u.id = v.verified_by_user_id
        ORDER BY v.id DESC
        LIMIT 25
      `)
      .all();

    const runbooks = db
      .prepare(`
        SELECT r.*, u.full_name as updated_by_name
        FROM bcp_runbooks r
        LEFT JOIN users u ON u.id = r.updated_by
        ORDER BY r.runbook_code ASC
      `)
      .all();

    const signoffs = db
      .prepare(`
        SELECT s.*, u.full_name as signed_off_by_name, u.username as signed_off_by_username
        FROM enterprise_acceptance_signoffs s
        LEFT JOIN users u ON u.id = s.signed_off_by_user_id
        ORDER BY s.id DESC
        LIMIT 15
      `)
      .all();

    res.json({
      health,
      verifications,
      runbooks,
      signoffs,
    });
  });

  app.post('/api/ops/dr/verify-integrity', authenticate, requirePermission('ops.dr.manage'), (req: AuthenticatedRequest, res) => {
    const result = runDrIntegrityVerification();
    const code = `DR-INT-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const info = db
      .prepare(`
        INSERT INTO dr_backup_verifications (
          verification_code, verification_type, backup_version, table_count, record_count,
          status, summary, details_json, verified_by_user_id
        ) VALUES (?, 'sqlite_integrity_check', 'OIMS-2027.4-FASE4', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        code,
        result.tableCount,
        result.recordCount,
        result.status,
        result.summary,
        JSON.stringify(result),
        req.authUser!.id
      );

    logAudit(req, 'DR_INTEGRITY_VERIFIED', 'operations', 'dr_verification', String(info.lastInsertRowid), {
      verification_code: code,
      status: result.status,
      durationMs: result.durationMs,
    });

    res.status(201).json({
      verification_code: code,
      result,
    });
  });

  app.post('/api/ops/dr/verify-snapshot', authenticate, requirePermission('ops.dr.manage'), (req: AuthenticatedRequest, res) => {
    const snapshotPayload = req.body?.snapshot && typeof req.body.snapshot === 'object' ? req.body.snapshot : null;
    const result = verifySnapshotPayloadDryRun(snapshotPayload);
    const code = `DR-SNP-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const info = db
      .prepare(`
        INSERT INTO dr_backup_verifications (
          verification_code, verification_type, backup_version, snapshot_sha256,
          table_count, record_count, status, summary, details_json, verified_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        code,
        result.verificationType,
        result.backupVersion,
        result.snapshotSha256,
        result.presentTables,
        result.totalRecords,
        result.status,
        result.summary,
        JSON.stringify(result),
        req.authUser!.id
      );

    logAudit(req, 'DR_SNAPSHOT_VERIFIED', 'operations', 'dr_verification', String(info.lastInsertRowid), {
      verification_code: code,
      verificationType: result.verificationType,
      status: result.status,
      sha256: result.snapshotSha256,
    });

    res.status(result.status === 'Failed' ? 400 : 201).json({
      verification_code: code,
      result,
    });
  });

  app.post('/api/ops/bcp/runbooks/:id/drill', authenticate, requirePermission('ops.dr.manage'), (req: AuthenticatedRequest, res) => {
    const runbookId = Number(req.params.id);
    const runbook = db.prepare('SELECT * FROM bcp_runbooks WHERE id = ?').get(runbookId) as
      | { id: number; runbook_code: string; title: string }
      | undefined;
    if (!runbook) {
      res.status(404).json({ error: 'BCP runbook not found' });
      return;
    }

    const testStatus = req.body?.test_status === 'Action Required' ? 'Action Required' : 'Passed';
    const rtoMinutes = Math.max(1, Math.min(1440, Number(req.body?.rto_minutes) || 20));
    const rpoMinutes = Math.max(0, Math.min(1440, Number(req.body?.rpo_minutes) || 5));
    const drillNotes = String(req.body?.notes || '').trim() || 'Simulasi prosedur BCP berjalan sesuai target RTO/RPO.';
    const code = `BCP-DRL-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE bcp_runbooks
        SET last_tested_at = datetime('now'), last_test_status = ?, updated_by = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(testStatus, req.authUser!.id, runbookId);

      db.prepare(`
        INSERT INTO dr_backup_verifications (
          verification_code, verification_type, backup_version, table_count, record_count,
          rpo_minutes, rto_minutes, status, summary, details_json, verified_by_user_id
        ) VALUES (?, 'manual_bcp_drill', 'OIMS-2027.4-FASE4', ?, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        code,
        EXPECTED_SCHEMA_TABLES,
        rpoMinutes,
        rtoMinutes,
        testStatus === 'Passed' ? 'Passed' : 'Warning',
        `Drill ${runbook.runbook_code} (${runbook.title}): RTO ${rtoMinutes}m, RPO ${rpoMinutes}m — ${drillNotes}`,
        JSON.stringify({ runbook_code: runbook.runbook_code, testStatus, rtoMinutes, rpoMinutes, drillNotes }),
        req.authUser!.id
      );
    });
    tx();

    logAudit(req, 'BCP_DRILL_RECORDED', 'operations', 'bcp_runbook', String(runbookId), {
      runbook_code: runbook.runbook_code,
      testStatus,
      rtoMinutes,
      rpoMinutes,
    });

    res.status(201).json({ ok: true, verification_code: code, test_status: testStatus });
  });

  app.post('/api/ops/quality-gate/run', authenticate, requirePermission('ops.health.view'), (req: AuthenticatedRequest, res) => {
    const report = runEnterpriseQualityGate();
    logAudit(req, 'ENTERPRISE_QUALITY_GATE_RUN', 'operations', 'quality_gate', report.releaseTag, {
      overallStatus: report.overallStatus,
      checksPassed: report.checksPassed,
      checksTotal: report.checksTotal,
    });
    res.json(report);
  });

  app.post('/api/ops/quality-gate/signoff', authenticate, requirePermission('ops.dr.manage'), (req: AuthenticatedRequest, res) => {
    const report = runEnterpriseQualityGate();
    const notes = String(req.body?.notes || '').trim();
    const gateScope = String(req.body?.gate_scope || 'final_acceptance').trim() || 'final_acceptance';

    if (report.overallStatus === 'Failed') {
      res.status(400).json({
        error: 'Final Enterprise Acceptance sign-off blocked while mandatory Quality Gate checks are failing.',
        report,
      });
      return;
    }

    const info = db
      .prepare(`
        INSERT INTO enterprise_acceptance_signoffs (
          release_tag, gate_scope, gate_status, checks_passed, checks_total, checks_json, notes, signed_off_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        report.releaseTag,
        gateScope,
        report.overallStatus,
        report.checksPassed,
        report.checksTotal,
        JSON.stringify(report.checks),
        notes || null,
        req.authUser!.id
      );

    logAudit(req, 'ENTERPRISE_ACCEPTANCE_SIGNED_OFF', 'operations', 'quality_gate', String(info.lastInsertRowid), {
      releaseTag: report.releaseTag,
      gateScope,
      gateStatus: report.overallStatus,
      checksPassed: report.checksPassed,
      checksTotal: report.checksTotal,
    });

    res.status(201).json({
      ok: true,
      signoffId: info.lastInsertRowid,
      report,
    });
  });
}

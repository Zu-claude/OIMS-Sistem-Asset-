import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// In-memory rate limiter for auth endpoints
const authAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkAuthRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    authAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return { allowed: true };
  }
  if (entry.count >= 15) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface SessionPayload {
  userId: number;
  username: string;
  exp: number;
}

export function signSessionToken(userId: number, username: string): string {
  const payload: SessionPayload = {
    userId,
    username,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

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

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  phone: string | null;
  department: string | null;
  position_title: string | null;
  avatar_url: string | null;
  last_login_at: string | null;
  role_code: string;
  role_name: string;
  permissions: string[];
  org_scopes: UserOrgScope[];
  is_holding_scope: boolean;
  allowed_company_ids: number[];
  company_wide_ids: number[];
  division_scoped_ids: number[];
}

export function getUserWithPermissions(userId: number): AuthUser | null {
  const user = db
    .prepare('SELECT id, username, email, full_name, phone, department, position_title, avatar_url, last_login_at, is_active FROM users WHERE id = ?')
    .get(userId) as {
      id: number;
      username: string;
      email: string;
      full_name: string;
      phone: string | null;
      department: string | null;
      position_title: string | null;
      avatar_url: string | null;
      last_login_at: string | null;
      is_active: number;
    } | undefined;

  if (!user || !user.is_active) return null;

  const role = db
    .prepare(`
      SELECT r.id, r.code, r.name
      FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
      LIMIT 1
    `)
    .get(userId) as { id: number; code: string; name: string } | undefined;

  if (!role) return null;

  const perms = db
    .prepare(`
      SELECT p.code
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = ?
    `)
    .all(role.id) as { code: string }[];

  const orgScopes = db
    .prepare(`
      SELECT s.id, s.scope_level, s.holding_id, h.name as holding_name,
             COALESCE(s.company_id, d.company_id) as company_id,
             c.name as company_name, c.code as company_code,
             s.division_id, d.name as division_name, s.is_default
      FROM user_org_scopes s
      LEFT JOIN holding_groups h ON h.id = s.holding_id
      LEFT JOIN divisions d ON d.id = s.division_id
      LEFT JOIN companies c ON c.id = COALESCE(s.company_id, d.company_id)
      WHERE s.user_id = ?
      ORDER BY s.is_default DESC, s.id ASC
    `)
    .all(userId) as UserOrgScope[];

  const isHoldingScope =
    role.code === 'super_admin' || orgScopes.some((s) => s.scope_level === 'holding');

  const allCompanies = db.prepare('SELECT id FROM companies ORDER BY id ASC').all() as { id: number }[];
  const companyWideSet = new Set<number>();
  const divisionScopedSet = new Set<number>();
  const allowedCompanySet = new Set<number>();

  if (isHoldingScope) {
    for (const c of allCompanies) {
      companyWideSet.add(c.id);
      allowedCompanySet.add(c.id);
    }
  } else {
    for (const s of orgScopes) {
      if (s.scope_level === 'company' && s.company_id) {
        companyWideSet.add(s.company_id);
        allowedCompanySet.add(s.company_id);
      } else if (s.scope_level === 'division' && s.division_id) {
        divisionScopedSet.add(s.division_id);
        if (s.company_id) {
          allowedCompanySet.add(s.company_id);
        }
      }
    }
    if (allowedCompanySet.size === 0 && allCompanies[0]) {
      // Safe fallback to primary company only if zero scopes configured
      companyWideSet.add(allCompanies[0].id);
      allowedCompanySet.add(allCompanies[0].id);
    }
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    phone: user.phone ?? null,
    department: user.department ?? null,
    position_title: user.position_title ?? null,
    avatar_url: user.avatar_url,
    last_login_at: user.last_login_at ?? null,
    role_code: role.code,
    role_name: role.name,
    permissions: perms.map((p) => p.code),
    org_scopes: orgScopes,
    is_holding_scope: isHoldingScope,
    allowed_company_ids: Array.from(allowedCompanySet),
    company_wide_ids: Array.from(companyWideSet),
    division_scoped_ids: Array.from(divisionScopedSet),
  };
}

export interface ResolvedOrgScope {
  isHoldingScope: boolean;
  activeCompanyId: number | null;
  allowedCompanyIds: number[];
  companyWideIds: number[];
  divisionScopedIds: number[];
}

export function resolveRequestOrgScope(
  req: AuthenticatedRequest,
  res: Response
): ResolvedOrgScope | null {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  const rawHeader = req.headers['x-oims-company-id'];
  const rawQuery = req.query.company_id;
  const rawVal = rawQuery !== undefined && rawQuery !== '' ? String(rawQuery) : rawHeader !== undefined ? String(rawHeader) : '';
  const trimmed = rawVal.trim();

  let activeCompanyId: number | null = null;
  if (trimmed && trimmed.toLowerCase() !== 'all') {
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      res.status(400).json({ error: 'Invalid company scope identifier.' });
      return null;
    }
    if (!user.is_holding_scope && !user.allowed_company_ids.includes(parsed)) {
      res.status(403).json({ error: 'Cross-company access denied for this organization scope.' });
      return null;
    }
    activeCompanyId = parsed;
  } else if (!user.is_holding_scope && user.allowed_company_ids.length === 1) {
    activeCompanyId = user.allowed_company_ids[0];
  }

  return {
    isHoldingScope: user.is_holding_scope,
    activeCompanyId,
    allowedCompanyIds: activeCompanyId !== null ? [activeCompanyId] : user.allowed_company_ids,
    companyWideIds: user.company_wide_ids,
    divisionScopedIds: user.division_scoped_ids,
  };
}

export function buildCompanyScopeSql(
  scope: ResolvedOrgScope,
  companyColumn: string
): { clause: string; params: unknown[] } {
  if (scope.activeCompanyId !== null) {
    return { clause: `${companyColumn} = ?`, params: [scope.activeCompanyId] };
  }
  if (scope.isHoldingScope) {
    return { clause: '1=1', params: [] };
  }
  if (scope.allowedCompanyIds.length === 0) {
    return { clause: '1=0', params: [] };
  }
  const placeholders = scope.allowedCompanyIds.map(() => '?').join(',');
  return { clause: `${companyColumn} IN (${placeholders})`, params: [...scope.allowedCompanyIds] };
}

export function buildAssetScopeSql(
  scope: ResolvedOrgScope,
  alias = 'a'
): { clause: string; params: unknown[] } {
  if (scope.activeCompanyId !== null) {
    if (scope.isHoldingScope || scope.companyWideIds.includes(scope.activeCompanyId)) {
      return { clause: `${alias}.company_id = ?`, params: [scope.activeCompanyId] };
    }
    if (scope.divisionScopedIds.length > 0) {
      const ph = scope.divisionScopedIds.map(() => '?').join(',');
      return {
        clause: `(${alias}.company_id = ? AND ${alias}.division_id IN (${ph}))`,
        params: [scope.activeCompanyId, ...scope.divisionScopedIds],
      };
    }
    return { clause: '1=0', params: [] };
  }

  if (scope.isHoldingScope) {
    return { clause: '1=1', params: [] };
  }

  const parts: string[] = [];
  const params: unknown[] = [];
  if (scope.companyWideIds.length > 0) {
    const ph = scope.companyWideIds.map(() => '?').join(',');
    parts.push(`${alias}.company_id IN (${ph})`);
    params.push(...scope.companyWideIds);
  }
  if (scope.divisionScopedIds.length > 0) {
    const ph = scope.divisionScopedIds.map(() => '?').join(',');
    parts.push(`${alias}.division_id IN (${ph})`);
    params.push(...scope.divisionScopedIds);
  }
  if (parts.length === 0) return { clause: '1=0', params: [] };
  return { clause: `(${parts.join(' OR ')})`, params };
}

export function canUserAccessRecord(
  user: AuthUser,
  companyId: number,
  divisionId?: number | null
): boolean {
  if (user.is_holding_scope) return true;
  if (user.company_wide_ids.includes(Number(companyId))) return true;
  if (divisionId && user.division_scoped_ids.includes(Number(divisionId))) return true;
  return false;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }
  const user = getUserWithPermissions(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'User account inactive or not found' });
    return;
  }
  req.authUser = user;
  next();
}

export function requirePermission(permissionCode: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.authUser.role_code === 'super_admin' || req.authUser.permissions.includes(permissionCode)) {
      next();
      return;
    }
    res.status(403).json({ error: `Permission denied: requires ${permissionCode}` });
  };
}

export function logAudit(
  req: AuthenticatedRequest,
  action: string,
  module: string,
  entityType?: string,
  entityId?: string | number,
  details?: unknown
) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.authUser?.id ?? null,
      req.authUser?.username ?? 'anonymous',
      action,
      module,
      entityType ?? null,
      entityId !== undefined ? String(entityId) : null,
      details ? JSON.stringify(details) : null,
      req.ip ?? null
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

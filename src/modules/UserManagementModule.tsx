import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Plus, Building2, Edit3, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { isSafeExternalUrl } from '../lib/workspace';
import type { AuthUser, Lang } from '../types/oims';

interface UserManagementModuleProps {
  lang: Lang;
  user: AuthUser;
}

export const UserManagementModule: React.FC<UserManagementModuleProps> = ({ lang, user }) => {
  const canManage = user.role_code === 'super_admin' || user.permissions.includes('users.manage');

  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [rolePerms, setRolePerms] = useState<{ role_id: number; permission_id: number }[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const [tab, setTab] = useState<'users' | 'matrix' | 'audit'>('users');
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number>(2);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
    password: '',
    role_id: '2',
    scope_level: 'company' as 'holding' | 'company' | 'division',
    company_id: '',
    division_id: '',
  });

  const load = async () => {
    const [uRes, aRes] = await Promise.all([
      apiFetch<{
        users: any[];
        roles: any[];
        permissions: any[];
        rolePermissions: any[];
        companies?: any[];
        divisions?: any[];
      }>('/api/users'),
      apiFetch<{ logs: any[] }>('/api/audit-logs'),
    ]);
    setUsers(uRes.users);
    setRoles(uRes.roles);
    setPermissions(uRes.permissions);
    setRolePerms(uRes.rolePermissions);
    setCompanies(uRes.companies || []);
    setDivisions(uRes.divisions || []);
    setAuditLogs(aRes.logs);
    setForm((prev) => ({
      ...prev,
      company_id: prev.company_id || String(uRes.companies?.[0]?.id || ''),
      division_id: prev.division_id || String(uRes.divisions?.[0]?.id || ''),
    }));
  };

  useEffect(() => {
    load();
  }, []);

  const createDivisions = useMemo(
    () => divisions.filter((d) => !form.company_id || String(d.company_id) === String(form.company_id)),
    [divisions, form.company_id]
  );

  const editDivisions = useMemo(
    () => divisions.filter((d) => !editingUser?.company_id || String(d.company_id) === String(editingUser.company_id)),
    [divisions, editingUser?.company_id]
  );

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          full_name: form.full_name,
          password: form.password,
          role_id: Number(form.role_id),
          scope_level: form.scope_level,
          company_id: form.scope_level === 'holding' ? null : Number(form.company_id || companies[0]?.id || 1),
          division_id: form.scope_level === 'division' ? Number(form.division_id) : null,
        }),
      });
      setShowCreate(false);
      setForm({
        username: '',
        email: '',
        full_name: '',
        password: '',
        role_id: '2',
        scope_level: 'company',
        company_id: String(companies[0]?.id || ''),
        division_id: String(divisions[0]?.id || ''),
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError('');
    try {
      await apiFetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          full_name: editingUser.full_name,
          email: editingUser.email,
          is_active: Boolean(editingUser.is_active),
          role_id: Number(editingUser.role_id),
          scope_level: editingUser.scope_level,
          company_id:
            editingUser.scope_level === 'holding' ? null : Number(editingUser.company_id || companies[0]?.id || 1),
          division_id: editingUser.scope_level === 'division' ? Number(editingUser.division_id) : null,
        }),
      });
      setEditingUser(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleUserActive = async (u: any) => {
    setError('');
    try {
      await apiFetch(`/api/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          full_name: u.full_name,
          email: u.email,
          is_active: !u.is_active,
          role_id: u.role_id,
        }),
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const togglePermissionForRole = async (permId: number) => {
    if (!canManage) return;
    const currentIds = rolePerms.filter((rp) => rp.role_id === selectedRoleId).map((rp) => rp.permission_id);
    const nextIds = currentIds.includes(permId)
      ? currentIds.filter((id) => id !== permId)
      : [...currentIds, permId];
    await apiFetch(`/api/roles/${selectedRoleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissionIds: nextIds }),
    });
    await load();
  };

  const activeRolePermSet = new Set(
    rolePerms.filter((rp) => rp.role_id === selectedRoleId).map((rp) => rp.permission_id)
  );

  const isId = lang === 'id';
  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  const formatScopeBadge = (u: any) => {
    const sc = u.org_scopes?.[0];
    if (!sc) return isId ? 'Default' : 'Default';
    if (sc.scope_level === 'holding') return `Holding · ${sc.holding_name || 'Group'}`;
    if (sc.scope_level === 'division') return `${sc.company_code || sc.company_name || ''} · ${sc.division_name || ''}`;
    return `${sc.company_code || ''} · ${sc.company_name || ''}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {isId ? 'Manajemen Pengguna, RBAC & Scope Organisasi' : 'User Management, RBAC & Org Scope'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {isId
              ? '5 peran korporat, cakupan organisasi (Holding / Perusahaan / Divisi), dan matriks izin granular'
              : '5 corporate roles, organization scopes (Holding / Company / Division), and granular permission matrix'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-neutral-200/70 dark:bg-[#1E222A] rounded-md text-xs font-medium">
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`px-3 py-1.5 rounded whitespace-nowrap ${
                tab === 'users'
                  ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
              }`}
            >
              {isId ? `Pengguna (${users.length})` : `Users (${users.length})`}
            </button>
            <button
              type="button"
              onClick={() => setTab('matrix')}
              className={`px-3 py-1.5 rounded whitespace-nowrap ${
                tab === 'matrix'
                  ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
              }`}
            >
              {isId ? 'Matriks Peran' : 'Role Matrix'}
            </button>
            <button
              type="button"
              onClick={() => setTab('audit')}
              className={`px-3 py-1.5 rounded whitespace-nowrap ${
                tab === 'audit'
                  ? 'bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-200'
              }`}
            >
              {isId ? 'Log Audit' : 'Audit Logs'}
            </button>
          </div>
          {canManage && tab === 'users' && (
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isId ? 'Tambah Pengguna' : 'Add User'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md text-xs text-[#C8102E] dark:text-red-300">
          {error}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          {showCreate && (
            <form
              onSubmit={handleCreateUser}
              className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
            >
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Buat Akun Pengguna Baru' : 'Create User Account'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className={labelClass}>Username *</label>
                  <input
                    type="text"
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>{isId ? 'Nama Lengkap *' : 'Full Name *'}</label>
                  <input
                    type="text"
                    required
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>{isId ? 'Email Perusahaan *' : 'Corporate Email *'}</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>{isId ? 'Peran *' : 'Role *'}</label>
                  <select
                    value={form.role_id}
                    onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                    className={inputClass}
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{isId ? 'Level Cakupan Organisasi *' : 'Organization Scope Level *'}</label>
                  <select
                    value={form.scope_level}
                    onChange={(e) =>
                      setForm({ ...form, scope_level: e.target.value as 'holding' | 'company' | 'division' })
                    }
                    className={inputClass}
                  >
                    {user.is_holding_scope && (
                      <option value="holding">{isId ? 'Holding (Semua Entitas)' : 'Holding (All Companies)'}</option>
                    )}
                    <option value="company">{isId ? 'Perusahaan (Company Scope)' : 'Company Scope'}</option>
                    <option value="division">{isId ? 'Divisi (Division Scope)' : 'Division Scope'}</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>
                    {isId ? 'Kata Sandi Awal (min. 8 karakter) *' : 'Initial Password (min 8 chars) *'}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className={inputClass}
                  />
                </div>

                {form.scope_level !== 'holding' && (
                  <div>
                    <label className={labelClass}>{isId ? 'Perusahaan *' : 'Company *'}</label>
                    <select
                      value={form.company_id}
                      onChange={(e) => {
                        const cid = e.target.value;
                        const firstDiv = divisions.find((d) => String(d.company_id) === cid);
                        setForm({ ...form, company_id: cid, division_id: firstDiv ? String(firstDiv.id) : '' });
                      }}
                      className={inputClass}
                    >
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {form.scope_level === 'division' && (
                  <div>
                    <label className={labelClass}>{isId ? 'Divisi *' : 'Division *'}</label>
                    <select
                      required
                      value={form.division_id}
                      onChange={(e) => setForm({ ...form, division_id: e.target.value })}
                      className={inputClass}
                    >
                      {createDivisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md"
                >
                  {isId ? 'Buat Pengguna' : 'Create User'}
                </button>
              </div>
            </form>
          )}

          <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                  <tr>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Pengguna' : 'User'}</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Peran' : 'Role'}</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Scope Organisasi' : 'Org Scope'}</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">{isId ? 'Login Terakhir' : 'Last Login'}</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{isId ? 'Aksi' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {users.map((u) => {
                    const primaryScope = u.org_scopes?.[0];
                    return (
                      <tr key={u.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            {u.avatar_url && isSafeExternalUrl(u.avatar_url) ? (
                              <img
                                src={u.avatar_url}
                                alt={u.full_name}
                                referrerPolicy="no-referrer"
                                className="w-8 h-8 rounded-md object-cover border border-neutral-200 dark:border-neutral-700 shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-md bg-[#141619] dark:bg-[#C8102E] text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
                                {(u.full_name || u.username || 'U').slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-[#141619] dark:text-neutral-100">{u.full_name}</div>
                              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                                @{u.username} · {u.email}
                                {u.department ? ` · ${u.department}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-neutral-800 dark:text-neutral-200 whitespace-nowrap">
                          {u.role_name}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-100 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 text-[11px] text-neutral-700 dark:text-neutral-200">
                            <Building2 className="w-3 h-3 text-[#C8102E]" />
                            <span>{formatScopeBadge(u)}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-neutral-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                          {u.last_login_at || (isId ? 'Belum pernah' : 'Never')}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={
                              u.is_active
                                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                : 'text-[#C8102E] dark:text-red-400 font-medium'
                            }
                          >
                            {u.is_active ? (isId ? 'Aktif' : 'Active') : isId ? 'Nonaktif' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() =>
                                setEditingUser({
                                  id: u.id,
                                  username: u.username,
                                  full_name: u.full_name,
                                  email: u.email,
                                  is_active: Boolean(u.is_active),
                                  role_id: String(u.role_id || 2),
                                  scope_level: primaryScope?.scope_level || 'company',
                                  company_id: String(primaryScope?.company_id || companies[0]?.id || ''),
                                  division_id: String(primaryScope?.division_id || divisions[0]?.id || ''),
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>{isId ? 'Scope & Peran' : 'Scope & Role'}</span>
                            </button>
                          )}
                          {canManage && u.id !== user.id && (
                            <button
                              type="button"
                              onClick={() => handleToggleUserActive(u)}
                              className="px-2.5 py-1 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              {u.is_active ? (isId ? 'Nonaktifkan' : 'Deactivate') : isId ? 'Aktifkan' : 'Activate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'matrix' && (
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Matriks Izin Modul' : 'Module Permission Matrix'}
              </h3>
            </div>
            <select
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(Number(e.target.value))}
              className="px-3 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md font-medium focus:outline-none focus:border-[#C8102E]"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            {permissions.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2.5 p-2.5 border border-neutral-200 dark:border-neutral-800 rounded-md cursor-pointer hover:bg-neutral-50 dark:hover:bg-[#1E222A]"
              >
                <input
                  type="checkbox"
                  disabled={!canManage || selectedRoleId === 1}
                  checked={selectedRoleId === 1 || activeRolePermSet.has(p.id)}
                  onChange={() => togglePermissionForRole(p.id)}
                  className="accent-[#C8102E]"
                />
                <div>
                  <div className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{p.code}</div>
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{p.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Waktu' : 'Timestamp'}</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Pengguna' : 'User'}</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Aksi' : 'Action'}</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{isId ? 'Modul' : 'Module'}</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {auditLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60 transition-colors">
                    <td className="px-4 py-2 font-mono text-neutral-500 dark:text-neutral-400 whitespace-nowrap tabular-nums">
                      {l.created_at}
                    </td>
                    <td className="px-4 py-2 font-mono text-[#141619] dark:text-neutral-100">{l.username || 'system'}</td>
                    <td className="px-4 py-2 font-mono font-semibold text-[#C8102E] dark:text-red-400">{l.action}</td>
                    <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{l.module}</td>
                    <td className="px-4 py-2 font-mono text-neutral-500 dark:text-neutral-400">
                      {l.entity_type} {l.entity_id ? `#${l.entity_id}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSaveEditUser}
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <h3 className="font-display text-sm font-bold text-[#141619] dark:text-neutral-100">
                {isId ? `Ubah Peran & Scope (@${editingUser.username})` : `Edit Role & Scope (@${editingUser.username})`}
              </h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>{isId ? 'Nama Lengkap *' : 'Full Name *'}</label>
                <input
                  type="text"
                  required
                  value={editingUser.full_name}
                  onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{isId ? 'Peran *' : 'Role *'}</label>
                <select
                  value={editingUser.role_id}
                  onChange={(e) => setEditingUser({ ...editingUser, role_id: e.target.value })}
                  className={inputClass}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>{isId ? 'Level Cakupan Organisasi *' : 'Organization Scope Level *'}</label>
                <select
                  value={editingUser.scope_level}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      scope_level: e.target.value as 'holding' | 'company' | 'division',
                    })
                  }
                  className={inputClass}
                >
                  {user.is_holding_scope && (
                    <option value="holding">{isId ? 'Holding (Semua Entitas)' : 'Holding (All Companies)'}</option>
                  )}
                  <option value="company">{isId ? 'Perusahaan (Company Scope)' : 'Company Scope'}</option>
                  <option value="division">{isId ? 'Divisi (Division Scope)' : 'Division Scope'}</option>
                </select>
              </div>
              {editingUser.scope_level !== 'holding' && (
                <div>
                  <label className={labelClass}>{isId ? 'Perusahaan *' : 'Company *'}</label>
                  <select
                    value={editingUser.company_id}
                    onChange={(e) => {
                      const cid = e.target.value;
                      const firstDiv = divisions.find((d) => String(d.company_id) === cid);
                      setEditingUser({
                        ...editingUser,
                        company_id: cid,
                        division_id: firstDiv ? String(firstDiv.id) : '',
                      });
                    }}
                    className={inputClass}
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {editingUser.scope_level === 'division' && (
                <div>
                  <label className={labelClass}>{isId ? 'Divisi *' : 'Division *'}</label>
                  <select
                    required
                    value={editingUser.division_id}
                    onChange={(e) => setEditingUser({ ...editingUser, division_id: e.target.value })}
                    className={inputClass}
                  >
                    {editDivisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-neutral-200 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md"
              >
                {isId ? 'Batal' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md"
              >
                {isId ? 'Simpan Scope' : 'Save Scope'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

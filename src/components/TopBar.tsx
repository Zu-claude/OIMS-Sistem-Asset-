import React, { useEffect, useState } from 'react';
import { Bell, Search, LogOut, Menu, Globe, Sun, Moon, Building2, Shield } from 'lucide-react';
import type { AuthUser, Lang, ModuleKey, NotificationItem } from '../types/oims';
import { translations } from '../i18n/translations';
import { isSafeExternalUrl } from '../lib/workspace';

interface TopBarProps {
  activeModule: ModuleKey;
  user: AuthUser;
  lang: Lang;
  theme: 'light' | 'dark';
  companies: { id: number; code: string; name: string }[];
  activeCompanyScope: number | null;
  onChangeCompanyScope: (companyId: number | null) => void;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  globalSearch: string;
  onGlobalSearchChange: (val: string) => void;
  onGlobalSearchSubmit: () => void;
  notifications: NotificationItem[];
  onMarkNotificationRead: (id: number) => void;
  onLogout: () => void;
  onOpenMobileMenu: () => void;
  onOpenAccount: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeModule,
  user,
  lang,
  theme,
  companies,
  activeCompanyScope,
  onChangeCompanyScope,
  onToggleLang,
  onToggleTheme,
  globalSearch,
  onGlobalSearchChange,
  onGlobalSearchSubmit,
  notifications,
  onMarkNotificationRead,
  onLogout,
  onOpenMobileMenu,
  onOpenAccount,
}) => {
  const t = translations[lang];
  const [notifOpen, setNotifOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [user.avatar_url]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const showAvatar = Boolean(user.avatar_url && isSafeExternalUrl(user.avatar_url) && !avatarError);

  const canSwitchCompany = Boolean(user.is_holding_scope) || companies.length > 1;
  const defaultScopeLabel =
    user.org_scopes && user.org_scopes.length > 0
      ? user.org_scopes[0].scope_level === 'holding'
        ? lang === 'id'
          ? 'Holding (Semua Entitas)'
          : 'Holding (All Companies)'
        : user.org_scopes[0].division_name
        ? `${user.org_scopes[0].company_code || ''} · ${user.org_scopes[0].division_name}`
        : user.org_scopes[0].company_name || user.org_scopes[0].company_code || 'Company Scope'
      : companies[0]?.name || 'KIDECO';

  return (
    <header className="h-16 bg-white dark:bg-[#171A20] border-b border-neutral-200 dark:border-neutral-800 px-4 lg:px-6 flex items-center justify-between gap-3 shrink-0 no-print transition-colors">
      {/* Left Zone: Mobile Menu + Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-neutral-600 dark:text-neutral-300 hover:text-[#141619] dark:hover:text-white rounded-md border border-neutral-200 dark:border-neutral-700"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap truncate">
            KIDECO OIMS / <span className="text-[#141619] dark:text-neutral-100 font-medium">{t.nav[activeModule]}</span>
          </div>
        </div>
      </div>

      {/* Center Zone: Global Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onGlobalSearchSubmit();
        }}
        className="hidden md:flex items-center flex-1 max-w-sm"
      >
        <div className="relative w-full">
          <Search className="w-4 h-4 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={globalSearch}
            onChange={(e) => onGlobalSearchChange(e.target.value)}
            placeholder={t.topbar.searchPlaceholder}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-neutral-50 dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 border border-neutral-200 dark:border-neutral-700 rounded-md focus:outline-none focus:bg-white dark:focus:bg-[#171A20] focus:border-[#C8102E]"
          />
        </div>
      </form>

      {/* Right Zone: Org Scope + Theme + Lang + Notifications + User Profile + Logout */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Organization Scope Switcher / Indicator */}
        {canSwitchCompany ? (
          <div
            className="hidden sm:flex items-center gap-1.5 px-2 py-1 text-xs border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-[#1E222A] rounded-md"
            title={lang === 'id' ? 'Scope Entitas / Perusahaan Aktif' : 'Active Organization / Company Scope'}
          >
            <Building2 className="w-3.5 h-3.5 text-[#C8102E] shrink-0" />
            <select
              value={activeCompanyScope === null ? 'all' : String(activeCompanyScope)}
              onChange={(e) => {
                const v = e.target.value;
                onChangeCompanyScope(v === 'all' ? null : Number(v));
              }}
              aria-label={lang === 'id' ? 'Pilih cakupan perusahaan' : 'Select company scope'}
              className="bg-transparent text-xs font-medium text-[#141619] dark:text-neutral-100 focus:outline-none max-w-[165px] truncate cursor-pointer"
            >
              {user.is_holding_scope && (
                <option value="all" className="bg-white dark:bg-[#171A20]">
                  {lang === 'id' ? 'Holding · Semua Perusahaan' : 'Holding · All Companies'}
                </option>
              )}
              {companies.map((c) => (
                <option key={c.id} value={String(c.id)} className="bg-white dark:bg-[#171A20]">
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-[#1E222A] rounded-md whitespace-nowrap"
            title={lang === 'id' ? 'Isolasi scope organisasi aktif' : 'Active isolated organization scope'}
          >
            <Shield className="w-3 h-3 text-[#C8102E]" />
            <span className="max-w-[150px] truncate">{defaultScopeLabel}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#1E222A] rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
          title={t.topbar.toggleTheme}
          aria-label={t.topbar.toggleTheme}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden xl:inline">{t.topbar.themeLight}</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-neutral-600" />
              <span className="hidden xl:inline">{t.topbar.themeDark}</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleLang}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#1E222A] rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
          title="Switch Indonesian / English"
        >
          <Globe className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
          <span className="font-mono">{lang.toUpperCase()}</span>
        </button>

        {/* Notifications Popover */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            className="relative p-2 text-neutral-600 dark:text-neutral-300 hover:text-[#141619] dark:hover:text-white border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#1E222A] rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            aria-label={t.topbar.notifications}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-[#C8102E] text-white text-[10px] font-mono font-semibold rounded flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#141619] dark:text-neutral-100">{t.topbar.notifications}</span>
                <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">{unreadCount} unread</span>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
                {notifications.length === 0 ? (
                  <div className="p-4 text-xs text-neutral-500 dark:text-neutral-400 text-center">{t.topbar.noNotifications}</div>
                ) : (
                  notifications.slice(0, 10).map((n) => (
                    <div key={n.id} className={`p-3 text-xs ${n.is_read ? 'bg-white dark:bg-[#171A20]' : 'bg-red-50/40 dark:bg-red-950/20'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-[#141619] dark:text-neutral-100">{n.title}</span>
                        <span className={`text-[10px] font-mono shrink-0 ${n.priority === 'Critical' || n.priority === 'High' ? 'text-[#C8102E] dark:text-red-400' : 'text-neutral-500 dark:text-neutral-400'}`}>
                          {n.priority}
                        </span>
                      </div>
                      <p className="text-neutral-600 dark:text-neutral-400 mt-1 leading-snug">{n.message}</p>
                      {!n.is_read && (
                        <button
                          type="button"
                          onClick={() => onMarkNotificationRead(n.id)}
                          className="mt-1.5 text-[11px] font-medium text-[#C8102E] dark:text-red-400 hover:underline"
                        >
                          {lang === 'id' ? 'Tandai sudah dibaca' : 'Mark as read'}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile & Role (opens Account Settings) */}
        <button
          type="button"
          onClick={onOpenAccount}
          title={t.topbar.accountSettings}
          className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-1 border-l border-neutral-200 dark:border-neutral-800 rounded-r-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-left"
        >
          {showAvatar ? (
            <img
              src={user.avatar_url!}
              alt={user.full_name}
              referrerPolicy="no-referrer"
              onError={() => setAvatarError(true)}
              className="w-8 h-8 rounded-md object-cover border border-neutral-200 dark:border-neutral-700 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-md bg-[#141619] dark:bg-neutral-800 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {user.full_name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="hidden sm:block leading-tight">
            <div className="text-xs font-semibold text-[#141619] dark:text-neutral-100 whitespace-nowrap max-w-[130px] truncate">{user.full_name}</div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap">{user.role_name}</div>
          </div>
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="p-2 text-neutral-600 dark:text-neutral-300 hover:text-[#C8102E] dark:hover:text-red-400 border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#1E222A] rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
          title={t.topbar.logout}
          aria-label={t.topbar.logout}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

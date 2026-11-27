import React, { useEffect, useState } from 'react';
import { apiFetch, setActiveCompanyScopeId, setSessionToken } from './lib/api';
import type { AuthUser, Lang, MasterData, AssetRow, ModuleKey, NotificationItem } from './types/oims';
import { LoginView } from './components/LoginView';
import { PublicQrView } from './components/PublicQrView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardModule } from './modules/DashboardModule';
import { AssetRegistrationModule } from './modules/AssetRegistrationModule';
import { AssetDatabaseModule } from './modules/AssetDatabaseModule';
import { QrTaggingModule } from './modules/QrTaggingModule';
import { LocationManagementModule } from './modules/LocationManagementModule';
import { PicManagementModule } from './modules/PicManagementModule';
import { MovementHistoryModule } from './modules/MovementHistoryModule';
import { MaintenanceModule } from './modules/MaintenanceModule';
import { StockOpnameModule } from './modules/StockOpnameModule';
import { ReplacementPlanningModule } from './modules/ReplacementPlanningModule';
import { ReportingCenterModule } from './modules/ReportingCenterModule';
import { GovernanceAiModule } from './modules/GovernanceAiModule';
import { SystemOpsModule } from './modules/SystemOpsModule';
import { UserManagementModule } from './modules/UserManagementModule';
import { SystemSettingsModule } from './modules/SystemSettingsModule';
import { AccountSettingsModule } from './modules/AccountSettingsModule';

type ThemeMode = 'light' | 'dark';

function readInitialQrCodeFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('qr');
    if (q && q.trim()) return q.trim();
    const match = window.location.pathname.match(/\/qr\/([^/?#]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]).trim();
  } catch {
    // ignore URL errors
  }
  return null;
}

export default function App() {
  const [lang, setLang] = useState<Lang>('id');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return window.localStorage.getItem('oims_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [booting, setBooting] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [installStatus, setInstallStatus] = useState<{
    tableCount: number;
    expectedTableCount: number;
    tablesReady: boolean;
    hasAdminUser: boolean;
  } | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeCompanyScope, setActiveCompanyScope] = useState<number | null>(null);
  const [scopeVersion, setScopeVersion] = useState(0);
  const [initialQrCode, setInitialQrCode] = useState<string | null>(() => readInitialQrCodeFromUrl());
  const [showPublicQr, setShowPublicQr] = useState<boolean>(() => Boolean(readInitialQrCodeFromUrl()));

  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');

  const [master, setMaster] = useState<MasterData | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem('oims_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const fetchAuthStatus = async () => {
    try {
      const status = await apiFetch<{
        needsSetup: boolean;
        installStatus?: {
          tableCount: number;
          expectedTableCount: number;
          tablesReady: boolean;
          hasAdminUser: boolean;
        };
        smtpConfigured?: boolean;
        branding: Record<string, string>;
      }>('/api/auth/status');
      setNeedsSetup(status.needsSetup);
      setInstallStatus(status.installStatus || null);
      setSmtpConfigured(Boolean(status.smtpConfigured));
      setLogoUrl(status.branding?.company_logo_url || '');
    } finally {
      setBooting(false);
    }
  };

  useEffect(() => {
    fetchAuthStatus();
  }, []);

  const loadWorkspaceData = async () => {
    const [mRes, aRes, nRes] = await Promise.all([
      apiFetch<MasterData>('/api/master/all'),
      apiFetch<{ assets: AssetRow[] }>('/api/assets'),
      apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
    ]);
    setMaster(mRes);
    setAssets(aRes.assets);
    setNotifications(nRes.notifications);
  };

  useEffect(() => {
    if (user) {
      loadWorkspaceData();
    }
  }, [user, scopeVersion]);

  const handleChangeCompanyScope = (companyId: number | null) => {
    setActiveCompanyScopeId(companyId);
    setActiveCompanyScope(companyId);
    setScopeVersion((v) => v + 1);
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setSessionToken(null);
    setActiveCompanyScopeId(null);
    setActiveCompanyScope(null);
    setUser(null);
    setMaster(null);
    setAssets([]);
    setActiveModule('dashboard');
    await fetchAuthStatus();
  };

  const handleMarkNotificationRead = async (id: number) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0F1115] flex items-center justify-center text-neutral-600 dark:text-neutral-300 text-xs font-mono">
        Memuat KIDECO OIMS...
      </div>
    );
  }

  if (!user) {
    if (showPublicQr && initialQrCode) {
      return (
        <PublicQrView
          slugOrToken={initialQrCode}
          logoUrl={logoUrl}
          lang={lang}
          theme={theme}
          onToggleLang={() => setLang((l) => (l === 'id' ? 'en' : 'id'))}
          onToggleTheme={toggleTheme}
          onRequestSignIn={() => setShowPublicQr(false)}
          onDismissPublicView={() => {
            setShowPublicQr(false);
            setInitialQrCode(null);
            try {
              window.history.replaceState({}, '', '/');
            } catch {
              // ignore
            }
          }}
        />
      );
    }

    return (
      <LoginView
        needsSetup={needsSetup}
        installStatus={installStatus}
        smtpConfigured={smtpConfigured}
        logoUrl={logoUrl}
        lang={lang}
        theme={theme}
        onToggleLang={() => setLang((l) => (l === 'id' ? 'en' : 'id'))}
        onToggleTheme={toggleTheme}
        onAuthenticated={(u) => {
          const initialScope = u.is_holding_scope
            ? null
            : (u.allowed_company_ids && u.allowed_company_ids.length > 0 ? u.allowed_company_ids[0] : null);
          setActiveCompanyScopeId(initialScope);
          setActiveCompanyScope(initialScope);
          setNeedsSetup(false);
          if (initialQrCode) {
            setActiveModule('qr');
          }
          setUser(u);
        }}
      />
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#F4F5F7] dark:bg-[#0F1115] oims-app-shell">
      <Sidebar
        activeModule={activeModule}
        onSelect={setActiveModule}
        user={user}
        lang={lang}
        logoUrl={logoUrl}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden oims-content-col">
        <TopBar
          activeModule={activeModule}
          user={user}
          lang={lang}
          theme={theme}
          companies={master?.companies || []}
          activeCompanyScope={activeCompanyScope}
          onChangeCompanyScope={handleChangeCompanyScope}
          onToggleLang={() => setLang((l) => (l === 'id' ? 'en' : 'id'))}
          onToggleTheme={toggleTheme}
          globalSearch={globalSearch}
          onGlobalSearchChange={setGlobalSearch}
          onGlobalSearchSubmit={() => setActiveModule('database')}
          notifications={notifications}
          onMarkNotificationRead={handleMarkNotificationRead}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenAccount={() => setActiveModule('account')}
        />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 oims-main">
          {!master ? (
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {lang === 'id' ? 'Memuat data master inventaris...' : 'Loading master inventory records...'}
            </div>
          ) : (
            <div key={scopeVersion} className="contents">
              {activeModule === 'dashboard' && (
                <DashboardModule lang={lang} theme={theme} user={user} onNavigate={setActiveModule} />
              )}
              {activeModule === 'register' && (
                <AssetRegistrationModule
                  lang={lang}
                  master={master}
                  onRegistered={loadWorkspaceData}
                />
              )}
              {activeModule === 'database' && (
                <AssetDatabaseModule
                  lang={lang}
                  user={user}
                  master={master}
                  assets={assets}
                  initialSearch={globalSearch}
                  onRefresh={loadWorkspaceData}
                />
              )}
              {activeModule === 'qr' && (
                <QrTaggingModule
                  lang={lang}
                  user={user}
                  assets={assets}
                  initialQrCode={initialQrCode}
                  onClearInitialQrCode={() => setInitialQrCode(null)}
                  onRefreshAssets={loadWorkspaceData}
                />
              )}
              {activeModule === 'locations' && (
                <LocationManagementModule
                  lang={lang}
                  user={user}
                  master={master}
                  assets={assets}
                  onRefresh={loadWorkspaceData}
                />
              )}
              {activeModule === 'pic' && (
                <PicManagementModule
                  lang={lang}
                  user={user}
                  master={master}
                  assets={assets}
                  onRefresh={loadWorkspaceData}
                />
              )}
              {activeModule === 'movements' && (
                <MovementHistoryModule
                  lang={lang}
                  user={user}
                  master={master}
                  assets={assets}
                  onRefreshAssets={loadWorkspaceData}
                />
              )}
              {activeModule === 'maintenance' && (
                <MaintenanceModule
                  lang={lang}
                  user={user}
                  assets={assets}
                  onRefreshAssets={loadWorkspaceData}
                />
              )}
              {activeModule === 'opname' && (
                <StockOpnameModule lang={lang} user={user} master={master} />
              )}
              {activeModule === 'replacement' && (
                <ReplacementPlanningModule lang={lang} user={user} />
              )}
              {activeModule === 'reports' && (
                <ReportingCenterModule
                  lang={lang}
                  master={master}
                />
              )}
              {activeModule === 'governance' && (
                <GovernanceAiModule
                  lang={lang}
                  user={user}
                  master={master}
                  assets={assets}
                  onRefreshAssets={loadWorkspaceData}
                />
              )}
              {activeModule === 'operations' && (
                <SystemOpsModule lang={lang} user={user} />
              )}
              {activeModule === 'users' && (
                <UserManagementModule lang={lang} user={user} />
              )}
              {activeModule === 'settings' && (
                <SystemSettingsModule
                  lang={lang}
                  user={user}
                  logoUrl={logoUrl}
                  onRefreshBranding={fetchAuthStatus}
                />
              )}
              {activeModule === 'account' && (
                <AccountSettingsModule
                  lang={lang}
                  user={user}
                  onUserUpdated={(updatedUser, newToken) => {
                    if (newToken) setSessionToken(newToken);
                    setUser(updatedUser);
                  }}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

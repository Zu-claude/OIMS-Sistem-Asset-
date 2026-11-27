import React from 'react';
import {
  LayoutDashboard,
  PlusSquare,
  Database,
  QrCode,
  MapPin,
  Users,
  ArrowLeftRight,
  Wrench,
  ClipboardCheck,
  RefreshCw,
  FileBarChart2,
  ShieldCheck,
  Activity,
  Shield,
  Settings,
  UserCog,
  X,
} from 'lucide-react';
import type { AuthUser, Lang, ModuleKey } from '../types/oims';
import { translations } from '../i18n/translations';
import { BrandMark } from './BrandMark';

interface SidebarProps {
  activeModule: ModuleKey;
  onSelect: (m: ModuleKey) => void;
  user: AuthUser;
  lang: Lang;
  logoUrl?: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: { key: ModuleKey; icon: React.ComponentType<{ className?: string }>; perm: string | null }[] = [
  { key: 'dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
  { key: 'register', icon: PlusSquare, perm: 'assets.create' },
  { key: 'database', icon: Database, perm: 'assets.view' },
  { key: 'qr', icon: QrCode, perm: 'qr.view' },
  { key: 'locations', icon: MapPin, perm: 'locations.view' },
  { key: 'pic', icon: Users, perm: 'pic.view' },
  { key: 'movements', icon: ArrowLeftRight, perm: 'movements.view' },
  { key: 'maintenance', icon: Wrench, perm: 'maintenance.view' },
  { key: 'opname', icon: ClipboardCheck, perm: 'opname.view' },
  { key: 'replacement', icon: RefreshCw, perm: 'replacement.view' },
  { key: 'reports', icon: FileBarChart2, perm: 'reports.view' },
  { key: 'governance', icon: ShieldCheck, perm: 'governance.view' },
  { key: 'operations', icon: Activity, perm: 'ops.health.view' },
  { key: 'users', icon: Shield, perm: 'users.view' },
  { key: 'settings', icon: Settings, perm: 'settings.view' },
  { key: 'account', icon: UserCog, perm: null },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelect,
  user,
  lang,
  logoUrl,
  mobileOpen,
  onCloseMobile,
}) => {
  const t = translations[lang];
  const hasPerm = (p: string | null) => p === null || user.role_code === 'super_admin' || user.permissions.includes(p);

  const visibleItems = NAV_ITEMS.filter((item) => hasPerm(item.perm));

  const content = (
    <aside className="w-[260px] bg-[#141619] text-neutral-300 flex flex-col h-full border-r border-neutral-800 shrink-0 no-print">
      <div className="h-16 px-5 flex items-center justify-between border-b border-neutral-800">
        <BrandMark logoUrl={logoUrl} darkSurface />
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 text-neutral-400 hover:text-white rounded"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = activeModule === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                onSelect(item.key);
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#C8102E] text-white'
                  : 'text-neutral-300 hover:bg-[#1F242A] hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{t.nav[item.key]}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3.5 border-t border-neutral-800 text-[11px] text-neutral-400">
        <div className="font-medium text-neutral-300 truncate">{t.roadmapTag}</div>
        <div className="truncate mt-0.5">{t.vision}</div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full no-print">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex no-print">
          <div className="fixed inset-0 bg-black/50" onClick={onCloseMobile} />
          <div className="relative z-50 h-full">{content}</div>
        </div>
      )}
    </>
  );
};

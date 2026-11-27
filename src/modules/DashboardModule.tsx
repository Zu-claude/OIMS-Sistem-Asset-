import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Activity,
  Image as ImageIcon,
  X,
  TrendingUp,
  QrCode,
  PlusSquare,
  FileBarChart2,
  ClipboardCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatIDR } from '../lib/exportUtils';
import { isSafeExternalUrl } from '../lib/workspace';
import { translations } from '../i18n/translations';
import type { AuthUser, Lang, ModuleKey, NotificationItem } from '../types/oims';
import { ConditionLabel, StatusLabel } from '../components/StatusText';
import { D3LifecycleLineChart } from '../components/D3LifecycleLineChart';

interface DashboardModuleProps {
  lang: Lang;
  theme?: 'light' | 'dark';
  user?: AuthUser;
  onNavigate: (m: ModuleKey) => void;
}

const CHART_PALETTE_LIGHT = ['#141619', '#C8102E', '#525866', '#8A93A2', '#D97706', '#15803D'];
const CHART_PALETTE_DARK = ['#E5E7EB', '#F87171', '#9CA3AF', '#6B7280', '#FBBF24', '#34D399'];

export const DashboardModule: React.FC<DashboardModuleProps> = ({ lang, theme = 'light', user, onNavigate }) => {
  const t = translations[lang].dashboard;
  const isId = lang === 'id';
  const isDark = theme === 'dark';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});
  const [lightboxItem, setLightboxItem] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/dashboard');
      setData(res);
    } catch (err: any) {
      setError(err.message || (isId ? 'Gagal memuat ringkasan dasbor' : 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg animate-pulse" />
          <div className="h-72 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white dark:bg-[#171A20] border border-red-200 dark:border-red-900/60 rounded-lg p-6 text-sm text-[#C8102E] dark:text-red-400">
        {error || (isId ? 'Data dasbor tidak tersedia' : 'Dashboard data unavailable')}
      </div>
    );
  }

  const { kpis, charts, recentActivity = [], recentMovements, notifications } = data;

  const gridStroke = isDark ? '#272B35' : '#E5E7EB';
  const tickColor = isDark ? '#9CA3AF' : '#525866';
  const primaryBarFill = isDark ? '#E5E7EB' : '#141619';
  const secondaryBarFill = isDark ? '#9CA3AF' : '#525866';
  const crimsonStroke = isDark ? '#F87171' : '#C8102E';
  const palette = isDark ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT;

  const conditionColors: Record<string, string> = isDark
    ? {
        Good: '#34D399',
        'Minor Damage': '#FBBF24',
        'Major Damage': '#FB923C',
        Unserviceable: '#F87171',
      }
    : {
        Good: '#15803D',
        'Minor Damage': '#D97706',
        'Major Damage': '#EA580C',
        Unserviceable: '#C8102E',
      };

  const tooltipProps = {
    contentStyle: {
      backgroundColor: isDark ? '#171A20' : '#FFFFFF',
      borderColor: isDark ? '#272B35' : '#E5E7EB',
      borderRadius: '6px',
      fontSize: '12px',
      color: isDark ? '#F3F4F6' : '#141619',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
    },
    itemStyle: { color: isDark ? '#F3F4F6' : '#141619' },
    labelStyle: { color: isDark ? '#9CA3AF' : '#525866', marginBottom: '2px', fontWeight: 600 },
  };

  const kpiCards = [
    { label: t.totalAssets, value: kpis.totalAssets, sub: formatIDR(kpis.totalValue), accent: false },
    {
      label: t.goodCondition,
      value: kpis.goodCount,
      sub: `${Math.round((kpis.goodCount / Math.max(1, kpis.totalAssets)) * 100)}%`,
      accent: false,
    },
    { label: t.minorDamage, value: kpis.minorDamageCount, sub: isId ? 'Perlu pengecekan' : 'Needs check', accent: false },
    {
      label: t.majorDamage,
      value: kpis.majorDamageCount,
      sub: isId ? 'Prioritas perbaikan' : 'Priority repair',
      accent: kpis.majorDamageCount > 0,
    },
    {
      label: t.unserviceable,
      value: kpis.unserviceableCount,
      sub: isId ? 'Antrean penggantian' : 'Replacement queue',
      accent: kpis.unserviceableCount > 0,
    },
    { label: t.inMaintenance, value: kpis.inMaintenanceCount, sub: isId ? 'Tiket aktif' : 'Active tickets', accent: false },
    {
      label: t.missingPic,
      value: kpis.missingPicCount,
      sub: isId ? 'Tetapkan PIC' : 'Assign custodian',
      accent: kpis.missingPicCount > 0,
    },
    {
      label: t.missingQr,
      value: kpis.missingQrCount,
      sub: isId ? 'Perlu label QR' : 'Tag required',
      accent: kpis.missingQrCount > 0,
    },
  ];

  const hasPerm = (perm: string | null) =>
    perm === null || !user || user.role_code === 'super_admin' || user.permissions.includes(perm);

  const quickActions: {
    key: ModuleKey;
    label: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    perm: string | null;
  }[] = [
    {
      key: 'qr',
      label: t.quickActions.scanQr,
      desc: t.quickActions.scanQrDesc,
      icon: QrCode,
      perm: 'qr.view',
    },
    {
      key: 'register',
      label: t.quickActions.newRegistration,
      desc: t.quickActions.newRegistrationDesc,
      icon: PlusSquare,
      perm: 'assets.create',
    },
    {
      key: 'reports',
      label: t.quickActions.generateReport,
      desc: t.quickActions.generateReportDesc,
      icon: FileBarChart2,
      perm: 'reports.view',
    },
    {
      key: 'opname',
      label: t.quickActions.stockOpname,
      desc: t.quickActions.stockOpnameDesc,
      icon: ClipboardCheck,
      perm: 'opname.view',
    },
  ];

  const visibleQuickActions = quickActions.filter((action) => hasPerm(action.perm));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">{t.title}</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isId ? 'Muat Ulang' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('register')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <span>+ {translations[lang].nav.register}</span>
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      {visibleQuickActions.length > 0 && (
        <section aria-labelledby="quick-actions-heading" className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="quick-actions-heading"
              className="font-display text-xs font-semibold tracking-wide text-neutral-600 dark:text-neutral-400"
            >
              {t.quickActionsTitle}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {visibleQuickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => onNavigate(action.key)}
                  className="group w-full text-left bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 hover:border-[#C8102E]/60 dark:hover:border-red-500/50 rounded-lg px-4 py-3.5 flex items-center gap-3.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8102E]"
                >
                  <span className="w-9 h-9 rounded-md bg-neutral-100 dark:bg-[#1E222A] text-[#C8102E] dark:text-red-400 group-hover:bg-[#C8102E] group-hover:text-white flex items-center justify-center shrink-0 transition-colors duration-150">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-xs font-semibold text-[#141619] dark:text-neutral-100 truncate">
                      {action.label}
                    </span>
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                      {action.desc}
                    </span>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 group-hover:text-[#C8102E] dark:group-hover:text-red-400 group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 flex flex-col justify-between"
          >
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{card.label}</span>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span
                className={`font-display text-2xl font-bold tabular-nums ${
                  card.accent ? 'text-[#C8102E] dark:text-red-400' : 'text-[#141619] dark:text-neutral-100'
                }`}
              >
                {card.value}
              </span>
              <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 tabular-nums truncate">
                {card.sub}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 6 Charts Grid + D3 Lifecycle Line Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Asset by Category */}
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-4">{t.chartCategory}</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.byCategory} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <Tooltip {...tooltipProps} cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" fill={primaryBarFill} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Asset by Location */}
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">{t.chartLocation}</h3>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
                {isId
                  ? `${charts.byLocation.length} titik lokasi terdaftar · proporsi distribusi aset aktif`
                  : `${charts.byLocation.length} registered locations · active asset distribution`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('locations')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#C8102E] dark:text-red-400 hover:underline whitespace-nowrap shrink-0"
            >
              <span>{isId ? 'Kelola Lokasi' : 'Locations'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {charts.byLocation.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-8 text-xs text-neutral-500 dark:text-neutral-400">
              {isId ? 'Belum ada data aset per lokasi.' : 'No location asset data available.'}
            </div>
          ) : (
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {(() => {
                const maxLocCount = Math.max(1, ...charts.byLocation.map((l: any) => Number(l.count) || 0));
                const totalLocAssets = Math.max(
                  1,
                  charts.byLocation.reduce((acc: number, l: any) => acc + (Number(l.count) || 0), 0)
                );
                return charts.byLocation.map((loc: any, idx: number) => {
                  const count = Number(loc.count) || 0;
                  const pctWidth = Math.round((count / maxLocCount) * 100);
                  const sharePct = Math.round((count / totalLocAssets) * 100);
                  const primaryTitle = loc.specific_location || loc.name;
                  const subPath = [loc.company_name, loc.building_name, loc.room_name].filter(Boolean).join(' · ');

                  return (
                    <div key={loc.location_id || `${primaryTitle}-${idx}`} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-[#141619] dark:text-neutral-100 truncate">
                            {primaryTitle}
                          </div>
                          {subPath && (
                            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                              {subPath}
                            </div>
                          )}
                        </div>
                        <div className="flex items-baseline gap-2 shrink-0 text-right tabular-nums">
                          {Number(loc.total_value) > 0 && (
                            <span className="hidden sm:inline text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                              {formatIDR(Number(loc.total_value))}
                            </span>
                          )}
                          <span className="font-mono font-semibold text-[#141619] dark:text-neutral-100">
                            {count}
                          </span>
                          <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 w-9 text-right">
                            {sharePct}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-neutral-100 dark:bg-[#1E222A] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            idx === 0 ? 'bg-[#C8102E] dark:bg-red-500' : 'bg-[#141619] dark:bg-neutral-300'
                          }`}
                          style={{ width: `${count > 0 ? Math.max(6, pctWidth) : 0}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* 3. Asset Condition */}
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-4">{t.chartCondition}</h3>
          <div className="h-60 flex items-center">
            <ResponsiveContainer width="58%" height="100%">
              <PieChart>
                <Pie data={charts.byCondition} dataKey="count" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                  {charts.byCondition.map((entry: any, i: number) => (
                    <Cell key={entry.name} fill={conditionColors[entry.name] || palette[i % palette.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipProps} />
              </PieChart>
            </ResponsiveContainer>
            <div className="w-[42%] space-y-2.5 text-xs">
              {charts.byCondition.map((entry: any, i: number) => (
                <div key={entry.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: conditionColors[entry.name] || palette[i % palette.length] }}
                    />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="font-mono font-semibold text-[#141619] dark:text-neutral-100 tabular-nums">
                    {entry.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Asset Acquisition per Year */}
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-4">{t.chartAcquisition}</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.acquisitionByYear} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <Tooltip {...tooltipProps} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={crimsonStroke}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: primaryBarFill, stroke: crimsonStroke, strokeWidth: 1.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 5. Maintenance Status */}
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-4">{t.chartMaintenance}</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.maintenanceByStatus} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <Tooltip {...tooltipProps} cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" fill={secondaryBarFill} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 6. Movement History */}
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 mb-4">{t.chartMovement}</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.movementHistoryChart} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={gridStroke} />
                <Tooltip {...tooltipProps} cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" fill={primaryBarFill} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 7. 12-Month Acquisition & Retirement Trends (D3.js Line Chart) */}
        <div className="lg:col-span-2 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <TrendingUp className="w-4 h-4 text-[#C8102E] dark:text-red-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">{t.chartLifecycle}</h3>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">{t.chartLifecycleDesc}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('replacement')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#C8102E] dark:text-red-400 hover:underline whitespace-nowrap shrink-0"
            >
              <span>{isId ? 'Rencana Penggantian' : 'Replacement Plan'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <D3LifecycleLineChart data={charts.monthlyLifecycleTrends || []} lang={lang} theme={theme} />
        </div>
      </div>

      {/* Recent Activity Widget: Latest 5 Asset Registrations & Status Changes */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#C8102E] dark:text-red-400 shrink-0" />
            <div>
              <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Aktivitas Terbaru' : 'Recent Activity'}
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {isId
                  ? '5 registrasi aset atau perubahan status terbaru beserta pratinjau foto untuk verifikasi cepat.'
                  : 'Latest 5 asset registrations or status changes with thumbnail previews for quick visual verification.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('database')}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#C8102E] dark:text-red-400 hover:underline whitespace-nowrap shrink-0"
          >
            <span>{isId ? 'Buka Database Aset' : 'Open Asset Database'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {recentActivity.length === 0 ? (
            <div className="p-6 text-xs text-neutral-500 dark:text-neutral-400 text-center">
              {isId ? 'Belum ada aktivitas aset terbaru.' : 'No recent asset registrations or status changes.'}
            </div>
          ) : (
            recentActivity.slice(0, 5).map((item: any) => {
              const hasPhoto = Boolean(
                item.primary_photo_url &&
                  isSafeExternalUrl(item.primary_photo_url) &&
                  !brokenThumbs[item.activity_id]
              );
              const badgeColor =
                item.action === 'ASSET_REGISTERED'
                  ? 'bg-[#141619] dark:bg-neutral-100 text-white dark:text-[#141619] border-[#141619] dark:border-neutral-100'
                  : item.action.startsWith('MAINTENANCE')
                  ? 'bg-red-50 dark:bg-red-950/40 text-[#C8102E] dark:text-red-300 border-red-200 dark:border-red-900/60'
                  : item.action.startsWith('MOVEMENT')
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900/60'
                  : 'bg-neutral-100 dark:bg-[#1E222A] text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700';

              return (
                <div
                  key={item.activity_id}
                  className="px-5 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4 hover:bg-neutral-50/70 dark:hover:bg-[#1E222A]/60 transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {hasPhoto ? (
                      <button
                        type="button"
                        onClick={() => setLightboxItem(item)}
                        className="w-12 h-12 rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-[#1E222A] shrink-0 hover:border-[#C8102E] transition-colors cursor-zoom-in"
                        title={isId ? 'Verifikasi foto aset' : 'Inspect asset photo'}
                      >
                        <img
                          src={item.primary_photo_url}
                          alt={item.asset_name}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setBrokenThumbs((prev) => ({ ...prev, [item.activity_id]: true }))
                          }
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="w-12 h-12 rounded-md bg-neutral-100 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-400 dark:text-neutral-500 shrink-0">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${badgeColor}`}>
                          {item.activity_label}
                        </span>
                        <span className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{item.asset_code}</span>
                        <span className="text-xs font-semibold text-[#141619] dark:text-neutral-100 truncate">
                          {item.asset_name}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 truncate">
                        {item.category_name} · {item.location_label}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-xs">
                    <div className="flex flex-col sm:items-end gap-1">
                      <div className="flex items-center gap-2">
                        <ConditionLabel condition={item.condition_status} />
                        <StatusLabel status={item.asset_status} />
                      </div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                        {item.actor_name} · {String(item.occurred_at).slice(0, 16).replace('T', ' ')}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Bottom Operational Feeds: Recent Movements & Automated Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">{t.recentMovements}</h3>
            <button
              type="button"
              onClick={() => onNavigate('movements')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#C8102E] dark:text-red-400 hover:underline whitespace-nowrap shrink-0"
            >
              <span>{isId ? 'Lihat semua' : 'View all'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{isId ? 'Aset' : 'Asset'}</th>
                  <th className="px-4 py-2.5 font-medium">{isId ? 'Rute' : 'Route'}</th>
                  <th className="px-4 py-2.5 font-medium">{isId ? 'Tanggal' : 'Date'}</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {recentMovements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-neutral-500 dark:text-neutral-400">
                      {isId ? 'Belum ada perpindahan aset terbaru' : 'No recent movements'}
                    </td>
                  </tr>
                ) : (
                  recentMovements.map((m: any) => (
                    <tr key={m.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60">
                      <td className="px-4 py-2.5">
                        <div className="font-mono font-semibold text-[#141619] dark:text-neutral-100">{m.asset_code}</div>
                        <div className="text-neutral-500 dark:text-neutral-400 truncate max-w-[180px]">{m.asset_name}</div>
                      </td>
                      <td className="px-4 py-2.5 text-neutral-700 dark:text-neutral-300">
                        <div>{m.from_location_label}</div>
                        <div className="text-neutral-400 dark:text-neutral-500">→ {m.to_location_label}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-neutral-600 dark:text-neutral-400 whitespace-nowrap tabular-nums">
                        {String(m.movement_date).slice(0, 10)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusLabel status={m.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">{t.alertsTitle}</h3>
            <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
              {notifications.length} {isId ? 'aktif' : 'active'}
            </span>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-xs text-neutral-500 dark:text-neutral-400 text-center">
                {isId ? 'Tidak ada peringatan pemeliharaan atau penggantian tertunda.' : 'No pending maintenance or replacement alerts.'}
              </div>
            ) : (
              notifications.map((n: NotificationItem) => (
                <div key={n.id} className="px-5 py-3 flex items-start gap-3">
                  <AlertTriangle
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      n.priority === 'Critical' || n.priority === 'High'
                        ? 'text-[#C8102E] dark:text-red-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#141619] dark:text-neutral-100 truncate">{n.title}</span>
                      <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 shrink-0">{n.priority}</span>
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5 leading-snug">{n.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {lightboxItem && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-xl w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{lightboxItem.asset_code}</div>
                <div className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 truncate">
                  {lightboxItem.asset_name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxItem(null)}
                className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-neutral-950 flex items-center justify-center p-4 max-h-[70vh]">
              <img
                src={lightboxItem.primary_photo_url}
                alt={lightboxItem.asset_name}
                referrerPolicy="no-referrer"
                className="max-h-[62vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

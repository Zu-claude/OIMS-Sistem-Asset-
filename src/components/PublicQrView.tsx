import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  LogIn,
  ArrowLeft,
  Building2,
  MapPin,
  Tag,
  Image as ImageIcon,
  Sun,
  Moon,
  Languages,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { ConditionLabel, StatusLabel } from './StatusText';
import { isSafeExternalUrl } from '../lib/workspace';
import type { Lang } from '../types/oims';

interface PublicQrViewProps {
  slugOrToken: string;
  logoUrl?: string;
  lang: Lang;
  theme: 'light' | 'dark';
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onRequestSignIn: () => void;
  onDismissPublicView: () => void;
}

interface PublicQrPayload {
  access_tier: 'public';
  asset: {
    asset_code: string;
    asset_name: string;
    category_name: string;
    brand?: string | null;
    model?: string | null;
    condition_status: string;
    asset_status: string;
    public_slug: string;
    qr_status: string;
    company_name?: string | null;
    general_location?: string | null;
    primary_photo_url?: string | null;
  };
}

export const PublicQrView: React.FC<PublicQrViewProps> = ({
  slugOrToken,
  logoUrl,
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  onRequestSignIn,
  onDismissPublicView,
}) => {
  const isId = lang === 'id';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PublicQrPayload | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ code: string; message: string; status: number } | null>(null);
  const [photoBroken, setPhotoBroken] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorInfo(null);
    setPhotoBroken(false);

    fetch(`/api/public/qr/${encodeURIComponent(slugOrToken)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setData(null);
          setErrorInfo({
            code: String(body.code || 'ERROR'),
            message: String(body.error || `Error (${res.status})`),
            status: res.status,
          });
        } else {
          setData(body as PublicQrPayload);
        }
      })
      .catch(() => {
        if (!active) return;
        setErrorInfo({
          code: 'NETWORK_ERROR',
          message: isId ? 'Gagal menghubungi server verifikasi QR.' : 'Failed to reach QR verification server.',
          status: 500,
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slugOrToken, isId]);

  const getErrorHeading = (code: string) => {
    switch (code) {
      case 'QR_REVOKED':
        return isId ? 'Token QR Telah Dicabut (Revoked)' : 'QR Token Has Been Revoked';
      case 'QR_EXPIRED':
        return isId ? 'Tautan Verifikasi QR Kedaluwarsa' : 'QR Verification Link Expired';
      case 'PUBLIC_DISABLED':
        return isId ? 'Akses Publik Dinonaktifkan' : 'Public Asset View Disabled';
      case 'RATE_LIMITED':
        return isId ? 'Batas Permintaan Terlampaui' : 'Rate Limit Exceeded';
      default:
        return isId ? 'Aset QR Tidak Ditemukan' : 'QR Asset Record Not Found';
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0F1115] text-[#141619] dark:text-neutral-100 flex flex-col">
      <header className="bg-white dark:bg-[#171A20] border-b border-neutral-200 dark:border-neutral-800 px-4 lg:px-8 py-3 flex items-center justify-between gap-4">
        <BrandMark logoUrl={logoUrl} darkSurface={false} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <Languages className="w-3.5 h-3.5" />
            <span className="font-mono uppercase">{lang}</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="p-1.5 text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
            title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onRequestSignIn}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>{isId ? 'Masuk untuk Detail Penuh' : 'Sign In for Full Details'}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 lg:p-8">
        <div className="max-w-xl w-full space-y-4">
          {loading ? (
            <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-8 text-center text-xs text-neutral-500 dark:text-neutral-400 font-mono">
              {isId ? 'Memverifikasi identitas QR publik...' : 'Verifying public QR identity...'}
            </div>
          ) : errorInfo ? (
            <div className="bg-white dark:bg-[#171A20] border border-red-200 dark:border-red-900/60 rounded-lg p-6 space-y-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-md bg-red-50 dark:bg-red-950/40 text-[#C8102E] dark:text-red-400 shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-[#C8102E] dark:text-red-400">
                    HTTP {errorInfo.status} · {errorInfo.code}
                  </div>
                  <h1 className="font-display text-lg font-bold text-[#141619] dark:text-neutral-100">
                    {getErrorHeading(errorInfo.code)}
                  </h1>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{errorInfo.message}</p>
                </div>
              </div>

              <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onDismissPublicView}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{isId ? 'Kembali ke Halaman Login' : 'Back to Login Page'}</span>
                </button>
                <button
                  type="button"
                  onClick={onRequestSignIn}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md hover:bg-neutral-800 dark:hover:bg-[#A10D24]"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{isId ? 'Masuk sebagai Petugas' : 'Sign In as Staff'}</span>
                </button>
              </div>
            </div>
          ) : (
            data && (
              <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 bg-[#141619] text-white flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>{isId ? 'Mode Akses 1 · Tampilan Aset Publik Terbatas' : 'Access Tier 1 · Limited Public Asset View'}</span>
                  </div>
                  <span className="font-mono text-[11px] text-neutral-300">{data.asset.asset_code}</span>
                </div>

                <div className="p-5 space-y-5">
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="w-full sm:w-36 h-36 rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-[#1E222A] shrink-0 flex items-center justify-center">
                      {data.asset.primary_photo_url && isSafeExternalUrl(data.asset.primary_photo_url) && !photoBroken ? (
                        <img
                          src={data.asset.primary_photo_url}
                          alt={data.asset.asset_name}
                          referrerPolicy="no-referrer"
                          onError={() => setPhotoBroken(true)}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400 px-2 text-center">
                          <ImageIcon className="w-5 h-5 text-neutral-400" />
                          <span>
                            {data.asset.primary_photo_url
                              ? isId
                                ? 'Foto Aset'
                                : 'Asset Photo'
                              : isId
                              ? 'Foto Disembunyikan / Tidak Tersedia'
                              : 'Photo Hidden / Unavailable'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">
                        {data.asset.asset_code}
                      </div>
                      <h1 className="font-display text-lg font-bold text-[#141619] dark:text-neutral-100 leading-snug">
                        {data.asset.asset_name}
                      </h1>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                        <span className="inline-flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5" />
                          {data.asset.category_name}
                        </span>
                        {(data.asset.brand || data.asset.model) && (
                          <span>
                            · {[data.asset.brand, data.asset.model].filter(Boolean).join(' ')}
                          </span>
                        )}
                      </div>
                      <div className="pt-1 flex flex-wrap items-center gap-3">
                        <ConditionLabel condition={data.asset.condition_status} />
                        <StatusLabel status={data.asset.asset_status} />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-md bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 text-xs">
                    <div>
                      <div className="text-neutral-500 dark:text-neutral-400 flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>{isId ? 'Entitas Perusahaan' : 'Company Entity'}</span>
                      </div>
                      <div className="font-medium text-[#141619] dark:text-neutral-100 mt-0.5">
                        {data.asset.company_name || (isId ? 'Disembunyikan (Privasi Publik)' : 'Restricted (Public Privacy)')}
                      </div>
                    </div>
                    <div>
                      <div className="text-neutral-500 dark:text-neutral-400 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{isId ? 'Lokasi Umum' : 'General Location'}</span>
                      </div>
                      <div className="font-medium text-[#141619] dark:text-neutral-100 mt-0.5">
                        {data.asset.general_location || (isId ? 'Disembunyikan (Privasi Publik)' : 'Restricted (Public Privacy)')}
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-md bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                    <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold">
                        {isId
                          ? 'Data Finansial, Dokumen & Riwayat Dilindungi'
                          : 'Financial, Document & History Records Protected'}
                      </div>
                      <p className="text-[11px] opacity-90 leading-relaxed">
                        {isId
                          ? 'Kepemilikan tautan QR tidak memberikan akses ke nilai perolehan, pemasok, kontak PIC, dokumen pengadaan, atau jejak audit. Masuk dengan akun resmi untuk tampilan Terotentikasi (Tier 2) atau Administratif (Tier 3).'
                          : 'Possessing a QR URL does not expose acquisition values, suppliers, custodian contacts, procurement files, or audit trails. Sign in with your corporate account for Authenticated (Tier 2) or Administrative (Tier 3) inspection.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                    <button
                      type="button"
                      onClick={onDismissPublicView}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>{isId ? 'Portal Login KIDECO' : 'KIDECO Login Portal'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={onRequestSignIn}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>{isId ? 'Masuk & Buka Detail Operasional' : 'Sign In & Inspect Full Record'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
};

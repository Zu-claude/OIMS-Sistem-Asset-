import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { apiFetch, setSessionToken } from '../lib/api';
import { translations } from '../i18n/translations';
import type { AuthUser, Lang } from '../types/oims';
import { BrandMark } from './BrandMark';

interface LoginViewProps {
  needsSetup: boolean;
  installStatus?: {
    tableCount: number;
    expectedTableCount: number;
    tablesReady: boolean;
    hasAdminUser: boolean;
  } | null;
  smtpConfigured?: boolean;
  logoUrl?: string;
  lang: Lang;
  theme?: 'light' | 'dark';
  onToggleLang: () => void;
  onToggleTheme?: () => void;
  onAuthenticated: (user: AuthUser) => void;
}

type AuthViewMode = 'login' | 'forgot';
type ResetStep = 'request' | 'verify' | 'new_password';

export const LoginView: React.FC<LoginViewProps> = ({
  needsSetup,
  installStatus,
  smtpConfigured = false,
  logoUrl,
  lang,
  theme = 'light',
  onToggleLang,
  onToggleTheme,
  onAuthenticated,
}) => {
  const t = translations[lang];
  const isId = lang === 'id';

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password & email confirmation state
  const [viewMode, setViewMode] = useState<AuthViewMode>('login');
  const [resetStep, setResetStep] = useState<ResetStep>('request');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // First-run installer state
  const [setupUsername, setSetupUsername] = useState('admin');
  const [setupEmail, setSetupEmail] = useState('admin@kideco.co.id');
  const [setupName, setSetupName] = useState('Super Administrator');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [seedRoles, setSeedRoles] = useState(true);

  const [heroImgError, setHeroImgError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  // Handle reset link query params (?reset_token=...&email=...)
  useEffect(() => {
    if (needsSetup) return;
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('reset_token')?.trim() || '';
    const emailParam = params.get('email')?.trim() || '';
    if (!tokenParam || !emailParam) return;

    window.history.replaceState({}, '', window.location.pathname);
    setViewMode('forgot');
    setResetEmail(emailParam);
    setResetToken(tokenParam);
    setError('');
    setInfoMsg('');
    setLoading(true);

    apiFetch<{ ok: boolean; verified: boolean }>('/api/auth/verify-reset-code', {
      method: 'POST',
      body: JSON.stringify({ email: emailParam, token: tokenParam }),
    })
      .then(() => {
        setResetStep('new_password');
        setInfoMsg(
          isId
            ? 'Konfirmasi email berhasil. Silakan buat password baru Anda.'
            : 'Email confirmation verified. Please enter your new password.'
        );
      })
      .catch((err: any) => {
        setResetStep('request');
        setResetToken('');
        setError(
          err?.message ||
            (isId
              ? 'Tautan reset password tidak valid atau sudah kedaluwarsa.'
              : 'Reset link is invalid or has expired.')
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [needsSetup, isId]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const openForgotPassword = () => {
    setError('');
    setInfoMsg('');
    setViewMode('forgot');
    setResetStep('request');
    setResetCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmNewPassword('');
    if (identifier.includes('@')) {
      setResetEmail(identifier.trim());
    }
  };

  const backToLogin = () => {
    setViewMode('login');
    setResetStep('request');
    setError('');
    setInfoMsg('');
    setResetCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      setSessionToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || (isId ? 'Autentikasi gagal.' : 'Authentication failed.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRequestResetCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setInfoMsg('');
    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError(isId ? 'Masukkan alamat email perusahaan yang valid.' : 'Please enter a valid corporate email address.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail }),
      });
      setResetEmail(cleanEmail);
      setResetToken('');
      setResetStep('verify');
      setResendCooldown(60);
      setInfoMsg(
        isId
          ? `Jika email ${cleanEmail} terdaftar dan aktif, kode konfirmasi 6 digit dan tautan reset telah dikirim.`
          : `If ${cleanEmail} is registered and active, a 6-digit confirmation code and reset link have been sent.`
      );
    } catch (err: any) {
      setError(err.message || (isId ? 'Gagal mengirim email konfirmasi.' : 'Failed to send confirmation email.'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    const cleanCode = resetCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError(isId ? 'Masukkan kode verifikasi 6 digit angka.' : 'Please enter the 6-digit numeric verification code.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch<{ ok: boolean; verified: boolean }>('/api/auth/verify-reset-code', {
        method: 'POST',
        body: JSON.stringify({ email: resetEmail.trim().toLowerCase(), code: cleanCode }),
      });
      setResetStep('new_password');
      setInfoMsg(
        isId
          ? 'Email terkonfirmasi. Silakan masukkan password baru Anda.'
          : 'Email confirmed. Please enter your new password.'
      );
    } catch (err: any) {
      setError(err.message || (isId ? 'Kode verifikasi tidak valid atau kedaluwarsa.' : 'Invalid or expired verification code.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');

    if (newPassword.length < 8) {
      setError(isId ? 'Password baru minimal 8 karakter.' : 'New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(isId ? 'Konfirmasi password baru tidak cocok.' : 'New password confirmation does not match.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: resetEmail.trim().toLowerCase(),
          ...(resetToken ? { token: resetToken } : { code: resetCode.trim() }),
          new_password: newPassword,
          confirm_password: confirmNewPassword,
        }),
      });
      const emailSaved = resetEmail.trim().toLowerCase();
      setViewMode('login');
      setResetStep('request');
      setResetCode('');
      setResetToken('');
      setNewPassword('');
      setConfirmNewPassword('');
      setIdentifier(emailSaved);
      setPassword('');
      setInfoMsg(
        isId
          ? 'Password berhasil direset. Silakan masuk menggunakan password baru Anda.'
          : 'Password reset successfully. Please sign in with your new password.'
      );
    } catch (err: any) {
      setError(err.message || (isId ? 'Gagal mereset password.' : 'Failed to reset password.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (setupPassword.length < 8) {
      setError(
        isId
          ? 'Kata sandi Super Administrator minimal 8 karakter.'
          : 'Super Administrator password must be at least 8 characters.'
      );
      return;
    }
    if (setupPassword !== setupConfirmPassword) {
      setError(isId ? 'Konfirmasi kata sandi tidak cocok.' : 'Password confirmation does not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/install/run', {
        method: 'POST',
        body: JSON.stringify({
          username: setupUsername,
          email: setupEmail,
          full_name: setupName,
          password: setupPassword,
          confirmPassword: setupConfirmPassword,
          seedRoleAccounts: seedRoles,
        }),
      });
      setSessionToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2.5 text-sm bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#C8102E]/25 focus:border-[#C8102E] transition-colors';

  return (
    <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0F1115] flex flex-col justify-between p-4 sm:p-6 lg:p-10 transition-colors">
      {/* Top Bar */}
      <div className="flex items-center justify-between max-w-6xl w-full mx-auto gap-4">
        <BrandMark logoUrl={logoUrl} darkSurface={false} />
        <div className="flex items-center gap-2 shrink-0">
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
              aria-label={t.topbar.toggleTheme}
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">{t.topbar.themeLight}</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-neutral-600" />
                  <span className="hidden sm:inline">{t.topbar.themeDark}</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
            <span className="font-mono">{lang === 'id' ? 'ID / EN' : 'EN / ID'}</span>
          </button>
        </div>
      </div>

      {/* Main Executive Split Card */}
      <div className="max-w-6xl w-full mx-auto my-6 lg:my-8 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left Corporate Split Visual Panel */}
        <div className="lg:col-span-6 relative min-h-[300px] lg:min-h-[580px] bg-[#141619] text-white flex flex-col justify-between p-7 sm:p-10 overflow-hidden">
          {!heroImgError && (
            <img
              src="/src/assets/images/kideco_corporate_hq_1795696330249.jpg"
              alt="KIDECO Corporate Office Architecture"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgError(true)}
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-[#0D0F12]/95 via-[#141619]/75 to-[#141619]/55"
          />

          <div className="relative z-10">
            <p className="text-[11px] font-mono font-semibold text-red-400 tracking-widest uppercase mb-3">
              {t.roadmapTag}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-white text-balance">
              Office Inventory Management System
            </h1>
            <p className="mt-3 text-sm text-neutral-200 leading-relaxed max-w-md">
              {t.vision}
            </p>
          </div>

          <div className="relative z-10 mt-10 pt-6 border-t border-white/15 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-300">
                {isId ? 'Pengkodean Aset Terstandar' : 'Standardized Asset Coding'}
              </span>
              <span className="font-mono font-medium text-white tabular-nums">OIMS-2027-000001</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-300">
                {isId ? 'Verifikasi & Pelacakan' : 'Verification & Tracking'}
              </span>
              <span className="text-neutral-100 font-medium">QR Tagging · Stock Opname</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-neutral-300">
                {isId ? 'Penyimpanan & Pelaporan' : 'Storage & Reporting'}
              </span>
              <span className="text-neutral-100 font-medium">
                {isId ? 'Server Lokal · Excel · PDF · SQL' : 'Local Server · Excel · PDF · SQL'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Authentication Form Panel */}
        <div className="lg:col-span-6 p-6 sm:p-10 lg:p-12 flex flex-col justify-center bg-white dark:bg-[#171A20]">
          <div className="max-w-md w-full mx-auto">
            <div className="flex items-center gap-2.5 mb-2">
              {needsSetup ? (
                <ShieldCheck className="w-5 h-5 text-[#C8102E] dark:text-red-400 shrink-0" />
              ) : viewMode === 'forgot' ? (
                <KeyRound className="w-5 h-5 text-[#C8102E] dark:text-red-400 shrink-0" />
              ) : (
                <Lock className="w-5 h-5 text-[#C8102E] dark:text-red-400 shrink-0" />
              )}
              <h2 className="font-display text-xl sm:text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
                {needsSetup
                  ? t.auth.setupTitle
                  : viewMode === 'forgot'
                    ? t.auth.forgotPasswordTitle
                    : t.auth.loginTitle}
              </h2>
            </div>

            <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
              {needsSetup
                ? t.auth.setupDesc
                : viewMode === 'forgot'
                  ? t.auth.forgotPasswordDesc
                  : 'PT Kideco Jaya Agung · Member of Indika Energy Group'}
            </p>

            {error && (
              <div className="mb-4 px-3.5 py-2.5 text-xs font-medium text-[#C8102E] dark:text-red-300 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md">
                {error}
              </div>
            )}

            {infoMsg && (
              <div className="mb-4 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 rounded-md flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" />
                <span>{infoMsg}</span>
              </div>
            )}

            {needsSetup ? (
              <form onSubmit={handleSetup} className="space-y-4">
                {installStatus && (
                  <div className="px-3.5 py-2.5 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md text-[11px] text-neutral-700 dark:text-neutral-300 flex items-center justify-between gap-2">
                    <span>
                      {isId ? 'Pemeriksaan Tabel Database:' : 'Database Table Check:'}{' '}
                      <strong className="font-mono text-[#141619] dark:text-neutral-100 tabular-nums">
                        {installStatus.tableCount}/{installStatus.expectedTableCount}
                      </strong>
                    </span>
                    <span className="font-semibold text-[#C8102E] dark:text-red-400">
                      {isId ? 'Akun Admin Belum Terisi' : 'No Super Admin User Yet'}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      {t.auth.username}
                    </label>
                    <input
                      type="text"
                      required
                      value={setupUsername}
                      onChange={(e) => setSetupUsername(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      {t.auth.fullName}
                    </label>
                    <input
                      type="text"
                      required
                      value={setupName}
                      onChange={(e) => setSetupName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                    {t.auth.email} *
                  </label>
                  <input
                    type="email"
                    required
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder="admin@kideco.co.id"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      {t.auth.password} (min. 8)
                    </label>
                    <div className="relative">
                      <input
                        type={showSetupPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={setupPassword}
                        onChange={(e) => setSetupPassword(e.target.value)}
                        placeholder="Min. 8 karakter"
                        className={`${inputClass} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSetupPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                        aria-label={showSetupPassword ? 'Hide password' : 'Show password'}
                      >
                        {showSetupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      {isId ? 'Konfirmasi Sandi' : 'Confirm Password'}
                    </label>
                    <input
                      type={showSetupPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={setupConfirmPassword}
                      onChange={(e) => setSetupConfirmPassword(e.target.value)}
                      placeholder={isId ? 'Ulangi sandi' : 'Repeat password'}
                      className={inputClass}
                    />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seedRoles}
                    onChange={(e) => setSeedRoles(e.target.checked)}
                    className="mt-0.5 accent-[#C8102E]"
                  />
                  <span>{t.auth.seedRolesOption}</span>
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-50"
                >
                  {loading ? '...' : t.auth.createAdminBtn}
                </button>
              </form>
            ) : viewMode === 'forgot' ? (
              <div className="space-y-4">
                {/* Step Indicator */}
                <div className="grid grid-cols-3 gap-2 text-[11px] font-medium">
                  <div
                    className={`px-2.5 py-1.5 rounded border text-center ${
                      resetStep === 'request'
                        ? 'bg-[#C8102E]/10 border-[#C8102E] text-[#C8102E] dark:text-red-400'
                        : 'bg-neutral-50 dark:bg-[#1E222A] border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400'
                    }`}
                  >
                    1. Email
                  </div>
                  <div
                    className={`px-2.5 py-1.5 rounded border text-center ${
                      resetStep === 'verify'
                        ? 'bg-[#C8102E]/10 border-[#C8102E] text-[#C8102E] dark:text-red-400'
                        : 'bg-neutral-50 dark:bg-[#1E222A] border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400'
                    }`}
                  >
                    2. {isId ? 'Konfirmasi' : 'Verify'}
                  </div>
                  <div
                    className={`px-2.5 py-1.5 rounded border text-center ${
                      resetStep === 'new_password'
                        ? 'bg-[#C8102E]/10 border-[#C8102E] text-[#C8102E] dark:text-red-400'
                        : 'bg-neutral-50 dark:bg-[#1E222A] border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400'
                    }`}
                  >
                    3. {isId ? 'Password Baru' : 'New Password'}
                  </div>
                </div>

                {!smtpConfigured && resetStep === 'request' && (
                  <div className="px-3.5 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-md text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                    {isId
                      ? 'Layanan email SMTP server belum dikonfigurasi. Atur variabel SMTP_HOST, SMTP_USER, dan SMTP_PASS di pengaturan server agar email konfirmasi dapat dikirim.'
                      : 'Server SMTP email delivery is not configured yet. Configure SMTP_HOST, SMTP_USER, and SMTP_PASS on the server to send confirmation emails.'}
                  </div>
                )}

                {resetStep === 'request' && (
                  <form onSubmit={handleRequestResetCode} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        {t.auth.email} *
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="email"
                          required
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          placeholder="nama@kideco.co.id"
                          className={`${inputClass} pl-9`}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-50"
                    >
                      {loading ? '...' : t.auth.sendResetCodeBtn}
                    </button>
                  </form>
                )}

                {resetStep === 'verify' && (
                  <form onSubmit={handleVerifyResetCode} className="space-y-4">
                    <div className="px-3 py-2 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md text-xs text-neutral-700 dark:text-neutral-300 flex items-center justify-between gap-2">
                      <span className="truncate font-mono">{resetEmail}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setResetStep('request');
                          setError('');
                          setInfoMsg('');
                        }}
                        className="text-[11px] font-semibold text-[#C8102E] dark:text-red-400 hover:underline shrink-0"
                      >
                        {isId ? 'Ubah Email' : 'Change'}
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        {t.auth.verificationCode} *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        maxLength={6}
                        pattern="\d{6}"
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-50"
                    >
                      {loading ? '...' : t.auth.verifyCodeBtn}
                    </button>

                    <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 pt-1">
                      <span>{isId ? 'Belum menerima kode?' : "Didn't receive the code?"}</span>
                      <button
                        type="button"
                        disabled={loading || resendCooldown > 0}
                        onClick={() => handleRequestResetCode()}
                        className="font-semibold text-[#C8102E] dark:text-red-400 hover:underline disabled:text-neutral-400 dark:disabled:text-neutral-600 disabled:no-underline"
                      >
                        {resendCooldown > 0 ? `${t.auth.resendCode} (${resendCooldown}s)` : t.auth.resendCode}
                      </button>
                    </div>
                  </form>
                )}

                {resetStep === 'new_password' && (
                  <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                    <div className="px-3 py-2 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded-md text-xs text-neutral-700 dark:text-neutral-300 flex items-center justify-between">
                      <span className="font-mono truncate">{resetEmail}</span>
                      <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {isId ? 'Email Terverifikasi' : 'Email Verified'}
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        {t.auth.newPassword} *
                      </label>
                      <div className="relative">
                        <input
                          type={showResetPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          maxLength={128}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min. 8 karakter"
                          className={`${inputClass} pr-10`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowResetPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                          aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                        >
                          {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                        {t.auth.confirmNewPassword} *
                      </label>
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        maxLength={128}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder={isId ? 'Ulangi password baru' : 'Repeat new password'}
                        className={inputClass}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-50"
                    >
                      {loading ? '...' : t.auth.resetPasswordBtn}
                    </button>
                  </form>
                )}

                <button
                  type="button"
                  onClick={backToLogin}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-neutral-100 pt-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{t.auth.backToLogin}</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                    {t.auth.usernameOrEmail}
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="admin@kideco.co.id"
                    className={inputClass}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      {t.auth.password}
                    </label>
                    <button
                      type="button"
                      onClick={openForgotPassword}
                      className="text-xs font-medium text-[#C8102E] dark:text-red-400 hover:underline"
                    >
                      {t.auth.forgotPassword}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${inputClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-50 mt-2"
                >
                  {loading ? '...' : t.auth.signIn}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>PT Kideco Jaya Agung · Office Inventory Digitalization</span>
        <span>OIMS Platform · MySQL & Local Storage Ready</span>
      </div>
    </div>
  );
};

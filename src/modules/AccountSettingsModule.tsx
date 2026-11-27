import React, { useEffect, useState } from 'react';
import {
  User as UserIcon,
  Lock,
  Camera,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Save,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { isSafeExternalUrl } from '../lib/workspace';
import type { AuthUser, Lang } from '../types/oims';

interface AccountSettingsModuleProps {
  lang: Lang;
  user: AuthUser;
  onUserUpdated: (updatedUser: AuthUser, newToken?: string) => void;
}

export const AccountSettingsModule: React.FC<AccountSettingsModuleProps> = ({
  lang,
  user,
  onUserUpdated,
}) => {
  const isId = lang === 'id';

  const [profileForm, setProfileForm] = useState({
    username: user.username || '',
    full_name: user.full_name || '',
    email: user.email || '',
    phone: user.phone || '',
    department: user.department || '',
    position_title: user.position_title || '',
  });

  useEffect(() => {
    setProfileForm({
      username: user.username || '',
      full_name: user.full_name || '',
      email: user.email || '',
      phone: user.phone || '',
      department: user.department || '',
      position_title: user.position_title || '',
    });
  }, [user]);

  const [pwForm, setPwForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setAvatarBroken(false);
  }, [user.avatar_url]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingProfile(true);
    try {
      const res = await apiFetch<{ user: AuthUser; token?: string }>('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify(profileForm),
      });
      onUserUpdated(res.user, res.token);
      setFeedback({
        type: 'success',
        message: isId
          ? 'Data pribadi dan username berhasil diperbarui.'
          : 'Personal profile details and username updated successfully.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || (isId ? 'Gagal menyimpan perubahan profil.' : 'Failed to update profile details.'),
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (pwForm.new_password.length < 8) {
      setFeedback({
        type: 'error',
        message: isId ? 'Kata sandi baru minimal 8 karakter.' : 'New password must be at least 8 characters.',
      });
      return;
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      setFeedback({
        type: 'error',
        message: isId ? 'Konfirmasi kata sandi baru tidak cocok.' : 'New password confirmation does not match.',
      });
      return;
    }

    setSavingPassword(true);
    try {
      await apiFetch('/api/account/password', {
        method: 'PUT',
        body: JSON.stringify(pwForm),
      });
      setPwForm({ current_password: '', new_password: '', confirm_password: '' });
      setFeedback({
        type: 'success',
        message: isId ? 'Kata sandi akun berhasil diperbarui.' : 'Account password updated successfully.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || (isId ? 'Gagal memperbarui kata sandi.' : 'Failed to update password.'),
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleAvatarLocalUpload = async (file: File | undefined) => {
    if (!file) return;
    setFeedback(null);
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await apiFetch<{ avatar_url: string; user: AuthUser }>('/api/account/avatar', {
        method: 'POST',
        body: fd,
      });
      onUserUpdated(res.user);
      setFeedback({
        type: 'success',
        message: isId ? 'Foto profil berhasil diunggah.' : 'Profile photo uploaded successfully.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || (isId ? 'Gagal mengunggah foto profil.' : 'Failed to upload profile photo.'),
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setFeedback(null);
    setUploadingPhoto(true);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/account/avatar', { method: 'DELETE' });
      onUserUpdated(res.user);
      setFeedback({
        type: 'success',
        message: isId ? 'Foto profil dihapus.' : 'Profile photo removed.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || (isId ? 'Gagal menghapus foto profil.' : 'Failed to remove profile photo.'),
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const hasValidAvatar = Boolean(user.avatar_url && isSafeExternalUrl(user.avatar_url) && !avatarBroken);
  const initials = (user.full_name || user.username || 'US').slice(0, 2).toUpperCase();
  const cardClass =
    'bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6';
  const inputClass =
    'w-full px-3 py-2 bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
          {isId ? 'Pengaturan Akun Pribadi' : 'Account & Profile Settings'}
        </h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          {isId
            ? 'Kelola data pribadi, username login, foto profil, dan kata sandi akun Anda secara mandiri.'
            : 'Manage your personal information, login username, profile photo, and account password.'}
        </p>
      </div>

      {feedback && (
        <div
          className={`px-4 py-3 rounded-md border text-xs flex items-center gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/35 border-red-200 dark:border-red-900/60 text-[#C8102E] dark:text-red-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Profile Photo & Account Summary */}
        <section className={`lg:col-span-4 ${cardClass} space-y-5`}>
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <Camera className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
            <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
              {isId ? 'Foto Profil Akun' : 'Profile Photo'}
            </h2>
          </div>

          <div className="flex flex-col items-center text-center space-y-4">
            {hasValidAvatar ? (
              <img
                src={user.avatar_url!}
                alt={user.full_name}
                referrerPolicy="no-referrer"
                onError={() => setAvatarBroken(true)}
                className="w-28 h-28 rounded-lg object-cover border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-[#1E222A]"
              />
            ) : (
              <div className="w-28 h-28 rounded-lg bg-[#141619] dark:bg-neutral-800 text-white flex items-center justify-center font-display text-2xl font-bold border border-neutral-200 dark:border-neutral-700">
                {initials}
              </div>
            )}

            <div className="space-y-1">
              <div className="text-sm font-semibold text-[#141619] dark:text-neutral-100">{user.full_name}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                <span>{user.role_name}</span>
                <span aria-hidden="true"> · </span>
                <span className="font-mono">@{user.username}</span>
              </div>
            </div>

            <div className="w-full space-y-2 pt-1">
              <label
                className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                  uploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{uploadingPhoto ? (isId ? 'Mengunggah...' : 'Uploading...') : (isId ? 'Unggah Foto Baru' : 'Upload New Photo')}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={uploadingPhoto}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    handleAvatarLocalUpload(f);
                  }}
                />
              </label>

              {user.avatar_url && (
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={handleRemoveAvatar}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-[#C8102E] dark:text-red-300 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 hover:bg-red-100 dark:hover:bg-red-950/50 rounded-md transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isId ? 'Hapus Foto Profil' : 'Remove Photo'}</span>
                </button>
              )}
            </div>

            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {isId ? 'Format JPG, PNG, atau WEBP (maks. 5 MB).' : 'JPG, PNG, or WEBP format (max 5 MB).'}
            </p>
          </div>

          <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">{isId ? 'Email Aktif' : 'Active Email'}</span>
              <span className="font-mono text-[#141619] dark:text-neutral-100 truncate max-w-[190px]">{user.email}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">{isId ? 'Login Terakhir' : 'Last Login'}</span>
              <span className="font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                {user.last_login_at ? user.last_login_at.slice(0, 16).replace('T', ' ') : '-'}
              </span>
            </div>
          </div>
        </section>

        {/* Right Column: Personal Data + Username & Password */}
        <div className="lg:col-span-8 space-y-6">
          <form onSubmit={handleSaveProfile} className={`${cardClass} space-y-5`}>
            <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <UserIcon className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
              <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Data Pribadi & Username' : 'Personal Data & Username'}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className={labelClass}>{isId ? 'Username Login *' : 'Login Username *'}</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={50}
                  pattern="[a-zA-Z0-9._-]+"
                  value={profileForm.username}
                  onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value.toLowerCase() })}
                  className={`${inputClass} font-mono`}
                  placeholder="nama.pengguna"
                />
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
                  {isId ? 'Huruf kecil, angka, titik, garis bawah, atau tanda hubung.' : 'Lowercase letters, numbers, dot, underscore, or hyphen.'}
                </p>
              </div>

              <div>
                <label className={labelClass}>{isId ? 'Nama Lengkap *' : 'Full Name *'}</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={150}
                  value={profileForm.full_name}
                  onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{isId ? 'Email Perusahaan *' : 'Corporate Email *'}</label>
                <input
                  type="email"
                  required
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{isId ? 'Nomor Telepon / WhatsApp' : 'Phone Number'}</label>
                <input
                  type="tel"
                  maxLength={50}
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                  placeholder="+62-811-xxxx-xxxx"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label className={labelClass}>{isId ? 'Departemen / Divisi' : 'Department / Division'}</label>
                <input
                  type="text"
                  maxLength={120}
                  value={profileForm.department}
                  onChange={(e) => setProfileForm({ ...profileForm, department: e.target.value })}
                  placeholder="General Affairs / IT Operations"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>{isId ? 'Jabatan' : 'Position Title'}</label>
                <input
                  type="text"
                  maxLength={120}
                  value={profileForm.position_title}
                  onChange={(e) => setProfileForm({ ...profileForm, position_title: e.target.value })}
                  placeholder="Asset Control Officer"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {savingProfile
                    ? (isId ? 'Menyimpan...' : 'Saving...')
                    : (isId ? 'Simpan Data Pribadi' : 'Save Profile Changes')}
                </span>
              </button>
            </div>
          </form>

          <form onSubmit={handleUpdatePassword} className={`${cardClass} space-y-5`}>
            <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <Lock className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
              <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                {isId ? 'Ubah Kata Sandi' : 'Change Password'}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className={labelClass}>{isId ? 'Kata Sandi Saat Ini *' : 'Current Password *'}</label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    required
                    value={pwForm.current_password}
                    onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
                    className={`${inputClass} pr-9`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    aria-label={showCurrentPw ? 'Hide current password' : 'Show current password'}
                  >
                    {showCurrentPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className={labelClass}>{isId ? 'Kata Sandi Baru (min. 8) *' : 'New Password (min 8 chars) *'}</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    required
                    minLength={8}
                    maxLength={128}
                    value={pwForm.new_password}
                    onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                    className={`${inputClass} pr-9`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    aria-label={showNewPw ? 'Hide new password' : 'Show new password'}
                  >
                    {showNewPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className={labelClass}>{isId ? 'Konfirmasi Kata Sandi Baru *' : 'Confirm New Password *'}</label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    required
                    minLength={8}
                    maxLength={128}
                    value={pwForm.confirm_password}
                    onChange={(e) => setPwForm({ ...pwForm, confirm_password: e.target.value })}
                    className={`${inputClass} pr-9`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirmPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingPassword}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-neutral-700 hover:bg-neutral-800 dark:hover:bg-neutral-600 rounded-md transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>
                  {savingPassword
                    ? (isId ? 'Memperbarui...' : 'Updating...')
                    : (isId ? 'Perbarui Kata Sandi' : 'Update Password')}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

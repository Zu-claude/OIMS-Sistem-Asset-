import React, { useEffect, useState } from 'react';
import { Upload, CheckCircle2, HardDrive, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatFileSize, uploadAssetFileLocally } from '../lib/workspace';
import type { Lang, MasterData } from '../types/oims';

interface AssetRegistrationModuleProps {
  lang: Lang;
  master: MasterData;
  onRegistered: () => void;
}

export const AssetRegistrationModule: React.FC<AssetRegistrationModuleProps> = ({
  lang,
  master,
  onRegistered,
}) => {
  const isId = lang === 'id';
  const [nextCode, setNextCode] = useState('OIMS-2027-000011');

  const [form, setForm] = useState({
    asset_name: '',
    category_id: String(master.categories[0]?.id || 1),
    subcategory_id: '',
    brand: '',
    model: '',
    serial_number: '',
    description: '',
    specification: '',
  });

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchNextCode = async () => {
    try {
      const res = await apiFetch<{ nextCode: string }>('/api/assets/next-code');
      setNextCode(res.nextCode);
    } catch {
      // keep fallback
    }
  };

  useEffect(() => {
    fetchNextCode();
  }, []);

  const filteredSubs = master.subcategories.filter((s) => String(s.category_id) === form.category_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const defaultCompanyId = master.companies[0]?.id;
    const defaultDivision =
      master.divisions.find((d) => d.company_id === defaultCompanyId) || master.divisions[0];
    const defaultLocation =
      master.locations.find((l) => l.company_id === defaultCompanyId) || master.locations[0];

    if (!defaultCompanyId || !defaultDivision || !defaultLocation) {
      setError(
        isId
          ? 'Data master perusahaan, divisi, atau lokasi belum tersedia di sistem.'
          : 'Master company, division, or location records are not yet configured.'
      );
      return;
    }

    setSubmitting(true);
    try {
      let primaryPhotoUrl: string | null = null;
      let primaryPhotoName: string | null = null;
      let photoMimeType: string | null = null;
      let photoSizeBytes: number | null = null;

      if (photoFile) {
        const uploadedPhoto = await uploadAssetFileLocally({
          file: photoFile,
          kind: 'photo',
          assetCode: nextCode,
          docType: 'Asset Photo',
        });
        primaryPhotoUrl = uploadedPhoto.fileUrl;
        primaryPhotoName = uploadedPhoto.fileName;
        photoMimeType = uploadedPhoto.mimeType;
        photoSizeBytes = uploadedPhoto.fileSizeBytes;
      }

      const created = await apiFetch<{ id: number; asset_code: string }>('/api/assets', {
        method: 'POST',
        body: JSON.stringify({
          asset_name: form.asset_name,
          category_id: Number(form.category_id),
          subcategory_id: form.subcategory_id ? Number(form.subcategory_id) : null,
          brand: form.brand || null,
          model: form.model || null,
          serial_number: form.serial_number || null,
          description: form.description || null,
          specification: form.specification || null,
          acquisition_date: new Date().toISOString().slice(0, 10),
          acquisition_value: 0,
          company_id: defaultCompanyId,
          division_id: defaultDivision.id,
          responsible_division_id: defaultDivision.id,
          location_id: defaultLocation.id,
          condition_status: 'Good',
          auto_generate_qr: true,
          primary_photo_url: primaryPhotoUrl,
          primary_photo_name: primaryPhotoName,
          primary_photo_mime_type: photoMimeType,
          primary_photo_size_bytes: photoSizeBytes,
        }),
      });

      setSuccessMsg(
        isId
          ? `Aset berhasil diregistrasi dengan kode ${created.asset_code} beserta QR Code dan catatan event SHA-256.`
          : `Asset registered under code ${created.asset_code} with QR Code and SHA-256 event log.`
      );
      setForm((prev) => ({
        ...prev,
        asset_name: '',
        brand: '',
        model: '',
        serial_number: '',
        description: '',
        specification: '',
      }));
      setPhotoFile(null);
      await fetchNextCode();
      onRegistered();
    } catch (err: any) {
      setError(err.message || (isId ? 'Registrasi gagal' : 'Registration failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const cardClass =
    'bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4';
  const inputClass =
    'w-full px-3 py-2 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]';
  const labelClass = 'block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1';

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
          {isId ? 'Registrasi Aset Baru' : 'New Asset Registration'}
        </h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          {isId
            ? 'Pendaftaran aset ringkas dengan identitas aset, foto aset lokal, dan pembuatan kode QR otomatis.'
            : 'Streamlined asset onboarding with asset identity, local asset photo storage, and automatic QR Code generation.'}
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md text-xs font-medium text-[#C8102E] dark:text-red-300">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 rounded-md text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Identity Information */}
        <div className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-3">
            <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
              01. {isId ? 'Informasi Identitas Aset' : 'Asset Identity Information'}
            </h2>
            <div className="text-xs font-mono text-[#C8102E] dark:text-red-400 font-semibold tabular-nums">
              {isId ? 'Kode Berikutnya:' : 'Next Code:'} {nextCode}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className={labelClass}>{isId ? 'Nama Aset *' : 'Asset Name *'}</label>
              <input
                type="text"
                required
                value={form.asset_name}
                onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
                placeholder="e.g. Dell Latitude 7450 Laptop"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {isId ? 'Nomor Seri (Cek Unik)' : 'Serial Number (Unique Check)'}
              </label>
              <input
                type="text"
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                placeholder="SN-XXXX-XXXX"
                className={`${inputClass} font-mono`}
              />
            </div>

            <div>
              <label className={labelClass}>{isId ? 'Kategori *' : 'Category *'}</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value, subcategory_id: '' })}
                className={inputClass}
              >
                {master.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Subkategori' : 'Subcategory'}</label>
              <select
                value={form.subcategory_id}
                onChange={(e) => setForm({ ...form, subcategory_id: e.target.value })}
                className={inputClass}
              >
                <option value="">{isId ? '-- Opsional --' : '-- Optional --'}</option>
                {filteredSubs.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>{isId ? 'Merek' : 'Brand'}</label>
                <input
                  type="text"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Model</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{isId ? 'Deskripsi' : 'Description'}</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{isId ? 'Spesifikasi Teknis' : 'Technical Specification'}</label>
              <textarea
                rows={2}
                value={form.specification}
                onChange={(e) => setForm({ ...form, specification: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Section 2: Local Server Asset Photo Upload Only */}
        <div className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                02. {isId ? 'Dokumentasi Foto Aset (Penyimpanan Lokal)' : 'Asset Photo Documentation (Local Storage)'}
              </h2>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                {isId
                  ? 'Unggah foto fisik aset untuk disimpan aman pada penyimpanan lokal server (/uploads/photos).'
                  : 'Upload the physical asset photo to store securely on local server storage (/uploads/photos).'}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <HardDrive className="w-3.5 h-3.5" />
              <span>{isId ? 'Penyimpanan Lokal Aktif' : 'Local Server Storage Active'}</span>
            </span>
          </div>

          <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-md p-4 hover:border-[#C8102E] dark:hover:border-red-400 transition-colors bg-neutral-50/50 dark:bg-[#1E222A]/60">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-3 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer flex-1 min-w-0">
                <Upload className="w-4 h-4 text-[#C8102E] dark:text-red-400 shrink-0" />
                <div className="truncate">
                  <div className="font-medium truncate">
                    {photoFile
                      ? photoFile.name
                      : isId
                        ? 'Pilih Foto Aset (JPG/PNG/WEBP, maks. 10MB)'
                        : 'Select Asset Photo (JPG/PNG/WEBP, max 10MB)'}
                  </div>
                  {photoFile && (
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                      {photoFile.type} · {formatFileSize(photoFile.size)}
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                />
              </label>
              {photoFile && (
                <button
                  type="button"
                  onClick={() => setPhotoFile(null)}
                  className="p-1 text-neutral-400 hover:text-[#C8102E] dark:hover:text-red-400"
                  title={isId ? 'Hapus foto' : 'Remove photo'}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {submitting
              ? isId
                ? 'Mengunggah & Menyimpan...'
                : 'Uploading & Registering...'
              : isId
                ? 'Simpan & Registrasikan Aset'
                : 'Register Asset'}
          </button>
        </div>
      </form>
    </div>
  );
};

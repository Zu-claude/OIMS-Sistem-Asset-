import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Camera,
  Search,
  Download,
  Printer,
  QrCode,
  CheckSquare,
  Square,
  X,
  Sparkles,
  SlidersHorizontal,
  Layers,
  Image as ImageIcon,
  ExternalLink,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Lock,
  MapPin,
  Copy,
  Settings2,
  RotateCcw,
  Ban,
  History,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { downloadDataUrl, formatIDR } from '../lib/exportUtils';
import { formatFileSize, isSafeExternalUrl } from '../lib/workspace';
import { normalizeScannedBarcode, playScanBeep, useBarcodeScanner } from '../lib/useBarcodeScanner';
import type { AssetRow, AuthUser, FieldCaptureRow, Lang, QrAccessLogRow } from '../types/oims';
import { ConditionLabel, StatusLabel } from '../components/StatusText';

interface QrTaggingModuleProps {
  lang: Lang;
  user: AuthUser;
  assets: AssetRow[];
  initialQrCode?: string | null;
  onClearInitialQrCode?: () => void;
  onRefreshAssets: () => void;
}

type LabelTemplateId = 'avery-5160' | 'avery-5163' | 'avery-l7160' | 'thermal-50x30' | 'thermal-100x50';

interface LabelTemplateSpec {
  id: LabelTemplateId;
  name: string;
  paperLabel: string;
  isThermal: boolean;
  pageWidth: string;
  pageHeight: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  cols: number;
  rows: number;
  perSheet: number;
  labelWidth: string;
  labelHeight: string;
  colGap: string;
  rowGap: string;
  qrSize: string;
  compact: boolean;
}

const LABEL_TEMPLATES: Record<LabelTemplateId, LabelTemplateSpec> = {
  'avery-5160': {
    id: 'avery-5160',
    name: 'Avery 5160 (30 / Sheet · 2.625" × 1")',
    paperLabel: 'US Letter (8.5" × 11")',
    isThermal: false,
    pageWidth: '8.5in',
    pageHeight: '11in',
    marginTop: '0.5in',
    marginRight: '0.1875in',
    marginBottom: '0.5in',
    marginLeft: '0.1875in',
    cols: 3,
    rows: 10,
    perSheet: 30,
    labelWidth: '2.625in',
    labelHeight: '1in',
    colGap: '0.125in',
    rowGap: '0in',
    qrSize: '0.74in',
    compact: true,
  },
  'avery-5163': {
    id: 'avery-5163',
    name: 'Avery 5163 (10 / Sheet · 4" × 2")',
    paperLabel: 'US Letter (8.5" × 11")',
    isThermal: false,
    pageWidth: '8.5in',
    pageHeight: '11in',
    marginTop: '0.5in',
    marginRight: '0.15625in',
    marginBottom: '0.5in',
    marginLeft: '0.15625in',
    cols: 2,
    rows: 5,
    perSheet: 10,
    labelWidth: '4in',
    labelHeight: '2in',
    colGap: '0.1875in',
    rowGap: '0in',
    qrSize: '1.32in',
    compact: false,
  },
  'avery-l7160': {
    id: 'avery-l7160',
    name: 'Avery L7160 (21 / Sheet · 63.5 × 38.1 mm)',
    paperLabel: 'A4 (210 × 297 mm)',
    isThermal: false,
    pageWidth: '210mm',
    pageHeight: '297mm',
    marginTop: '15.1mm',
    marginRight: '7.2mm',
    marginBottom: '15.1mm',
    marginLeft: '7.2mm',
    cols: 3,
    rows: 7,
    perSheet: 21,
    labelWidth: '63.5mm',
    labelHeight: '38.1mm',
    colGap: '2.5mm',
    rowGap: '0mm',
    qrSize: '26mm',
    compact: true,
  },
  'thermal-50x30': {
    id: 'thermal-50x30',
    name: 'Thermal Roll 50 × 30 mm (Zebra / Xprinter)',
    paperLabel: 'Direct Thermal 50 × 30 mm',
    isThermal: true,
    pageWidth: '50mm',
    pageHeight: '30mm',
    marginTop: '1.5mm',
    marginRight: '1.5mm',
    marginBottom: '1.5mm',
    marginLeft: '1.5mm',
    cols: 1,
    rows: 1,
    perSheet: 1,
    labelWidth: '47mm',
    labelHeight: '27mm',
    colGap: '0mm',
    rowGap: '0mm',
    qrSize: '21mm',
    compact: true,
  },
  'thermal-100x50': {
    id: 'thermal-100x50',
    name: 'Thermal Asset Plate 100 × 50 mm (4" × 2" Roll)',
    paperLabel: 'Direct Thermal 100 × 50 mm',
    isThermal: true,
    pageWidth: '100mm',
    pageHeight: '50mm',
    marginTop: '2.5mm',
    marginRight: '3mm',
    marginBottom: '2.5mm',
    marginLeft: '3mm',
    cols: 1,
    rows: 1,
    perSheet: 1,
    labelWidth: '94mm',
    labelHeight: '45mm',
    colGap: '0mm',
    rowGap: '0mm',
    qrSize: '33mm',
    compact: false,
  },
};

interface BulkGenerateResponse {
  generatedCount: number;
  totalCount: number;
  items: { assetId: number; asset_code: string; qr_token: string; dataUrl: string }[];
}

export const QrTaggingModule: React.FC<QrTaggingModuleProps> = ({
  lang,
  user,
  assets,
  initialQrCode,
  onClearInitialQrCode,
  onRefreshAssets,
}) => {
  const canGenerateQr = user.role_code === 'super_admin' || user.permissions.includes('qr.generate');
  const canFieldCapture =
    user.role_code === 'super_admin' ||
    user.permissions.includes('qr.scan') ||
    user.permissions.includes('opname.verify') ||
    user.permissions.includes('assets.edit');

  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanPhotoBroken, setScanPhotoBroken] = useState(false);
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [registrySearch, setRegistrySearch] = useState('');
  const [qrFilter, setQrFilter] = useState<'all' | 'missing' | 'tagged'>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [qrMap, setQrMap] = useState<Record<number, string>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');

  // Field GPS + Photo Capture state
  const [fieldLat, setFieldLat] = useState('');
  const [fieldLng, setFieldLng] = useState('');
  const [fieldAcc, setFieldAcc] = useState('');
  const [fieldCondition, setFieldCondition] = useState('');
  const [fieldNotes, setFieldNotes] = useState('');
  const [fieldPhotoFile, setFieldPhotoFile] = useState<File | null>(null);
  const [fieldBusy, setFieldBusy] = useState(false);
  const [fieldMessage, setFieldMessage] = useState('');

  // QR Privacy & Revocation Modal state
  const [managedAsset, setManagedAsset] = useState<AssetRow | null>(null);
  const [privacyForm, setPrivacyForm] = useState({
    public_enabled: true,
    public_show_photo: true,
    public_show_location: true,
    expires_at: '',
  });
  const [revokeReason, setRevokeReason] = useState('');
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState('');

  // QR Access Logs state
  const [showAccessLogs, setShowAccessLogs] = useState(false);
  const [accessLogs, setAccessLogs] = useState<QrAccessLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Avery & Thermal Print Studio state
  const [printMode, setPrintMode] = useState(false);
  const [templateId, setTemplateId] = useState<LabelTemplateId>('avery-5160');
  const [monochromeThermal, setMonochromeThermal] = useState(true);
  const [showBordersOnPrint, setShowBordersOnPrint] = useState(false);
  const [startOffset, setStartOffset] = useState(0);
  const [copiesPerAsset, setCopiesPerAsset] = useState(1);
  const [showLocation, setShowLocation] = useState(true);
  const [showSerial, setShowSerial] = useState(true);
  const [showPic, setShowPic] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lookupInputRef = useRef<HTMLInputElement | null>(null);

  const activeTemplate = LABEL_TEMPLATES[templateId];

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // ignore cleanup error
      }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (activeTemplate.isThermal) {
      setStartOffset(0);
      setMonochromeThermal(true);
    } else if (startOffset >= activeTemplate.perSheet) {
      setStartOffset(0);
    }
  }, [templateId, activeTemplate.isThermal, activeTemplate.perSheet, startOffset]);

  const missingAssetsCount = useMemo(() => assets.filter((a) => !a.qr_token).length, [assets]);

  const filteredAssets = useMemo(() => {
    const q = registrySearch.trim().toLowerCase();
    return assets.filter((a) => {
      if (qrFilter === 'missing' && a.qr_token) return false;
      if (qrFilter === 'tagged' && !a.qr_token) return false;
      if (!q) return true;
      return (
        a.asset_code.toLowerCase().includes(q) ||
        a.asset_name.toLowerCase().includes(q) ||
        (a.serial_number || '').toLowerCase().includes(q) ||
        (a.building_name || '').toLowerCase().includes(q) ||
        (a.specific_location || '').toLowerCase().includes(q) ||
        (a.pic_name || '').toLowerCase().includes(q)
      );
    });
  }, [assets, registrySearch, qrFilter]);

  const resolveCode = async (codeOrToken: string) => {
    const clean = normalizeScannedBarcode(codeOrToken);
    if (!clean) return;
    setScanError('');
    setFieldMessage('');
    setScanPhotoBroken(false);
    try {
      const res = await apiFetch(`/api/qr/resolve/${encodeURIComponent(clean)}`);
      setScanResult(res);
      setFieldCondition(res.asset?.condition_status || '');
      const firstPhoto = res.photos?.[0]?.file_url || res.asset?.primary_photo_url || null;
      setActivePhotoUrl(firstPhoto);
      playScanBeep(true);
    } catch (err: any) {
      setScanError(err.message || 'Asset not found');
      setScanResult(null);
      setActivePhotoUrl(null);
      playScanBeep(false);
    }
  };

  useEffect(() => {
    if (initialQrCode) {
      setManualCode(initialQrCode);
      void resolveCode(initialQrCode);
      onClearInitialQrCode?.();
    }
  }, [initialQrCode]);

  const loadAccessLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await apiFetch<{ logs: QrAccessLogRow[] }>('/api/qr/access-logs?limit=80');
      setAccessLogs(res.logs || []);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleCaptureBrowserGps = () => {
    if (!navigator.geolocation) {
      setFieldMessage(lang === 'id' ? 'Browser tidak mendukung Geolocation.' : 'Geolocation is not supported by this browser.');
      return;
    }
    setFieldMessage(lang === 'id' ? 'Mengambil koordinat GPS perangkat...' : 'Reading device GPS coordinates...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFieldLat(pos.coords.latitude.toFixed(6));
        setFieldLng(pos.coords.longitude.toFixed(6));
        setFieldAcc(pos.coords.accuracy ? String(Math.round(pos.coords.accuracy)) : '');
        setFieldMessage(lang === 'id' ? 'Koordinat GPS siap dikirim.' : 'GPS coordinates captured.');
      },
      (err) => {
        setFieldMessage(
          lang === 'id'
            ? `Gagal membaca GPS (${err.message}). Anda dapat mengisi koordinat manual.`
            : `GPS read failed (${err.message}). You may enter coordinates manually.`
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmitFieldCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanResult?.asset?.id || fieldBusy) return;
    setFieldBusy(true);
    setFieldMessage('');
    try {
      if (fieldPhotoFile) {
        const fd = new FormData();
        fd.append('asset_id', String(scanResult.asset.id));
        fd.append('capture_context', 'qr_field_scan');
        if (fieldLat.trim()) fd.append('latitude', fieldLat.trim());
        if (fieldLng.trim()) fd.append('longitude', fieldLng.trim());
        if (fieldAcc.trim()) fd.append('accuracy_meters', fieldAcc.trim());
        if (fieldCondition) fd.append('condition_observed', fieldCondition);
        if (fieldNotes.trim()) fd.append('notes', fieldNotes.trim());
        fd.append('file', fieldPhotoFile);
        await apiFetch('/api/field/capture', { method: 'POST', body: fd });
      } else {
        await apiFetch('/api/field/capture', {
          method: 'POST',
          body: JSON.stringify({
            asset_id: scanResult.asset.id,
            capture_context: 'qr_field_scan',
            latitude: fieldLat.trim() || null,
            longitude: fieldLng.trim() || null,
            accuracy_meters: fieldAcc.trim() || null,
            condition_observed: fieldCondition || null,
            notes: fieldNotes.trim() || null,
          }),
        });
      }
      setFieldNotes('');
      setFieldPhotoFile(null);
      setFieldMessage(
        lang === 'id'
          ? 'Bukti lapangan (GPS/Foto) berhasil dicatat ke histori event tanpa menimpa data master.'
          : 'Field evidence (GPS/Photo) recorded to event history without overwriting master data.'
      );
      await resolveCode(scanResult.asset.qr_token || scanResult.asset.asset_code);
      onRefreshAssets();
    } catch (err: any) {
      setFieldMessage(err?.message || 'Field capture failed');
    } finally {
      setFieldBusy(false);
    }
  };

  const openManagePrivacy = (asset: AssetRow) => {
    setManagedAsset(asset);
    setPrivacyError('');
    setRevokeReason('');
    setPrivacyForm({
      public_enabled: Number(asset.public_enabled ?? 1) === 1,
      public_show_photo: Number(asset.public_show_photo ?? 1) === 1,
      public_show_location: Number(asset.public_show_location ?? 1) === 1,
      expires_at: asset.qr_expires_at ? String(asset.qr_expires_at).slice(0, 16) : '',
    });
  };

  const handleSavePrivacySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managedAsset) return;
    setPrivacyBusy(true);
    setPrivacyError('');
    try {
      await apiFetch(`/api/qr/${managedAsset.id}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          public_enabled: privacyForm.public_enabled,
          public_show_photo: privacyForm.public_show_photo,
          public_show_location: privacyForm.public_show_location,
          expires_at: privacyForm.expires_at ? new Date(privacyForm.expires_at).toISOString() : null,
        }),
      });
      setBatchNotice(
        lang === 'id'
          ? `Pengaturan privasi QR untuk ${managedAsset.asset_code} diperbarui.`
          : `QR privacy settings updated for ${managedAsset.asset_code}.`
      );
      setManagedAsset(null);
      onRefreshAssets();
    } catch (err: any) {
      setPrivacyError(err?.message || 'Failed to update QR privacy settings');
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleRevokeOrRotate = async (reissue: boolean) => {
    if (!managedAsset) return;
    setPrivacyBusy(true);
    setPrivacyError('');
    try {
      const res = await apiFetch<{ qr_token: string; public_slug: string; status: string; dataUrl: string | null }>(
        `/api/qr/${managedAsset.id}/revoke`,
        {
          method: 'POST',
          body: JSON.stringify({
            reissue,
            reason:
              revokeReason.trim() ||
              (reissue ? 'QR token rotated & reissued by admin' : 'QR token revoked by admin'),
          }),
        }
      );
      if (res.dataUrl) {
        setQrMap((prev) => ({ ...prev, [managedAsset.id]: res.dataUrl! }));
      }
      setBatchNotice(
        reissue
          ? lang === 'id'
            ? `Token QR ${managedAsset.asset_code} berhasil dirotasi & diterbitkan ulang (${res.qr_token}).`
            : `QR token for ${managedAsset.asset_code} rotated and reissued (${res.qr_token}).`
          : lang === 'id'
          ? `Token QR ${managedAsset.asset_code} telah dicabut (Revoked).`
          : `QR token for ${managedAsset.asset_code} has been revoked.`
      );
      setManagedAsset(null);
      onRefreshAssets();
    } catch (err: any) {
      setPrivacyError(err?.message || 'Failed to revoke/reissue QR token');
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleCopyPublicLink = async (asset: AssetRow) => {
    const slugOrToken = asset.public_slug || asset.qr_token;
    if (!slugOrToken) return;
    const url = `${window.location.origin}/?qr=${encodeURIComponent(slugOrToken)}`;
    try {
      await navigator.clipboard.writeText(url);
      setBatchNotice(
        lang === 'id'
          ? `Tautan QR publik (${asset.asset_code}) disalin ke clipboard.`
          : `Public QR link (${asset.asset_code}) copied to clipboard.`
      );
    } catch {
      setBatchNotice(url);
    }
  };

  useBarcodeScanner({
    enabled: !printMode && !lightboxUrl,
    targetInputRef: lookupInputRef,
    onScan: (code) => {
      setManualCode(code);
      void resolveCode(code);
    },
  });

  const startCamera = async () => {
    setScanError('');
    setScanning(true);
    try {
      const qr = new Html5Qrcode('oims-qr-reader');
      scannerRef.current = qr;
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (decodedText) => {
          await stopCamera();
          setManualCode(decodedText);
          await resolveCode(decodedText);
        },
        () => {
          // ignore frame read misses
        }
      );
    } catch (err: any) {
      setScanning(false);
      setScanError(err?.message || 'Camera unavailable in this browser. Use manual Asset Code input below.');
    }
  };

  const handleGenerateQr = async (assetId: number) => {
    setBatchNotice('');
    setScanError('');
    try {
      const res = await apiFetch<{ qr_token: string; dataUrl: string }>(`/api/qr/generate/${assetId}`, {
        method: 'POST',
      });
      setQrMap((prev) => ({ ...prev, [assetId]: res.dataUrl }));
      onRefreshAssets();
    } catch (err: any) {
      setScanError(err.message || 'Failed to generate QR');
    }
  };

  const handleGenerateAllMissing = async () => {
    setBatchBusy(true);
    setBatchNotice('');
    setScanError('');
    try {
      const res = await apiFetch<BulkGenerateResponse>('/api/qr/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({ missingOnly: true }),
      });
      if (res.items.length > 0) {
        setQrMap((prev) => {
          const next = { ...prev };
          for (const item of res.items) {
            next[item.assetId] = item.dataUrl;
          }
          return next;
        });
      }
      setBatchNotice(
        lang === 'id'
          ? `${res.generatedCount} token QR baru berhasil dibuat dan siap dicetak.`
          : `${res.generatedCount} new QR token(s) generated and ready for printing.`
      );
      onRefreshAssets();
    } catch (err: any) {
      setScanError(err.message || 'Bulk QR generation failed');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleDownloadPng = async (asset: AssetRow) => {
    let url = qrMap[asset.id];
    if (!url) {
      const res = await apiFetch<{ dataUrl: string }>(`/api/qr/generate/${asset.id}`, { method: 'POST' });
      url = res.dataUrl;
      setQrMap((prev) => ({ ...prev, [asset.id]: url }));
      onRefreshAssets();
    }
    downloadDataUrl(url, `${asset.asset_code}_QR.png`);
  };

  const prepareBulkPrint = async (ids: number[]) => {
    if (ids.length === 0) return;
    setBatchBusy(true);
    setBatchNotice('');
    setScanError('');
    try {
      const missingFromCache = ids.filter((id) => !qrMap[id]);
      if (missingFromCache.length > 0) {
        const res = await apiFetch<BulkGenerateResponse>('/api/qr/bulk-generate', {
          method: 'POST',
          body: JSON.stringify({ assetIds: missingFromCache, missingOnly: false }),
        });
        setQrMap((prev) => {
          const next = { ...prev };
          for (const item of res.items) {
            next[item.assetId] = item.dataUrl;
          }
          return next;
        });
        if (res.generatedCount > 0) {
          setBatchNotice(
            lang === 'id'
              ? `${res.generatedCount} aset otomatis dibuatkan token QR sebelum pratinjau cetak.`
              : `${res.generatedCount} asset(s) auto-assigned QR tokens for print.`
          );
          onRefreshAssets();
        }
      }
      setSelectedIds(ids);
      setPrintMode(true);
    } catch (err: any) {
      setScanError(err.message || 'Failed to prepare bulk print labels');
    } finally {
      setBatchBusy(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allFilteredSelected =
    filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.includes(a.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredAssets.map((a) => a.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredAssets.map((a) => a.id)])));
    }
  };

  const selectedAssets = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return assets.filter((a) => selectedSet.has(a.id));
  }, [assets, selectedIds]);

  const sheetPages = useMemo(() => {
    if (!printMode || selectedAssets.length === 0) return [];
    const expanded: (AssetRow | null)[] = [];
    const effectiveOffset = activeTemplate.isThermal ? 0 : Math.min(startOffset, activeTemplate.perSheet - 1);
    for (let i = 0; i < effectiveOffset; i += 1) {
      expanded.push(null);
    }
    for (const asset of selectedAssets) {
      for (let c = 0; c < copiesPerAsset; c += 1) {
        expanded.push(asset);
      }
    }
    const pages: (AssetRow | null)[][] = [];
    for (let idx = 0; idx < expanded.length; idx += activeTemplate.perSheet) {
      const slice = expanded.slice(idx, idx + activeTemplate.perSheet);
      while (!activeTemplate.isThermal && slice.length < activeTemplate.perSheet) {
        slice.push(null);
      }
      pages.push(slice);
    }
    return pages;
  }, [printMode, selectedAssets, activeTemplate, startOffset, copiesPerAsset]);

  const totalLabelsToPrint = selectedAssets.length * copiesPerAsset;

  return (
    <div className="space-y-6">
      {/* Inject dynamic @page dimensions matching selected Avery / Thermal stock when Print Studio is open */}
      {printMode && (
        <style media="print">{`
          @page {
            size: ${activeTemplate.pageWidth} ${activeTemplate.pageHeight};
            margin: 0;
          }
        `}</style>
      )}

      {/* Header + Bulk Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#141619] dark:text-neutral-100 tracking-tight">
            {lang === 'id' ? 'QR Code Tagging & Pemindai' : 'QR Code Tagging & Scanner'}
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {lang === 'id'
              ? 'Generate QR massal, cetak label Avery / Thermal langsung dari browser, unduh PNG, dan pindai kamera.'
              : 'Bulk QR generation, browser-native Avery & thermal label printing, PNG downloads, and live camera scanning.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {missingAssetsCount > 0 && (
            <button
              type="button"
              disabled={batchBusy}
              onClick={handleGenerateAllMissing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#141619] dark:text-neutral-100 bg-white dark:bg-[#171A20] border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
              <span>
                {lang === 'id'
                  ? `Generate QR Belum Terbit (${missingAssetsCount})`
                  : `Generate Missing QR (${missingAssetsCount})`}
              </span>
            </button>
          )}

          {selectedIds.length > 0 && (
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => prepareBulkPrint(selectedIds)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" />
              <span>
                {lang === 'id'
                  ? `Cetak Label Avery / Thermal (${selectedIds.length})`
                  : `Bulk Print Labels (${selectedIds.length})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {batchNotice && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-900/60 rounded-md text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between no-print">
          <span>{batchNotice}</span>
          <button type="button" onClick={() => setBatchNotice('')} className="font-semibold underline">
            {lang === 'id' ? 'Tutup' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Avery & Thermal Print Studio */}
      {printMode && (
        <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-5 oims-print-studio">
          {/* Print Controls Header (Hidden on Print) */}
          <div className="space-y-4 border-b border-neutral-200 dark:border-neutral-800 pb-4 no-print">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-[#141619] dark:text-neutral-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                  <span>
                    {lang === 'id'
                      ? 'Studio Cetak Label Avery & Thermal'
                      : 'Avery & Thermal Label Print Studio'}
                  </span>
                </h2>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {totalLabelsToPrint}{' '}
                  {lang === 'id' ? 'label pada' : 'labels across'} {sheetPages.length}{' '}
                  {activeTemplate.isThermal
                    ? lang === 'id'
                      ? 'potong roll thermal'
                      : 'thermal roll pages'
                    : lang === 'id'
                    ? 'lembar'
                    : 'sheet(s)'}{' '}
                  · {activeTemplate.paperLabel}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{lang === 'id' ? 'Cetak Sekarang' : 'Print Now'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintMode(false)}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{lang === 'id' ? 'Tutup' : 'Close'}</span>
                </button>
              </div>
            </div>

            {/* Calibration & Template Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#F4F5F7] dark:bg-[#1E222A] p-3.5 rounded-md border border-neutral-200 dark:border-neutral-700">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1 flex items-center gap-1">
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>{lang === 'id' ? 'Standar Kertas / Label' : 'Label Layout Standard'}</span>
                </label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value as LabelTemplateId)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded focus:outline-none focus:border-[#C8102E]"
                >
                  {Object.values(LABEL_TEMPLATES).map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  {lang === 'id' ? 'Jumlah Salinan / Aset' : 'Copies per Asset'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={copiesPerAsset}
                  onChange={(e) => setCopiesPerAsset(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded focus:outline-none focus:border-[#C8102E]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  {lang === 'id' ? 'Mulai dari Slot Avery ke-' : 'Skip Used Slots (Start Offset)'}
                </label>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, activeTemplate.perSheet - 1)}
                  disabled={activeTemplate.isThermal}
                  value={activeTemplate.isThermal ? 0 : startOffset}
                  onChange={(e) =>
                    setStartOffset(
                      Math.max(0, Math.min(activeTemplate.perSheet - 1, Number(e.target.value) || 0))
                    )
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded disabled:bg-neutral-100 dark:disabled:bg-neutral-800 disabled:text-neutral-400 focus:outline-none focus:border-[#C8102E]"
                />
              </div>

              <div className="lg:col-span-4 flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-neutral-700 dark:text-neutral-300">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={monochromeThermal}
                    onChange={(e) => setMonochromeThermal(e.target.checked)}
                    className="accent-[#141619]"
                  />
                  <span className="font-medium">
                    {lang === 'id'
                      ? 'Mode Thermal Monokrom (Hitam Pekat 1-Bit)'
                      : 'Thermal Monochrome Mode (Pure Black 1-Bit)'}
                  </span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showBordersOnPrint}
                    onChange={(e) => setShowBordersOnPrint(e.target.checked)}
                    className="accent-[#141619]"
                  />
                  <span>
                    {lang === 'id'
                      ? 'Cetak Garis Potong (Untuk Kertas Polos / Uji Kalibrasi)'
                      : 'Print Cut Borders (For Plain Paper / Alignment Test)'}
                  </span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showLocation}
                    onChange={(e) => setShowLocation(e.target.checked)}
                    className="accent-[#141619]"
                  />
                  <span>{lang === 'id' ? 'Lokasi' : 'Location'}</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSerial}
                    onChange={(e) => setShowSerial(e.target.checked)}
                    className="accent-[#141619]"
                  />
                  <span>{lang === 'id' ? 'Nomor Seri' : 'Serial No.'}</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPic}
                    onChange={(e) => setShowPic(e.target.checked)}
                    className="accent-[#141619]"
                  />
                  <span>PIC</span>
                </label>
              </div>
            </div>

            <div className="text-[11px] text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 px-3 py-2 rounded">
              <span className="font-semibold text-[#141619] dark:text-neutral-100">
                {lang === 'id' ? 'Tips Kalibrasi Printer:' : 'Printer Calibration Tip:'}
              </span>{' '}
              {lang === 'id'
                ? 'Pada dialog cetak browser, atur Scale = 100% / Actual Size, Margins = None, dan matikan Headers & Footers agar presisi pada stiker Avery maupun roll thermal.'
                : 'In the browser print dialog, set Scale = 100% (Actual Size), Margins = None, and disable Headers & Footers for exact Avery sheet and thermal roll alignment.'}
            </div>
          </div>

          {/* Physical Sheet / Thermal Roll Preview & Print Output */}
          <div className="overflow-x-auto pb-2 print:overflow-visible print:pb-0">
            <div className="flex flex-col items-start lg:items-center gap-6 print:block">
              {sheetPages.map((slots, pageIndex) => (
                <div
                  key={pageIndex}
                  className="oims-print-sheet bg-white border border-dashed border-neutral-300 shadow-sm shrink-0"
                  style={{
                    width: activeTemplate.pageWidth,
                    height: activeTemplate.pageHeight,
                    paddingTop: activeTemplate.marginTop,
                    paddingRight: activeTemplate.marginRight,
                    paddingBottom: activeTemplate.marginBottom,
                    paddingLeft: activeTemplate.marginLeft,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${activeTemplate.cols}, ${activeTemplate.labelWidth})`,
                      gridTemplateRows: `repeat(${activeTemplate.rows}, ${activeTemplate.labelHeight})`,
                      columnGap: activeTemplate.colGap,
                      rowGap: activeTemplate.rowGap,
                    }}
                  >
                    {slots.map((asset, slotIdx) => {
                      const borderClass = showBordersOnPrint
                        ? 'border border-black'
                        : 'border border-dashed border-neutral-200 print:border-transparent';

                      if (!asset) {
                        return (
                          <div
                            key={`empty-${pageIndex}-${slotIdx}`}
                            className={`${borderClass} box-border`}
                            style={{
                              width: activeTemplate.labelWidth,
                              height: activeTemplate.labelHeight,
                            }}
                          />
                        );
                      }

                      const primaryColor = monochromeThermal ? '#000000' : '#141619';
                      const codeColor = monochromeThermal ? '#000000' : '#C8102E';
                      const mutedColor = monochromeThermal ? '#000000' : '#525252';

                      return (
                        <div
                          key={`${asset.id}-${pageIndex}-${slotIdx}`}
                          className={`${borderClass} bg-white box-border flex items-center overflow-hidden`}
                          style={{
                            width: activeTemplate.labelWidth,
                            height: activeTemplate.labelHeight,
                            padding: activeTemplate.id === 'thermal-50x30' ? '1.5mm' : activeTemplate.compact ? '2.5mm' : '3.5mm',
                            gap: activeTemplate.compact ? '2mm' : '3.5mm',
                            color: primaryColor,
                          }}
                        >
                          {qrMap[asset.id] && (
                            <img
                              src={qrMap[asset.id]}
                              alt={asset.asset_code}
                              className="qr-thermal-img shrink-0 block bg-white"
                              style={{
                                width: activeTemplate.qrSize,
                                height: activeTemplate.qrSize,
                              }}
                            />
                          )}

                          <div className="min-w-0 flex-1 flex flex-col justify-center leading-tight">
                            <div
                              className="font-display font-bold tracking-tight uppercase truncate"
                              style={{
                                fontSize: activeTemplate.id === 'thermal-50x30' ? '6.5pt' : activeTemplate.compact ? '7pt' : '8.5pt',
                                color: primaryColor,
                              }}
                            >
                              KIDECO · OIMS
                            </div>

                            <div
                              className="font-mono font-bold truncate"
                              style={{
                                fontSize: activeTemplate.id === 'thermal-50x30' ? '7.5pt' : activeTemplate.compact ? '8.5pt' : '11pt',
                                color: codeColor,
                                marginTop: '1px',
                              }}
                            >
                              {asset.asset_code}
                            </div>

                            <div
                              className="font-semibold truncate"
                              style={{
                                fontSize: activeTemplate.id === 'thermal-50x30' ? '6.5pt' : activeTemplate.compact ? '7.5pt' : '9.5pt',
                                color: primaryColor,
                                marginTop: '1px',
                              }}
                            >
                              {asset.asset_name}
                            </div>

                            {showLocation && (
                              <div
                                className="truncate"
                                style={{
                                  fontSize: activeTemplate.id === 'thermal-50x30' ? '5.5pt' : activeTemplate.compact ? '6.5pt' : '7.5pt',
                                  color: mutedColor,
                                  marginTop: '1px',
                                }}
                              >
                                {asset.building_name} · {asset.specific_location}
                              </div>
                            )}

                            {!activeTemplate.compact && showSerial && asset.serial_number && (
                              <div
                                className="font-mono truncate"
                                style={{ fontSize: '7pt', color: mutedColor, marginTop: '1px' }}
                              >
                                SN: {asset.serial_number}
                              </div>
                            )}

                            {!activeTemplate.compact && showPic && (
                              <div
                                className="truncate"
                                style={{ fontSize: '7pt', color: mutedColor, marginTop: '1px' }}
                              >
                                PIC: {asset.pic_name || 'Unassigned'}
                              </div>
                            )}

                            {!activeTemplate.compact && asset.qr_token && (
                              <div
                                className="font-mono truncate"
                                style={{ fontSize: '6pt', color: mutedColor, marginTop: '2px' }}
                              >
                                {asset.qr_token}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scanner + Lookup Result Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 no-print">
        <div className="lg:col-span-5 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
            {lang === 'id' ? 'Pindai QR Code atau Masukkan Kode Aset' : 'Scan QR Code or Enter Asset Code'}
          </h2>

          <div className="flex gap-2">
            {!scanning ? (
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded-md transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span>{lang === 'id' ? 'Mulai Kamera Pemindai' : 'Start Camera Scanner'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] rounded-md"
              >
                <span>{lang === 'id' ? 'Hentikan Kamera' : 'Stop Camera'}</span>
              </button>
            )}
          </div>

          <div
            id="oims-qr-reader"
            className={scanning ? 'w-full rounded overflow-hidden border border-neutral-200 dark:border-neutral-700' : 'hidden'}
          />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualCode.trim()) resolveCode(manualCode);
            }}
            className="flex gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800"
          >
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={lookupInputRef}
                type="text"
                value={manualCode}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="OIMS-QR-..., OIMS-2027-000001, or Serial No."
                className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E]"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md whitespace-nowrap"
            >
              {lang === 'id' ? 'Cari' : 'Lookup'}
            </button>
          </form>

          {scanError && (
            <div className="p-3 text-xs text-[#C8102E] dark:text-red-300 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900/60 rounded-md">{scanError}</div>
          )}
        </div>

        {/* Scan Result Detail Card */}
        <div className="lg:col-span-7 bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
          {!scanResult ? (
            <div className="h-full flex flex-col items-center justify-center py-10 text-center text-neutral-500 dark:text-neutral-400 text-xs">
              <QrCode className="w-10 h-10 text-neutral-300 dark:text-neutral-600 mb-2" />
              <p>
                {lang === 'id'
                  ? 'Pindai QR code aset atau masukkan Kode Aset / Serial Number untuk menampilkan data detail aset dan foto.'
                  : 'Scan an asset QR code or enter an Asset Code / Serial Number to view complete asset details and photos.'}
              </p>
            </div>
          ) : (
            (() => {
              const asset = scanResult.asset;
              const photos: any[] = Array.isArray(scanResult.photos) ? scanResult.photos : [];
              const documents: any[] = Array.isArray(scanResult.documents) ? scanResult.documents : [];
              const displayPhotoUrl = activePhotoUrl || asset.primary_photo_url || null;
              const canPreviewPhoto = Boolean(displayPhotoUrl && isSafeExternalUrl(displayPhotoUrl) && !scanPhotoBroken);

              return (
                <div className="space-y-4">
                  {/* Top Header + Large Asset Photo */}
                  <div className="flex flex-col sm:flex-row items-start justify-between gap-4 border-b border-neutral-100 dark:border-neutral-800 pb-4">
                    <div className="flex flex-col sm:flex-row items-start gap-4 min-w-0 flex-1">
                      <div className="w-full sm:w-40 shrink-0 space-y-2">
                        {canPreviewPhoto ? (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(displayPhotoUrl)}
                            className="block w-full h-36 rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-[#1E222A] hover:border-[#C8102E] transition-colors cursor-zoom-in"
                            title={lang === 'id' ? 'Perbesar foto aset' : 'Zoom asset photo'}
                          >
                            <img
                              src={displayPhotoUrl!}
                              alt={asset.asset_name}
                              referrerPolicy="no-referrer"
                              onError={() => setScanPhotoBroken(true)}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="w-full h-36 rounded-md bg-neutral-100 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 flex flex-col items-center justify-center text-neutral-500 dark:text-neutral-400 text-[11px] gap-1.5 p-2 text-center">
                            <ImageIcon className="w-5 h-5 text-neutral-400" />
                            <span>
                              {displayPhotoUrl
                                ? lang === 'id'
                                  ? 'Tersimpan Lokal'
                                  : 'Stored Locally'
                                : lang === 'id'
                                ? 'Belum Ada Foto Aset'
                                : 'No Asset Photo'}
                            </span>
                          </div>
                        )}

                        {photos.length > 1 && (
                          <div className="flex flex-wrap gap-1.5">
                            {photos.map((p, idx) => (
                              <button
                                key={p.id || idx}
                                type="button"
                                onClick={() => {
                                  setScanPhotoBroken(false);
                                  setActivePhotoUrl(p.file_url);
                                }}
                                className={`w-9 h-9 rounded overflow-hidden border ${
                                  displayPhotoUrl === p.file_url ? 'border-[#C8102E] ring-1 ring-[#C8102E]' : 'border-neutral-200 dark:border-neutral-700'
                                }`}
                              >
                                <img
                                  src={p.file_url}
                                  alt={p.file_name || `Photo ${idx + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{asset.asset_code}</span>
                          {asset.qr_token && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 bg-neutral-100 dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 rounded text-neutral-700 dark:text-neutral-300">
                              {asset.qr_token}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${
                              scanResult.access_tier === 'administrative'
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60'
                                : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60'
                            }`}
                          >
                            {scanResult.access_tier === 'administrative' ? (
                              <>
                                <ShieldCheck className="w-3 h-3" />
                                <span>{lang === 'id' ? 'Tier 3 · Administratif' : 'Tier 3 · Administrative'}</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3 h-3" />
                                <span>{lang === 'id' ? 'Tier 2 · Terotentikasi' : 'Tier 2 · Authenticated'}</span>
                              </>
                            )}
                          </span>
                          {asset.qr_status === 'Revoked' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-[#C8102E] dark:text-red-300 border border-red-200 dark:border-red-900/60">
                              <Ban className="w-3 h-3" />
                              <span>Revoked</span>
                            </span>
                          )}
                        </div>
                        <h3 className="font-display text-base font-bold text-[#141619] dark:text-neutral-100 mt-1">{asset.asset_name}</h3>
                        <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
                          {asset.category_name}
                          {asset.subcategory_name ? ` · ${asset.subcategory_name}` : ''}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                          {asset.brand || '-'} {asset.model || ''}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <ConditionLabel condition={asset.condition_status} />
                          <StatusLabel status={asset.asset_status} />
                        </div>
                        {typeof asset.scan_count === 'number' && (
                          <div className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500 mt-2">
                            {lang === 'id' ? 'Total Pindai:' : 'Scan Count:'} {asset.scan_count}
                            {asset.last_scanned_at ? ` · Last: ${String(asset.last_scanned_at).slice(0, 16)}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Full Asset Detail Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Nomor Seri' : 'Serial Number'}</span>
                      <span className="font-mono font-medium text-[#141619] dark:text-neutral-100">{asset.serial_number || '-'}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Perusahaan & Divisi' : 'Company & Division'}</span>
                      <span className="font-medium text-[#141619] dark:text-neutral-100">
                        {asset.company_name} · {asset.division_name}
                        {asset.department ? ` (${asset.department})` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Penanggung Jawab (PIC)' : 'Responsible Person (PIC)'}</span>
                      <span className="font-medium text-[#141619] dark:text-neutral-100">
                        {asset.pic_name ? `${asset.pic_name} (${asset.pic_nik})` : 'Unassigned'}
                      </span>
                      {(asset.pic_email || asset.pic_phone) && (
                        <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                          {[asset.pic_email, asset.pic_phone].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>

                    <div className="sm:col-span-2 lg:col-span-3">
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Lokasi Penempatan' : 'Placement Location'}</span>
                      <span className="font-medium text-[#141619] dark:text-neutral-100">
                        {asset.building_name} → {asset.floor_name} → {asset.room_name} → {asset.specific_location}
                      </span>
                      {asset.location_code && (
                        <span className="ml-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">[{asset.location_code}]</span>
                      )}
                    </div>

                    <div>
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Tanggal Perolehan' : 'Acquisition Date'}</span>
                      <span className="font-mono text-[#141619] dark:text-neutral-100">{asset.acquisition_date || '-'}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Nilai Perolehan' : 'Acquisition Value'}</span>
                      <span className="font-mono font-semibold text-[#141619] dark:text-neutral-100 tabular-nums">
                        {scanResult.access_tier === 'administrative'
                          ? formatIDR(asset.acquisition_value)
                          : lang === 'id'
                          ? 'Disembunyikan (Tier 3)'
                          : 'Restricted (Tier 3)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Garansi / Sumber' : 'Warranty / Source'}</span>
                      <span className="text-[#141619] dark:text-neutral-100">
                        {asset.warranty_period_months ? `${asset.warranty_period_months} mo` : '-'} · {asset.acquisition_source || '-'}
                      </span>
                    </div>

                    <div>
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Pemasok / Referensi PO' : 'Supplier / PO Ref'}</span>
                      <span className="text-[#141619] dark:text-neutral-100">
                        {scanResult.access_tier === 'administrative'
                          ? `${asset.supplier || '-'} ${asset.purchase_reference ? `(${asset.purchase_reference})` : ''}`
                          : lang === 'id'
                          ? 'Disembunyikan (Tier 3)'
                          : 'Restricted (Tier 3)'}
                      </span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-neutral-500 dark:text-neutral-400 block">{lang === 'id' ? 'Spesifikasi & Deskripsi' : 'Specification & Description'}</span>
                      <span className="text-neutral-700 dark:text-neutral-300">
                        {[asset.specification, asset.description].filter(Boolean).join(' — ') || '-'}
                      </span>
                    </div>
                  </div>

                  {scanResult.access_tier !== 'administrative' && (
                    <div className="p-3 rounded-md bg-blue-50/70 dark:bg-blue-950/25 border border-blue-200 dark:border-blue-900/60 text-[11px] text-blue-900 dark:text-blue-200 flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {lang === 'id'
                          ? 'Mode Tier 2 (Authenticated): nilai perolehan, pemasok, kontak PIC, dokumen pengadaan, dan event ledger disensor otomatis.'
                          : 'Tier 2 (Authenticated) mode: acquisition value, supplier, PIC contact, procurement documents, and event ledger are redacted.'}
                      </span>
                    </div>
                  )}

                  {/* Mobile / Field GPS & Photo Capture */}
                  {canFieldCapture && (
                    <form
                      onSubmit={handleSubmitFieldCapture}
                      className="p-3.5 rounded-md bg-[#F4F5F7] dark:bg-[#1E222A] border border-neutral-200 dark:border-neutral-700 space-y-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-[#141619] dark:text-neutral-100 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-[#C8102E] dark:text-red-400" />
                          <span>{lang === 'id' ? 'Rekam Bukti Lapangan (GPS & Foto)' : 'Field Evidence Capture (GPS & Photo)'}</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCaptureBrowserGps}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        >
                          <MapPin className="w-3 h-3 text-[#C8102E] dark:text-red-400" />
                          <span>{lang === 'id' ? 'Ambil GPS Perangkat' : 'Capture Device GPS'}</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={fieldLat}
                          onChange={(e) => setFieldLat(e.target.value)}
                          placeholder="Latitude (e.g. -1.8689)"
                          className="px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded"
                        />
                        <input
                          type="text"
                          value={fieldLng}
                          onChange={(e) => setFieldLng(e.target.value)}
                          placeholder="Longitude (e.g. 115.9682)"
                          className="px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded"
                        />
                        <select
                          value={fieldCondition}
                          onChange={(e) => setFieldCondition(e.target.value)}
                          className="px-2.5 py-1.5 text-xs bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded"
                        >
                          <option value="">{lang === 'id' ? 'Kondisi teramati...' : 'Observed condition...'}</option>
                          <option value="Good">Good</option>
                          <option value="Minor Damage">Minor Damage</option>
                          <option value="Major Damage">Major Damage</option>
                          <option value="Unserviceable">Unserviceable</option>
                        </select>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white dark:bg-[#171A20] text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">
                          <Upload className="w-3.5 h-3.5" />
                          <span>
                            {fieldPhotoFile
                              ? fieldPhotoFile.name
                              : lang === 'id'
                              ? 'Foto Kamera / Lokal'
                              : 'Camera / Local Photo'}
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => setFieldPhotoFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        <input
                          type="text"
                          value={fieldNotes}
                          onChange={(e) => setFieldNotes(e.target.value)}
                          placeholder={lang === 'id' ? 'Catatan pemeriksaan lapangan...' : 'Field inspection notes...'}
                          className="flex-1 min-w-[160px] px-2.5 py-1.5 text-xs bg-white dark:bg-[#171A20] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded"
                        />
                        <button
                          type="submit"
                          disabled={fieldBusy}
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] hover:bg-neutral-800 dark:hover:bg-[#A10D24] rounded disabled:opacity-50"
                        >
                          {fieldBusy
                            ? lang === 'id'
                              ? 'Menyimpan...'
                              : 'Saving...'
                            : lang === 'id'
                            ? 'Simpan Bukti'
                            : 'Save Evidence'}
                        </button>
                      </div>

                      {fieldMessage && (
                        <div className="text-[11px] text-neutral-700 dark:text-neutral-300 font-medium">{fieldMessage}</div>
                      )}
                    </form>
                  )}

                  {/* Supporting Documents */}
                  {documents.length > 0 && (
                    <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs space-y-1.5">
                      <div className="font-semibold text-[#141619] dark:text-neutral-100 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#C8102E] dark:text-red-400" />
                        <span>
                          {lang === 'id' ? 'Dokumen Pendukung & Faktur' : 'Supporting Documents & Invoices'} ({documents.length})
                        </span>
                      </div>
                      <div className="space-y-1">
                        {documents.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between gap-2 text-neutral-700 dark:text-neutral-300">
                            <span className="truncate">
                              {doc.doc_type} · {doc.file_name}
                              {doc.file_size_bytes ? ` (${formatFileSize(doc.file_size_bytes)})` : ''}
                            </span>
                            {isSafeExternalUrl(doc.file_url) && (
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[#C8102E] dark:text-red-400 hover:underline shrink-0"
                              >
                                <span>{lang === 'id' ? 'Buka File' : 'Open File'}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Field Captures History */}
                  {Array.isArray(scanResult.fieldCaptures) && scanResult.fieldCaptures.length > 0 && (
                    <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs space-y-1.5">
                      <div className="font-semibold text-[#141619] dark:text-neutral-100 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#C8102E] dark:text-red-400" />
                        <span>
                          {lang === 'id' ? 'Riwayat GPS & Foto Lapangan' : 'Field GPS & Photo Captures'} ({scanResult.fieldCaptures.length})
                        </span>
                      </div>
                      <div className="space-y-1">
                        {scanResult.fieldCaptures.slice(0, 4).map((fc: FieldCaptureRow) => (
                          <div key={fc.id} className="flex flex-wrap items-center justify-between gap-2 text-neutral-600 dark:text-neutral-300">
                            <div>
                              <span className="font-mono text-[11px]">{String(fc.captured_at).slice(0, 16)}</span> ·{' '}
                              <span>{fc.captured_by_name || fc.captured_by_username || 'Staff'}</span>
                              {fc.latitude !== null && fc.latitude !== undefined && fc.longitude !== null && fc.longitude !== undefined && (
                                <span className="ml-1.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                                  ({Number(fc.latitude).toFixed(5)}, {Number(fc.longitude).toFixed(5)})
                                </span>
                              )}
                              {fc.condition_observed && <span className="ml-1.5">· {fc.condition_observed}</span>}
                            </div>
                            {fc.photo_url && isSafeExternalUrl(fc.photo_url) && (
                              <button
                                type="button"
                                onClick={() => setLightboxUrl(fc.photo_url!)}
                                className="text-[#C8102E] dark:text-red-400 hover:underline font-medium"
                              >
                                {lang === 'id' ? 'Lihat Foto' : 'View Photo'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Movement & Maintenance History */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs">
                    <div>
                      <div className="font-semibold text-[#141619] dark:text-neutral-100 mb-1.5">
                        {lang === 'id' ? 'Riwayat Perpindahan' : 'Movement History'} ({scanResult.movements.length})
                      </div>
                      {scanResult.movements.length === 0 ? (
                        <div className="text-neutral-400 dark:text-neutral-500">{lang === 'id' ? 'Belum ada riwayat perpindahan' : 'No recorded transfers'}</div>
                      ) : (
                        scanResult.movements.slice(0, 4).map((m: any) => (
                          <div key={m.id} className="text-neutral-600 dark:text-neutral-300 mb-1">
                            <span className="font-mono">{String(m.movement_date).slice(0, 10)}</span> · {m.from_loc} → {m.to_loc}
                          </div>
                        ))
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-[#141619] dark:text-neutral-100 mb-1.5">
                        {lang === 'id' ? 'Riwayat Pemeliharaan' : 'Maintenance History'} ({scanResult.maintenance.length})
                      </div>
                      {scanResult.maintenance.length === 0 ? (
                        <div className="text-neutral-400 dark:text-neutral-500">{lang === 'id' ? 'Belum ada tiket pemeliharaan' : 'No maintenance tickets'}</div>
                      ) : (
                        scanResult.maintenance.slice(0, 4).map((m: any) => (
                          <div key={m.id} className="text-neutral-600 dark:text-neutral-300 mb-1">
                            <span className="font-mono">{m.ticket_code}</span> · {m.damage_type} ({m.status})
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* Asset QR Tag Registry */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden no-print">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
              {lang === 'id' ? 'Registrasi & Antrean Cetak Label QR' : 'Asset QR Tag Registry & Bulk Queue'}
            </h3>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
              {filteredAssets.length} {lang === 'id' ? 'aset ditampilkan' : 'assets shown'} ·{' '}
              {selectedIds.length} {lang === 'id' ? 'dipilih' : 'selected'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                placeholder={lang === 'id' ? 'Cari kode, nama, lokasi...' : 'Filter code, name, location...'}
                className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded-md focus:outline-none focus:border-[#C8102E] w-48"
              />
            </div>

            <div className="inline-flex border border-neutral-300 dark:border-neutral-700 rounded-md overflow-hidden text-xs">
              {(['all', 'missing', 'tagged'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setQrFilter(mode)}
                  className={`px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
                    qrFilter === mode
                      ? 'bg-[#141619] dark:bg-[#C8102E] text-white'
                      : 'bg-white dark:bg-[#1E222A] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                  }`}
                >
                  {mode === 'all'
                    ? lang === 'id'
                      ? 'Semua'
                      : 'All'
                    : mode === 'missing'
                    ? lang === 'id'
                      ? `Belum QR (${missingAssetsCount})`
                      : `Missing (${missingAssetsCount})`
                    : lang === 'id'
                    ? 'Sudah QR'
                    : 'Tagged'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="px-2.5 py-1.5 text-xs font-medium text-[#C8102E] dark:text-red-400 border border-[#C8102E]/30 dark:border-red-900/60 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap"
            >
              {allFilteredSelected
                ? lang === 'id'
                  ? 'Batal Pilih'
                  : 'Deselect Filtered'
                : lang === 'id'
                ? `Pilih Semua (${filteredAssets.length})`
                : `Select Filtered (${filteredAssets.length})`}
            </button>

            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                {lang === 'id' ? 'Bersihkan' : 'Clear'}
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2.5 w-10">
                  <button
                    type="button"
                    onClick={toggleSelectAllFiltered}
                    className="text-neutral-500 hover:text-[#C8102E]"
                    title={lang === 'id' ? 'Pilih semua hasil filter' : 'Toggle all filtered'}
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-2.5 font-medium">Asset Code</th>
                <th className="px-4 py-2.5 font-medium">Asset Name</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">QR Token & Privacy</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-400 dark:text-neutral-500">
                    {lang === 'id'
                      ? 'Tidak ada aset yang cocok dengan filter.'
                      : 'No assets match the current filter.'}
                  </td>
                </tr>
              ) : (
                filteredAssets.map((a) => {
                  const selected = selectedIds.includes(a.id);
                  const isRevoked = a.qr_status === 'Revoked';
                  return (
                    <tr key={a.id} className={selected ? 'bg-red-50/40 dark:bg-red-950/25' : 'hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60'}>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSelect(a.id)}
                          className="text-neutral-500 hover:text-[#C8102E]"
                        >
                          {selected ? (
                            <CheckSquare className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-[#141619] dark:text-neutral-100 whitespace-nowrap">{a.asset_code}</td>
                      <td className="px-4 py-2.5 text-neutral-800 dark:text-neutral-200">{a.asset_name}</td>
                      <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">
                        {a.building_name} · {a.specific_location}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-neutral-600 dark:text-neutral-400">
                        {a.qr_token ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span>{a.qr_token}</span>
                              {isRevoked ? (
                                <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-[#C8102E] dark:text-red-300 border border-red-200 dark:border-red-900/60">
                                  Revoked
                                </span>
                              ) : Number(a.public_enabled ?? 1) === 1 ? (
                                <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60">
                                  Public
                                </span>
                              ) : (
                                <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                                  Private
                                </span>
                              )}
                            </div>
                            {a.public_slug && (
                              <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
                                slug: {a.public_slug}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#C8102E] dark:text-red-400 font-sans font-medium">Missing QR</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                        {!a.qr_token ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleGenerateQr(a.id)}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-[#C8102E] rounded hover:bg-[#A10D24]"
                            >
                              Generate QR
                            </button>
                            <button
                              type="button"
                              disabled={batchBusy}
                              onClick={() => prepareBulkPrint([a.id])}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#141619] dark:bg-neutral-700 rounded hover:bg-neutral-800 dark:hover:bg-neutral-600 disabled:opacity-50"
                            >
                              <Printer className="w-3 h-3" />
                              <span>Print</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => resolveCode(a.qr_token!)}
                              className="px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              Inspect
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyPublicLink(a)}
                              title={lang === 'id' ? 'Salin Tautan QR Publik' : 'Copy Public QR Link'}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Link</span>
                            </button>
                            {canGenerateQr && (
                              <button
                                type="button"
                                onClick={() => openManagePrivacy(a)}
                                title={lang === 'id' ? 'Atur Privasi & Revoke QR' : 'Manage QR Privacy & Revoke'}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              >
                                <Settings2 className="w-3 h-3" />
                                <span>{lang === 'id' ? 'Privasi' : 'Access'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDownloadPng(a)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              <Download className="w-3 h-3" />
                              <span>PNG</span>
                            </button>
                            <button
                              type="button"
                              disabled={batchBusy}
                              onClick={() => prepareBulkPrint([a.id])}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#141619] dark:bg-neutral-700 rounded hover:bg-neutral-800 dark:hover:bg-neutral-600 disabled:opacity-50"
                            >
                              <Printer className="w-3 h-3" />
                              <span>Label</span>
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* QR Access Audit Logs */}
      <div className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden no-print">
        <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
            <h3 className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
              {lang === 'id' ? 'Log Akses & Keamanan QR (Public / Staff / Denied)' : 'QR Access & Security Logs (Public / Staff / Denied)'}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !showAccessLogs;
              setShowAccessLogs(next);
              if (next) void loadAccessLogs();
            }}
            className="px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-300 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            {showAccessLogs
              ? lang === 'id'
                ? 'Sembunyikan Log'
                : 'Hide Logs'
              : lang === 'id'
              ? 'Muat Log Akses QR'
              : 'Load QR Access Logs'}
          </button>
        </div>

        {showAccessLogs && (
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-[#1E222A] border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 sticky top-0">
                <tr>
                  <th className="px-4 py-2 font-medium">{lang === 'id' ? 'Waktu (UTC)' : 'Timestamp'}</th>
                  <th className="px-4 py-2 font-medium">{lang === 'id' ? 'Aset / Token' : 'Asset / Token'}</th>
                  <th className="px-4 py-2 font-medium">Tier</th>
                  <th className="px-4 py-2 font-medium">Outcome</th>
                  <th className="px-4 py-2 font-medium">{lang === 'id' ? 'Pengguna / IP' : 'User / IP'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {logsLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                      {lang === 'id' ? 'Memuat log akses QR...' : 'Loading QR access logs...'}
                    </td>
                  </tr>
                ) : accessLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                      {lang === 'id' ? 'Belum ada catatan akses QR.' : 'No QR access events recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  accessLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-neutral-50 dark:hover:bg-[#1E222A]/60">
                      <td className="px-4 py-2 font-mono text-[11px] text-neutral-500 whitespace-nowrap">{log.accessed_at}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-[#141619] dark:text-neutral-100">
                        {log.asset_code || log.token_attempted || '-'}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px]">{log.access_tier}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-[11px] font-semibold ${
                            log.outcome === 'granted'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-[#C8102E] dark:text-red-400'
                          }`}
                        >
                          {log.outcome}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                        {log.username ? `@${log.username}` : 'public'} · {log.ip_address || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QR Privacy, Expiration & Token Revocation Modal */}
      {managedAsset && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 no-print"
          onClick={() => setManagedAsset(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-lg w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{managedAsset.asset_code}</div>
                <div className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100">
                  {lang === 'id' ? 'Kontrol Privasi, Kedaluwarsa & Pencabutan QR' : 'QR Privacy, Expiry & Revocation Control'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManagedAsset(null)}
                className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-[#141619] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 text-xs">
              {privacyError && (
                <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-[#C8102E] dark:text-red-300">
                  {privacyError}
                </div>
              )}

              <form onSubmit={handleSavePrivacySettings} className="space-y-3">
                <div className="font-semibold text-[#141619] dark:text-neutral-100">
                  {lang === 'id' ? 'Visibilitas Tampilan Publik (Tier 1)' : 'Public Asset View Visibility (Tier 1)'}
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={privacyForm.public_enabled}
                    onChange={(e) => setPrivacyForm({ ...privacyForm, public_enabled: e.target.checked })}
                    className="accent-[#C8102E]"
                  />
                  <span>{lang === 'id' ? 'Izinkan Tampilan Publik Tanpa Login' : 'Allow Unauthenticated Public View'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={privacyForm.public_show_photo}
                    onChange={(e) => setPrivacyForm({ ...privacyForm, public_show_photo: e.target.checked })}
                    className="accent-[#C8102E]"
                  />
                  <span>{lang === 'id' ? 'Tampilkan Foto Aset pada Mode Publik' : 'Show Asset Photo in Public View'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={privacyForm.public_show_location}
                    onChange={(e) => setPrivacyForm({ ...privacyForm, public_show_location: e.target.checked })}
                    className="accent-[#C8102E]"
                  />
                  <span>{lang === 'id' ? 'Tampilkan Perusahaan & Gedung Umum pada Mode Publik' : 'Show Company & General Building in Public View'}</span>
                </label>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    {lang === 'id' ? 'Kedaluwarsa Akses QR (Opsional)' : 'Access Expiration Timestamp (Optional)'}
                  </label>
                  <input
                    type="datetime-local"
                    value={privacyForm.expires_at}
                    onChange={(e) => setPrivacyForm({ ...privacyForm, expires_at: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={privacyBusy}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#141619] dark:bg-[#C8102E] rounded-md hover:bg-neutral-800 dark:hover:bg-[#A10D24] disabled:opacity-50"
                  >
                    {lang === 'id' ? 'Simpan Pengaturan Privasi' : 'Save Privacy Settings'}
                  </button>
                </div>
              </form>

              <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
                <div className="font-semibold text-[#141619] dark:text-neutral-100 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-[#C8102E] dark:text-red-400" />
                  <span>{lang === 'id' ? 'Pencabutan & Rotasi Token QR' : 'QR Token Revocation & Rotation'}</span>
                </div>
                <input
                  type="text"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder={lang === 'id' ? 'Alasan pencabutan atau rotasi label QR...' : 'Reason for revoking or rotating QR label...'}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E222A] text-[#141619] dark:text-neutral-100 border border-neutral-300 dark:border-neutral-700 rounded"
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={privacyBusy}
                    onClick={() => handleRevokeOrRotate(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#C8102E] dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-md hover:bg-red-100 dark:hover:bg-red-950/60 disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>{lang === 'id' ? 'Cabut QR (Revoke)' : 'Revoke QR'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={privacyBusy}
                    onClick={() => handleRevokeOrRotate(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded-md disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{lang === 'id' ? 'Rotasi & Terbitkan Token Baru' : 'Rotate & Reissue Token'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 no-print"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="bg-white dark:bg-[#171A20] border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-2xl w-full overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs font-bold text-[#C8102E] dark:text-red-400">{scanResult?.asset?.asset_code}</div>
                <div className="font-display text-sm font-semibold text-[#141619] dark:text-neutral-100 truncate">
                  {scanResult?.asset?.asset_name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-neutral-950 flex items-center justify-center p-4 max-h-[75vh]">
              <img
                src={lightboxUrl}
                alt={scanResult?.asset?.asset_name || 'Asset Photo'}
                referrerPolicy="no-referrer"
                className="max-h-[68vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

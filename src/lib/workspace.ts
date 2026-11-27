import { apiFetch } from './api';

export interface LocalUploadMetadata {
  ok: boolean;
  kind: 'photo' | 'document';
  docType: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSizeBytes: number;
}

export function isSafeExternalUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  if (
    rawUrl.startsWith('/src/assets/images/') ||
    rawUrl.startsWith('/assets/aistudio/') ||
    rawUrl.startsWith('/uploads/')
  ) {
    return !rawUrl.includes('..');
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function uploadAssetFileLocally(params: {
  file: File;
  kind: 'photo' | 'document';
  assetCode?: string;
  docType?: string;
  assetId?: number;
}): Promise<LocalUploadMetadata> {
  const fd = new FormData();
  fd.append('kind', params.kind);
  if (params.assetCode) fd.append('asset_code', params.assetCode);
  if (params.docType) fd.append('doc_type', params.docType);
  fd.append('file', params.file);

  const endpoint = params.assetId ? `/api/assets/${params.assetId}/upload` : '/api/uploads/asset-file';
  return apiFetch<LocalUploadMetadata>(endpoint, {
    method: 'POST',
    body: fd,
  });
}

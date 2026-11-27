import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from './db';

const ALLOWED_LOCAL_BASES: { prefix: string; dir: string }[] = [
  { prefix: '/uploads/', dir: path.resolve(process.cwd(), 'uploads') },
  { prefix: '/src/assets/images/', dir: path.resolve(process.cwd(), 'src', 'assets', 'images') },
  { prefix: '/assets/aistudio/', dir: path.resolve(process.cwd(), 'assets', 'aistudio') },
];

const EXT_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export interface LocalFilePayload {
  resolvedPath: string;
  mimeType: string;
  buffer: Buffer;
  sha256: string;
}

export function resolveSafeLocalAssetPhoto(photoUrl: string): string | null {
  const clean = String(photoUrl || '').trim().split('?')[0].split('#')[0];
  if (!clean || clean.includes('..') || clean.includes('\0')) return null;

  for (const entry of ALLOWED_LOCAL_BASES) {
    if (clean.startsWith(entry.prefix)) {
      const rel = clean.slice(entry.prefix.length);
      if (!rel) return null;
      const resolved = path.resolve(entry.dir, rel);
      if (resolved.startsWith(entry.dir + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
      return null;
    }
  }
  return null;
}

export function readLocalAssetPhotoWithHash(photoUrl: string): LocalFilePayload {
  const resolvedPath = resolveSafeLocalAssetPhoto(photoUrl);
  if (!resolvedPath) {
    const err = new Error('Local asset photo file not found or path outside permitted storage.') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeType = EXT_MIME_MAP[ext];
  if (!mimeType) {
    const err = new Error('Unsupported image format for Smart Asset Identification. Allowed: JPG, PNG, WEBP.') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const buffer = fs.readFileSync(resolvedPath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { resolvedPath, mimeType, buffer, sha256 };
}

export function isGeminiApiKeyConfigured(): boolean {
  const raw = (process.env.GEMINI_API_KEY || '').trim();
  return Boolean(raw && raw !== 'MY_GEMINI_API_KEY' && raw !== 'YOUR_API_KEY');
}

export interface DuplicatePhotoMatch {
  asset_id: number | null;
  asset_code: string;
  asset_name: string;
  company_id: number;
  company_name: string;
  photo_url: string;
  match_type: 'sha256_exact' | 'same_file_url';
  is_cross_company: boolean;
}

export function findCrossAssetPhotoDuplicates(params: {
  sourcePhotoUrl: string;
  photoSha256: string;
  excludeAssetId?: number | null;
  allowedCompanyIds: number[];
  isHoldingScope: boolean;
}): DuplicatePhotoMatch[] {
  const rows = db
    .prepare(`
      SELECT a.id as asset_id, a.asset_code, a.asset_name, a.company_id, c.name as company_name,
             a.primary_photo_url as photo_url
      FROM assets a
      JOIN companies c ON c.id = a.company_id
      WHERE a.deleted_at IS NULL AND a.primary_photo_url IS NOT NULL
      UNION
      SELECT a.id as asset_id, a.asset_code, a.asset_name, a.company_id, c.name as company_name,
             ap.file_url as photo_url
      FROM asset_photos ap
      JOIN assets a ON a.id = ap.asset_id
      JOIN companies c ON c.id = a.company_id
      WHERE a.deleted_at IS NULL AND ap.file_url IS NOT NULL
    `)
    .all() as {
      asset_id: number;
      asset_code: string;
      asset_name: string;
      company_id: number;
      company_name: string;
      photo_url: string;
    }[];

  const allowedSet = new Set(params.allowedCompanyIds);
  const matches: DuplicatePhotoMatch[] = [];
  const seenKey = new Set<string>();
  const hashCache = new Map<string, string | null>();

  for (const row of rows) {
    if (params.excludeAssetId && row.asset_id === params.excludeAssetId) continue;
    const dedupeKey = `${row.asset_id}:${row.photo_url}`;
    if (seenKey.has(dedupeKey)) continue;

    let matchType: 'sha256_exact' | 'same_file_url' | null = null;
    if (row.photo_url === params.sourcePhotoUrl) {
      matchType = 'same_file_url';
    } else {
      let candidateHash = hashCache.get(row.photo_url);
      if (candidateHash === undefined) {
        const resolved = resolveSafeLocalAssetPhoto(row.photo_url);
        if (resolved) {
          try {
            candidateHash = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
          } catch {
            candidateHash = null;
          }
        } else {
          candidateHash = null;
        }
        hashCache.set(row.photo_url, candidateHash);
      }
      if (candidateHash && candidateHash === params.photoSha256) {
        matchType = 'sha256_exact';
      }
    }

    if (matchType) {
      seenKey.add(dedupeKey);
      const canSeeDetails = params.isHoldingScope || allowedSet.has(row.company_id);
      matches.push({
        asset_id: canSeeDetails ? row.asset_id : null,
        asset_code: canSeeDetails ? row.asset_code : 'CROSS-ENTITY-PROTECTED',
        asset_name: canSeeDetails ? row.asset_name : 'Aset duplikat terdeteksi pada entitas perusahaan lain',
        company_id: row.company_id,
        company_name: canSeeDetails ? row.company_name : 'Entitas Terisolasi',
        photo_url: canSeeDetails ? row.photo_url : '[REDACTED]',
        match_type: matchType,
        is_cross_company: !canSeeDetails || (params.excludeAssetId ? false : false),
      });
    }
  }

  return matches.slice(0, 20);
}

export interface SimilarAssetCandidate {
  asset_id: number;
  asset_code: string;
  asset_name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  category_name: string;
  score: number;
  matched_tokens: string[];
}

export function findSimilarAssetsAndCategory(params: {
  hintText: string;
  sourcePhotoUrl: string;
  companyIds: number[];
  isHoldingScope: boolean;
  excludeAssetId?: number | null;
}): {
  similarityMatches: SimilarAssetCandidate[];
  recommendedCategoryId: number | null;
} {
  const filenameTokens = path
    .basename(params.sourcePhotoUrl, path.extname(params.sourcePhotoUrl))
    .replace(/asset-photo-\d+-[0-9a-f-]+/i, '')
    .toLowerCase();

  const rawText = `${params.hintText || ''} ${filenameTokens}`.toLowerCase();
  const tokens = Array.from(
    new Set(
      rawText
        .split(/[^a-z0-9-]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
    )
  );

  const categories = db.prepare('SELECT id, code, name FROM categories ORDER BY id ASC').all() as {
    id: number;
    code: string;
    name: string;
  }[];

  let recommendedCategoryId: number | null = null;
  const categoryKeywords: Record<string, string[]> = {
    IT: ['laptop', 'dell', 'lenovo', 'thinkpad', 'latitude', 'workstation', 'printer', 'lexmark', 'hp', 'laserjet', 'switch', 'cisco', 'router', 'server', 'computer', 'pc', 'scanner'],
    FUR: ['chair', 'kursi', 'herman', 'steelcase', 'desk', 'meja', 'cabinet', 'lemari', 'ergonomic', 'furniture'],
    AV: ['display', 'samsung', 'monitor', 'tv', 'projector', 'proyektor', 'conference', 'audio', 'flip'],
    FAC: ['ups', 'apc', 'power', 'battery', 'ac', 'generator', 'electrical', 'panel'],
  };

  let bestCatScore = 0;
  for (const cat of categories) {
    let score = 0;
    const kwList = categoryKeywords[cat.code.toUpperCase()] || [];
    for (const kw of kwList) {
      if (rawText.includes(kw)) score += 2;
    }
    for (const t of tokens) {
      if (cat.name.toLowerCase().includes(t) || cat.code.toLowerCase() === t) score += 1;
    }
    if (score > bestCatScore) {
      bestCatScore = score;
      recommendedCategoryId = cat.id;
    }
  }

  let whereSql = 'a.deleted_at IS NULL';
  const queryParams: unknown[] = [];
  if (!params.isHoldingScope && params.companyIds.length > 0) {
    whereSql += ` AND a.company_id IN (${params.companyIds.map(() => '?').join(',')})`;
    queryParams.push(...params.companyIds);
  } else if (!params.isHoldingScope) {
    whereSql += ' AND 1=0';
  }

  const scopedAssets = db
    .prepare(`
      SELECT a.id, a.asset_code, a.asset_name, a.brand, a.model, a.serial_number, c.name as category_name
      FROM assets a
      JOIN categories c ON c.id = a.category_id
      WHERE ${whereSql}
    `)
    .all(...queryParams) as {
      id: number;
      asset_code: string;
      asset_name: string;
      brand: string | null;
      model: string | null;
      serial_number: string | null;
      category_name: string;
    }[];

  const scored: SimilarAssetCandidate[] = [];
  for (const asset of scopedAssets) {
    if (params.excludeAssetId && asset.id === params.excludeAssetId) continue;
    if (tokens.length === 0) continue;

    const haystack = `${asset.asset_code} ${asset.asset_name} ${asset.brand || ''} ${asset.model || ''} ${asset.serial_number || ''} ${asset.category_name}`.toLowerCase();
    const matchedTokens: string[] = [];
    let score = 0;

    for (const tok of tokens) {
      if (asset.serial_number && asset.serial_number.toLowerCase() === tok) {
        score += 10;
        matchedTokens.push(tok);
      } else if (haystack.includes(tok)) {
        score += tok.length >= 5 ? 3 : 2;
        matchedTokens.push(tok);
      }
    }

    if (score >= 2 && matchedTokens.length > 0) {
      scored.push({
        asset_id: asset.id,
        asset_code: asset.asset_code,
        asset_name: asset.asset_name,
        brand: asset.brand,
        model: asset.model,
        serial_number: asset.serial_number,
        category_name: asset.category_name,
        score,
        matched_tokens: matchedTokens.slice(0, 6),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    similarityMatches: scored.slice(0, 8),
    recommendedCategoryId,
  };
}

export interface GeminiAssetOcrResult {
  modelUsed: string;
  serial_number: string | null;
  asset_label: string | null;
  brand: string | null;
  model: string | null;
  specifications: string | null;
  recommended_category_code: string | null;
  confidence_notes: string | null;
  raw_json: string;
}

export async function runGeminiVisionAssetOcr(params: {
  buffer: Buffer;
  mimeType: string;
  categories: { id: number; code: string; name: string }[];
}): Promise<GeminiAssetOcrResult> {
  if (!isGeminiApiKeyConfigured()) {
    const err = new Error('GEMINI_API_KEY belum dikonfigurasi pada server environment. Gunakan mode Local SHA-256 Deduplication atau atur GEMINI_API_KEY di server.') as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!.trim(),
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const modelUsed = 'gemini-4-hydrogen';
  const catList = params.categories.map((c) => `${c.code} (${c.name})`).join(', ');

  try {
    const response = await ai.models.generateContent({
      model: modelUsed,
      contents: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.buffer.toString('base64'),
          },
        },
        `Inspect this corporate asset or equipment nameplate/label photo for KIDECO OIMS asset identification.
Extract only clearly observable data (return null or empty string if unreadable — never fabricate serial numbers):
- serial_number: manufacturer serial number / S/N / service tag if visible
- asset_label: asset tag, barcode text, or descriptive equipment label visible
- brand: manufacturer brand name
- model: exact hardware/equipment model
- specifications: concise technical specs visible on the label or device
- recommended_category_code: choose the best matching code from [${catList}]
- confidence_notes: brief note on image clarity and what was detected vs. uncertain.`,
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            serial_number: { type: Type.STRING, nullable: true },
            asset_label: { type: Type.STRING, nullable: true },
            brand: { type: Type.STRING, nullable: true },
            model: { type: Type.STRING, nullable: true },
            specifications: { type: Type.STRING, nullable: true },
            recommended_category_code: { type: Type.STRING, nullable: true },
            confidence_notes: { type: Type.STRING, nullable: true },
          },
          required: ['confidence_notes'],
        },
      },
    });

    const rawText = (response.text || '').trim();
    if (!rawText) {
      throw new Error('Empty structured response returned by Gemini API');
    }

    const parsed = JSON.parse(rawText) as Record<string, any>;
    const cleanField = (val: unknown, maxLen = 220): string | null => {
      if (typeof val !== 'string') return null;
      const t = val.trim();
      if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'n/a') return null;
      return t.slice(0, maxLen);
    };

    return {
      modelUsed,
      serial_number: cleanField(parsed.serial_number, 120),
      asset_label: cleanField(parsed.asset_label, 220),
      brand: cleanField(parsed.brand, 120),
      model: cleanField(parsed.model, 120),
      specifications: cleanField(parsed.specifications, 1000),
      recommended_category_code: cleanField(parsed.recommended_category_code, 30),
      confidence_notes: cleanField(parsed.confidence_notes, 500),
      raw_json: rawText,
    };
  } catch (err: any) {
    const wrapped = new Error(`Gemini Vision OCR gagal: ${err?.message || 'Upstream AI service error'}`) as Error & { statusCode?: number };
    wrapped.statusCode = err?.statusCode || 502;
    throw wrapped;
  }
}

export function validateExternalEndpointUrl(rawUrl: string): { valid: boolean; reason?: string; parsedUrl?: URL } {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return { valid: false, reason: 'URL endpoint tidak valid.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: 'Hanya protokol http:// atau https:// yang diizinkan.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Kredensial tidak boleh disematkan langsung di dalam URL endpoint.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { valid: false, reason: 'Hostname endpoint tidak valid.' };
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:')
  ) {
    return { valid: false, reason: 'SSRF Guard: Alamat loopback/link-local/internal host tidak diizinkan.' };
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr, cStr, dStr] = ipv4Match;
    const [a, b, c, d] = [Number(aStr), Number(bStr), Number(cStr), Number(dStr)];
    if ([a, b, c, d].some((n) => n < 0 || n > 255)) {
      return { valid: false, reason: 'Alamat IPv4 tidak valid.' };
    }
    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return { valid: false, reason: 'SSRF Guard: Rentang IP privat, loopback, atau cloud metadata (169.254.x.x) diblokir.' };
    }
  }

  return { valid: true, parsedUrl: parsed };
}

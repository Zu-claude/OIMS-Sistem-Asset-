// Session token & active org scope stored strictly in React/JS memory (never localStorage/sessionStorage)
let sessionToken: string | null = null;
let activeCompanyScopeId: number | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function setActiveCompanyScopeId(companyId: number | null) {
  activeCompanyScopeId = companyId;
}

export function getActiveCompanyScopeId(): number | null {
  return activeCompanyScopeId;
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  if (activeCompanyScopeId !== null && !headers.has('X-OIMS-Company-Id')) {
    headers.set('X-OIMS-Company-Id', String(activeCompanyScopeId));
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data as T;
  }

  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.text()) as unknown as T;
}

export async function apiDownloadSql(): Promise<Blob> {
  const headers = new Headers();
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  if (activeCompanyScopeId !== null) {
    headers.set('X-OIMS-Company-Id', String(activeCompanyScopeId));
  }
  const res = await fetch('/api/system/oims-sql', { headers });
  if (!res.ok) throw new Error('Failed to download oims.sql');
  return res.blob();
}

export async function apiDownloadInstallPhp(): Promise<Blob> {
  const headers = new Headers();
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  if (activeCompanyScopeId !== null) {
    headers.set('X-OIMS-Company-Id', String(activeCompanyScopeId));
  }
  const res = await fetch('/api/system/install-php', { headers });
  if (!res.ok) throw new Error('Failed to download install.php');
  return res.blob();
}

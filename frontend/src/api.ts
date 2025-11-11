const API_PREFIX = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function buildApiUrl(path: string): string {
  return `${API_PREFIX}${path}`;
}

export function getApiBaseUrl(): string {
  return API_PREFIX;
}

export function buildWsUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = API_PREFIX || window.location.origin;
  const baseUrl = base.startsWith('http://') || base.startsWith('https://') ? new URL(base) : new URL(base, window.location.origin);

  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}${normalizedPath}`;
  baseUrl.search = '';
  baseUrl.hash = '';
  baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  return baseUrl.toString();
}

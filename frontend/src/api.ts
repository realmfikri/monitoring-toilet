const API_PREFIX = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function buildApiUrl(path: string): string {
  return `${API_PREFIX}${path}`;
}

export function getApiBaseUrl(): string {
  return API_PREFIX;
}

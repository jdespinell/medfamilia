const TOKEN_KEY = 'medfamilia_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getFileUrl(url: string): string {
  if (!url) return '';
  const token = getToken();
  const baseUrl = url.split('?')[0];
  if (!token) return baseUrl;
  return `${baseUrl}?token=${encodeURIComponent(token)}`;
}

export async function fetchFileBlob(url: string): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const cleanUrl = url.split('?')[0];
  const targetUrl = cleanUrl.startsWith('/api') || cleanUrl.startsWith('http')
    ? cleanUrl
    : `/api${cleanUrl.startsWith('/') ? '' : '/'}${cleanUrl}`;

  const response = await fetch(targetUrl, { headers });
  if (!response.ok) {
    throw new Error('Error al descargar o visualizar el archivo.');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function openProtectedFile(url: string, e?: React.MouseEvent) {
  if (e) {
    e.preventDefault();
  }
  try {
    const blobUrl = await fetchFileBlob(url);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  } catch (err: any) {
    alert(err.message || 'No se pudo abrir el archivo.');
  }
}

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !endpoint.includes('/auth/login')) {
      removeToken();
      window.location.reload();
    }
    throw new Error(data.error || 'Ocurrió un error en la solicitud.');
  }

  return data;
}

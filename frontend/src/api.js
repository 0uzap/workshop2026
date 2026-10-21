// Le jeton d'accès reste en mémoire (état React), jamais dans localStorage,
// pour limiter l'impact d'une éventuelle faille XSS.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Erreur HTTP ${status}`);
    this.status = status;
    this.body = body || {};
  }
}

export async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const allHeaders = { ...headers };
  if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
  if (token) allHeaders.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers: allHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Image JPEG de la caméra du PC Hôte, ou null si la caméra est éteinte. */
export async function fetchFrame(path, headers) {
  const res = await fetch(path, { headers, cache: 'no-store' });
  return res.ok ? res.blob() : null;
}

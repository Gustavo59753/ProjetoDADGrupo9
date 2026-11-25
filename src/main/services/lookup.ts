/** Busca JSON em APIs públicas, normalizando falhas de rede/HTTP para os serviços de lookup. */

export const LOOKUP_TIMEOUT_MS = 4000;

export type LookupFetchResult =
  | { status: 'ok'; json: unknown }
  | { status: 'not_found' }
  | { status: 'unavailable' };

export async function fetchLookupJson(url: string): Promise<LookupFetchResult> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'OficinaDesktop/1.0' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });

    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'unavailable' };

    const json: unknown = await response.json();
    return { status: 'ok', json };
  } catch {
    return { status: 'unavailable' };
  }
}

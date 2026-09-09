import { normalizeBaseUrl } from '@/services/lnkz-api';

export function defaultRelayUrl(): string {
  const configured = process.env.EXPO_PUBLIC_LNKZ_API_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);

  const replitDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  return replitDomain ? normalizeBaseUrl(`https://${replitDomain}`) : '';
}

export async function requestBrowserPreviewSession(serverUrl = defaultRelayUrl()): Promise<{
  serverUrl: string;
  apiKey: string;
} | null> {
  if (!serverUrl) return null;
  const response = await fetch(`${normalizeBaseUrl(serverUrl)}/api/preview/session`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('The development relay could not start a mobile preview session.');
  const body = await response.json() as { token?: unknown; serverUrl?: unknown };
  if (typeof body.token !== 'string' || typeof body.serverUrl !== 'string') {
    throw new Error('The development relay returned an invalid preview session.');
  }
  return { serverUrl: normalizeBaseUrl(body.serverUrl), apiKey: body.token };
}
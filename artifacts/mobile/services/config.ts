import { normalizeBaseUrl } from '@/services/lnkz-api';

export function defaultRelayUrl(): string {
  const configured = process.env.EXPO_PUBLIC_LNKZ_API_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);

  const replitDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  return replitDomain ? normalizeBaseUrl(`https://${replitDomain}`) : '';
}
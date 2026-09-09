# LNKZ Mobile

The Expo app connects to the existing LNKZ REST relay with a bearer API key entered by the user.

## API configuration

- `EXPO_PUBLIC_LNKZ_API_URL` sets the default relay URL for local, Replit, or AWS builds.
- `EXPO_PUBLIC_DOMAIN` remains the Replit development fallback when no explicit relay URL is configured.
- The bearer API key is never an Expo public environment variable. Users enter it in the app; native builds store it with Expo SecureStore, while web preview keeps it in memory only.

For AWS App Runner, set `EXPO_PUBLIC_LNKZ_API_URL` to the deployed HTTPS service URL. The server's existing `LNKZ_PUBLIC_BASE_URL`, `ALLOWED_HOSTS`, and `ALLOWED_ORIGINS` values must include the exact production mobile/browser origins. Do not use wildcards.

## Verification

```sh
pnpm --filter @workspace/mobile run typecheck
pnpm --filter @workspace/mobile test
pnpm --filter @workspace/mobile run build
```
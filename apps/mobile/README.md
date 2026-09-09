# LNKZ Mobile

The Expo client connects directly to the canonical LNKZ REST relay. It stores the API key with Expo SecureStore on iOS and Android and uses browser local storage only for web previews.

## Run locally

1. Start the relay from the repository root with `corepack pnpm dev`.
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_LNKZ_API_URL` to the URL the device can reach.
3. Start Expo with `corepack pnpm dev:mobile`.

`localhost` works in the web preview. A physical phone needs the computer's LAN address or a deployed HTTPS API URL. The connection screen also lets a user override the build-time URL and stores that choice on the device.

## Browser preview and deployment

Add the exact Expo or Replit preview origin to the backend `ALLOWED_ORIGINS` list. Add the backend's public hostname to `ALLOWED_HOSTS`. For example:

```env
ALLOWED_HOSTS=api.example.com
ALLOWED_ORIGINS=https://mobile.example.com
```

Keep `LNKZ_API_KEY` only in the backend's secret manager. Enter it through the mobile connection screen; never place it in `EXPO_PUBLIC_*`, because Expo public variables are embedded in the client bundle.

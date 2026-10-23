---
name: Expo mobile workflow quirks
description: Expo browser previews and static builds can need workspace-specific host and Metro-port handling.
---

The Expo Go workflow can run successfully for QR/device access while the Replit browser proxy rejects its external host before the app is reached. Treat that as a preview-routing issue, not an app render failure; verify the local Expo server and production static build separately.

**Why:** This workspace runs multiple artifact services, and the mockup server may already own Metro's default port. The generated Expo builder also assumes port 8081 unless configured.

**How to apply:** Keep the managed Expo workflow, use the Expo-compatible host mode for device access, and make any static bundle builder honor an explicit alternate Metro port when another workflow occupies 8081. If both external Replit domains return `Invalid Host` while local Metro is healthy, this is an edge-routing issue; tunnel mode requires the optional `@expo/ngrok` package and may fail independently.

For a mobile artifact mounted below `/`, Metro's browser HTML emits workspace-root bundle URLs and `/assets/` URLs, so the managed service must route those exact prefixes in addition to the artifact preview path. Expo Router's `experiments.baseUrl` is not stripped from development bundles; a browser-facing managed workflow needs a production-like (`--no-dev --minify`) bundle for subpath routing to resolve correctly.

**Why:** Replit's Expo-domain router does not automatically rewrite every workspace-root Metro asset path, and Expo Router deliberately preserves base URLs during development. Without both route coverage and production-like browser bundling, the shell can load while JavaScript or the initial route fails.

**How to apply:** When a mobile artifact uses a non-root preview path, validate the shell, bundle MIME type, `/status`, and a screenshot at the artifact path. Keep device persistence on SecureStore; use only an in-memory web fallback because browser Expo SecureStore is unavailable and API keys must not be written to browser storage.
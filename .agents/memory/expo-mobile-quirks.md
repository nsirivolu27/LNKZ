---
name: Expo mobile workflow quirks
description: Expo browser previews and static builds can need workspace-specific host and Metro-port handling.
---

The Expo Go workflow can run successfully for QR/device access while the Replit browser proxy rejects its external host before the app is reached. Treat that as a preview-routing issue, not an app render failure; verify the local Expo server and production static build separately.

**Why:** This workspace runs multiple artifact services, and the mockup server may already own Metro's default port. The generated Expo builder also assumes port 8081 unless configured.

**How to apply:** Keep the managed Expo workflow, use the Expo-compatible host mode for device access, and make any static bundle builder honor an explicit alternate Metro port when another workflow occupies 8081.
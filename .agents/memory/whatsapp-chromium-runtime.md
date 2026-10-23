---
name: WhatsApp Chromium runtime
description: Replit VM browser selection for whatsapp-web.js and Puppeteer.
---

Use the Replit-provided system Chromium executable resolved from `PATH` for `whatsapp-web.js`. The bundled Puppeteer Chrome can be present and executable while still failing to launch because a VM shared library such as `libgbm.so.1` is unavailable; the system Chromium wrapper uses the Nix-provided runtime dependencies.

**Why:** A mock client did not exercise the browser launch. In the real environment the bundled browser failed on a missing shared library, while the system Chromium launched and `whatsapp-web.js` produced the QR event.

**How to apply:** Verify the system executable and dependencies in the configured VM image, pass its resolved path explicitly to the real Puppeteer client, and keep startup diagnostics to an allowlisted stage/cause—never raw errors or QR data.

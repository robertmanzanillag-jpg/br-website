---
name: Baileys pairing refresh
description: Protocol behavior for WhatsApp companion registration refresh notifications during QR linking.
---

Handle `companion_reg_refresh` inside Baileys' WebSocket notification path. During an unregistered pairing only, rotate the 32-byte advertising secret, persist the credential update, and redraw the QR using the same current reference. Do not advance the server-provided reference pool for this notification. If the session is already registered, leave its advertising secret and QR state unchanged.

**Why:** A QR can be rendered and scanned yet still be rejected when it advertises registration material the server has retired. The registered session also depends on its existing advertising secret.

**How to apply:** Verify the exact Baileys version and notification shape before patching; keep any compatibility patch narrowly version-gated. Treat QR display, `isNewLogin`, transport restart, and a subsequent open connection as distinct states. Never declare the reader active from QR generation alone.

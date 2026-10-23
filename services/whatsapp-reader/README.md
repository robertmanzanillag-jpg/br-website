# WhatsApp session persistence

The offline review processor accepts only messages associated with four exact group IDs validated from exact visible names. It does not connect WhatsApp, enumerate chats, read messages, or send messages, replies, reactions, or read confirmations. The production WhatsApp client remains blocked by the privacy limitation below.

## Group privacy block

The installed `whatsapp-web.js` client is not considered safe for strict four-group isolation. Its `Client.initialize()` calls `inject()`, which attaches a global `Store.Msg` add-event bridge and constructs/emits `Message` objects without filtering by chat ID. Its `getChats()` API also returns all chat metadata. This project therefore fails closed and does not start the production client until a future transport can prove filtering before message content crosses into the Node process.

The exact metadata resolver is isolated in `group-policy.js`: it accepts only the four approved visible names, reports missing or duplicate matches, and never selects a fuzzy match. Even after unique IDs are found, the current client limitation must be removed and tested before linking or reading.

## Encryption and recovery

- The service uses `RemoteAuth` with the project's existing private App Storage bucket.
- The remote Chromium profile archive is encrypted with AES-256-GCM before upload. The required key is a dedicated Replit Secret named `WHATSAPP_SESSION_ENCRYPTION_KEY`: exactly 32 random bytes encoded as base64. It must not reuse `SESSION_SECRET`, API keys, or another purpose's secret.
- A valid prior backup is restored before Chromium starts. Missing/corrupt meter data, a missing archive that the meter says exists, an invalid authentication tag, or an unavailable storage service fails closed; it does not silently create a replacement linked session.
- On owner stop and graceful `SIGTERM`/`SIGINT`, the service tries a final encrypted backup before closing. A hard crash can only recover the latest completed backup.
- Backups are attempted once after WhatsApp authentication and then every six hours. They are not backed up continuously.
- The local working profile is in a mode-0700 directory under `/tmp`; remote copies remain encrypted. As with any live browser session, Chromium must access its working profile while connected.

## Hard consumption limits

- Maximum encrypted profile archive: 128 MiB.
- Maximum encrypted reader state: 64 MiB, including saved message revisions and downloaded images. Message bodies are capped at 96 KiB; all attachments for one message are capped at 5 MiB.
- Maximum service allocation in the bucket: 256 MiB.
- The session and reader state share one storage meter and one 10 GiB per UTC month transfer meter. Both encrypted uploads and restores, including saved message/image data, count toward that transfer cap. The meter is an App Storage object; the reader does not poll or write the app database.
- At the documented App Storage rates of $0.015/GiB-month and $0.05/GiB transferred, these caps bound this service's storage/transfer charges to about $0.51/month, including a conservative allowance for the small meter object. This excludes no new VM or database service; the existing VM is reused.
- Session archive compression/upload happens at most every six hours, plus the initial backup and owner-requested graceful shutdown. Offline review state is written only when a new message or edit is saved; duplicate revisions do not trigger an upload. The QR itself expires after five minutes.
- The reader does not use the app database for checkpoints, quota, or polling. Opening the panel uses the existing login/session middleware; status then streams over one authenticated SSE connection instead of repeated polling.
- If a profile, storage, or monthly transfer limit is reached—or the encrypted backup cannot be safely written—the WhatsApp client is stopped. It does not continue unprotected or claim 24/7 availability. A transfer-cap stop stays stopped until the next UTC month and an owner starts it again; other failures require an operator to resolve them.

## Offline review processing

- `OfflineWhatsAppReviewReader` requires the exact four-name resolver to return four unique, distinct IDs. It checks the incoming `chatId` before reading the body, media metadata, or invoking an attachment download callback.
- Each message ID is fingerprinted; exact repeats are ignored, while changed content/media keys are stored as a new `edited` revision. Content and image bytes are included in the AES-GCM encrypted reader-state object, with the checkpoint and per-group last-processed timestamp committed in the same write.
- A failed quota reservation does not update the checkpoint or report an item as saved. The processor changes to `blocked` with `budget_stopped`; already saved review records remain recoverable.
- The offline processor is not wired to a WhatsApp client. It is safe to fixture-test, but does not imply that production messages are being read.

The free deployment has not been activated with a WhatsApp account. The owner must first add the dedicated secret and then scan the service's QR from the private owner-only panel.

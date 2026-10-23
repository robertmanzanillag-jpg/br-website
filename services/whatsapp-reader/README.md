# WhatsApp session persistence

The production WhatsApp Web client can synchronize the account's chat list and message events. The owner explicitly authorized this technical account synchronization. The application processor accepts content only from four exact, metadata-validated group IDs; it sends no messages, replies, reactions, or read confirmations.

## Account sync and KONG scope

The installed `whatsapp-web.js` client attaches a global `Store.Msg` event bridge and constructs/emits `Message` objects without filtering by chat ID; its `getChats()` API returns all chat metadata. The owner approved this account-level synchronization. Application code checks the exact chat ID before accessing message bodies, media metadata, or downloading attachments, and only fetches history for the four pinned IDs.

The exact metadata resolver accepts only the four approved visible names, reports missing or duplicate matches, and never selects a fuzzy match. The actual IDs remain unknown until the owner links the service and the four exact metadata matches are available.

## Encryption and recovery

- Browser startup uses the Replit-provided system Chromium found on `PATH`. Puppeteer's downloaded browser can fail in the VM image when a shared library such as `libgbm.so.1` is unavailable; do not silently fall back to it.
- Startup diagnostics advance through remote backup access/restore, Chromium launch, WhatsApp Web load, and QR wait. Individual object-storage requests are bounded at 15 seconds; phase deadlines are 20 seconds for backup metadata, 30 seconds for restore or Chromium launch, and 45 seconds each for Web load and QR wait. The owner page receives phase updates over SSE and advances elapsed time locally; it does not poll the database.
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

## Read-only processing and recovery

- `OfflineWhatsAppReviewReader` requires the exact four-name resolver to return four unique, distinct IDs. It checks the incoming `chatId` before reading the body, media metadata, or invoking an attachment download callback.
- Each message ID is fingerprinted; exact repeats are ignored, while changed content/media keys are stored as a new `edited` revision. Content and image bytes are included in the AES-GCM encrypted reader-state object, with the checkpoint and per-group last-processed timestamp committed in the same write.
- A failed quota reservation does not update the checkpoint or report an item as saved. The processor changes to `blocked` with `budget_stopped`; already saved review records remain recoverable.
- The owner-only start action establishes a new link; after `ready`, the runtime resolves exact group metadata, restores encrypted checkpoints, attaches read-only event handlers, then catches up only those four IDs.
- Startup recovery fetches at most 100 recent messages per approved group per run. Revisions are deduplicated against encrypted state; older backlog beyond that bounded window requires a later recovery run or operator review.
- On process startup, the server checks for an existing encrypted session. It starts Chromium only when the dedicated key is configured and a valid session archive exists; a fresh deployment without a linked session stays idle. Unexpected disconnects get at most three bounded retries.

The production account is not yet linked. The owner must add the dedicated secret and scan the service's QR from the private owner-only panel before the UI can report an active connection.

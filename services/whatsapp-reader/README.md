# WhatsApp session persistence

This stage only links and persists the owner's WhatsApp Web session. It does not enumerate chats, read messages, or send messages, replies, or reactions.

## Encryption and recovery

- The service uses `RemoteAuth` with the project's existing private App Storage bucket.
- The remote Chromium profile archive is encrypted with AES-256-GCM before upload. The required key is a dedicated Replit Secret named `WHATSAPP_SESSION_ENCRYPTION_KEY`: exactly 32 random bytes encoded as base64. It must not reuse `SESSION_SECRET`, API keys, or another purpose's secret.
- A valid prior backup is restored before Chromium starts. Missing/corrupt meter data, a missing archive that the meter says exists, an invalid authentication tag, or an unavailable storage service fails closed; it does not silently create a replacement linked session.
- On owner stop and graceful `SIGTERM`/`SIGINT`, the service tries a final encrypted backup before closing. A hard crash can only recover the latest completed backup.
- Backups are attempted once after WhatsApp authentication and then every six hours. They are not backed up continuously.
- The local working profile is in a mode-0700 directory under `/tmp`; remote copies remain encrypted. As with any live browser session, Chromium must access its working profile while connected.

## Hard consumption limits

- Maximum encrypted profile archive: 128 MiB.
- Maximum service allocation in the bucket: 256 MiB.
- Maximum metered profile transfer per UTC month: 10 GiB, counting backup uploads and restore downloads. The meter is an App Storage object; the reader does not poll or write the app database.
- At the documented App Storage rates of $0.015/GiB-month and $0.05/GiB transferred, these caps bound this service's storage/transfer charges to about $0.51/month, including a conservative allowance for the small meter object. This excludes no new VM or database service; the existing VM is reused.
- Archive compression/upload happens at most every six hours, plus the initial backup and owner-requested graceful shutdown. The QR itself expires after five minutes.
- The reader does not use the app database for checkpoints, quota, or polling. Opening the panel uses the existing login/session middleware; status then streams over one authenticated SSE connection instead of repeated polling.
- If a profile, storage, or monthly transfer limit is reached—or the encrypted backup cannot be safely written—the WhatsApp client is stopped. It does not continue unprotected or claim 24/7 availability. A transfer-cap stop stays stopped until the next UTC month and an owner starts it again; other failures require an operator to resolve them.

The free deployment has not been activated with a WhatsApp account. The owner must first add the dedicated secret and then scan the service's QR from the private owner-only panel.

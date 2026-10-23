# WhatsApp WebSocket migration — implementation, not deployed

Replaces the Chromium transport with pinned Baileys 7.0.0-rc14. No browser is
started. Baileys is unofficial and does not grant a server-enforced read-only
account scope. This module performs no application message sends, reactions,
read receipts or presence updates. WhatsApp's connection protocol still exchanges
authentication, delivery acknowledgements and other required transport traffic.

## Implemented

- Exact four-name discovery, encrypted ID pinning, ambiguity/identity-change stop.
- AES-256-GCM credentials, Signal keys, approved messages and media in PostgreSQL.
- Dedicated database lease; bounded reconnect, QR kept out of status/logs,
  terminal logout/replaced-session handling; no automatic logout on shutdown.
- Inbound new/edited messages, group envelope gate before content inspection,
  image size/time limits, revision deduplication and bounded queue.
- Owner-session routes with CSRF, no-store and flushed SSE through compression.
- Storage ceiling of 128 MiB and encrypted write ceiling of 5 GiB/calendar month.
  These ceilings are NOT a $2 billing guarantee or total network-traffic caps.

## Integration contract / release gates

The GitHub base does not contain the current Replit-only reader. Do not overwrite
the deployment from this old checkout. Transfer only this new directory after
recovering the current production source and checking its diff.

1. Stop and disable the old Chromium reader, including its automatic restore.
   The new reader's advisory lock cannot lock the legacy implementation.
2. Install this directory's locked dependencies with `npm ci --ignore-scripts`.
   Node >=20 is required; the dependency is an RC and needs live verification.
3. Create a dedicated pg Client through `createProductionReader`, reusing the
   private database connection and existing 32-byte Base64 encryption secret.
   Never rotate the existing key or put it in a URL/file/commit. Supply
   `legacyReaderDisabled: true` only after step 1 is verified.
4. Mount `mountOwnerRoutes` after the existing session and JSON middleware.
   Supply an exact owner identity check, not general admin privileges. Integrate
   the current private panel with these endpoints or use the owner-only `/panel`
   and `/qr.svg` routes supplied by this package.
   Do not add an unauthenticated linking page or log request/response bodies.
5. Start the reader once on server startup, and await shutdown on SIGTERM/SIGINT.
   The host needs its existing continuous Reserved VM, paid/available hosting
   and a supervisor. No new paid service is required by this package.
6. Owner scans the production QR. Verify all four groups resolve, approved
   messages arrive, unrelated messages are excluded, and no outgoing messages
   or read receipts are produced. No account has been linked by local tests.
7. Verify restart restores the encrypted session and the lease excludes a second
   process. An explicit relink is required for revoked/invalid sessions.

Recent authorized text is considered for KONG only after its source message is
saved. The parser accepts explicit labeled fields (`Venue`, `Date` as YYYY-MM-DD,
`Table`, `Minimum spend`, `Currency`, and `Conditions`); incomplete, ambiguous,
old, or image-only offers remain encrypted and pending. It never infers values
from ticket prices or flyer images. Source edits become conflicts. The reader
sends only to the fixed URL in `KONG_CONTRACT.md`, signs the exact JSON body, and
does not follow redirects. Receiver `202` remains review-only, not applied.

Delivery remains disabled unless the dedicated `BLACK_ROOM_TABLE_READER_HMAC_SECRET`
is valid AND host readiness is explicitly set with
`BLACK_ROOM_TABLE_READER_ENABLED=true`. Do not set either here or transmit until
the receiver host configuration is verified. Pending delivery records are
encrypted in the existing PostgreSQL state store, resumed after group identity
validation, and retried with a bounded schedule. No new service or paid inference
is used. WhatsApp sending, replies, reactions, and read receipts remain absent.

There is no full-history request or guarantee of missed-message recovery; status
reports the recent history WhatsApp actually delivered. Disconnection alerts
beyond the owner panel are not implemented.

Database storage and write caps stop processing rather than delete data silently.
Storage is separate from the old App Storage quota; it does not migrate, read or
delete the old Chromium profile. Cost and reliability must be measured live.

## Tests

`npm test` covers encryption/tampering, auth restart, exact groups, no inspection
of unrelated bodies, media gating, reconnect/logout, SQL revision dedup/quota
rollback, owner authorization, CSRF and live HTTP SSE through compression.
Socket protocol events use a fake provider; SQL runs with PGlite. These tests
do not certify WhatsApp compatibility, live account access, production QR or 24/7.

On 2026-10-23 an isolated real Baileys WebSocket smoke reached `qr_required`
from Codex using the environment's configured HTTPS proxy. No account was linked,
no QR was printed, no chats were read and the socket was closed. This proves an
unlinked handshake in this environment only, not a deployment or session restore.

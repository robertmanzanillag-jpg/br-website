---
name: WhatsApp storage recovery
description: Recovery policy for temporary PostgreSQL interruptions in the hosted WhatsApp reader.
---

Treat classified PostgreSQL connection interruptions as recoverable infrastructure failures, not as a reason to relink WhatsApp. Keep the encrypted auth/session record intact, retry through a single host supervisor with bounded exponential backoff, and cancel retries on owner stop. Invalid encryption keys, unreadable auth, revoked sessions, and unverified group identity are permanent states and must not trigger automatic relinking or retry loops.

**Why:** Restarting WhatsApp pairing can invalidate a still-linked account and risks duplicate readers or inbox writes after a database outage.

**How to apply:** Normalize only known transient network/PostgreSQL error codes; keep retries serialized under the existing advisory lease and rely on inbox insert-only deduplication for ambiguous commits.

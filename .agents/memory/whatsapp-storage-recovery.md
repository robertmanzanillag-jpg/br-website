---
name: WhatsApp storage recovery
description: Recovery policy for temporary PostgreSQL interruptions in the hosted WhatsApp reader.
---

Treat PostgreSQL connection interruptions as recoverable infrastructure failures, not as a reason to relink WhatsApp. For sanitized, unclassified failures limited to startup `connect`/`lease` operations, retry through the single host supervisor with bounded backoff; do not retry explicitly permanent auth, permission, or session failures. Keep encrypted auth intact and cancel retries on owner stop.

**Why:** Restarting WhatsApp pairing can invalidate a still-linked account and risks duplicate readers or inbox writes after a database outage. Sanitized production logs may omit the underlying transient error code, so no retry on `unclassified` can leave a temporary outage permanently stopped.

**How to apply:** Normalize known transient network/PostgreSQL codes; also allow slow, capped retries for unclassified startup `connect`/`lease` errors, but never for invalid keys, unreadable or revoked auth, or unverified groups. Keep retries serialized under the existing advisory lease and rely on inbox insert-only deduplication for ambiguous commits.

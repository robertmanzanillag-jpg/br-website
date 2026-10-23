---
name: WhatsApp event approval
description: Scope boundary for turning WhatsApp flyer or price messages into production event updates.
---

Do not write directly to production events or prices from WhatsApp intake. The owner authorized delivery through the verified KONG receiver only when venue, event date, table type, minimum spend, currency, and conditions are all explicit and unambiguous in the source text. Ambiguous, incomplete, old, edited-conflict, or flyer-only evidence remains pending; a receiver 202 is review evidence, never an applied price.

**Why:** Similar event names, flyers, and dates can refer to different events. The narrow signed receiver contract is the authorized boundary; inference or a direct write could still alter the wrong production event.

**How to apply:** Send only contract-complete text-derived offers to the fixed KONG endpoint with the dedicated HMAC secret and explicit host readiness. Never infer from ticket prices/images, follow redirects, expose the secret, or bypass pending/conflict statuses.

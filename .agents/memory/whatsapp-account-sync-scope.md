---
name: WhatsApp account sync scope
description: Owner authorization for WhatsApp Web account sync and the narrower KONG processing boundary.
---

The owner explicitly authorized technical synchronization of the full WhatsApp Web account in Replit, including other chats. Application-level KONG processing remains limited to exact group IDs resolved from `Promoters 🖤👾🖤`, `LIV MIAMI`, `SPACE TABLES`, and `STUDIO 60 PROMO`. Never send messages, replies, reactions, or read confirmations.

**Why:** WhatsApp Web may synchronize messages account-wide before the application filters events; the owner authorized that technical behavior while keeping the business processing scope narrow.

**How to apply:** Keep the account-sync consent explicit, resolve the four exact names before reading, and reject other IDs before application code accesses message bodies or downloads media.

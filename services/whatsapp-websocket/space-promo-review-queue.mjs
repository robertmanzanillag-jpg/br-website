import { createHash } from 'node:crypto';
import { prepareSpacePromoCandidates } from './space-promo-candidates.mjs';

export const SPACE_PROMO_GROUP = 'Promoters 🖤👾🖤';
const hash = value => createHash('sha256').update(value).digest('hex');

/** Encrypted review queue, deliberately separate from the kong:% price outbox. */
export class SpacePromoReviewQueue {
  constructor({ store, links = [], now = () => Date.now() }) {
    this.store = store;
    this.links = links;
    this.now = now;
    this.tail = Promise.resolve();
  }
  policy(pins) {
    return { groupId: pins?.[SPACE_PROMO_GROUP], groupName: SPACE_PROMO_GROUP, links: this.links };
  }
  record(message, pins) {
    const operation = this.tail.then(() => this.recordSerial(message, pins));
    this.tail = operation.catch(() => {});
    return operation;
  }
  async recordSerial(message, pins) {
    const policy = this.policy(pins);
    const next = prepareSpacePromoCandidates(message, policy, this.now());
    // Generic purchase links are not evidence of DOMNROB attribution. Keeping
    // their original encrypted inbox message is sufficient; do not promote them.
    if (!next.candidates.length && !next.dealCandidates.length) return { retained: false, reasons: next.reasons };
    const fingerprint = hash(JSON.stringify([message.text, message.sentAt]));
    const previous = await this.store.load(next.id);
    const indexId = `space-promo:index:${hash(policy.groupId)}`;
    const index = await this.store.load(indexId) || { ids: [] };
    if (previous?.fingerprint !== fingerprint) {
      await this.store.save(next.id, {
        ...next,
        // No receiver has been implemented/verified yet. A verified URL is an
        // eligible candidate, not evidence that a website mutation happened.
        status: 'pending_review', fingerprint,
        previousFingerprint: previous?.fingerprint || null,
        revisionReason: previous ? 'source_edited_requires_review' : null,
        createdAt: previous?.createdAt || new Date(this.now()).toISOString(),
        updatedAt: new Date(this.now()).toISOString(),
      });
    }
    // Repair index even when the process previously died between the two saves.
    if (!index.ids.includes(next.id)) {
      if (index.ids.length >= 5000) throw new Error('space_promo_review_limit');
      await this.store.save(indexId, { ids: [...index.ids, next.id] });
    }
    return { retained: true, id: next.id, status: 'pending_review', duplicate: previous?.fingerprint === fingerprint };
  }
  async resume(messages, pins) {
    for (const message of messages) {
      if (message.groupId === pins?.[SPACE_PROMO_GROUP]) await this.record(message, pins);
    }
  }
  async overview(pins, limit = 100) {
    await this.tail;
    const groupId = pins?.[SPACE_PROMO_GROUP];
    if (!groupId) return { status: 'group_identity_unverified', count: 0, items: [] };
    const index = await this.store.load(`space-promo:index:${hash(groupId)}`) || { ids: [] };
    const cap = Math.max(1, Math.min(100, Number(limit) || 100));
    const records = [];
    for (const id of index.ids.slice(-cap).reverse()) {
      const record = await this.store.load(id);
      if (record) records.push(record);
    }
    // This response contains private chat evidence: expose only under the
    // existing owner-authenticated, no-store admin middleware, never public logs.
    return { status: 'review_only', count: index.ids.length, truncated: index.ids.length > cap, items: records };
  }
}

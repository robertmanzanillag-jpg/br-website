import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const dayMs = 86400000;
const groupIdPattern = /^\d+(?:-\d+)?@g\.us$/;
const normalize = value => String(value || '').trim().toLowerCase();
const dateValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// Do not add tracking parameters, normalize URLs or follow redirects here.
// Opaque DICE tracking cannot be verified from a sender display name or a URL
// containing "domnrob". Only exact owner-verified link/event mappings can apply.
function diceUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      && !parsed.port && ['dice.fm', 'www.dice.fm', 'link.dice.fm'].includes(parsed.hostname)
      && parsed.pathname !== '/' && !/[\u0000-\u0020\u007f]/.test(raw);
  } catch { return false; }
}

function urlsIn(block) {
  // Matched bytes are preserved, including query ordering and percent encoding.
  return [...new Set(block.match(/https:\/\/[^\s<>"'()]+/g) || [])];
}

/**
 * policy is trusted configuration, NOT fields extracted from WhatsApp:
 * { groupId, groupName, links: [{ url, owner: 'DOMNROB', attributionVerified: true,
 *   eventId, eventDate, venueName, eventTitle }] }
 * Unknown links/deal prose remain review candidates. No side effects/network.
 * Sender identity is intentionally not inferred: existing inbox lacks sender IDs.
 */
export function prepareSpacePromoCandidates(message, policy = {}, now = Date.now()) {
  const sourceId = `space-promo:${digest(`${message?.groupId || ''}\0${message?.id || ''}`)}`;
  const result = { id: sourceId, status: 'pending', reasons: [], candidates: [], dealCandidates: [] };
  if (!groupIdPattern.test(policy.groupId || '') || !policy.groupName
    || message?.groupId !== policy.groupId) {
    result.reasons.push('group_identity_unverified');
    return result; // No text inspection until the source identity is pinned.
  }
  if (typeof message.id !== 'string' || !message.id.trim()) {
    result.reasons.push('source_message_id_required');
    return result;
  }
  const sentAt = message?.sentAt;
  if (!Number.isSafeInteger(sentAt) || sentAt <= 0 || sentAt * 1000 > now + 300000) {
    result.reasons.push('source_timestamp_invalid');
    return result;
  }
  if (now - sentAt * 1000 > 7 * dayMs) {
    result.reasons.push('source_older_than_7_days');
    return result;
  }
  const text = typeof message.text === 'string' ? message.text : '';
  if (!text || Buffer.byteLength(text) > 96 * 1024) {
    result.reasons.push(message.media ? 'image_requires_review' : 'text_evidence_required');
    return result;
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const blocks = text.split(/\r?\n\s*\r?\n|^\s*---+\s*$/m).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  for (const block of blocks) {
    const urls = urlsIn(block);
    const labeledDomnrob = /\bdomnrob\b/i.test(block);
    const deals = block.split(/\r?\n/).filter(line => /^\s*(?:deal|offer|promo|oferta|beneficio)\s*:/i.test(line)
      || /\b(?:guest\s*list|free before|free entry|entrada gratis|lista gratis)\b/i.test(line)).map(line => line.trim());
    if (deals.length) {
      const mapped = urls.length === 1 ? (policy.links || []).filter(link => link.url === urls[0]
        && normalize(link.owner) === 'domnrob' && link.attributionVerified === true) : [];
      const event = mapped.length === 1 ? mapped[0] : null;
      result.dealCandidates.push({
        id: `${sourceId}:deal:${digest(block).slice(0, 24)}`,
        status: 'pending', reason: event ? 'deal_terms_require_review' : 'deal_event_mapping_unverified',
        sourceGroup: policy.groupName, sourceGroupId: policy.groupId,
        sourceMessageId: message.id, sourceTimestamp: new Date(sentAt * 1000).toISOString(),
        eventId: event?.eventId || null, eventDate: event?.eventDate || null,
        evidenceExcerpt: block, dealEvidence: deals,
      });
    }
    for (const url of urls) {
      const mappings = (policy.links || []).filter(link => link.url === url
        && normalize(link.owner) === 'domnrob' && link.attributionVerified === true);
      if (!labeledDomnrob && mappings.length === 0) continue;
      const reasons = [];
      if (!diceUrl(url)) reasons.push('unsupported_or_unsafe_purchase_url');
      if (mappings.length !== 1) reasons.push(mappings.length ? 'ambiguous_link_mapping' : 'domnrob_attribution_unverified');
      const link = mappings.length === 1 ? mappings[0] : null;
      if (!link?.eventId || !link.venueName || !link.eventTitle || !dateValid(link.eventDate)) reasons.push('event_mapping_unverified');
      else if (link.eventDate < today) reasons.push('event_already_past');
      // A paragraph with several links cannot bind an extracted deal to one
      // link without stronger evidence, even if that link is already verified.
      const dealReason = deals.length && urls.length !== 1 ? 'deal_event_ambiguous' : deals.length ? 'deal_terms_require_review' : null;
      const candidateId = `${sourceId}:${digest(url).slice(0, 24)}`;
      if (seen.has(candidateId)) continue;
      seen.add(candidateId);
      result.candidates.push({
        id: candidateId, status: reasons.length ? 'pending' : 'ready', reasons,
        sourceGroup: policy.groupName, sourceGroupId: policy.groupId,
        sourceMessageId: message.id, sourceTimestamp: new Date(sentAt * 1000).toISOString(),
        purchaseUrl: url, attribution: link ? 'verified_domnrob_link' : 'unverified',
        eventId: link?.eventId || null, eventDate: link?.eventDate || null,
        venueName: link?.venueName || null, eventTitle: link?.eventTitle || null,
        evidenceExcerpt: block,
        // Raw evidence only; never derive free entry, capacity, price or eligibility.
        dealEvidence: deals, dealStatus: deals.length ? 'pending' : 'none', dealReason,
      });
    }
    if (deals.length && urls.length === 0) result.reasons.push('deal_without_verified_event_link');
  }
  if (!result.candidates.length && !result.reasons.length) result.reasons.push('no_domnrob_purchase_link');
  result.reasons = [...new Set(result.reasons)];
  result.status = result.candidates.length && result.candidates.every(candidate => candidate.status === 'ready') && !result.reasons.length && !result.dealCandidates.length ? 'ready' : 'pending';
  return result;
}

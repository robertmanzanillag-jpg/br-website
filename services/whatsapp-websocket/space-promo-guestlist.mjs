import { createHash } from 'node:crypto';
import { SPACE_PROMO_GROUP } from './space-promo-review-queue.mjs';

export const DOMNROB_GUESTLIST_INSTRUCTION = 'Mention DOMNROB at the guestlist line to get in.';
const clean = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const labels = new Map(Object.entries({
  venue: 'venueName', club: 'venueName', lugar: 'venueName',
  event: 'eventTitle', evento: 'eventTitle',
  date: 'eventDate', fecha: 'eventDate',
  guestlist: 'hours', 'promoter list': 'hours', horario: 'hours',
  'end date': 'guestlistEndDate', 'fecha fin': 'guestlistEndDate',
  gender: 'gender', eligibility: 'gender', genero: 'gender', elegibilidad: 'gender',
  offer: 'offerText', deal: 'offerText', oferta: 'offerText', conditions: 'offerText', condiciones: 'offerText',
}));
const genders = new Map([['unisex','unisex'],['everyone','unisex'],['all','unisex'],['todos','unisex'],['men','male'],['male','male'],['hombres','male'],['women','female'],['female','female'],['mujeres','female']]);

function parseTime(value) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2] || 0);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  } else if (!match[2] || hour > 23) return null; // bare 1/11 is ambiguous.
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseBlock(block, message, index) {
  const fields = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]{1,32}):\s*(.+?)\s*$/);
    const field = match && labels.get(clean(match[1]));
    if (!field) continue;
    if (fields[field] && fields[field] !== match[2]) return { status: 'pending', reason: 'contradictory_fields' };
    fields[field] = match[2];
  }
  if (!fields.venueName || !fields.eventTitle || !dateValid(fields.eventDate)) return { status: 'pending', reason: 'event_identity_required' };
  if (!fields.offerText) return { status: 'pending', reason: 'offer_conditions_required' };
  const guestlistGenderTarget = genders.get(clean(fields.gender));
  if (!guestlistGenderTarget) return { status: 'pending', reason: 'eligibility_required' };
  if (!fields.hours) return { status: 'pending', reason: 'exact_guestlist_hours_required' };
  let guestlistStartLocal = null, guestlistEndLocal = null;
  const range = fields.hours.split(/\s*(?:-|–|—|\bto\b|\ba\b)\s*/i);
  if (range.length === 2) {
    guestlistStartLocal = parseTime(range[0]); guestlistEndLocal = parseTime(range[1]);
    if (!guestlistStartLocal || !guestlistEndLocal || guestlistStartLocal === guestlistEndLocal) return { status: 'pending', reason: 'exact_guestlist_hours_required' };
  } else {
    guestlistEndLocal = parseTime(fields.hours.replace(/^(?:until|before|hasta)\s+/i, ''));
    if (!guestlistEndLocal) return { status: 'pending', reason: 'exact_guestlist_hours_required' };
    if (!dateValid(fields.guestlistEndDate)) return { status: 'pending', reason: 'cutoff_calendar_date_required' };
  }
  if (fields.guestlistEndDate && !dateValid(fields.guestlistEndDate)) return { status: 'pending', reason: 'invalid_end_date' };
  return { status: 'queued', payload: {
    sourceGroup: SPACE_PROMO_GROUP, sourceMessageId: `${message.id}:guestlist:${index + 1}`,
    sourceTimestamp: new Date(message.sentAt * 1000).toISOString(),
    venueName: fields.venueName, eventTitle: fields.eventTitle, eventDate: fields.eventDate,
    guestlistStartLocal, guestlistEndLocal,
    ...(fields.guestlistEndDate ? { guestlistEndDate: fields.guestlistEndDate } : {}),
    guestlistGenderTarget, timeZone: 'America/New_York',
    guestlistTimeText: fields.hours, offerText: fields.offerText,
    guestlistInstruction: DOMNROB_GUESTLIST_INSTRUCTION, evidenceExcerpt: block,
  } };
}

/** Explicit source facts only; no guessed date, venue, entitlement or cutoff. */
export function prepareSpacePromoGuestlist(message, pins, now = Date.now()) {
  const id = `space-promo-guestlist:${createHash('sha256').update(`${message?.groupId || ''}\0${message?.id || ''}`).digest('hex')}`;
  const pending = reason => ({ id, status: 'pending', reason, candidates: [] });
  if (!/^\d+(?:-\d+)?@g\.us$/.test(pins?.[SPACE_PROMO_GROUP] || '') || message?.groupId !== pins[SPACE_PROMO_GROUP]) return pending('group_identity_unverified');
  if (typeof message.id !== 'string' || !message.id.trim()) return pending('source_message_id_required');
  if (!Number.isSafeInteger(message.sentAt) || message.sentAt <= 0 || message.sentAt * 1000 > now + 300000) return pending('source_timestamp_invalid');
  if (now - message.sentAt * 1000 > 7 * 86400000) return pending('source_older_than_7_days');
  if (typeof message.text !== 'string' || !message.text.trim() || Buffer.byteLength(message.text) > 96 * 1024) return pending('text_evidence_required');
  const candidates = message.text.split(/^\s*---+\s*$/m).map(block => block.trim()).filter(Boolean).map((block, i) => parseBlock(block, message, i));
  return { id, status: candidates.length && candidates.every(c => c.status === 'queued') ? 'queued' : 'pending', candidates };
}

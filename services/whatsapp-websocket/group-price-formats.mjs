// Grammars for observed, pinned Miami promoter groups. Dollar amounts in these
// venue-specific formats are USD; this policy never applies to arbitrary chats.
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const dayMs = 86400000;
const localDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

function eventDate(month, day, weekday, year, sentAt) {
  const sourceDay = localDay(sentAt * 1000);
  const sourceYear = Number(sourceDay.slice(0, 4));
  const years = year ? [Number(year)] : [sourceYear - 1, sourceYear, sourceYear + 1];
  const candidates = years.map(y => new Date(Date.UTC(y, month - 1, day))).filter(date => {
    const distance = (date.getTime() - Date.parse(sourceDay)) / dayMs;
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      && weekdays[date.getUTCDay()] === weekday.toLowerCase()
      && distance >= -7 && distance <= 180;
  });
  return candidates.length === 1 ? candidates[0].toISOString().slice(0, 10) : null;
}

export function parseGroupPrices(message, group, now) {
  if (!['SPACE TABLES', 'LIV MIAMI'].includes(group) || !Number.isSafeInteger(message.sentAt) || message.sentAt <= 0) return null;
  const text = String(message.text || '');
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const isSpace = group === 'SPACE TABLES';
  const declaredYear = isSpace ? text.match(/\b(20\d{2})\s+space\s+tables\b/i)?.[1] : null;
  let section = null, recognized = false;
  const candidates = [], pendingItems = [];
  const seen = new Map();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const header = isSpace
      ? line.match(/^(.+?),\s*(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s*([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\s*$/i)
      : line.match(/^LIV\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\s+(.+)$/i);
    if (header) {
      recognized = true;
      const month = isSpace ? months.indexOf(header[3].toLowerCase().slice(0, 3)) + 1 : Number(header[2]);
      const date = eventDate(month, Number(isSpace ? header[4] : header[3]), isSpace ? header[2] : header[1], isSpace ? header[5] || declaredYear : header[4], message.sentAt);
      section = { date, title: isSpace ? header[1] : header[5], header: line, terms: [] };
      continue;
    }
    // Any other dated heading clears context rather than attaching a later
    // venue/event's prices to the preceding event.
    if (/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(line) && /\d/.test(line)) section = null;
    if (!isSpace && section && /(?:alcohol included|tax\/service charge)/i.test(line)) section.terms.push(line.replace(/^[-•]\s*/, ''));
    const row = isSpace
      ? line.match(/^([EW]\d{1,2}(?:\/\d{1,2})*|DJ\d{1,2})\s+\$\s*(.+)$/i)
      : line.match(/^[-•]\s*(Dance floor|Main Floor Big|Main Floor Small|Front Stage|Back Stage|Skyboxes|View Table|Mezzanine VIP)\s*:\s*\$\s*(.+)$/i);
    if (!row) continue;
    recognized = true;
    const reason = !section?.date ? 'ambiguous_date' : section.date < localDay(now) ? 'event_already_past' : null;
    const amount = row[2].match(/^(\d+(?:,\d{3})*(?:\.\d{1,2})?)(k)?(\+\+)?(?:\s+(.*))?$/i);
    if (reason || !amount || /\b(best offer|negotiable|offer)\b/i.test(row[2])) {
      pendingItems.push({ line: index + 1, reason: reason || 'negotiable_or_unrecognized_price' });
      continue;
    }
    // Only known LIV annotations may follow a fixed price. No invented capacity.
    if ((isSpace && amount[4]) || (!isSpace && amount[4] && !/^(?:\((?:BG|SG|Next To Artist|Near Artist)\)\s*)+$/i.test(amount[4]))) {
      pendingItems.push({ line: index + 1, reason: 'unrecognized_price_conditions' });
      continue;
    }
    const minimum = Number(amount[1].replaceAll(',', '')) * (amount[2] ? 1000 : 1);
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    const prefix = row[1].match(/^[A-Z]+/i)?.[0].toUpperCase();
    const tables = isSpace ? row[1].slice(prefix.length).split('/').map(n => `${prefix}${Number(n)}`) : [row[1]];
    for (const tableType of tables) {
      const key = `${section.date}:${tableType.toLowerCase()}`;
      const conditions = `${section.title}. ${amount[3] ? 'Minimum spend ++; additional tax/service charges apply.' : 'Minimum spend; additional charges not specified in source.'}${amount[4] ? ` Source annotation: ${amount[4]}.` : ''}${section.terms.length ? ` ${section.terms.join('. ')}` : ''}`;
      const quote = {
        sourceGroup: group, sourceMessageId: `${message.id}:format:${section.date}:${tableType.toLowerCase().replace(/\s+/g, '-')}`,
        sourceTimestamp: new Date(message.sentAt * 1000).toISOString(), venueName: isSpace ? 'Club Space' : 'LIV',
        eventDate: section.date, tableType, priceKind: 'minimum_spend', minimumSpend: String(minimum), currency: 'USD',
        minimumSpendDisplay: `$${minimum.toLocaleString('en-US')}${amount[3] || ''}`, conditions,
        evidenceExcerpt: [section.header, ...section.terms, line].join('\n'),
      };
      if (seen.has(key)) {
        const old = seen.get(key);
        if (old.minimumSpend !== quote.minimumSpend || old.conditions !== quote.conditions) {
          old.conflicting = true;
          pendingItems.push({ line: index + 1, reason: 'contradictory_fields' });
        }
      } else { seen.set(key, quote); candidates.push(quote); }
    }
  }
  return recognized ? { candidates: candidates.filter(x => !x.conflicting), pendingItems } : null;
}

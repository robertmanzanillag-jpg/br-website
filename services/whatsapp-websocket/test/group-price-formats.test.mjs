import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareKongRecord } from '../kong-delivery.mjs';
const now = Date.parse('2026-10-27T18:00:00Z');
const record = (text, group = 'SPACE TABLES', sent = '2026-10-25T17:43:52Z') => prepareKongRecord({ id: 'fixture', text, sentAt: Date.parse(sent) / 1000 }, group, now);

test('observed Space multiple events and slash table codes produce distinct USD minimums', () => {
  const result = record(`2026 space tables
Camelphat + Volkoder + Whitesquare, Friday, Oct 30
E4/5/6 $2k
E7/8/9/10 $2k++
E1/2 $4k++
W9/5 $4k++
DJ1 $best offer
(A-Z) Bedouin + Seth Troxler b2b Victor Calderone + Jamback b2b Toman, Saturday, Oct 31
E6/2 $10k++
Dixon b2b Jimi Jules + Whomadewho, Sunday, Nov 1
E7/8/9/10 $2k++`);
  assert.equal(result.status, 'queued');
  assert.equal(result.candidates.length, 17);
  assert.equal(new Set(result.candidates.map(x => x.sourceMessageId)).size, 17);
  assert.equal(result.candidates.find(x => x.tableType === 'W5').minimumSpend, '4000');
  assert.equal(result.candidates.find(x => x.eventDate === '2026-10-31').minimumSpend, '10000');
  assert.equal(result.candidates.filter(x => x.eventDate === '2026-11-01').length, 4);
  assert.ok(result.candidates.every(x => x.currency === 'USD' && x.venueName === 'Club Space'));
  assert.match(result.candidates[0].conditions, /not specified/);
  assert.equal(result.candidates[3].minimumSpendDisplay, '$2,000++');
  assert.equal(result.pendingItems[0].reason, 'negotiable_or_unrecognized_price');
});

test('new and old Music On quotes preserve source time and prices, negotiable DJ is not fixed', () => {
  const newer = record('Music ON, Friday, Dec 4\nE1/2 $12k++\nDJ1 $best offer $30k');
  const older = record('Music ON, Friday, Dec 4\nE1/2 $10k++', 'SPACE TABLES', '2026-10-24T21:00:00Z');
  assert.equal(newer.candidates.length, 2);
  assert.equal(newer.candidates[0].minimumSpend, '12000');
  assert.equal(older.candidates[0].minimumSpend, '10000');
  assert.ok(newer.candidates[0].sourceTimestamp > older.candidates[0].sourceTimestamp);
});

test('expired events, weekday mismatch, context-free amounts and other groups do not queue', () => {
  for (const text of ['Riordan, Saturday, Oct 24\nE2 $4k++', 'Camelphat, Saturday, Oct 30\nE2 $4k++', '8k', 'E2 $4k++', 'Floyd Halloween tickets $40']) {
    assert.equal(record(text).status, 'pending', text);
    assert.equal(record(text).candidates.length, 0);
  }
  assert.equal(record('Music ON, Friday, Dec 4\nE1 $10k++', 'Promoters 🖤👾🖤').candidates.length, 0);
});

test('LIV table tariff ignores bottle prices and percentages and preserves table annotations', () => {
  const result = record(`LIV Friday 10/30 **Sexyy Red**
- Below is your required minimum spend
- Alcohol included
• Bottles of your choice once you arrive start at $550 each
- Please note we add approximately 36% tax/service charge to your spend below
MAIN FLOOR:
- Dance floor: $6,000++ (BG)
- Main Floor Big: $4,500++ (BG)
- Main Floor Small: $2,000++ (SG)
STAGE:
- Front Stage: $5,000++ (BG) (Next To Artist)
- Back Stage: $2,000++ (SG) (Near Artist)
MEZZANINE:
- Skyboxes: $4,000++ (BG)
- View Table: $1,500++ (SG)`, 'LIV MIAMI');
  assert.equal(result.candidates.length, 7);
  assert.ok(result.candidates.every(x => x.eventDate === '2026-10-30' && x.venueName === 'LIV'));
  assert.equal(result.candidates[0].minimumSpend, '6000');
  assert.match(result.candidates[3].conditions, /Next To Artist/);
  assert.match(result.candidates[0].conditions, /36% tax\/service/);
  assert.ok(result.candidates.every(x => !('capacity' in x)));
});

test('conflicting same-table prices are withheld and changed event headings clear context', () => {
  const conflict = record('Music ON, Friday, Dec 4\nE1 $10k++\nE1 $12k++');
  assert.equal(conflict.candidates.length, 0);
  const badHeading = record('Music ON, Friday, Dec 4\nE1 $10k++\nFloyd Saturday 12/5\nE2 $12k++');
  assert.equal(badHeading.candidates.length, 1);
});

test('stale source and wrong explicit year never deliver, nearby New Year resolves correctly', () => {
  assert.equal(record('Music ON, Friday, Dec 4\nE1 $10k++', 'SPACE TABLES', '2026-10-15T12:00:00Z').status, 'pending');
  assert.equal(record('2025 space tables\nMusic ON, Friday, Dec 4\nE1 $10k++').candidates.length, 0);
  const nextYear = prepareKongRecord({ id: 'ny', text: 'Party, Friday, Jan 1\nE1 $2k++', sentAt: Date.parse('2026-12-30T18:00:00Z') / 1000 }, 'SPACE TABLES', Date.parse('2026-12-31T18:00:00Z'));
  assert.equal(nextYear.candidates[0].eventDate, '2027-01-01');
});

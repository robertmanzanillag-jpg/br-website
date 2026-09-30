import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'public/data/bank-media.json');
const hiddenPath = path.join(root, 'public/data/bank-media-hidden.json');
const excludedRows = new Set([46, 47]);

function stableIdentity(item) {
  if (item.sourceProvider === 'zoho' && item.sourceFileId) {
    return `zoho:${item.sourceFileId}`;
  }

  try {
    const url = new URL(item.url);
    if (/drive\.google\.com$/i.test(url.hostname)) {
      const id = url.searchParams.get('id') || url.pathname.match(/\/file\/d\/([^/]+)/)?.[1];
      if (id) return `drive:${id}`;
    }
    if (/dropbox\.com$/i.test(url.hostname)) {
      return `dropbox:${url.pathname.toLocaleLowerCase('en-US')}`;
    }
    return `url:${url.href}`;
  } catch {
    return `url:${item.url}`;
  }
}

function normalizedTitle(title) {
  return (title || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function isCuratedCollection(collection) {
  return !excludedRows.has(collection.row) && !/high voltage/i.test(collection.title);
}

function sourceOccurrenceKeys(collection) {
  const counts = new Map();
  return collection.media.map(item => {
    const key = `${stableIdentity(item)}|${item.type}|${normalizedTitle(item.title)}`;
    const occurrence = counts.get(key) || 0;
    counts.set(key, occurrence + 1);
    return { key, occurrence };
  });
}

function buildManifest(catalog) {
  const hidden = [];

  for (const collection of catalog.filter(isCuratedCollection)) {
    const occurrences = sourceOccurrenceKeys(collection);
    const hiddenIndexes = new Set();
    const keptByIndex = new Map();

    const addHidden = (index, reason, keptIndex = null) => {
      if (hiddenIndexes.has(index)) return;
      hiddenIndexes.add(index);
      if (keptIndex !== null) keptByIndex.set(index, keptIndex);
      hidden.push({
        row: collection.row,
        identity: stableIdentity(collection.media[index]),
        type: collection.media[index].type,
        title: collection.media[index].title,
        occurrence: occurrences[index].occurrence,
        reason,
        ...(keptIndex === null ? {} : {
          keptIdentity: stableIdentity(collection.media[keptIndex]),
          keptTitle: collection.media[keptIndex].title,
        }),
      });
    };

    const indexesByTitle = new Map();
    collection.media.forEach((item, index) => {
      const titleKey = `${item.type}|${normalizedTitle(item.title)}`;
      if (!indexesByTitle.has(titleKey)) indexesByTitle.set(titleKey, []);
      indexesByTitle.get(titleKey).push(index);
    });

    const findCounterpart = (index, candidateTitles) => {
      const item = collection.media[index];
      for (const title of candidateTitles) {
        const matches = indexesByTitle.get(`${item.type}|${normalizedTitle(title)}`) || [];
        const match = matches.find(candidate => candidate !== index && !hiddenIndexes.has(candidate));
        if (match !== undefined) return match;
      }
      return null;
    };

    collection.media.forEach((item, index) => {
      const title = (item.title || '').trim();
      if (item.type === 'image' && /\.arw$/i.test(title)) {
        const jpgTitle = title.replace(/\.arw$/i, '.jpg');
        const jpegTitle = title.replace(/\.arw$/i, '.jpeg');
        addHidden(index, 'camera-raw-source', findCounterpart(index, [jpgTitle, jpegTitle]));
      } else if (/^copy of\s+/i.test(title)) {
        const originalTitle = title.replace(/^copy of\s+/i, '');
        addHidden(index, 'copy-labeled-item', findCounterpart(index, [originalTitle]));
      } else if (/\b(test|draft|screenshot|screen[\s_-]?shot|backup|back[\s_-]?up|temp(?:orary)?|sample|proof|low[\s_-]?res(?:olution)?|watermark|corrupt|broken)\b/i.test(title)) {
        addHidden(index, 'test-draft-or-defective-label');
      }
    });

    // Stable IDs identify the same source file even if two catalog records have
    // different titles. Keep the first visible reference in this collection.
    const indexesByIdentity = new Map();
    collection.media.forEach((item, index) => {
      if (hiddenIndexes.has(index)) return;
      const key = `${item.type}|${stableIdentity(item)}`;
      if (!indexesByIdentity.has(key)) indexesByIdentity.set(key, []);
      indexesByIdentity.get(key).push(index);
    });
    for (const indexes of indexesByIdentity.values()) {
      if (indexes.length < 2) continue;
      const keptIndex = indexes[0];
      for (const index of indexes.slice(1)) addHidden(index, 'duplicate-source-file', keptIndex);
    }

    // A trailing hyphenated number is treated as a numbered export only when
    // the unsuffixed filename exists in the same collection and media type.
    collection.media.forEach((item, index) => {
      if (hiddenIndexes.has(index)) return;
      const match = (item.title || '').match(/^(.+)-(\d+)(\.[^.]+)$/);
      if (!match) return;
      const baseTitle = `${match[1]}${match[3]}`;
      const baseIndexes = indexesByTitle.get(`${item.type}|${normalizedTitle(baseTitle)}`) || [];
      const keptIndex = baseIndexes.find(candidate => !hiddenIndexes.has(candidate));
      if (keptIndex !== undefined) addHidden(index, 'numbered-export-variant', keptIndex);
    });

  }

  return {
    version: 1,
    scope: 'Presentation-only exclusions for /media.html. Source files and catalog URLs are not changed.',
    items: hidden,
  };
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const manifest = buildManifest(catalog);
  const counts = manifest.items.reduce((result, item) => {
    result[item.reason] = (result[item.reason] || 0) + 1;
    return result;
  }, {});

  if (process.argv.includes('--write')) {
    fs.writeFileSync(hiddenPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Saved ${manifest.items.length} reversible gallery exclusions.`);
  } else if (process.argv.includes('--check')) {
    const existing = JSON.parse(fs.readFileSync(hiddenPath, 'utf8'));
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new Error('The hidden-item manifest is out of date. Run with --write to regenerate it.');
    }
    const hiddenKeys = new Set(manifest.items.map(item =>
      `${item.row}|${item.identity}|${item.type}|${normalizedTitle(item.title)}|${item.occurrence}`,
    ));
    let retained = 0;
    let excluded = 0;
    for (const collection of catalog.filter(isCuratedCollection)) {
      const occurrences = sourceOccurrenceKeys(collection);
      collection.media.forEach((item, index) => {
        const key = `${collection.row}|${stableIdentity(item)}|${item.type}|${normalizedTitle(item.title)}|${occurrences[index].occurrence}`;
        if (hiddenKeys.has(key)) excluded += 1;
        else retained += 1;
      });
    }
    console.log(JSON.stringify({ retained, excluded, reasons: counts }, null, 2));
  } else {
    console.log(`Would save ${manifest.items.length} exclusions. Use --write to generate the manifest.`);
    console.log(JSON.stringify(counts, null, 2));
  }
}

main();
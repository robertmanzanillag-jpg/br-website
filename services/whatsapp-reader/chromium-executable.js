import fs from 'node:fs';
import path from 'node:path';

const BROWSER_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

export function resolveChromiumExecutable(env = process.env) {
  const explicit = env.PUPPETEER_EXECUTABLE_PATH || env.CHROMIUM_PATH;
  const candidates = explicit
    ? [explicit]
    : (env.PATH || '').split(path.delimiter).flatMap(directory =>
      BROWSER_NAMES.map(name => path.join(directory, name)));

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile() && (fs.statSync(candidate).mode & 0o111)) return candidate;
    } catch {
      // Try the next PATH candidate; never fall back to Puppeteer's bundled browser.
    }
  }
  throw Object.assign(new Error('No executable system Chromium was found.'), { code: 'WA_CHROMIUM_NOT_FOUND' });
}

export function classifyWhatsAppStartupFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const knownCodes = new Set([
    'WA_KEY_MISSING',
    'WA_KEY_INVALID',
    'WA_BACKUP_CORRUPT',
    'WA_METER_CORRUPT',
    'WA_BUDGET_LIMIT',
    'WA_STORAGE_LIMIT',
    'WA_STORAGE_ERROR',
    'WA_STORAGE_TIMEOUT',
    'WA_READER_STATE_INVALID',
    'WA_CHROMIUM_NOT_FOUND'
  ]);
  if (knownCodes.has(code)) return code;

  const text = `${error?.message || ''} ${error?.cause?.message || ''}`.toLowerCase();
  if (/libgbm\.so|shared librar|error while loading shared object/.test(text)) return 'CHROMIUM_MISSING_LIBRARY';
  if (/no usable sandbox|sandbox/.test(text)) return 'CHROMIUM_SANDBOX_FAILURE';
  if (/enoent|could not find chrome|executable.*not found/.test(text)) return 'CHROMIUM_NOT_FOUND';
  if (/timeout|timed out/.test(text)) return 'WHATSAPP_START_TIMEOUT';
  if (/net::err|navigation.*failed|failed to navigate/.test(text)) return 'WHATSAPP_WEB_UNREACHABLE';
  return 'WHATSAPP_START_FAILED';
}

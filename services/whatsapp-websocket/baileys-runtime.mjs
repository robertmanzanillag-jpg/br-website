import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const VERSION = '7.0.0-rc14';
const PATCH_MARKER = '// BR_COMPANION_REG_REFRESH_PATCH_V2';
const require = createRequire(import.meta.url);

export function handleCompanionRegRefresh(node, { creds, emitCredsUpdate, refreshQR, logger, getChild }) {
  const validChild = getChild(node, 'companion_reg_refresh') || getChild(node, 'pair-device-rotate-qr');
  if (!validChild) {
    logger.warn({}, 'ignored malformed companion registration refresh');
    return 'ignored_malformed';
  }
  if (creds.me) {
    logger.debug({}, 'ignored companion registration refresh for registered session');
    return 'ignored_registered';
  }
  creds.advSecretKey = randomBytes(32).toString('base64');
  emitCredsUpdate({ advSecretKey: creds.advSecretKey });
  logger.info({}, 'refreshed pending pairing QR material');
  refreshQR();
  return 'rotated';
}

export function rewritePairingSocket(source) {
  if (source.includes(PATCH_MARKER)) return source;
  const priorPatch = source.indexOf('    // BR_COMPANION_REG_REFRESH_PATCH');
  const start = priorPatch >= 0
    ? priorPatch
    : source.indexOf("    // QR gen\n    ws.on('CB:iq,type:set,pair-device'");
  const end = source.indexOf('    // device paired for the first time', start);
  if (start < 0 || end < 0 || (priorPatch < 0 && source.indexOf("const advB64 = creds.advSecretKey;", start) < 0)) {
    throw new Error('Baileys pairing implementation does not match the supported patch target');
  }
  const helperSource = `const handleCompanionRegRefresh = ${handleCompanionRegRefresh.toString()};`;
  const replacement = `    ${PATCH_MARKER}
    ${helperSource}
    let refreshPairingQR;
    // QR gen
    ws.on('CB:iq,type:set,pair-device', async (stanza) => {
        const iq = {
            tag: 'iq',
            attrs: { to: S_WHATSAPP_NET, type: 'result', id: stanza.attrs.id }
        };
        await sendNode(iq);
        const pairDeviceNode = getBinaryNodeChild(stanza, 'pair-device');
        const refs = getBinaryNodeChildren(pairDeviceNode, 'ref').map(ref => ref.content.toString('utf-8'));
        const noiseKeyB64 = Buffer.from(creds.noiseKey.public).toString('base64');
        const identityKeyB64 = Buffer.from(creds.signedIdentityKey.public).toString('base64');
        let index = 0;
        let currentRef;
        let qrMs = qrTimeout || 60000;
        const renderCurrent = () => {
            if (currentRef !== undefined) {
                ev.emit('connection.update', {
                    qr: buildPairingQRData(currentRef, noiseKeyB64, identityKeyB64, creds.advSecretKey, browser)
                });
            }
        };
        refreshPairingQR = renderCurrent;
        const genPairQR = () => {
            if (!ws.isOpen) return;
            currentRef = refs[index++];
            if (currentRef === undefined) {
                void end(new Boom('QR refs attempts ended', { statusCode: DisconnectReason.timedOut }));
                return;
            }
            renderCurrent();
            qrTimer = setTimeout(genPairQR, qrMs);
            qrMs = qrTimeout || 20000;
        };
        genPairQR();
    });
    ws.on('CB:notification,type:companion_reg_refresh', node => {
        handleCompanionRegRefresh(node, {
            creds,
            emitCredsUpdate: update => ev.emit('creds.update', update),
            refreshQR: () => refreshPairingQR?.(),
            logger,
            getChild: getBinaryNodeChild
        });
    });
`;
  return source.slice(0, start) + replacement + source.slice(end);
}

async function installCompatibilityPatch() {
  const entry = require.resolve('@whiskeysockets/baileys');
  const root = path.resolve(path.dirname(entry), '..');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== VERSION) {
    throw new Error(`Unsupported Baileys version for pairing compatibility patch (${pkg.version})`);
  }
  const socketPath = path.join(root, 'lib/Socket/socket.js');
  const original = await readFile(socketPath, 'utf8');
  const patched = rewritePairingSocket(original);
  if (patched !== original) await writeFile(socketPath, patched);
}

await installCompatibilityPatch();
const baileys = await import('@whiskeysockets/baileys');

export default baileys.default;
export const initAuthCreds = baileys.initAuthCreds;
export const proto = baileys.proto;
export const normalizeMessageContent = baileys.normalizeMessageContent;
export const downloadMediaMessage = baileys.downloadMediaMessage;
export const DisconnectReason = baileys.DisconnectReason;
export const BufferJSON = baileys.BufferJSON;

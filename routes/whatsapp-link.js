// Replaces the Chromium controller. Do not mount both implementations.
import express from 'express';
import { createHostSystem } from '../services/whatsapp-websocket/host.mjs';
export { isWhatsAppLinkOwner } from '../services/whatsapp-websocket/host.mjs';

const system = createHostSystem(express);
export const whatsAppLinkPageRouter = system.pageRouter;
export const whatsAppLinkApiRouter = system.apiRouter;
export const shutdownWhatsAppLinkService = system.shutdown;
export const resumeWhatsAppLinkService = system.resume;

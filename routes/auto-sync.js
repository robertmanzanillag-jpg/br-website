import express from 'express';
import cron from 'node-cron';
import fetch from 'node-fetch';
import { scrapePoshEvents } from '../scripts/posh-scraper.js';

const router = express.Router();

let syncHistory = [];
let cronJob = null;
let poshCronJob = null;

// Función para ejecutar sincronización
async function runAutoSync() {
  try {
    console.log('\n🤖 === SINCRONIZACIÓN AUTOMÁTICA INICIADA ===');
    console.log(`📅 Fecha: ${new Date().toISOString()}`);
    
    const response = await fetch('http://localhost:5000/api/youtube-calendar-sync/sync', {
      method: 'POST'
    });
    
    const result = await response.json();
    
    const syncRecord = {
      timestamp: new Date().toISOString(),
      success: result.success || false,
      added: result.added || 0,
      skipped: result.skipped || 0,
      total: result.totalInCalendar || 0
    };
    
    syncHistory.push(syncRecord);
    
    // Mantener solo los últimos 50 registros
    if (syncHistory.length > 50) {
      syncHistory = syncHistory.slice(-50);
    }
    
    console.log(`✅ Sincronización automática completada`);
    console.log(`📊 Nuevos eventos agregados: ${syncRecord.added}`);
    console.log(`📊 Total en calendario: ${syncRecord.total}`);
    
    return syncRecord;
    
  } catch (error) {
    console.error('❌ Error en sincronización automática:', error);
    
    const errorRecord = {
      timestamp: new Date().toISOString(),
      success: false,
      error: error.message
    };
    
    syncHistory.push(errorRecord);
    
    if (syncHistory.length > 50) {
      syncHistory = syncHistory.slice(-50);
    }
    
    return errorRecord;
  }
}

// Función para sincronizar eventos de Posh.vip
async function runPoshSync() {
  try {
    console.log('\n🎟️ === SINCRONIZACIÓN POSH.VIP INICIADA ===');
    console.log(`📅 Fecha: ${new Date().toISOString()}`);
    
    const events = await scrapePoshEvents();
    
    const syncRecord = {
      timestamp: new Date().toISOString(),
      type: 'posh',
      success: true,
      eventsFound: events.length
    };
    
    syncHistory.push(syncRecord);
    
    if (syncHistory.length > 50) {
      syncHistory = syncHistory.slice(-50);
    }
    
    console.log(`✅ Sincronización Posh.vip completada`);
    console.log(`📊 Eventos de Black Room encontrados: ${events.length}`);
    
    return syncRecord;
    
  } catch (error) {
    console.error('❌ Error en sincronización Posh.vip:', error);
    
    const errorRecord = {
      timestamp: new Date().toISOString(),
      type: 'posh',
      success: false,
      error: error.message
    };
    
    syncHistory.push(errorRecord);
    
    if (syncHistory.length > 50) {
      syncHistory = syncHistory.slice(-50);
    }
    
    return errorRecord;
  }
}

// Inicializar cron jobs
function startAutoSync() {
  // YouTube sync: Todos los jueves a las 8PM
  if (!cronJob) {
    cronJob = cron.schedule('0 20 * * 4', async () => {
      console.log('\n🔔 Ejecutando sincronización YouTube (Jueves 8PM)');
      await runAutoSync();
    }, {
      scheduled: true,
      timezone: "America/New_York"
    });
    console.log('✅ YouTube sync configurado: Jueves 8PM (EST)');
  }
  
  // Posh.vip sync: Todos los días a las 6AM
  if (!poshCronJob) {
    poshCronJob = cron.schedule('0 6 * * *', async () => {
      console.log('\n🔔 Ejecutando sincronización Posh.vip (Diaria 6AM)');
      await runPoshSync();
    }, {
      scheduled: true,
      timezone: "America/New_York"
    });
    console.log('✅ Posh.vip sync configurado: Diariamente 6AM (EST)');
  }
}

// Detener cron jobs
function stopAutoSync() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('⏸️  YouTube sync detenido');
  }
  if (poshCronJob) {
    poshCronJob.stop();
    poshCronJob = null;
    console.log('⏸️  Posh.vip sync detenido');
  }
}

// Endpoint para ver el estado del auto-sync
router.get('/status', (req, res) => {
  res.json({
    youtube: {
      active: cronJob !== null,
      schedule: 'Jueves 8PM EST'
    },
    posh: {
      active: poshCronJob !== null,
      schedule: 'Diariamente 6AM EST'
    },
    timezone: 'America/New_York',
    history: syncHistory.slice(-10)
  });
});

// Endpoint para sincronizar Posh.vip manualmente
router.post('/sync-posh', async (req, res) => {
  try {
    const result = await runPoshSync();
    res.json({
      success: true,
      message: 'Sincronización Posh.vip ejecutada',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para ejecutar sync manual
router.post('/run-now', async (req, res) => {
  try {
    const result = await runAutoSync();
    res.json({
      success: true,
      message: 'Sincronización manual ejecutada',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para iniciar auto-sync
router.post('/start', (req, res) => {
  startAutoSync();
  res.json({
    success: true,
    message: 'Auto-sync activado: Jueves 8PM EST',
    schedule: 'Jueves 8PM (America/New_York)'
  });
});

// Endpoint para detener auto-sync
router.post('/stop', (req, res) => {
  stopAutoSync();
  res.json({
    success: true,
    message: 'Auto-sync detenido'
  });
});

// Endpoint para ver historial completo
router.get('/history', (req, res) => {
  res.json({
    success: true,
    total: syncHistory.length,
    history: syncHistory
  });
});

// Iniciar auto-sync al cargar el módulo
startAutoSync();

export default router;

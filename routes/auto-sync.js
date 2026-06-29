import express from 'express';
import cron from 'node-cron';
import fetch from 'node-fetch';
import { scrapeKongEvents } from '../scripts/kong-scraper.js';

const router = express.Router();

let syncHistory = [];
let cronJob = null;
let kongCronJob = null;

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

// Función para sincronizar eventos de Kong Nightlife
async function runKongSync() {
  try {
    console.log('\n🎟️ === SINCRONIZACIÓN KONG NIGHTLIFE INICIADA ===');
    console.log(`📅 Fecha: ${new Date().toISOString()}`);
    
    const events = await scrapeKongEvents();
    
    const syncRecord = {
      timestamp: new Date().toISOString(),
      type: 'kong',
      success: true,
      eventsFound: events.length
    };
    
    syncHistory.push(syncRecord);
    
    if (syncHistory.length > 50) {
      syncHistory = syncHistory.slice(-50);
    }
    
    console.log(`✅ Sincronización Kong Nightlife completada`);
    console.log(`📊 Eventos encontrados: ${events.length}`);
    
    return syncRecord;
    
  } catch (error) {
    console.error('❌ Error en sincronización Kong Nightlife:', error);
    
    const errorRecord = {
      timestamp: new Date().toISOString(),
      type: 'kong',
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
  
  // Kong Nightlife sync: every hour so ticket images/details do not stay stale.
  if (!kongCronJob) {
    kongCronJob = cron.schedule('7 * * * *', async () => {
      console.log('\n🔔 Ejecutando sincronización Kong Nightlife (cada hora)');
      await runKongSync();
    }, {
      scheduled: true,
      timezone: "America/New_York"
    });
    console.log('✅ Kong Nightlife sync configurado: cada hora (America/New_York)');

    setTimeout(() => {
      runKongSync().catch(error => {
        console.error('❌ Error en sincronización inicial Kong Nightlife:', error);
      });
    }, 30000);
  }
}

// Detener cron jobs
function stopAutoSync() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('⏸️  YouTube sync detenido');
  }
  if (kongCronJob) {
    kongCronJob.stop();
    kongCronJob = null;
    console.log('⏸️  Kong Nightlife sync detenido');
  }
}

// Endpoint para ver el estado del auto-sync
router.get('/status', (req, res) => {
  res.json({
    youtube: {
      active: cronJob !== null,
      schedule: 'Jueves 8PM EST'
    },
    kong: {
      active: kongCronJob !== null,
      schedule: 'Cada hora, minuto 7 (America/New_York)'
    },
    timezone: 'America/New_York',
    history: syncHistory.slice(-10)
  });
});

async function handleManualKongSync(req, res) {
  try {
    const result = await runKongSync();
    res.json({
      success: true,
      message: 'Sincronización Kong Nightlife ejecutada',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

router.post('/sync-kong', handleManualKongSync);
router.post('/sync-posh', handleManualKongSync);

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

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const CALENDAR_ID = "theblackroom.us@gmail.com";
const EVENTS_FILE = path.join(__dirname, '../db/events.json');

// Black Room Channel and Uploads Playlist
// IMPORTANT: Use UPLOADS PLAYLIST to get ALL videos (667 total)
// Search API only returns ~500 videos max
const CHANNEL_ID = "UCi__qHBfHLlYg0fu86BUA8g";
const UPLOADS_PLAYLIST_ID = "UUi__qHBfHLlYg0fu86BUA8g"; // Note: UC -> UU for uploads

// Función para parsear duración ISO 8601 (PT1H23M45S) a segundos
function parseISO8601Duration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  
  return (hours * 3600) + (minutes * 60) + seconds;
}

// Función para extraer fecha del título del video
function extractDateFromTitle(title, publishedAt) {
  // Patrones comunes de fecha en los títulos
  const patterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // DD/MM/YYYY o MM/DD/YYYY
    /(\d{1,2})-(\d{1,2})-(\d{4})/,    // DD-MM-YYYY
    /(\d{4})-(\d{2})-(\d{2})/,        // YYYY-MM-DD
    /(\d{1,2})\.(\d{1,2})\.(\d{4})/,  // DD.MM.YYYY
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      // Intentar diferentes formatos
      const [_, p1, p2, p3] = match;
      
      // YYYY-MM-DD
      if (p1.length === 4) {
        return new Date(`${p1}-${p2}-${p3}`);
      }
      
      // Asumir DD/MM/YYYY (formato latino)
      const year = parseInt(p3);
      const month = parseInt(p2) - 1; // Meses son 0-indexed
      const day = parseInt(p1);
      
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Si no hay fecha en el título, usar la fecha de publicación del video
  return new Date(publishedAt);
}

// Función para extraer nombre del DJ y género del título
function extractDJNameAndGenre(title) {
  // Remover prefijos comunes
  let cleanTitle = title
    .replace(/BLACK ROOM\s*/gi, '')
    .replace(/RADIO\s*/gi, '')
    .replace(/LIVE\s+SESSION\s*/gi, '')
    .replace(/LIVE\s*/gi, '')
    .replace(/DJ\s+SET\s*/gi, '')
    .replace(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}/g, '') // fechas DD/MM/YYYY
    .replace(/\d{4}-\d{2}-\d{2}/g, ''); // fechas ISO YYYY-MM-DD
  
  // Remover ciudades y fechas al final (después de "at", "@", "|")
  cleanTitle = cleanTitle.split(/\s+(?:at|@)\s+/i)[0];
  cleanTitle = cleanTitle.split(/\s+\|\s+/)[0];
  
  // Remover mes/año al final (ej: "OCT 2025", "JAN 2024")
  cleanTitle = cleanTitle.replace(/\s+[A-Z]{3}\s+\d{4}\s*$/i, '');
  
  // Remover guiones, pipes y símbolos al final
  cleanTitle = cleanTitle.replace(/[\-\|\s]+$/, '');
  cleanTitle = cleanTitle.replace(/^[\-\|\s]+/, '');
  
  // Limpiar comillas extra y símbolos
  cleanTitle = cleanTitle.replace(/['"]+/g, '');
  
  // Limpiar espacios extras
  cleanTitle = cleanTitle.trim().replace(/\s+/g, ' ');
  
  return cleanTitle || 'Unknown DJ';
}

// Obtener videos de un playlist con duración (con retry y manejo robusto de errores)
async function getPlaylistVideos(playlistId) {
  try {
    if (!YOUTUBE_API_KEY) {
      throw new Error('YOUTUBE_API_KEY no configurado en variables de entorno');
    }
    
    console.log(`📺 Fetching videos from playlist: ${playlistId}`);
    
    let allVideos = [];
    let nextPageToken = null;
    let pageCount = 0;
    
    // Obtener todos los videos del playlist (paginado con retry)
    do {
      pageCount++;
      let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${YOUTUBE_API_KEY}`;
      
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }
      
      // Retry logic: intentar hasta 3 veces con backoff
      let retries = 0;
      let success = false;
      let data = null;
      
      while (retries < 3 && !success) {
        try {
          const response = await fetch(url);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ YouTube API error on page ${pageCount}, attempt ${retries + 1}: ${response.status}`);
            console.error(`Error details: ${errorText.substring(0, 200)}`);
            
            // Si es error de quota (403), no tiene sentido reintentar
            if (response.status === 403) {
              throw new Error(`YouTube API quota exceeded. Videos fetched so far: ${allVideos.length}`);
            }
            
            // Para otros errores, esperar y reintentar
            retries++;
            if (retries < 3) {
              const waitTime = Math.pow(2, retries) * 1000; // Exponential backoff
              console.log(`⏳ Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            } else {
              throw new Error(`Failed to fetch page ${pageCount} after 3 retries. Status: ${response.status}`);
            }
          }
          
          data = await response.json();
          success = true;
          
        } catch (error) {
          if (retries >= 2) {
            throw error;
          }
          retries++;
          const waitTime = Math.pow(2, retries) * 1000;
          console.log(`⏳ Network error, waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
      
      if (!success || !data) {
        throw new Error(`Failed to fetch playlist page ${pageCount}`);
      }
      
      allVideos = allVideos.concat(data.items || []);
      nextPageToken = data.nextPageToken;
      
      console.log(`✅ Page ${pageCount}: ${data.items?.length || 0} videos (Total so far: ${allVideos.length})`);
      
    } while (nextPageToken);
    
    // Obtener detalles de videos (duración) en lotes de 50
    const videoIds = allVideos.map(item => item.snippet.resourceId.videoId);
    const videosWithDuration = [];
    
    for (let i = 0; i < videoIds.length; i += 50) {
      const batchIds = videoIds.slice(i, i + 50).join(',');
      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${batchIds}&key=${YOUTUBE_API_KEY}`;
      
      const response = await fetch(detailsUrl);
      if (response.ok) {
        const data = await response.json();
        videosWithDuration.push(...(data.items || []));
      }
    }
    
    console.log(`✅ Found ${videosWithDuration.length} videos with details`);
    return videosWithDuration;
    
  } catch (error) {
    console.error(`❌ Error fetching playlist videos:`, error);
    return [];
  }
}

// Función para agregar eventos al archivo events.json local
async function addEventsToLocalCalendar(videos) {
  try {
    // Leer eventos existentes
    let existingEvents = [];
    try {
      const fileContent = await fs.readFile(EVENTS_FILE, 'utf-8');
      existingEvents = JSON.parse(fileContent);
    } catch (error) {
      console.log('📄 Creando nuevo archivo events.json');
      existingEvents = [];
    }
    
    // Crear un Set de videos existentes para evitar duplicados
    const existingVideoIds = new Set(
      existingEvents
        .filter(e => e.youtubeId)
        .map(e => e.youtubeId)
    );
    
    // Convertir videos de YouTube al formato de eventos
    const newEvents = videos
      .filter(video => !existingVideoIds.has(video.videoId))
      .map(video => ({
        id: `yt-${video.videoId}`,
        title: video.djName,
        date: video.date,
        description: `🎧 BLACK ROOM RADIO - ${video.djName}\n\n` +
          `🎵 Duración: ${video.durationMinutes} minutos\n` +
          `📺 ${video.youtubeUrl}\n\n` +
          `Título original: ${video.title}`,
        youtubeUrl: video.youtubeUrl,
        youtubeId: video.videoId,
        type: 'radio',
        autoGenerated: true,
        djs: [
          {
            name: video.djName,
            videoId: video.videoId,
            youtubeUrl: video.youtubeUrl
          }
        ]
      }));
    
    if (newEvents.length === 0) {
      return { added: 0, skipped: videos.length };
    }
    
    // Combinar eventos existentes con nuevos
    const allEvents = [...existingEvents, ...newEvents];
    
    // Ordenar por fecha
    allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Guardar en el archivo
    await fs.writeFile(EVENTS_FILE, JSON.stringify(allEvents, null, 2), 'utf-8');
    
    console.log(`✅ Agregados ${newEvents.length} eventos nuevos al calendario`);
    console.log(`📊 Total de eventos en calendario: ${allEvents.length}`);
    
    return {
      added: newEvents.length,
      skipped: videos.length - newEvents.length,
      total: allEvents.length
    };
    
  } catch (error) {
    console.error('❌ Error guardando eventos:', error);
    throw error;
  }
}

// Endpoint para sincronizar videos a calendario
router.post('/sync', async (req, res) => {
  try {
    console.log('\n🎥 === INICIANDO SINCRONIZACIÓN YOUTUBE → CALENDARIO ===\n');
    
    // Obtener videos del Uploads Playlist (TODOS los videos del canal)
    console.log(`📺 Obteniendo videos de Uploads Playlist: ${UPLOADS_PLAYLIST_ID}`);
    const allVideos = await getPlaylistVideos(UPLOADS_PLAYLIST_ID);
    
    console.log(`📊 Total videos encontrados: ${allVideos.length}`);
    
    // Filtrar videos > 30 minutos
    const longVideos = allVideos.filter(video => {
      const duration = video.contentDetails.duration;
      const seconds = parseISO8601Duration(duration);
      const minutes = seconds / 60;
      return minutes >= 30;
    });
    
    console.log(`⏱️  Videos >30min: ${longVideos.length}`);
    
    // Procesar cada video
    const processedVideos = longVideos.map(video => {
      const title = video.snippet.title;
      const videoId = video.id;
      const publishedAt = video.snippet.publishedAt;
      const duration = video.contentDetails.duration;
      const durationSeconds = parseISO8601Duration(duration);
      
      // Extraer información
      const date = extractDateFromTitle(title, publishedAt);
      const djNameAndGenre = extractDJNameAndGenre(title);
      
      return {
        videoId,
        title,
        djName: djNameAndGenre,
        date: date.toISOString().split('T')[0], // YYYY-MM-DD
        durationMinutes: Math.round(durationSeconds / 60),
        youtubeUrl: `https://youtube.com/watch?v=${videoId}`,
        publishedAt
      };
    });
    
    // Agrupar por fecha
    const byDate = {};
    processedVideos.forEach(video => {
      if (!byDate[video.date]) {
        byDate[video.date] = [];
      }
      byDate[video.date].push(video);
    });
    
    console.log(`\n📅 AGREGANDO EVENTOS AL CALENDARIO LOCAL...`);
    console.log(`═══════════════════════════════════════\n`);
    
    // Agregar eventos al archivo events.json local
    const results = await addEventsToLocalCalendar(processedVideos);
    
    console.log(`\n📊 RESUMEN DE SINCRONIZACIÓN:`);
    console.log(`✅ Eventos agregados: ${results.added}`);
    console.log(`⏭️  Eventos ya existentes (omitidos): ${results.skipped}`);
    console.log(`📊 Total en calendario: ${results.total}`);
    
    res.json({
      success: true,
      totalVideos: allVideos.length,
      longVideos: longVideos.length,
      processed: processedVideos.length,
      added: results.added,
      skipped: results.skipped,
      totalInCalendar: results.total,
      byDate
    });
    
  } catch (error) {
    console.error('❌ Error en sincronización:', error);
    res.status(500).json({ 
      error: 'Failed to sync',
      details: error.message 
    });
  }
});

// Endpoint para ver preview sin crear eventos
router.get('/preview', async (req, res) => {
  try {
    console.log('\n👀 PREVIEW MODE - No se creará nada en el calendario\n');
    
    // Obtener videos del Uploads Playlist
    const allVideos = await getPlaylistVideos(UPLOADS_PLAYLIST_ID);
    
    // Filtrar videos > 30 minutos
    const longVideos = allVideos.filter(video => {
      const duration = video.contentDetails.duration;
      const seconds = parseISO8601Duration(duration);
      return seconds >= 1800; // 30 minutos
    });
    
    // Procesar cada video
    const processedVideos = longVideos.map(video => {
      const title = video.snippet.title;
      const publishedAt = video.snippet.publishedAt;
      const date = extractDateFromTitle(title, publishedAt);
      const djNameAndGenre = extractDJNameAndGenre(title);
      const durationSeconds = parseISO8601Duration(video.contentDetails.duration);
      
      return {
        videoId: video.id,
        title,
        djName: djNameAndGenre,
        date: date.toISOString().split('T')[0],
        durationMinutes: Math.round(durationSeconds / 60),
        youtubeUrl: `https://youtube.com/watch?v=${video.id}`
      };
    });
    
    // Agrupar por fecha
    const byDate = {};
    processedVideos.forEach(video => {
      if (!byDate[video.date]) {
        byDate[video.date] = [];
      }
      byDate[video.date].push(video);
    });
    
    res.json({
      success: true,
      totalVideos: allVideos.length,
      longVideos: longVideos.length,
      processed: processedVideos.length,
      byDate,
      videos: processedVideos
    });
    
  } catch (error) {
    console.error('❌ Error en preview:', error);
    res.status(500).json({ 
      error: 'Failed to preview',
      details: error.message 
    });
  }
});

// Endpoint para test profundo: verificar videos mes por mes
router.get('/test-monthly', async (req, res) => {
  try {
    console.log('\n🔍 === TEST PROFUNDO MES POR MES ===\n');
    
    // Obtener TODOS los videos del canal
    const allVideos = await getPlaylistVideos(UPLOADS_PLAYLIST_ID);
    console.log(`📊 Total videos en canal: ${allVideos.length}`);
    
    // Filtrar videos >30min
    const longVideos = allVideos.filter(video => {
      const duration = video.contentDetails.duration;
      const seconds = parseISO8601Duration(duration);
      return seconds >= 1800; // 30 minutos
    });
    
    console.log(`⏱️  Videos >30min: ${longVideos.length}`);
    
    // Agrupar por mes
    const byMonth = {};
    longVideos.forEach(video => {
      const publishDate = new Date(video.snippet.publishedAt);
      const monthKey = `${publishDate.getFullYear()}-${String(publishDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = [];
      }
      byMonth[monthKey].push({
        id: video.id,
        title: video.snippet.title,
        published: video.snippet.publishedAt,
        duration: video.contentDetails.duration
      });
    });
    
    // Leer events.json
    let existingEvents = [];
    try {
      const fileContent = await fs.readFile(EVENTS_FILE, 'utf-8');
      existingEvents = JSON.parse(fileContent);
    } catch (error) {
      console.log('⚠️  No se pudo leer events.json');
    }
    
    const existingVideoIds = new Set(
      existingEvents
        .filter(e => e.youtubeId)
        .map(e => e.youtubeId)
    );
    
    // Analizar mes por mes
    const monthlyReport = {};
    const sortedMonths = Object.keys(byMonth).sort();
    
    console.log('\n📅 REPORTE MES POR MES:\n');
    
    sortedMonths.forEach(month => {
      const monthVideos = byMonth[month];
      const missingVideos = monthVideos.filter(v => !existingVideoIds.has(v.id));
      
      monthlyReport[month] = {
        totalInYouTube: monthVideos.length,
        inCalendar: monthVideos.length - missingVideos.length,
        missing: missingVideos.length,
        missingVideos: missingVideos.map(v => ({
          id: v.id,
          title: v.title,
          url: `https://youtube.com/watch?v=${v.id}`
        }))
      };
      
      const status = missingVideos.length === 0 ? '✅' : '❌';
      console.log(`${status} ${month}: ${monthVideos.length} videos en YouTube, ${monthVideos.length - missingVideos.length} en calendario (${missingVideos.length} faltantes)`);
    });
    
    const totalMissing = Object.values(monthlyReport).reduce((sum, m) => sum + m.missing, 0);
    
    console.log(`\n📊 RESUMEN:`);
    console.log(`Total videos >30min en YouTube: ${longVideos.length}`);
    console.log(`Total en calendario: ${longVideos.length - totalMissing}`);
    console.log(`Total faltantes: ${totalMissing}`);
    
    res.json({
      success: true,
      totalVideosInChannel: allVideos.length,
      longVideosInChannel: longVideos.length,
      eventsInCalendar: existingVideoIds.size,
      totalMissing,
      monthlyReport
    });
    
  } catch (error) {
    console.error('❌ Error en test mensual:', error);
    res.status(500).json({ 
      error: 'Failed to run monthly test',
      details: error.message 
    });
  }
});

export default router;

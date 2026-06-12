
import fs from 'fs/promises';
import path from 'path';

// Sistema para gestionar imágenes de eventos con limpieza automática
export class EventImageManager {
  constructor() {
    this.eventsDir = path.join(process.cwd(), 'public', 'images', 'events');
    this.metadataFile = path.join(this.eventsDir, 'metadata.json');
  }

  async saveEventImage(imageUrl, eventTitle, eventDate = null) {
    try {
      // Crear directorio si no existe
      await fs.mkdir(this.eventsDir, { recursive: true });

      // Generar nombre de archivo
      const sanitizedTitle = eventTitle 
        ? eventTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 50)
        : `event-${Date.now()}`;
      
      const urlParts = imageUrl.split('.');
      const extension = urlParts[urlParts.length - 1].split('?')[0] || 'jpg';
      const filename = `${sanitizedTitle}.${extension}`;
      const filePath = path.join(this.eventsDir, filename);
      
      console.log(`⬇️ Descargando imagen del evento: ${imageUrl}`);
      
      // Descargar imagen con headers apropiados para evitar bloqueo 403
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://posh.vip/',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'same-origin'
        }
      });
      
      if (!response.ok) {
        console.log(`⚠️ Error ${response.status} descargando imagen, intentando sin headers especiales...`);
        
        // Segundo intento sin headers especiales
        const fallbackResponse = await fetch(imageUrl);
        if (!fallbackResponse.ok) {
          throw new Error(`Error descargando imagen: ${response.status} (fallback: ${fallbackResponse.status})`);
        }
        
        // Usar respuesta del fallback
        const imageBuffer = await fallbackResponse.arrayBuffer();
        await fs.writeFile(filePath, Buffer.from(imageBuffer));
      } else {
        // Usar respuesta original
        const imageBuffer = await response.arrayBuffer();
        await fs.writeFile(filePath, Buffer.from(imageBuffer));
      }

      // Guardar metadata para limpieza automática
      await this.saveImageMetadata(filename, eventTitle, eventDate);

      const webPath = `/images/events/${filename}`;
      console.log(`✅ Imagen del evento guardada: ${webPath}`);
      
      return webPath;

    } catch (error) {
      console.error('❌ Error guardando imagen del evento:', error);
      throw error;
    }
  }

  async saveImageMetadata(filename, eventTitle, eventDate) {
    try {
      // Asegurar que el directorio existe
      await fs.mkdir(this.eventsDir, { recursive: true });
      
      let metadata = {};
      
      // Leer metadata existente
      try {
        const data = await fs.readFile(this.metadataFile, 'utf8');
        metadata = JSON.parse(data);
      } catch (error) {
        // Archivo no existe, crear nuevo
        console.log('📝 Creando archivo de metadata para imágenes de eventos');
        metadata = {};
      }

      // Agregar nueva entrada
      metadata[filename] = {
        title: eventTitle,
        savedAt: new Date().toISOString(),
        eventDate: eventDate,
        deleteAfter: eventDate ? new Date(new Date(eventDate).getTime() + 24 * 60 * 60 * 1000).toISOString() : null
      };

      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
      console.log(`📋 Metadata guardada para ${filename}`);

    } catch (error) {
      console.error('❌ Error guardando metadata:', error);
    }
  }

  async cleanupExpiredImages() {
    try {
      // Asegurar que el directorio existe
      await fs.mkdir(this.eventsDir, { recursive: true });
      
      let metadata = {};
      try {
        const data = await fs.readFile(this.metadataFile, 'utf8');
        metadata = JSON.parse(data);
      } catch (error) {
        console.log('📝 No hay archivo de metadata para limpiar');
        return;
      }
      
      const now = new Date();
      let cleanedCount = 0;
      let expiredImages = [];

      for (const [filename, info] of Object.entries(metadata)) {
        // Check if image should be deleted (event date + 1 day has passed)
        if (info.deleteAfter && new Date(info.deleteAfter) < now) {
          try {
            const filePath = path.join(this.eventsDir, filename);
            
            // Check if file exists before trying to delete
            try {
              await fs.access(filePath);
              await fs.unlink(filePath);
              expiredImages.push(`${filename} (${info.title})`);
              cleanedCount++;
              console.log(`🗑️ Imagen eliminada después del evento: ${filename} - ${info.title}`);
            } catch (fileError) {
              // File doesn't exist, just remove from metadata
              console.log(`📝 Archivo ya no existe, removiendo de metadata: ${filename}`);
            }
            
            delete metadata[filename];
          } catch (deleteError) {
            console.error(`❌ Error eliminando ${filename}:`, deleteError);
          }
        }
      }

      // Also check for images without events (older than 7 days)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      for (const [filename, info] of Object.entries(metadata)) {
        if (!info.eventDate && new Date(info.savedAt) < sevenDaysAgo) {
          try {
            const filePath = path.join(this.eventsDir, filename);
            await fs.unlink(filePath);
            delete metadata[filename];
            cleanedCount++;
            console.log(`🗑️ Imagen antigua sin evento eliminada: ${filename}`);
          } catch (deleteError) {
            console.error(`❌ Error eliminando imagen antigua ${filename}:`, deleteError);
          }
        }
      }

      if (cleanedCount > 0) {
        await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
        console.log(`🧹 Limpieza completada: ${cleanedCount} imágenes eliminadas`);
        if (expiredImages.length > 0) {
          console.log(`📋 Eventos finalizados: ${expiredImages.join(', ')}`);
        }
      } else {
        console.log('🧹 No hay imágenes para limpiar');
      }

    } catch (error) {
      console.error('❌ Error en limpieza de imágenes:', error);
    }
  }

  async listStoredImages() {
    try {
      // Asegurar que el directorio existe
      await fs.mkdir(this.eventsDir, { recursive: true });
      
      let metadata = {};
      try {
        const data = await fs.readFile(this.metadataFile, 'utf8');
        metadata = JSON.parse(data);
      } catch (error) {
        console.log('📝 No hay imágenes almacenadas o archivo no existe');
        return {};
      }
      
      console.log('📋 Imágenes de eventos almacenadas:');
      for (const [filename, info] of Object.entries(metadata)) {
        console.log(`  - ${filename}: ${info.title} (guardada: ${info.savedAt})`);
        if (info.deleteAfter) {
          console.log(`    🗓️ Se eliminará después de: ${info.deleteAfter}`);
        }
      }

      return metadata;
    } catch (error) {
      console.log('📝 Error leyendo imágenes almacenadas:', error);
      return {};
    }
  }
}

export default EventImageManager;

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const imageUrls = {
  'posh-black-room-ii-anniversary': 'URL_DE_LA_IMAGEN_ANNIVERSARY_AQUI',
  'posh-veseli-presented-by-black-room': 'URL_DE_LA_IMAGEN_VESELI_AQUI'
};

const updateEventsWithImageUrls = () => {
  console.log('🎨 Agregando URLs de imágenes a los eventos...\n');
  
  const eventsPath = path.join(__dirname, '../db/events.json');
  const eventsData = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

  let updated = 0;

  eventsData.forEach(event => {
    if (imageUrls[event.id]) {
      event.imageUrl = imageUrls[event.id];
      console.log(`✅ ${event.title || event.name}`);
      console.log(`   → ${imageUrls[event.id]}\n`);
      updated++;
    }
  });

  fs.writeFileSync(eventsPath, JSON.stringify(eventsData, null, 2));
  
  console.log(`🎯 ${updated} eventos actualizados con imágenes!`);
};

updateEventsWithImageUrls();


class MusicGenreAnalyzer {
  constructor() {
    this.genrePatterns = {
      // Géneros principales de techno
      'hard techno': ['hard techno', 'hardtechno', 'hard tech', 'hard-techno', 'hardtech'],
      'hypnotic techno': ['hypnotic techno', 'hypnotic', 'deep techno', 'hypnotictechno', 'hypnotic-techno'],
      'industrial techno': ['industrial techno', 'industrial', 'schranz', 'industrialtechno', 'industrial-techno'],
      'acid techno': ['acid techno', 'acid', 'tb-303', 'acidtechno', 'acid-techno'],
      'minimal techno': ['minimal techno', 'minimal', 'minimalistic', 'minimaltechno', 'minimal-techno'],
      'peak time techno': ['peak time', 'peak-time', 'peaktime', 'peak time techno', 'peaktimetechno'],
      'driving techno': ['driving techno', 'driving', 'drivingtechno', 'driving-techno'],
      'melodic techno': ['melodic techno', 'melodic', 'melodictechno', 'melodic-techno'],
      'raw techno': ['raw techno', 'raw', 'rawtechno', 'raw-techno'],
      
      // Sub-géneros y estilos
      'hard groove': ['hard groove', 'hardgroove', 'groove', 'hard-groove', 'hardgrv', 'hard grv'],
      'tech house': ['tech house', 'techhouse', 'tech-house', 'techouse'],
      'progressive house': ['progressive house', 'progressive', 'progressivehouse', 'progressive-house', 'prog house'],
      'deep house': ['deep house', 'deep', 'deephouse', 'deep-house'],
      'tribal': ['tribal', 'tribal house', 'tribalhouse', 'tribal-house'],
      'breakbeat': ['breakbeat', 'breaks', 'break beat', 'break-beat'],
      'drum and bass': ['drum and bass', 'dnb', 'd&b', 'drumandbass', 'drum&bass'],
      'hardcore': ['hardcore', 'gabber', 'hard core', 'hard-core'],
      'trance': ['trance', 'uplifting trance', 'upliftingtrance', 'uplifting-trance'],
      
      // Estilos latinos y regionales
      'latin club': ['latin club', 'latin', 'latino', 'latinclub', 'latin-club'],
      'dub techno': ['dub techno', 'dub', 'dubtechno', 'dub-techno'],
      'afro house': ['afro house', 'afro', 'african', 'afrohouse', 'afro-house'],
      'uk garage': ['uk garage', 'garage', 'ukgarage', 'uk-garage', 'ukg'],
      
      // Características de sonido
      'dark': ['dark', 'dark techno', 'darkside', 'darktechno', 'dark-techno'],
      'underground': ['underground', 'undergrnd', 'under ground', 'under-ground'],
      'experimental': ['experimental', 'avant-garde', 'avant garde', 'experimental-techno'],
      'ambient': ['ambient', 'atmospheric', 'ambient techno', 'ambienttechno'],
      'psychedelic': ['psychedelic', 'psytrance', 'psy', 'psychedelic techno', 'psychedelictechno'],
      
      // Géneros adicionales comunes en Black Room
      'techno': ['techno', 'tech', 'tekno'],
      'house': ['house', 'hse'],
      'electronic': ['electronic', 'electro', 'electronic music'],
      'rave': ['rave', 'raving', 'rave music'],
      'club': ['club', 'clubbing', 'club music'],
      'dj set': ['dj set', 'djset', 'dj-set', 'live set', 'liveset'],
      'remix': ['remix', 'rmx', 'rework', 'edit'],
      'bootleg': ['bootleg', 'bootleg remix', 'unofficial'],
      'mashup': ['mashup', 'mash up', 'mash-up']
    };
    
    this.tempoKeywords = {
      'slow': ['slow', 'downtempo', 'chill'],
      'medium': ['medium', 'mid-tempo'],
      'fast': ['fast', 'uptempo', 'high energy'],
      'very fast': ['very fast', 'speedcore', 'gabber']
    };
    
    this.energyKeywords = {
      'low energy': ['chill', 'ambient', 'downtempo', 'relaxed'],
      'medium energy': ['groove', 'steady', 'flowing'],
      'high energy': ['energetic', 'intense', 'driving', 'powerful'],
      'extreme energy': ['hard', 'extreme', 'brutal', 'aggressive']
    };
    
    this.foundGenres = new Set();
    this.genreStats = {};
  }

  // Normalizar texto para mejor detección
  normalizeText(text) {
    if (!text) return '';
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Reemplazar caracteres especiales con espacios
      .replace(/\s+/g, ' ')     // Normalizar espacios múltiples
      .trim();
  }

  // Analizar título individual
  analyzeTitle(title) {
    if (!title) return [];
    
    const normalizedTitle = this.normalizeText(title);
    const foundGenres = [];
    
    // Buscar géneros en el título normalizado
    for (const [genre, patterns] of Object.entries(this.genrePatterns)) {
      let genreFound = false;
      
      for (const pattern of patterns) {
        const normalizedPattern = this.normalizeText(pattern);
        
        // Buscar coincidencia exacta o como palabra completa
        if (normalizedTitle.includes(normalizedPattern) || 
            normalizedTitle.includes(normalizedPattern.replace(/\s+/g, ''))) {
          foundGenres.push(genre);
          this.foundGenres.add(genre);
          this.updateGenreStats(genre);
          genreFound = true;
          break; // Solo agregar una vez por género
        }
      }
      
      if (genreFound) continue;
    }
    
    return foundGenres;
  }

  // Actualizar estadísticas de géneros
  updateGenreStats(genre) {
    if (this.genreStats[genre]) {
      this.genreStats[genre]++;
    } else {
      this.genreStats[genre] = 1;
    }
  }

  // Analizar colección completa de videos
  analyzeVideoCollection(videos) {
    console.log(`🎵 Analizando ${videos.length} videos para extraer géneros musicales...`);
    
    const results = {
      videoGenres: {},
      genreFrequency: {},
      recommendedFilters: [],
      genreHierarchy: {}
    };

    // Resetear estadísticas
    this.foundGenres.clear();
    this.genreStats = {};

    // Analizar cada video
    videos.forEach(video => {
      const title = video.snippet?.title || video.title || '';
      const videoId = video.snippet?.resourceId?.videoId || video.id?.videoId || video.id;
      
      if (videoId && title) {
        const genres = this.analyzeTitle(title);
        results.videoGenres[videoId] = {
          title: title,
          genres: genres,
          primaryGenre: genres[0] || 'unknown'
        };
      }
    });

    // Compilar estadísticas finales
    results.genreFrequency = { ...this.genreStats };
    results.recommendedFilters = this.generateRecommendedFilters();
    results.genreHierarchy = this.buildGenreHierarchy();

    console.log(`✅ Análisis completo: ${this.foundGenres.size} géneros únicos encontrados`);
    console.log(`📊 Top géneros:`, Object.entries(this.genreStats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([genre, count]) => `${genre}: ${count}`)
    );

    return results;
  }

  // Generar filtros recomendados basados en frecuencia
  generateRecommendedFilters() {
    // Términos genéricos a excluir de los filtros automáticos
    const excludeFromFilters = ['dj set', 'house', 'club', 'set', 'mix'];
    
    const sortedGenres = Object.entries(this.genreStats)
      .sort(([,a], [,b]) => b - a)
      .filter(([genre, count]) => {
        // Excluir términos genéricos y géneros con muy pocos videos
        return count >= 3 && !excludeFromFilters.includes(genre.toLowerCase());
      });

    return [
      { value: 'all', label: 'All Genres', count: Object.values(this.genreStats).reduce((a, b) => a + b, 0) },
      ...sortedGenres.map(([genre, count]) => ({
        value: genre,
        label: this.formatGenreLabel(genre),
        count: count
      }))
    ];
  }

  // Construir jerarquía de géneros
  buildGenreHierarchy() {
    const hierarchy = {
      'techno': [],
      'house': [],
      'experimental': [],
      'regional': [],
      'other': []
    };

    for (const genre of this.foundGenres) {
      if (genre.includes('techno')) {
        hierarchy.techno.push(genre);
      } else if (genre.includes('house')) {
        hierarchy.house.push(genre);
      } else if (['experimental', 'ambient', 'psychedelic'].some(k => genre.includes(k))) {
        hierarchy.experimental.push(genre);
      } else if (['latin', 'afro', 'uk'].some(k => genre.includes(k))) {
        hierarchy.regional.push(genre);
      } else {
        hierarchy.other.push(genre);
      }
    }

    return hierarchy;
  }

  // Formatear etiqueta de género para mostrar
  formatGenreLabel(genre) {
    return genre.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Buscar videos por género
  filterVideosByGenre(videos, targetGenre) {
    if (targetGenre === 'all') return videos;

    return videos.filter(video => {
      const title = video.snippet?.title || video.title || '';
      const genres = this.analyzeTitle(title);
      return genres.includes(targetGenre);
    });
  }

  // Buscar géneros similares
  findSimilarGenres(targetGenre) {
    const similar = [];
    
    for (const genre of this.foundGenres) {
      if (genre !== targetGenre) {
        const targetWords = targetGenre.split(' ');
        const genreWords = genre.split(' ');
        
        const commonWords = targetWords.filter(word => genreWords.includes(word));
        
        if (commonWords.length > 0) {
          similar.push({
            genre: genre,
            similarity: commonWords.length / Math.max(targetWords.length, genreWords.length)
          });
        }
      }
    }
    
    return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }

  // Obtener reporte completo
  generateReport() {
    return {
      totalGenres: this.foundGenres.size,
      totalVideosAnalyzed: Object.values(this.genreStats).reduce((a, b) => a + b, 0),
      mostPopularGenre: Object.entries(this.genreStats).sort(([,a], [,b]) => b - a)[0],
      genreDistribution: this.genreStats,
      recommendedFilters: this.generateRecommendedFilters()
    };
  }
}

// Hacer disponible globalmente
window.MusicGenreAnalyzer = MusicGenreAnalyzer;

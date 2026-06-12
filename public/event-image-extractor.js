
class EventImageExtractor {
  constructor() {
    console.log('🔧 EventImageExtractor initialized');
  }

  async extractCompleteEvent(url) {
    try {
      console.log('🔍 Extracting complete event data from:', url);

      const response = await fetch('/admin/extract-complete-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: url })
      });

      console.log('📥 Server response status:', response.status);
      console.log('📥 Server response headers:', Object.fromEntries(response.headers.entries()));

      let responseData;
      const responseText = await response.text();
      
      try {
        responseData = JSON.parse(responseText);
        console.log('📊 Server response data:', responseData);
      } catch (jsonError) {
        console.error('❌ Error parsing JSON response:', jsonError);
        console.log('📄 Raw server response:', responseText.substring(0, 500));
        throw new Error('El servidor no devolvió una respuesta JSON válida');
      }

      if (!response.ok) {
        const errorMessage = responseData.error || `HTTP ${response.status}: ${response.statusText}`;
        console.error('❌ Server returned error:', errorMessage);
        throw new Error(errorMessage);
      }

      if (!responseData.success) {
        const errorMessage = responseData.error || 'Error desconocido del servidor';
        console.error('❌ Server success=false:', errorMessage);
        throw new Error(errorMessage);
      }

      if (!responseData.data) {
        console.error('❌ No data in successful response:', responseData);
        throw new Error('El servidor no devolvió datos del evento');
      }

      console.log('✅ Event data extracted successfully:', responseData.data);
      return this.formatEventData(responseData.data);

    } catch (error) {
      console.error('❌ Error completo extracting event:', error);
      console.error('❌ Error stack:', error.stack);

      // Re-throw with more user-friendly message if needed
      if (error.message.includes('fetch')) {
        throw new Error('No se pudo conectar con el servidor. Verifica tu conexión.');
      } else if (error.message.includes('JSON')) {
        throw new Error('Error de comunicación con el servidor. Intenta nuevamente.');
      }

      throw error;
    }
  }

  async createCompleteEvent(eventData) {
    try {
      console.log('📝 Creating complete event:', eventData);

      const response = await fetch('/api/admin/create-complete-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Error creando evento');
      }

      console.log('✅ Event created successfully:', result);
      return result;

    } catch (error) {
      console.error('❌ Error creating complete event:', error);
      throw error;
    }
  }

  validateUrl(url) {
    if (!url || url.trim() === '') {
      throw new Error('URL requerida');
    }

    if (!url.includes('posh.vip')) {
      throw new Error('Debe ser un enlace de Posh.vip válido');
    }

    try {
      new URL(url.startsWith('http') ? url : 'https://' + url);
      return true;
    } catch (e) {
      throw new Error('URL inválida');
    }
  }

  formatEventData(rawData) {
    return {
      title: rawData.title || 'Evento sin título',
      name: rawData.name || rawData.title || 'Evento sin título',
      description: rawData.description || 'Get ready for an unforgettable night at Black Room',
      date: rawData.date || 'Por definir',
      location: rawData.location || 'Miami',
      price: rawData.price || 'Consultar precio',
      image: rawData.image || rawData.imageUrl,
      imageUrl: rawData.imageUrl || rawData.image,
      ticketLink: rawData.ticketLink,
      additionalInfo: rawData.additionalInfo || {}
    };
  }
}

// Export for use in admin.html
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventImageExtractor;
}

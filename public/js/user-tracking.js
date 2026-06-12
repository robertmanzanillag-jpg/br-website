// 📊 BLACK ROOM - SISTEMA DE TRACKING COMPLETO DE USUARIOS
// Este script captura automáticamente toda la actividad de los usuarios

class BlackRoomTracker {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.userId = this.getCurrentUserId();
        this.startTime = Date.now();
        this.lastActivity = Date.now();
        this.pageStartTime = Date.now();
        this.interactions = [];
        this.isTracking = true;
        
        this.deviceInfo = this.getDeviceInfo();
        this.sessionStarted = false;

        console.log('🎯 BlackRoom Tracker iniciado:', {
            sessionId: this.sessionId,
            userId: this.userId,
            device: this.deviceInfo
        });

        this.init();
    }

    // 🔄 Inicializar tracking
    init() {
        if (!this.isTracking) return;

        // Esperar a que el DOM esté listo
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.startTracking());
        } else {
            this.startTracking();
        }
    }

    // ▶️ Iniciar tracking completo
    async startTracking() {
        try {
            // Iniciar sesión si el usuario está logueado
            if (this.userId) {
                await this.startSession();
            }

            // Registrar vista de página
            await this.trackPageView();

            // Configurar event listeners
            this.setupEventListeners();

            // Tracking de tiempo en página
            this.startTimeTracking();

            console.log('✅ Tracking iniciado correctamente');

        } catch (error) {
            console.error('❌ Error iniciando tracking:', error);
        }
    }

    // 🆔 Generar ID único de sesión
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // 👤 Obtener ID del usuario actual (desde sessionStorage/localStorage o cookies)
    getCurrentUserId() {
        // Intentar obtener desde el DOM (si hay un elemento con user info)
        const userElement = document.querySelector('[data-user-email]');
        if (userElement) {
            return userElement.getAttribute('data-user-email');
        }

        // Intentar obtener desde sessionStorage
        const sessionUser = sessionStorage.getItem('currentUser');
        if (sessionUser) {
            try {
                const userData = JSON.parse(sessionUser);
                return userData.email || userData.id;
            } catch (e) {
                console.warn('Error parsing session user data');
            }
        }

        // Intentar obtener desde localStorage
        const localUser = localStorage.getItem('blackroom_user');
        if (localUser) {
            try {
                const userData = JSON.parse(localUser);
                return userData.email || userData.id;
            } catch (e) {
                console.warn('Error parsing local user data');
            }
        }

        // Intentar obtener desde las cookies
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'user_email' || name === 'blackroom_user') {
                return decodeURIComponent(value);
            }
        }

        return null; // Usuario anónimo
    }

    // 📱 Obtener información del dispositivo
    getDeviceInfo() {
        const ua = navigator.userAgent;
        let device = 'Desktop';
        let browser = 'Unknown';
        let os = 'Unknown';

        // Detectar dispositivo
        if (/Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
            device = 'Mobile';
            if (/iPad/i.test(ua)) device = 'Tablet';
        }

        // Detectar navegador
        if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Edge')) browser = 'Edge';
        else if (ua.includes('Opera')) browser = 'Opera';

        // Detectar OS
        if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac')) os = 'macOS';
        else if (ua.includes('Linux')) os = 'Linux';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

        return {
            type: device,
            browser: browser,
            os: os,
            screen: `${screen.width}x${screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            userAgent: ua
        };
    }

    // 🔄 Iniciar sesión
    async startSession() {
        if (this.sessionStarted || !this.userId) return;

        try {
            const sessionData = {
                userId: this.userId,
                sessionId: this.sessionId,
                startTime: new Date().toISOString(),
                deviceType: this.deviceInfo.type,
                browser: this.deviceInfo.browser,
                operatingSystem: this.deviceInfo.os,
                screenResolution: this.deviceInfo.screen,
                userAgent: this.deviceInfo.userAgent,
                referrerUrl: document.referrer || null,
                landingPage: window.location.pathname
            };

            const response = await fetch('/api/tracking/start-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(sessionData)
            });

            if (response.ok) {
                this.sessionStarted = true;
                console.log('✅ Sesión iniciada:', this.sessionId);
            }

        } catch (error) {
            console.warn('⚠️ Error iniciando sesión:', error);
        }
    }

    // 👁️ Registrar vista de página
    async trackPageView() {
        try {
            const pageData = {
                userId: this.userId,
                sessionId: this.sessionId,
                pageUrl: window.location.pathname,
                pageTitle: document.title,
                referrerUrl: document.referrer || null,
                timestamp: new Date().toISOString(),
                deviceType: this.deviceInfo.type,
                browser: this.deviceInfo.browser
            };

            const response = await fetch('/api/tracking/page-view', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(pageData)
            });

            if (response.ok) {
                console.log('👁️ Vista de página registrada:', window.location.pathname);
            }

        } catch (error) {
            console.warn('⚠️ Error registrando vista de página:', error);
        }
    }

    // 🎯 Registrar interacción
    async trackInteraction(type, data = {}) {
        if (!this.isTracking) return;

        try {
            const interaction = {
                userId: this.userId,
                sessionId: this.sessionId,
                interactionType: type,
                targetElement: data.element || null,
                targetText: data.text || null,
                targetUrl: data.url || null,
                pageUrl: window.location.pathname,
                timestamp: new Date().toISOString(),
                additionalData: data.extra || null
            };

            const response = await fetch('/api/tracking/interaction', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(interaction)
            });

            if (response.ok) {
                console.log(`🎯 Interacción registrada: ${type}`, data);
            }

        } catch (error) {
            console.warn('⚠️ Error registrando interacción:', error);
        }
    }

    // ⏱️ Registrar tiempo en página al salir
    async trackTimeOnPage() {
        if (!this.userId) return;

        try {
            const timeSpent = Math.round((Date.now() - this.pageStartTime) / 1000);
            
            const timeData = {
                userId: this.userId,
                sessionId: this.sessionId,
                pageUrl: window.location.pathname,
                timeSpentSeconds: timeSpent,
                timestamp: new Date().toISOString()
            };

            await fetch('/api/tracking/time-on-page', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(timeData)
            });

            console.log(`⏱️ Tiempo en página: ${timeSpent}s`);

        } catch (error) {
            console.warn('⚠️ Error registrando tiempo en página:', error);
        }
    }

    // 🎧 Configurar event listeners
    setupEventListeners() {
        // Clicks en enlaces
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link) {
                this.trackInteraction('link_click', {
                    element: link.className || 'link',
                    text: link.textContent.slice(0, 100),
                    url: link.href
                });
            }

            // Clicks en botones
            const button = e.target.closest('button');
            if (button) {
                this.trackInteraction('button_click', {
                    element: button.className || 'button',
                    text: button.textContent.slice(0, 100),
                    extra: { type: button.type || 'button' }
                });
            }

            // Clicks en eventos (si tienen data-event-id)
            const eventElement = e.target.closest('[data-event-id]');
            if (eventElement) {
                this.trackInteraction('event_view', {
                    element: 'event-card',
                    text: eventElement.querySelector('h3, .event-title')?.textContent || 'Evento',
                    extra: { eventId: eventElement.getAttribute('data-event-id') }
                });
            }

            // Clicks en videos (si tienen data-video-id)
            const videoElement = e.target.closest('[data-video-id]');
            if (videoElement) {
                this.trackInteraction('video_click', {
                    element: 'video-item',
                    text: videoElement.querySelector('.video-title')?.textContent || 'Video',
                    extra: { videoId: videoElement.getAttribute('data-video-id') }
                });
            }

            this.updateLastActivity();
        });

        // Envío de formularios
        document.addEventListener('submit', (e) => {
            const form = e.target;
            this.trackInteraction('form_submit', {
                element: form.className || 'form',
                text: form.id || 'form_submission',
                extra: { action: form.action, method: form.method }
            });
            this.updateLastActivity();
        });

        // Scroll tracking (throttled)
        let scrollTimer = null;
        let maxScroll = 0;
        document.addEventListener('scroll', () => {
            const scrollPercent = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
            if (scrollPercent > maxScroll) {
                maxScroll = scrollPercent;
                
                // Throttle scroll events
                clearTimeout(scrollTimer);
                scrollTimer = setTimeout(() => {
                    if (scrollPercent >= 75 && maxScroll >= 75) {
                        this.trackInteraction('scroll_deep', {
                            element: 'page',
                            extra: { scrollPercent: maxScroll }
                        });
                    }
                }, 2000);
            }
            this.updateLastActivity();
        });

        // Tiempo en página al salir
        window.addEventListener('beforeunload', () => {
            this.trackTimeOnPage();
        });

        // Detectar inactividad
        this.setupInactivityDetection();
    }

    // 🕐 Configurar detección de inactividad
    setupInactivityDetection() {
        const inactivityTime = 5 * 60 * 1000; // 5 minutos

        setInterval(() => {
            const timeSinceLastActivity = Date.now() - this.lastActivity;
            
            if (timeSinceLastActivity > inactivityTime && this.isTracking) {
                console.log('💤 Usuario inactivo, pausando tracking');
                this.isTracking = false;
                this.trackInteraction('user_inactive', {
                    extra: { inactiveTimeMinutes: Math.round(timeSinceLastActivity / 60000) }
                });
            }
        }, 60000); // Verificar cada minuto
    }

    // ⏱️ Iniciar tracking de tiempo
    startTimeTracking() {
        // Enviar heartbeat cada 30 segundos si el usuario está activo
        setInterval(() => {
            if (this.isTracking && (Date.now() - this.lastActivity) < 30000) {
                this.trackInteraction('heartbeat', {
                    extra: { timeOnPageMinutes: Math.round((Date.now() - this.pageStartTime) / 60000) }
                });
            }
        }, 30000);
    }

    // 🔄 Actualizar última actividad
    updateLastActivity() {
        this.lastActivity = Date.now();
        if (!this.isTracking) {
            console.log('🔄 Usuario volvió a estar activo, reanudando tracking');
            this.isTracking = true;
        }
    }

    // 🛑 Método para detener tracking (si es necesario)
    stopTracking() {
        this.isTracking = false;
        this.trackTimeOnPage();
        console.log('🛑 Tracking detenido');
    }
}

// 🚀 Auto-inicializar tracker cuando se carga el script
(() => {
    // Esperar un poco para asegurarse de que todo esté cargado
    setTimeout(() => {
        if (typeof window !== 'undefined' && !window.blackRoomTracker) {
            window.blackRoomTracker = new BlackRoomTracker();
            
            // Exponer métodos globales útiles
            window.trackCustomInteraction = (type, data) => {
                if (window.blackRoomTracker) {
                    window.blackRoomTracker.trackInteraction(type, data);
                }
            };

            // Para debugging
            window.getTrackerStatus = () => {
                if (window.blackRoomTracker) {
                    return {
                        userId: window.blackRoomTracker.userId,
                        sessionId: window.blackRoomTracker.sessionId,
                        isTracking: window.blackRoomTracker.isTracking,
                        timeOnPage: Math.round((Date.now() - window.blackRoomTracker.pageStartTime) / 1000)
                    };
                }
                return null;
            };
        }
    }, 500);
})();

// 📊 Console info para debugging
console.log(`
🎯 BLACK ROOM TRACKER v1.0
═══════════════════════════
• Tracking automático de usuarios habilitado
• Para ver estado: getTrackerStatus()  
• Para enviar evento custom: trackCustomInteraction(type, data)
• Para debugging: console del navegador
`);
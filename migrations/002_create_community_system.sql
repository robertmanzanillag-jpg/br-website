-- Black Room Community System Migration
-- Version: 002
-- Created: 2025-09-10

BEGIN;

-- Tabla de categorías para los posts
CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE,
    description TEXT,
    color VARCHAR(20) DEFAULT '#666666',
    icon VARCHAR(40) DEFAULT '💬',
    auto_approve BOOLEAN DEFAULT TRUE, -- Para moderación híbrida
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla principal de posts
CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    user_id INTEGER NOT NULL, -- Matches users_extended.id type
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    image_urls TEXT[], -- Array de URLs de imágenes
    video_embed_url TEXT, -- YouTube, TikTok, Instagram embeds
    spotify_embed TEXT, -- Spotify track/playlist
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
    is_featured BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    approved_at TIMESTAMPTZ,
    approved_by INTEGER, -- Admin user ID
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de comentarios (con threading)
CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    parent_comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT FALSE,
    like_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de reacciones (likes, fire, love, etc)
CREATE TABLE IF NOT EXISTS reactions (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    reaction_type VARCHAR(20) NOT NULL CHECK (reaction_type IN ('like', 'love', 'fire', 'mind_blown', 'eyes')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, user_id, reaction_type), -- Un usuario solo puede dar una reacción de cada tipo por post
    UNIQUE(comment_id, user_id, reaction_type), -- Un usuario solo puede dar una reacción de cada tipo por comment
    CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL)) -- Solo post o comment, no ambos
);

-- Tabla de reportes para moderación
CREATE TABLE IF NOT EXISTS reports (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    reporter_user_id INTEGER NOT NULL,
    reason VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    reviewed_by INTEGER, -- Admin user ID
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL)) -- Solo post o comment, no ambos
);

-- Tabla de seguidores (para notificaciones)
CREATE TABLE IF NOT EXISTS user_follows (
    id BIGSERIAL PRIMARY KEY,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(follower_id, following_id),
    CHECK (follower_id != following_id) -- Un usuario no se puede seguir a sí mismo
);

-- Tabla de notificaciones
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type VARCHAR(40) NOT NULL, -- 'comment', 'reaction', 'follow', 'post_approved', etc
    title VARCHAR(200) NOT NULL,
    message TEXT,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    from_user_id INTEGER, -- Usuario que generó la notificación
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para optimización
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_featured ON posts(is_featured);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category_status_created ON posts(category_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);

CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_reactions_comment ON reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_type ON reactions(reaction_type);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Insertar categorías predefinidas
INSERT INTO categories (name, description, color, icon, auto_approve, sort_order) VALUES
    ('Upcoming Events', 'Discusiones sobre eventos futuros', '#FF6B35', '🎉', FALSE, 1),
    ('Music Talk', 'Conversaciones sobre música techno', '#6B73FF', '🎵', TRUE, 2),
    ('Media Share', 'Fotos, videos y sets', '#35D9A0', '📸', FALSE, 3),
    ('General Chat', 'Conversación libre sobre cultura techno', '#FFB135', '💭', TRUE, 4),
    ('Feedback & Suggestions', 'Ideas para mejorar Black Room', '#FF35B0', '💡', TRUE, 5)
ON CONFLICT (name) DO NOTHING;

-- Triggers para mantener contadores actualizados
CREATE OR REPLACE FUNCTION update_post_counters() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Incrementar contador de comentarios
        UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Decrementar contador de comentarios
        UPDATE posts SET comment_count = comment_count - 1 WHERE id = OLD.post_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_like_counters() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.reaction_type = 'like' THEN
        IF NEW.post_id IS NOT NULL THEN
            UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
        ELSIF NEW.comment_id IS NOT NULL THEN
            UPDATE comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' AND OLD.reaction_type = 'like' THEN
        IF OLD.post_id IS NOT NULL THEN
            UPDATE posts SET like_count = like_count - 1 WHERE id = OLD.post_id;
        ELSIF OLD.comment_id IS NOT NULL THEN
            UPDATE comments SET like_count = like_count - 1 WHERE id = OLD.comment_id;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Crear triggers
CREATE TRIGGER trigger_update_post_counters
    AFTER INSERT OR DELETE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_post_counters();

CREATE TRIGGER trigger_update_like_counters
    AFTER INSERT OR DELETE ON reactions
    FOR EACH ROW EXECUTE FUNCTION update_like_counters();

-- Función para auto-aprovar posts según categoría
CREATE OR REPLACE FUNCTION auto_approve_posts() RETURNS TRIGGER AS $$
BEGIN
    -- Si la categoría tiene auto_approve = TRUE, aprobar automáticamente
    IF EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND auto_approve = TRUE) THEN
        NEW.status = 'approved';
        NEW.approved_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_approve_posts
    BEFORE INSERT ON posts
    FOR EACH ROW EXECUTE FUNCTION auto_approve_posts();

-- Comentarios sobre las tablas
COMMENT ON TABLE categories IS 'Categories for organizing community posts';
COMMENT ON TABLE posts IS 'Main community posts with hybrid moderation';
COMMENT ON TABLE comments IS 'Threaded comments on posts';
COMMENT ON TABLE reactions IS 'User reactions (like, fire, love) on posts and comments';
COMMENT ON TABLE reports IS 'User reports for moderation';
COMMENT ON TABLE user_follows IS 'User following relationships';
COMMENT ON TABLE notifications IS 'System notifications for users';

COMMIT;

-- Black Room Token System Migration
-- Version: 001
-- Created: 2024-12-16

BEGIN;

-- Tabla principal de tokens (prendas)
CREATE TABLE IF NOT EXISTS tokens (
    id BIGSERIAL PRIMARY KEY,
    token_code VARCHAR(24) UNIQUE NOT NULL,
    serial INTEGER NOT NULL,
    product VARCHAR(120) NOT NULL,
    drop_name VARCHAR(60) NOT NULL,
    variant VARCHAR(80),
    size VARCHAR(10),
    color VARCHAR(50),
    image_url TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'claimed')),
    owner_id BIGINT,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de lotes para organización
CREATE TABLE IF NOT EXISTS batches (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    product VARCHAR(120) NOT NULL,
    drop_name VARCHAR(60) NOT NULL,
    variant VARCHAR(80),
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relación de tokens con lotes
CREATE TABLE IF NOT EXISTS batch_items (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT REFERENCES batches(id) ON DELETE CASCADE,
    token_id BIGINT REFERENCES tokens(id) ON DELETE CASCADE
);

-- Logs de auditoría para claims
CREATE TABLE IF NOT EXISTS token_claims_log (
    id BIGSERIAL PRIMARY KEY,
    token_code VARCHAR(24) NOT NULL,
    user_id BIGINT,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para optimización
CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_code ON tokens(token_code);
CREATE INDEX IF NOT EXISTS idx_tokens_drop_variant_status ON tokens(drop_name, variant, status);
CREATE INDEX IF NOT EXISTS idx_tokens_serial ON tokens(serial);
CREATE INDEX IF NOT EXISTS idx_tokens_owner ON tokens(owner_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_claims_log_created ON token_claims_log(created_at);
CREATE INDEX IF NOT EXISTS idx_claims_log_token ON token_claims_log(token_code);
CREATE INDEX IF NOT EXISTS idx_claims_log_user ON token_claims_log(user_id);

-- Insert sample data for testing
INSERT INTO tokens (token_code, serial, product, drop_name, variant, size, color, image_url, status) 
VALUES 
    ('TEST-001', 1, 'T-Shirt', 'Season 1', 'Black Square', 'M', 'Black', 'https://via.placeholder.com/400x500/000000/ffffff?text=Black+Room+Tee', 'available'),
    ('TEST-002', 2, 'T-Shirt', 'Season 1', 'Black Square', 'L', 'Black', 'https://via.placeholder.com/400x500/000000/ffffff?text=Black+Room+Tee', 'available'),
    ('TEST-003', 3, 'Hoodie', 'Season 1', 'Red Square', 'M', 'Red', 'https://via.placeholder.com/400x500/ff0000/ffffff?text=Black+Room+Hoodie', 'available')
ON CONFLICT (token_code) DO NOTHING;

COMMENT ON TABLE tokens IS 'Main table storing individual token codes for garments';
COMMENT ON TABLE batches IS 'Groups of tokens created together for organization';
COMMENT ON TABLE batch_items IS 'Many-to-many relationship between batches and tokens';
COMMENT ON TABLE token_claims_log IS 'Audit log for all claim attempts';

COMMIT;

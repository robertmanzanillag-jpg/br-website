
# Black Room Token System (NFT Off-Chain)

Sistema de tokens de prendas tipo NFT off-chain para Black Room, implementado con QR genérico + código único por prenda.

## 🎯 Características Principales

- **QR Genérico**: Un solo QR apunta a `/claim` para todos los productos
- **Códigos Únicos**: Cada prenda tiene un código one-time use
- **Admin Wizard**: Generación masiva por rangos de seriales
- **Perfil de Usuario**: Colección personal con fichas compartibles
- **Exportación CSV**: Para fulfillment e imprenta
- **Auditoría**: Logs completos de intentos de claim

## 🏗️ Arquitectura

### Base de Datos (PostgreSQL)

```sql
-- Tokens principales (prendas)
tokens:
  - id, token_code (unique), serial, product, drop_name, variant
  - size, color, image_url, status, owner_id, claimed_at

-- Lotes para organización
batches:
  - id, name, product, drop_name, variant, image_url, created_at

-- Relación lotes-tokens
batch_items:
  - batch_id, token_id

-- Logs de auditoría
token_claims_log:
  - token_code, user_id, success, error_message, ip_address, created_at
```

### Stack Tecnológico

- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: HTML/CSS/JS vanilla (estilo Black Room dark)
- **Auth**: Reutiliza sistema de sesiones existente
- **DB**: pg (PostgreSQL driver)

## 🚀 Instalación y Setup

### 1. Variables de Entorno

```bash
# .env
DATABASE_URL=postgresql://username:password@localhost:5432/blackroom
SESSION_SECRET=your-session-secret-here
NODE_ENV=development
```

### 2. Ejecutar Migraciones

```bash
# Conectar a PostgreSQL y ejecutar:
psql -U username -d blackroom -f migrations/001_create_tokens_system.sql
```

### 3. Instalar Dependencias

```bash
npm install pg
```

## 📋 Uso del Sistema

### Admin: Crear Lote de Tokens

1. Ir a `/admin/tokens`
2. Completar formulario:
   - **Product**: T-Shirt, Hoodie, etc.
   - **Drop Name**: "Season 2"
   - **Variant**: "Red Square" (opcional)
   - **Serial From/To**: 250 → 300 (genera 51 tokens)
   - **Size/Color**: M, Black/Red
   - **Image URL**: foto del producto

3. Click "Create Batch"
4. Exportar CSV para fulfillment

### Fulfillment: Proceso de Envío

1. **Imprimir QR genérico** en todas las bolsas/etiquetas → URL `/claim`
2. **Serial en prenda**: visible en etiqueta interna (ej. #250)
3. **Tarjeta en bolsa**: con token_code del CSV (ej. "S2-RSQ-7GJ4KQ")
4. **Control de calidad**: probar 3-5 códigos que activen la prenda correcta

### Usuario: Reclamar Prenda

1. Escanear QR → redirige a `/claim`
2. Login si no está autenticado
3. Ingresar código de la tarjeta
4. Prenda aparece en `/me/tokens`
5. Ficha pública compartible en `/p/{code}`

## 🔧 API Endpoints

### Admin
```
GET    /admin/tokens              - Panel admin
GET    /admin/tokens/stats        - Estadísticas generales
GET    /admin/tokens/batches      - Lista de lotes
POST   /admin/tokens/batch        - Crear nuevo lote
GET    /admin/tokens/batch/:id/export.csv - Exportar CSV
```

### Claims
```
GET    /claim                     - Página de reclamación
POST   /claim                     - Procesar claim (requiere auth)
```

### Tokens de Usuario
```
GET    /me/tokens                 - Página de colección personal
GET    /api/me/tokens             - API de tokens del usuario
GET    /p/:code                   - Ficha pública del token
GET    /api/tokens/:code          - API pública del token
```

## 🔐 Seguridad

### Generación de Códigos
- **Alfabeto legible**: sin I, O, 1, 0 para evitar confusiones
- **Formato**: S2-RSQ-7GJ4KQ (prefijo + 6-8 chars)
- **Constraint UNIQUE** en base de datos
- **One-time use**: status cambia a 'claimed'

### Rate Limiting
- **Claims**: máximo 10 intentos por IP en 5 minutos
- **Logs de auditoría**: todos los intentos (exitosos y fallidos)

### Transacciones Atómicas
- **SELECT ... FOR UPDATE** previene doble reclamación
- **Rollback automático** en errores

## 🧪 Testing

### Criterios de Aceptación

1. **Crear lote 250→300**:
   ```bash
   curl -X POST /admin/tokens/batch \
     -H "Content-Type: application/json" \
     -d '{
       "product": "T-Shirt",
       "drop_name": "Season 2", 
       "variant": "Red Square",
       "serial_from": 250,
       "serial_to": 300,
       "size": "M",
       "color": "Black/Red"
     }'
   ```

2. **Exportar CSV**:
   ```bash
   curl /admin/tokens/batch/1/export.csv
   ```

3. **Claim exitoso**:
   ```bash
   curl -X POST /claim \
     -H "Content-Type: application/json" \
     -d '{"code": "S2-RSQ-7GJ4KQ"}'
   ```

4. **Claim duplicado** (debe fallar):
   ```bash
   curl -X POST /claim \
     -H "Content-Type: application/json" \
     -d '{"code": "S2-RSQ-7GJ4KQ"}'
   # Response: 409 "This code was already claimed"
   ```

### Tests Unitarios

```javascript
// Ejemplo de test de generación de código
import { generateTokenCode, validateTokenCode } from './utils/tokenGenerator.js';

test('generates valid token code', () => {
  const code = generateTokenCode('S2-RSQ', 6);
  expect(code).toMatch(/^S2-RSQ-[A-Z0-9]{6}$/);
  expect(validateTokenCode(code)).toBe(true);
});
```

## 📊 Métricas y Analytics

### Dashboard Admin
- Total tokens creados
- Tokens disponibles vs reclamados
- % de reclamación por drop/variant
- Usuarios únicos con tokens

### Logs de Auditoría
```sql
-- Claims por día
SELECT DATE(created_at) as date, 
       COUNT(*) as attempts,
       COUNT(CASE WHEN success THEN 1 END) as successful
FROM token_claims_log 
GROUP BY DATE(created_at) 
ORDER BY date DESC;

-- Códigos más problemáticos
SELECT token_code, COUNT(*) as failed_attempts
FROM token_claims_log 
WHERE success = false 
GROUP BY token_code 
HAVING COUNT(*) > 3;
```

## 🎨 UI/UX

### Estilo Black Room
- **Background**: negro (#000000) con imagen de fondo
- **Acentos**: blanco (#ffffff) con glow effects
- **Cards**: aspect ratio 4:5, hover effects
- **Buttons**: gradientes y animaciones suaves

### Responsive Design
- **Desktop**: grid de 3-4 columnas
- **Tablet**: grid de 2 columnas  
- **Mobile**: stack vertical, botones full-width

## 🔄 SOP de Fulfillment

### 1. Preparación
1. Admin crea lote en `/admin/tokens`
2. Exporta CSV con seriales y códigos
3. Envía CSV a imprenta/fulfillment

### 2. Producción
1. **QR genérico** se imprime igual en todas las bolsas
2. **Serial** va en etiqueta de prenda o viene de fábrica
3. **Token code** va en tarjeta dentro de bolsa/caja

### 3. Control de Calidad
1. Muestrear 3-5 paquetes aleatoriamente
2. Verificar que serial en prenda coincide con CSV
3. Probar código en tarjeta → debe activar prenda correcta
4. Guardar PDF/CSV final como respaldo

### 4. Ejemplo de CSV Export
```csv
serial,token_code,product,drop_name,variant,size,color,image_url,status
250,"S2-RSQ-7GJ4KQ","T-Shirt","Season 2","Red Square","M","Black/Red","https://...",available
251,"S2-RSQ-9HK3MP","T-Shirt","Season 2","Red Square","M","Black/Red","https://...",available
252,"S2-RSQ-2NQ8VX","T-Shirt","Season 2","Red Square","M","Black/Red","https://...",available
```

## 🐛 Troubleshooting

### Errores Comunes

1. **"Invalid code format"**
   - Verificar que no tenga I, O, 1, 0
   - Máximo 24 caracteres
   - Solo letras, números y guiones

2. **"Token not found"**
   - Code no existe en base de datos
   - Verificar typos en input del usuario

3. **"Already claimed"**
   - Token ya fue reclamado por otro usuario
   - Verificar en admin si hay duplicación en CSV

4. **Rate limit exceeded**
   - Usuario intentó muchas veces muy rápido
   - Esperar 5 minutos o contactar soporte

### Logs Útiles
```bash
# Ver intentos fallidos recientes
psql -c "SELECT * FROM token_claims_log WHERE success = false ORDER BY created_at DESC LIMIT 10;"

# Tokens más reclamados
psql -c "SELECT drop_name, variant, COUNT(*) FROM tokens WHERE status = 'claimed' GROUP BY drop_name, variant;"
```

## 🚀 Roadmap Futuro

### Features Potenciales
- **Transferencias**: permitir enviar tokens entre usuarios
- **Perks**: beneficios especiales por tener ciertos tokens
- **Marketplace**: compra/venta secundaria
- **Multi-chain**: migrar a blockchain real (Polygon, etc.)
- **AR/VR**: visualización 3D de prendas

### Optimizaciones
- **Cache Redis**: para stats y lookups frecuentes
- **CDN**: para imágenes de productos
- **Analytics**: Google Analytics + eventos custom
- **Push notifications**: nuevos drops, claims exitosos

---

## 📞 Soporte

Para soporte técnico del sistema de tokens:
- **Email**: dev@blackroom.com
- **Slack**: #dev-tokens
- **Issues**: GitHub repository

**Objetivo final**: Con una sola acción en admin (definir "T-Shirt / Season 2 / Red Square / serial 250→300"), el sistema debe generar 50 tokens y 50 códigos; fulfillment imprime serial en prenda y tarjeta con code en bolsa; el comprador escanea QR genérico → /claim, ingresa su code y la prenda aparece en My Pieces con ficha pública compartible.

const https = require('https');
const fs = require('fs');
const path = require('path');

const GALLERY_DIR = path.join(__dirname, '../public/images/gallery');

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = body.toString();
    
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } 
        catch { resolve({ error: 'parse_error', raw: data.slice(0, 200) }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Accept': 'application/vnd.api+json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destPath, token) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const urlObj = new URL(url);
    
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        downloadFile(res.headers.location, destPath, token).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', err => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

async function getToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN
  });
  const res = await httpsPost('https://accounts.zoho.com/oauth/v2/token', params);
  return res.access_token || null;
}

function sanitize(name) {
  return name.toLowerCase().replace(/[\/\\]/g, '-').replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function syncGallery() {
  console.log('🔄 Zoho Gallery Sync starting...');
  
  const token = await getToken();
  if (!token) { console.error('❌ No token'); return { success: false }; }
  console.log('✅ Token obtained');

  const teamsRes = await httpsGet('https://www.zohoapis.com/workdrive/api/v1/teams', token);
  const teams = teamsRes.data?.data || [];
  if (!teams.length) { console.error('No teams'); return { success: false }; }
  
  const teamId = teams[0].id;
  console.log('📁 Team:', teams[0].attributes?.name);

  const psRes = await httpsGet(`https://www.zohoapis.com/workdrive/api/v1/users/me/privatespace?team_id=${teamId}`, token);
  const privateSpace = psRes.data?.data;
  if (!privateSpace) { console.error('No private space'); return { success: false }; }

  const foldersRes = await httpsGet(`https://www.zohoapis.com/workdrive/api/v1/files/${privateSpace.id}/files`, token);
  const folders = foldersRes.data?.data || [];
  console.log(`Found ${folders.length} top-level folders`);

  let totalDownloaded = 0;
  const galleryEvents = [];

  for (const folder of folders) {
    const name = folder.attributes?.name;
    if (!folder.attributes?.is_folder) continue;
    
    console.log(`\n📂 ${name}`);
    
    const subRes = await httpsGet(`https://www.zohoapis.com/workdrive/api/v1/files/${folder.id}/files`, token);
    const subItems = subRes.data?.data || [];

    for (const sub of subItems) {
      const subName = sub.attributes?.name?.toLowerCase();
      if (!sub.attributes?.is_folder) continue;
      if (!subName?.includes('photo')) continue;

      console.log(`  📸 Found: ${sub.attributes.name}`);
      
      const localFolder = sanitize(name);
      const localPath = path.join(GALLERY_DIR, localFolder);
      if (!fs.existsSync(localPath)) fs.mkdirSync(localPath, { recursive: true });

      const photosRes = await httpsGet(`https://www.zohoapis.com/workdrive/api/v1/files/${sub.id}/files`, token);
      const photos = photosRes.data?.data || [];
      let count = 0;

      for (const photo of photos) {
        const pName = photo.attributes?.name;
        if (photo.attributes?.is_folder) continue;
        if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(pName)) continue;

        const dest = path.join(localPath, pName);
        if (fs.existsSync(dest)) { count++; continue; }

        try {
          console.log(`    ⬇️ ${pName}`);
          await downloadFile(`https://www.zohoapis.com/workdrive/api/v1/download/${photo.id}`, dest, token);
          totalDownloaded++;
          count++;
        } catch (e) { console.log(`    ❌ ${pName}: ${e.message}`); }
      }

      if (count > 0) {
        galleryEvents.push({ id: localFolder, title: name.toUpperCase(), folder: localFolder, date: '2025', location: 'Miami, FL' });
      }
    }
  }

  // Update gallery-events.json
  const galleryPath = path.join(__dirname, '../db/gallery-events.json');
  const existing = fs.existsSync(galleryPath) ? JSON.parse(fs.readFileSync(galleryPath)) : [];
  const existingIds = new Set(existing.map(e => e.id));
  const newEvents = galleryEvents.filter(e => !existingIds.has(e.id));
  if (newEvents.length) {
    fs.writeFileSync(galleryPath, JSON.stringify([...existing, ...newEvents], null, 2));
    console.log(`\n📝 Added ${newEvents.length} events`);
  }

  console.log(`\n✅ Done! Downloaded ${totalDownloaded} images`);
  return { success: true, downloaded: totalDownloaded };
}

syncGallery().then(r => console.log('Result:', r)).catch(e => console.error('Error:', e));

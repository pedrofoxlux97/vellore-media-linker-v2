const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, 'storage', 'arquivos');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'database.json');
const PORT = parseInt(process.env.PORT || '3001', 10);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PUBLIC_FILES_PATH = (process.env.PUBLIC_FILES_PATH || '/arquivos').replace(/\/$/, '');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '200', 10);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.jpg', '.jpeg', '.png', '.pdf', '.html']);
const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

async function ensureSetup() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(STORAGE_ROOT, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    await saveDb({ files: [], folders: [], audit: [] });
  }
}

async function readDb() {
  try {
    const text = await fsp.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return {
      files: Array.isArray(parsed.files) ? parsed.files : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : []
    };
  } catch {
    return { files: [], folders: [], audit: [] };
  }
}

async function saveDb(db) {
  await fsp.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sanitizeSegment(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .toLowerCase();
}

function sanitizeFolderPath(folderPath) {
  const raw = String(folderPath || '').replace(/\\/g, '/').trim();
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean).map(sanitizeSegment).filter(Boolean);
  return parts.join('/');
}

function ensureSafeSubPath(base, relativePath) {
  const target = path.resolve(base, relativePath);
  const normalizedBase = path.resolve(base) + path.sep;
  if (!(target + path.sep).startsWith(normalizedBase) && target !== path.resolve(base)) {
    throw new Error('Caminho inválido.');
  }
  return target;
}

function sanitizeFileName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const basename = path.basename(originalName || '', ext);
  const safeBase = sanitizeSegment(basename) || 'arquivo';
  return { ext, safeName: `${safeBase}${ext}` };
}

function uniqueFileName(fullDir, initialName) {
  let safeName = initialName;
  if (!fs.existsSync(path.join(fullDir, safeName))) return safeName;
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  safeName = `${base}-${stamp}${ext}`;
  if (!fs.existsSync(path.join(fullDir, safeName))) return safeName;
  return `${base}-${stamp}-${crypto.randomBytes(3).toString('hex')}${ext}`;
}

function makePublicUrl(folderPath, fileName) {
  const cleanFolder = sanitizeFolderPath(folderPath);
  const encodedParts = [PUBLIC_FILES_PATH]
    .concat(cleanFolder ? cleanFolder.split('/') : [])
    .concat(fileName ? [fileName] : [])
    .map((part, idx) => (idx === 0 ? part : encodeURIComponent(part)));
  return `${PUBLIC_BASE_URL}${encodedParts.join('/')}`;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
      if (body.length > MAX_UPLOAD_BYTES * 1.5) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function guessMime(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function serveFile(req, res, filePath) {
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile()) {
      sendText(res, 404, 'Arquivo não encontrado.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': guessMime(filePath),
      'Content-Length': stats.size,
      'Cache-Control': 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, 'Arquivo não encontrado.');
  }
}

function iconForExtension(ext) {
  switch (ext) {
    case '.mp4': return '🎬';
    case '.jpg':
    case '.jpeg':
    case '.png': return '🖼️';
    case '.pdf': return '📄';
    case '.html': return '🌐';
    default: return '📁';
  }
}

function summarizeDb(db) {
  const totalBytes = db.files.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
  return {
    totalFiles: db.files.length,
    totalFolders: db.folders.length,
    totalBytes,
    allowedExtensions: Array.from(ALLOWED_EXTENSIONS),
    publicBaseUrl: PUBLIC_BASE_URL,
    publicFilesPath: PUBLIC_FILES_PATH,
    maxUploadMb: MAX_UPLOAD_MB
  };
}

async function handleApi(req, res, urlObj) {
  const pathname = urlObj.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    const db = await readDb();
    return sendJson(res, 200, { ok: true, now: new Date().toISOString(), summary: summarizeDb(db) });
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, {
      publicBaseUrl: PUBLIC_BASE_URL,
      publicFilesPath: PUBLIC_FILES_PATH,
      maxUploadMb: MAX_UPLOAD_MB,
      allowedExtensions: Array.from(ALLOWED_EXTENSIONS)
    });
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const db = await readDb();
    const files = [...db.files].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
    return sendJson(res, 200, { summary: summarizeDb(db), recentFiles: files });
  }

  if (req.method === 'GET' && pathname === '/api/folders') {
    const db = await readDb();
    const folders = [...db.folders].sort((a, b) => a.fullPath.localeCompare(b.fullPath, 'pt-BR'));
    return sendJson(res, 200, { folders });
  }

  if (req.method === 'POST' && pathname === '/api/folders') {
    try {
      const body = await readJsonBody(req);
      const name = sanitizeSegment(body.name || '');
      const parentPath = sanitizeFolderPath(body.parentPath || '');
      const createdBy = String(body.createdBy || 'Usuário').trim().slice(0, 120) || 'Usuário';
      if (!name) return sendJson(res, 400, { error: 'Informe um nome válido para a pasta.' });
      const fullPath = [parentPath, name].filter(Boolean).join('/');
      const physicalPath = ensureSafeSubPath(STORAGE_ROOT, fullPath);
      const db = await readDb();
      if (db.folders.some(folder => folder.fullPath === fullPath)) {
        return sendJson(res, 409, { error: 'Essa pasta já existe.' });
      }
      await fsp.mkdir(physicalPath, { recursive: true });
      const folder = {
        id: crypto.randomUUID(),
        folderName: name,
        fullPath,
        createdBy,
        createdAt: new Date().toISOString()
      };
      db.folders.push(folder);
      db.audit.push({ id: crypto.randomUUID(), action: 'folder_created', createdAt: new Date().toISOString(), actor: createdBy, target: fullPath });
      await saveDb(db);
      return sendJson(res, 201, { folder });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || 'Erro ao criar pasta.' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/files') {
    const db = await readDb();
    const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
    const folder = sanitizeFolderPath(urlObj.searchParams.get('folder') || '');
    let files = [...db.files];
    if (folder) files = files.filter(item => item.folderPath === folder);
    if (q) {
      files = files.filter(item =>
        item.originalName.toLowerCase().includes(q) ||
        item.safeName.toLowerCase().includes(q) ||
        item.folderPath.toLowerCase().includes(q) ||
        (item.uploadedBy || '').toLowerCase().includes(q)
      );
    }
    files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { files });
  }

  if (req.method === 'POST' && pathname === '/api/files/upload') {
    try {
      const body = await readJsonBody(req);
      const originalName = String(body.originalName || '').trim();
      const folderPath = sanitizeFolderPath(body.folderPath || '');
      const uploadedBy = String(body.uploadedBy || 'Usuário').trim().slice(0, 120) || 'Usuário';
      const mimeType = String(body.mimeType || '').slice(0, 120);
      const base64 = String(body.base64 || '');
      if (!originalName) return sendJson(res, 400, { error: 'Nome do arquivo obrigatório.' });
      if (!base64) return sendJson(res, 400, { error: 'Conteúdo do arquivo obrigatório.' });
      const { ext, safeName: initialSafeName } = sanitizeFileName(originalName);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return sendJson(res, 400, { error: `Extensão não permitida. Permitidas: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}` });
      }
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length === 0) return sendJson(res, 400, { error: 'Arquivo vazio.' });
      if (buffer.length > MAX_UPLOAD_BYTES) return sendJson(res, 400, { error: `Arquivo excede o limite de ${MAX_UPLOAD_MB} MB.` });
      const fullDir = ensureSafeSubPath(STORAGE_ROOT, folderPath);
      await fsp.mkdir(fullDir, { recursive: true });
      const safeName = uniqueFileName(fullDir, initialSafeName);
      const fullPath = path.join(fullDir, safeName);
      await fsp.writeFile(fullPath, buffer);
      const relativePath = [folderPath, safeName].filter(Boolean).join('/');
      const publicUrl = makePublicUrl(folderPath, safeName);
      const db = await readDb();
      if (folderPath && !db.folders.some(folder => folder.fullPath === folderPath)) {
        db.folders.push({ id: crypto.randomUUID(), folderName: path.basename(folderPath), fullPath: folderPath, createdBy: uploadedBy, createdAt: new Date().toISOString() });
      }
      const file = {
        id: crypto.randomUUID(),
        originalName,
        safeName,
        extension: ext,
        mimeType: mimeType || guessMime(fullPath),
        sizeBytes: buffer.length,
        folderPath,
        relativePath,
        publicUrl,
        uploadedBy,
        icon: iconForExtension(ext),
        createdAt: new Date().toISOString()
      };
      db.files.push(file);
      db.audit.push({ id: crypto.randomUUID(), action: 'file_uploaded', createdAt: new Date().toISOString(), actor: uploadedBy, target: relativePath });
      await saveDb(db);
      return sendJson(res, 201, { file });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || 'Erro ao enviar arquivo.' });
    }
  }

  const fileIdMatch = pathname.match(/^\/api\/files\/([a-zA-Z0-9-]+)$/);
  if (req.method === 'DELETE' && fileIdMatch) {
    try {
      const fileId = fileIdMatch[1];
      const db = await readDb();
      const index = db.files.findIndex(item => item.id === fileId);
      if (index === -1) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
      const file = db.files[index];
      const physicalPath = ensureSafeSubPath(STORAGE_ROOT, file.relativePath);
      await fsp.rm(physicalPath, { force: true });
      db.files.splice(index, 1);
      db.audit.push({ id: crypto.randomUUID(), action: 'file_deleted', createdAt: new Date().toISOString(), actor: 'Sistema', target: file.relativePath });
      await saveDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || 'Erro ao excluir arquivo.' });
    }
  }

  if (req.method === 'PATCH' && fileIdMatch) {
    try {
      const fileId = fileIdMatch[1];
      const body = await readJsonBody(req);
      const newBaseName = sanitizeSegment(body.newBaseName || '');
      if (!newBaseName) return sendJson(res, 400, { error: 'Informe um nome válido.' });
      const db = await readDb();
      const file = db.files.find(item => item.id === fileId);
      if (!file) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
      const dir = ensureSafeSubPath(STORAGE_ROOT, file.folderPath);
      const newSafeName = uniqueFileName(dir, `${newBaseName}${file.extension}`);
      const oldPhysicalPath = ensureSafeSubPath(STORAGE_ROOT, file.relativePath);
      const newPhysicalPath = path.join(dir, newSafeName);
      await fsp.rename(oldPhysicalPath, newPhysicalPath);
      file.safeName = newSafeName;
      file.relativePath = [file.folderPath, newSafeName].filter(Boolean).join('/');
      file.publicUrl = makePublicUrl(file.folderPath, newSafeName);
      db.audit.push({ id: crypto.randomUUID(), action: 'file_renamed', createdAt: new Date().toISOString(), actor: 'Sistema', target: file.relativePath });
      await saveDb(db);
      return sendJson(res, 200, { file });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || 'Erro ao renomear arquivo.' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/audit') {
    const db = await readDb();
    const audit = [...db.audit].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
    return sendJson(res, 200, { audit });
  }

  return sendJson(res, 404, { error: 'Rota não encontrada.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `${PUBLIC_BASE_URL}`);
    const pathname = decodeURIComponent(urlObj.pathname);

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, urlObj);
    }

    if (pathname.startsWith(`${PUBLIC_FILES_PATH}/`) || pathname === PUBLIC_FILES_PATH) {
      const relative = pathname.slice(PUBLIC_FILES_PATH.length).replace(/^\//, '');
      const targetPath = ensureSafeSubPath(STORAGE_ROOT, relative);
      return await serveFile(req, res, targetPath);
    }

    let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
    filePath = ensureSafeSubPath(PUBLIC_DIR, path.relative(PUBLIC_DIR, filePath));

    if (fs.existsSync(filePath) && (await fsp.stat(filePath)).isFile()) {
      return await serveFile(req, res, filePath);
    }

    return sendText(res, 404, 'Página não encontrada.');
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Erro interno.' });
  }
});

ensureSetup().then(() => {
  server.listen(PORT, () => {
    console.log(`Vellore Media Linker V2 rodando em ${PUBLIC_BASE_URL}`);
    console.log(`Arquivos públicos em ${STORAGE_ROOT}`);
  });
}).catch((error) => {
  console.error('Falha ao iniciar:', error);
  process.exit(1);
});

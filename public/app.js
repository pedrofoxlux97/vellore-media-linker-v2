const state = {
  folders: [],
  files: [],
  config: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < sizes.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${sizes[index]}`;
}

function formatDate(value) {
  return new Date(value).toLocaleString('pt-BR');
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden', 'error');
  if (isError) toast.classList.add('error');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro na requisição.');
  return data;
}

function setActiveTab(tabName) {
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.id === `tab-${tabName}`));
}

function renderFolderOptions() {
  const options = ['<option value="">Raiz (/arquivos)</option>']
    .concat(state.folders.map(folder => `<option value="${folder.fullPath}">${folder.fullPath}</option>`))
    .join('');
  $('#folderPath').innerHTML = options;
  $('#parentFolder').innerHTML = options;
  $('#filterFolderFiles').innerHTML = '<option value="">Todas as pastas</option>' + state.folders.map(folder => `<option value="${folder.fullPath}">${folder.fullPath}</option>`).join('');
}

function renderFoldersList() {
  const el = $('#foldersList');
  if (!state.folders.length) {
    el.innerHTML = '<div class="empty-state">Nenhuma pasta cadastrada.</div>';
    return;
  }
  el.innerHTML = state.folders.map(folder => `
    <div class="list-item">
      <h3>📁 ${folder.fullPath}</h3>
      <div class="meta">Criada por ${folder.createdBy || 'Usuário'} em ${formatDate(folder.createdAt)}</div>
    </div>
  `).join('');
}

function fileActions(file) {
  return `
    <div class="inline-actions">
      <button onclick="copyText('${file.publicUrl.replace(/'/g, "\\'")}')">Copiar link</button>
      <a href="${file.publicUrl}" target="_blank" rel="noreferrer">Abrir</a>
      <button class="secondary" onclick="renameFile('${file.id}', '${file.safeName.replace(/'/g, "\\'")}')">Renomear</button>
      <button class="secondary" onclick="deleteFile('${file.id}')">Excluir</button>
    </div>
  `;
}

function previewFor(file) {
  if (['.jpg', '.jpeg', '.png'].includes(file.extension)) {
    return `<img class="preview-img" src="${file.publicUrl}" alt="${file.safeName}">`;
  }
  if (file.extension === '.mp4') {
    return `<video controls src="${file.publicUrl}"></video>`;
  }
  if (file.extension === '.pdf') {
    return `<iframe class="preview-frame" src="${file.publicUrl}"></iframe>`;
  }
  if (file.extension === '.html') {
    return `<iframe class="preview-frame" src="${file.publicUrl}"></iframe>`;
  }
  return '<div class="empty-state">Preview indisponível.</div>';
}

function renderUploadResult(file) {
  $('#uploadResult').innerHTML = `
    <div class="list-item">
      <h3>${file.icon} ${file.safeName}</h3>
      <div class="meta">Original: ${file.originalName}</div>
      <div class="meta">Pasta: /arquivos/${file.folderPath || ''}</div>
      <div class="meta">Link: <a href="${file.publicUrl}" target="_blank" rel="noreferrer">${file.publicUrl}</a></div>
      <div class="inline-actions">
        <button onclick="copyText('${file.publicUrl.replace(/'/g, "\\'")}')">Copiar link</button>
        <a href="${file.publicUrl}" target="_blank" rel="noreferrer">Abrir</a>
      </div>
      <div style="margin-top:14px">${previewFor(file)}</div>
    </div>
  `;
}

function renderFilesTable() {
  const el = $('#filesTable');
  if (!state.files.length) {
    el.innerHTML = '<div class="empty-state">Nenhum arquivo encontrado.</div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Arquivo</th>
          <th>Pasta</th>
          <th>Tamanho</th>
          <th>Usuário</th>
          <th>Data</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${state.files.map(file => `
          <tr>
            <td>
              <strong>${file.icon} ${file.safeName}</strong>
              <div class="muted small">Original: ${file.originalName}</div>
            </td>
            <td>${file.folderPath || '<span class="muted">raiz</span>'}</td>
            <td>${formatBytes(file.sizeBytes)}</td>
            <td>${file.uploadedBy || '-'}</td>
            <td>${formatDate(file.createdAt)}</td>
            <td>${fileActions(file)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderSummary(summary) {
  const cards = [
    { label: 'Arquivos', value: summary.totalFiles },
    { label: 'Pastas', value: summary.totalFolders },
    { label: 'Tamanho total', value: formatBytes(summary.totalBytes) },
    { label: 'Limite por upload', value: `${summary.maxUploadMb} MB` }
  ];
  $('#summaryCards').innerHTML = cards.map(item => `
    <div class="card">
      <div class="label">${item.label}</div>
      <div class="value">${item.value}</div>
    </div>
  `).join('');
}

function renderRecentFiles(files) {
  const el = $('#recentFiles');
  if (!files.length) {
    el.innerHTML = '<div class="empty-state">Nenhum upload recente.</div>';
    return;
  }
  el.innerHTML = files.map(file => `
    <div class="recent-item">
      <h3>${file.icon} ${file.safeName}</h3>
      <div class="meta">${file.folderPath || 'raiz'} · ${formatBytes(file.sizeBytes)}</div>
      <div class="meta">${formatDate(file.createdAt)}</div>
      ${fileActions(file)}
    </div>
  `).join('');
}

function renderAudit(audit) {
  const el = $('#auditList');
  if (!audit.length) {
    el.innerHTML = '<div class="empty-state">Sem registros.</div>';
    return;
  }
  el.innerHTML = audit.map(item => `
    <div class="list-item">
      <h3>${item.action}</h3>
      <div class="meta">${item.target}</div>
      <div class="meta">${item.actor || 'Sistema'} · ${formatDate(item.createdAt)}</div>
    </div>
  `).join('');
}

function updateSafeNamePreview() {
  const file = $('#fileInput').files[0];
  if (!file) {
    $('#safeNamePreview').value = '';
    return;
  }
  const name = file.name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .toLowerCase();
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
  $('#safeNamePreview').value = `${name || 'arquivo'}${ext}`;
}

async function loadConfig() {
  state.config = await api('/api/config', { headers: {} });
  $('#serverInfo').innerHTML = `Base pública:<br><strong>${state.config.publicBaseUrl}${state.config.publicFilesPath}</strong><br>Limite: ${state.config.maxUploadMb} MB`;
}

async function loadFolders() {
  const data = await api('/api/folders', { headers: {} });
  state.folders = data.folders;
  renderFolderOptions();
  renderFoldersList();
}

async function loadFiles() {
  const q = $('#searchFiles').value.trim();
  const folder = $('#filterFolderFiles').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (folder) params.set('folder', folder);
  const data = await api(`/api/files${params.toString() ? `?${params.toString()}` : ''}`, { headers: {} });
  state.files = data.files;
  renderFilesTable();
}

async function loadDashboard() {
  const data = await api('/api/dashboard', { headers: {} });
  renderSummary(data.summary);
  renderRecentFiles(data.recentFiles);
}

async function loadAudit() {
  const data = await api('/api/audit', { headers: {} });
  renderAudit(data.audit);
}

async function init() {
  await loadConfig();
  await loadFolders();
  await loadDashboard();
  await loadFiles();
  await loadAudit();
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function createFolder(event) {
  event.preventDefault();
  try {
    const payload = {
      name: $('#newFolderName').value,
      parentPath: $('#parentFolder').value,
      createdBy: $('#folderCreatedBy').value
    };
    await api('/api/folders', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    $('#newFolderName').value = '';
    showToast('Pasta criada com sucesso.');
    await loadFolders();
    await loadDashboard();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function uploadFile(event) {
  event.preventDefault();
  const file = $('#fileInput').files[0];
  if (!file) {
    showToast('Selecione um arquivo.', true);
    return;
  }
  try {
    const base64 = await fileToBase64(file);
    const payload = {
      originalName: file.name,
      folderPath: $('#folderPath').value,
      uploadedBy: $('#uploadedBy').value,
      mimeType: file.type,
      base64
    };
    const data = await api('/api/files/upload', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    renderUploadResult(data.file);
    $('#uploadForm').reset();
    $('#uploadedBy').value = payload.uploadedBy;
    updateSafeNamePreview();
    showToast('Upload concluído com sucesso.');
    await loadFolders();
    await loadDashboard();
    await loadFiles();
    await loadAudit();
    setActiveTab('upload');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteFile(id) {
  if (!confirm('Deseja excluir este arquivo?')) return;
  try {
    await api(`/api/files/${id}`, { method: 'DELETE' });
    showToast('Arquivo excluído.');
    await loadDashboard();
    await loadFiles();
    await loadAudit();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function renameFile(id, currentName) {
  const currentBase = currentName.replace(/\.[^.]+$/, '');
  const newBaseName = prompt('Novo nome do arquivo:', currentBase);
  if (!newBaseName) return;
  try {
    await api(`/api/files/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ newBaseName })
    });
    showToast('Arquivo renomeado.');
    await loadDashboard();
    await loadFiles();
    await loadAudit();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast('Link copiado.');
  } catch {
    showToast('Não foi possível copiar o link.', true);
  }
}

window.copyText = copyText;
window.deleteFile = deleteFile;
window.renameFile = renameFile;

$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
$('#folderForm').addEventListener('submit', createFolder);
$('#uploadForm').addEventListener('submit', uploadFile);
$('#fileInput').addEventListener('change', updateSafeNamePreview);
$('#clearUpload').addEventListener('click', () => {
  $('#uploadForm').reset();
  $('#uploadedBy').value = 'RH';
  updateSafeNamePreview();
});
$('#refreshDashboard').addEventListener('click', loadDashboard);
$('#refreshFolders').addEventListener('click', loadFolders);
$('#refreshFiles').addEventListener('click', loadFiles);
$('#refreshAudit').addEventListener('click', loadAudit);
$('#searchFiles').addEventListener('input', () => {
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(loadFiles, 250);
});
$('#filterFolderFiles').addEventListener('change', loadFiles);

init().catch(error => showToast(error.message, true));

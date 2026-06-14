// Side panel UI logic — IRIS Notices Extractor

let clients = [];
let runInProgress = false;
let allRunResults = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function appendLog(level, text) {
  const console = document.getElementById('logConsole');
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${now}</span><span class="log-${level}">${escHtml(text)}</span>`;
  console.appendChild(entry);
  console.scrollTop = console.scrollHeight;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progressBar').style.width = `${pct}%`;
  document.getElementById('progressText').textContent = `${current} / ${total} clients (${pct}%)`;
}

function setStatus(text) {
  document.getElementById('statusStrip').textContent = text;
}

function setRunning(active) {
  runInProgress = active;
  document.getElementById('startBtn').disabled = active || clients.length === 0;
  document.getElementById('stopBtn').disabled = !active;
  document.getElementById('exportBtn').disabled = active;
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"/, '').replace(/"$/, ''));

  const nameIdx = headers.findIndex(h => h === 'name');
  const ntnIdx  = headers.findIndex(h => ['ntn', 'cnic', 'reg', 'registration'].includes(h));

  if (nameIdx === -1 || ntnIdx === -1) {
    appendLog('err', 'CSV must have "Name" and "NTN" (or "CNIC" / "Reg") columns.');
    return [];
  }

  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"/, '').replace(/"$/, ''));
    const name = cols[nameIdx];
    const ntn  = cols[ntnIdx];
    if (name && ntn) result.push({ name, ntn });
  }
  return result;
}

// ─── CSV Drop Zone ────────────────────────────────────────────────────────────

const dropZone = document.getElementById('dropZone');
const csvFileInput = document.getElementById('csvFile');

dropZone.addEventListener('click', () => csvFileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleCsvFile(file);
});
csvFileInput.addEventListener('change', () => {
  if (csvFileInput.files[0]) handleCsvFile(csvFileInput.files[0]);
});

function handleCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    clients = parseCsv(e.target.result);
    document.getElementById('csvHint').textContent = file.name;
    const badge = document.getElementById('clientBadge');
    badge.textContent = `${clients.length} clients`;
    badge.style.display = clients.length > 0 ? 'inline-block' : 'none';
    if (clients.length > 0) {
      document.getElementById('startBtn').disabled = false;
      appendLog('ok', `Loaded ${clients.length} clients from ${file.name}`);
    }
  };
  reader.readAsText(file);
}

// ─── Settings persistence ─────────────────────────────────────────────────────

const apiKeyInput    = document.getElementById('apiKey');
const folderInput    = document.getElementById('folderPrefix');
const sectionSelect  = document.getElementById('sectionSelect');

chrome.storage.local.get(['irisNoticesApiKey', 'irisNoticesFolderPrefix', 'irisNoticesSection'], (data) => {
  if (data.irisNoticesApiKey)       apiKeyInput.value  = data.irisNoticesApiKey;
  if (data.irisNoticesFolderPrefix) folderInput.value  = data.irisNoticesFolderPrefix;
  if (data.irisNoticesSection)      sectionSelect.value = data.irisNoticesSection;
});

apiKeyInput.addEventListener('change', () => chrome.storage.local.set({ irisNoticesApiKey: apiKeyInput.value }));
folderInput.addEventListener('change', () => chrome.storage.local.set({ irisNoticesFolderPrefix: folderInput.value }));
sectionSelect.addEventListener('change', () => chrome.storage.local.set({ irisNoticesSection: sectionSelect.value }));

// ─── Dynamic Category Dropdown ────────────────────────────────────────────────

function populateCategories(categoryList) {
  const sel = document.getElementById('categoriesSelect');
  const currentValues = Array.from(sel.selectedOptions).map(o => o.value);

  // Keep existing options that aren't dynamic ones
  Array.from(sel.querySelectorAll('option:not([value="ALL"])')).forEach(o => o.remove());

  for (const cat of categoryList) {
    const opt = document.createElement('option');
    opt.value = cat.label;
    opt.textContent = `${cat.label} (${cat.count})`;
    if (currentValues.includes(cat.label)) opt.selected = true;
    sel.appendChild(opt);
  }
}

function getSelectedCategories() {
  const sel = document.getElementById('categoriesSelect');
  const selected = Array.from(sel.selectedOptions).map(o => o.value);
  if (selected.includes('ALL') || selected.length === 0) return ['ALL'];
  return selected;
}

// ─── Start / Stop ─────────────────────────────────────────────────────────────

document.getElementById('startBtn').addEventListener('click', async () => {
  if (clients.length === 0) { appendLog('err', 'Please load a CSV file first.'); return; }

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { appendLog('warn', 'No Claude API key — AI summaries will be skipped.'); }

  // Check for saved checkpoint
  const checkpoint = (await chrome.storage.local.get('irisNoticesCheckpoint')).irisNoticesCheckpoint;
  let startIndex = 0;
  if (checkpoint) {
    const resume = confirm(`Resume from client ${checkpoint.index + 1} (${checkpoint.clientNtn})?`);
    if (resume) startIndex = checkpoint.index;
    else await chrome.storage.local.remove('irisNoticesCheckpoint');
  }

  setRunning(true);
  setProgress(startIndex, clients.length);
  setStatus('Starting...');
  appendLog('info', `Starting extraction: ${clients.length} clients, section: ${sectionSelect.value}`);

  chrome.runtime.sendMessage({
    type: 'START_TO_CONTENT',
    clients,
    section: sectionSelect.value,
    selectedCategories: getSelectedCategories(),
    apiKey,
    folderPrefix: folderInput.value || 'IRIS_Notices',
    startIndex
  });
});

document.getElementById('stopBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_TO_CONTENT' });
  appendLog('warn', 'Stop requested — will stop after current notice...');
});

// ─── Export Portal Data ───────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', exportPortalData);

async function exportPortalData() {
  const results = (await chrome.storage.local.get('irisNoticesRunResults')).irisNoticesRunResults || [];

  const clientMap = {};
  let totalNotices = 0;
  let newThisRun = 0;

  for (const { client, notices } of results) {
    const key = client.ntn;
    if (!clientMap[key]) {
      clientMap[key] = { name: client.name, ntn: client.ntn, totalNotices: 0, newThisRun: 0, notices: [] };
    }
    for (const n of notices) {
      clientMap[key].notices.push(n);
      clientMap[key].totalNotices++;
      if (n.isNew) { clientMap[key].newThisRun++; newThisRun++; }
      totalNotices++;
    }
  }

  const exportData = {
    exportDate: new Date().toISOString(),
    runBy: 'S. Saeed Tax Consultants',
    totalClients: Object.keys(clientMap).length,
    totalNotices,
    newThisRun,
    clients: Object.values(clientMap)
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  chrome.downloads.download({
    url,
    filename: `_NOTICES_PORTAL_DATA_${date}.json`,
    saveAs: true
  });

  appendLog('ok', `Portal data exported: ${totalNotices} notices, ${Object.keys(clientMap).length} clients`);
}

// ─── Clear seen notices ───────────────────────────────────────────────────────

document.getElementById('clearSeenBtn').addEventListener('click', async () => {
  if (!confirm('Clear all seen-notices tracking? Next run will re-download everything.')) return;
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('notices_seen_'));
  await chrome.storage.local.remove(keys);
  appendLog('warn', `Cleared seen-notices registry (${keys.length} clients reset)`);
});

// ─── Clear log ────────────────────────────────────────────────────────────────

document.getElementById('clearLogBtn').addEventListener('click', () => {
  document.getElementById('logConsole').innerHTML = '';
});

// ─── Message handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'LOG':
      appendLog(message.level, message.text);
      break;

    case 'STATUS_UPDATE':
      setStatus(message.text);
      if (typeof message.current === 'number') setProgress(message.current + 1, message.total);
      break;

    case 'CATEGORIES_LOADED':
      populateCategories(message.categories);
      appendLog('info', `Categories loaded: ${message.categories.map(c => c.label).join(', ')}`);
      break;

    case 'CLIENT_RESULT':
      allRunResults.push({ client: message.client, notices: message.notices });
      appendLog('ok', `Client done: ${message.client.name} — ${message.notices.length} notice(s)`);
      break;

    case 'SAVE_SUMMARY_TXT': {
      const blob = new Blob([message.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({
        url,
        filename: `${message.folderPrefix || 'IRIS_Notices'}/${message.filename}`,
        saveAs: false
      });
      break;
    }

    case 'EXTRACT_PDF_TEXT':
      handlePdfExtract(message);
      break;

    case 'ALL_DONE':
      setRunning(false);
      setStatus('Done ✓');
      setProgress(clients.length, clients.length);
      appendLog('ok', 'All clients processed.');
      document.getElementById('exportBtn').disabled = false;
      break;
  }
});

async function handlePdfExtract(message) {
  // Try to read text from the downloaded PDF file via fetch
  // The downloaded file is on the local filesystem — we use the downloads API to get the path
  try {
    chrome.downloads.search({ id: message.downloadId }, async (results) => {
      if (!results || results.length === 0) return;
      const dl = results[0];
      const fileUrl = `file://${dl.filename}`;

      let text = null;
      try {
        text = await extractTextFromPdfUrl(fileUrl);
      } catch (e) {
        appendLog('warn', `PDF text extraction failed: ${e.message}`);
      }

      if (text && message.metadata && message.metadata.apiKey) {
        try {
          const summary = await generateNoticeSummary(text, message.metadata, message.metadata.apiKey);
          const blob = new Blob([summary], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          chrome.downloads.download({
            url,
            filename: `IRIS_Notices/${message.filename || 'summary'}.txt`,
            saveAs: false
          });
          appendLog('ok', `Summary saved for PDF notice`);
        } catch (e) {
          appendLog('err', `AI summary error: ${e.message}`);
        }
      }
    });
  } catch (e) {
    appendLog('err', `PDF handling error: ${e.message}`);
  }
}

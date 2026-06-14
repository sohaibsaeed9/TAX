// Routes messages between side panel and content script

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

let sidePanelPort = null;
let pendingPdfCapture = false;

// Side panel connects via port for reliable two-way messaging
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    sidePanelPort = port;
    port.onDisconnect.addListener(() => { sidePanelPort = null; });

    // Handle messages from side panel → content script
    port.onMessage.addListener((message) => {
      if (message.type === 'START_TO_CONTENT' || message.type === 'STOP_TO_CONTENT') {
        relayToPanel({ type: 'LOG', level: 'info', text: 'Looking for IRIS tab...' });
        chrome.tabs.query({}, (tabs) => {
          const allUrls = tabs.map(t => t.url).filter(Boolean);
          relayToPanel({ type: 'LOG', level: 'info', text: `Found ${tabs.length} tabs. URLs: ${allUrls.slice(0,5).join(' | ')}` });

          const irisTabs = tabs.filter(t =>
            t.url && (t.url.includes('iris.fbr.gov.pk') || t.url.includes('irisv1.fbr.gov.pk'))
          );

          if (irisTabs.length === 0) {
            relayToPanel({ type: 'LOG', level: 'err', text: 'No IRIS tab found. Please open iris.fbr.gov.pk and log in first.' });
            relayToPanel({ type: 'ALL_DONE', error: 'No IRIS tab' });
            return;
          }

          const irisTab = irisTabs[0];
          relayToPanel({ type: 'LOG', level: 'info', text: `Sending to tab ${irisTab.id}: ${irisTab.url}` });

          chrome.tabs.sendMessage(irisTab.id, message, (response) => {
            if (chrome.runtime.lastError) {
              // Content script not injected yet — inject it now then retry
              relayToPanel({ type: 'LOG', level: 'warn', text: 'Content script not found — injecting now...' });
              chrome.scripting.executeScript(
                { target: { tabId: irisTab.id }, files: ['content.js'] },
                () => {
                  if (chrome.runtime.lastError) {
                    relayToPanel({ type: 'LOG', level: 'err', text: `Inject failed: ${chrome.runtime.lastError.message}` });
                    relayToPanel({ type: 'ALL_DONE', error: 'Inject failed' });
                    return;
                  }
                  relayToPanel({ type: 'LOG', level: 'ok', text: 'Content script injected — retrying...' });
                  setTimeout(() => {
                    chrome.tabs.sendMessage(irisTab.id, message, (r2) => {
                      if (chrome.runtime.lastError) {
                        relayToPanel({ type: 'LOG', level: 'err', text: `Still failed: ${chrome.runtime.lastError.message}` });
                        relayToPanel({ type: 'ALL_DONE', error: 'Failed after inject' });
                      } else {
                        relayToPanel({ type: 'LOG', level: 'ok', text: 'Content script running!' });
                      }
                    });
                  }, 500);
                }
              );
            } else {
              relayToPanel({ type: 'LOG', level: 'ok', text: 'Content script acknowledged — running...' });
            }
          });
        });
      }

      if (message.type === 'EXPECT_PDF_DOWNLOAD') {
        pendingPdfCapture = true;
      }

      if (message.type === 'INSPECT_PAGE') {
        chrome.tabs.query({}, (tabs) => {
          const irisTabs = tabs.filter(t => t.url && t.url.includes('iris.fbr.gov.pk'));
          if (irisTabs.length === 0) {
            relayToPanel({ type: 'LOG', level: 'err', text: 'No IRIS tab found to inspect.' });
            return;
          }
          chrome.scripting.executeScript({
            target: { tabId: irisTabs[0].id },
            func: inspectIrisPage
          }, (results) => {
            if (chrome.runtime.lastError) {
              relayToPanel({ type: 'LOG', level: 'err', text: 'Inspect failed: ' + chrome.runtime.lastError.message });
              return;
            }
            const report = results?.[0]?.result;
            if (report) {
              for (const line of report) {
                relayToPanel({ type: 'LOG', level: 'info', text: line });
              }
            }
          });
        });
      }
    });
  }
});

// Relay a message to the side panel via port
function relayToPanel(message) {
  if (sidePanelPort) {
    try { sidePanelPort.postMessage(message); } catch (e) {}
  }
}

// Inspector function — injected into IRIS tab to map all key elements
function inspectIrisPage() {
  const lines = [];
  const tag = (el) => {
    if (!el) return 'null';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `<${el.tagName.toLowerCase()}${id}${cls}>`;
  };

  // 1. FILTERS button
  lines.push('─── FILTERS BUTTON ───');
  const filterBtns = Array.from(document.querySelectorAll('button, a')).filter(
    el => el.textContent.trim().toLowerCase().includes('filter') && el.offsetParent
  );
  filterBtns.forEach(el => lines.push(`  ${tag(el)} text="${el.textContent.trim().substring(0,30)}"`));

  // 2. Section tabs (Inbox / Draft / Outbox / Completed)
  lines.push('─── SECTION TABS ───');
  ['inbox', 'draft', 'outbox', 'completed'].forEach(kw => {
    const matches = Array.from(document.querySelectorAll('a, button, li, div, span')).filter(el => {
      const t = el.textContent.trim().toLowerCase();
      return t.includes(kw) && t.length < 60 && el.offsetParent;
    }).sort((a, b) => a.textContent.length - b.textContent.length);
    if (matches.length > 0) {
      const el = matches[0];
      lines.push(`  [${kw}] ${tag(el)} text="${el.textContent.trim().substring(0,40)}"`);
    } else {
      lines.push(`  [${kw}] NOT FOUND`);
    }
  });

  // 3. Category tabs (elements with pattern "TEXT (NUMBER)")
  lines.push('─── CATEGORY TABS ───');
  const catEls = Array.from(document.querySelectorAll('*')).filter(el => {
    return /^[A-Z\s\/]+\s*\(\d+\)$/.test(el.textContent.trim()) && el.offsetParent;
  });
  catEls.slice(0, 8).forEach(el => lines.push(`  ${tag(el)} text="${el.textContent.trim()}"`));
  if (catEls.length === 0) lines.push('  No category tabs found (apply filter first)');

  // 4. ALL inputs (to find Registration No)
  lines.push('─── ALL INPUTS ───');
  const regInputs = Array.from(document.querySelectorAll('input'));
  if (regInputs.length === 0) lines.push('  No inputs found (open filter panel first)');
  regInputs.slice(0, 10).forEach(el => {
    const label = document.querySelector(`label[for="${el.id}"]`);
    const visible = el.offsetParent !== null ? 'visible' : 'hidden';
    lines.push(`  ${tag(el)} type="${el.type}" placeholder="${el.placeholder}" id="${el.id}" label="${label?.textContent.trim() || 'n/a'}" [${visible}]`);
  });

  // 5. APPLY / CLEAR buttons
  lines.push('─── APPLY / CLEAR ───');
  ['apply', 'clear'].forEach(kw => {
    const btn = Array.from(document.querySelectorAll('button, a')).find(
      el => el.textContent.trim().toLowerCase().includes(kw) && el.offsetParent
    );
    if (btn) lines.push(`  [${kw}] ${tag(btn)} text="${btn.textContent.trim()}"`);
    else lines.push(`  [${kw}] NOT FOUND`);
  });

  // 6. Notice table rows
  lines.push('─── NOTICE TABLE ───');
  const tables = document.querySelectorAll('table');
  lines.push(`  Tables found: ${tables.length}`);
  tables.forEach((t, i) => {
    const rows = t.querySelectorAll('tbody tr');
    lines.push(`  Table[${i}] rows=${rows.length} class="${t.className?.substring(0,30)}"`);
  });

  // 7. View (eye) buttons
  lines.push('─── VIEW BUTTONS ───');
  const viewBtns = Array.from(document.querySelectorAll('a, button')).filter(el => {
    const t = (el.textContent + (el.title || '') + (el.getAttribute('aria-label') || '')).toLowerCase();
    return (t.includes('view') || t.includes('👁')) && el.offsetParent;
  });
  viewBtns.slice(0, 3).forEach(el => lines.push(`  ${tag(el)} text="${el.textContent.trim().substring(0,20)}" title="${el.title}"`));
  if (viewBtns.length === 0) lines.push('  None (open a notice list first)');

  return lines;
}

// Forward messages from content script → side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.tab) {
    relayToPanel(message);
  }
  sendResponse({ ok: true });
  return true;
});

// Intercept PDF downloads triggered by the IRIS Print button
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!pendingPdfCapture) return;
  const name = downloadItem.filename || '';
  const isTaxPdf = name.includes('Taxpayer_Correspondence') || name.toLowerCase().includes('iris');
  if (!isTaxPdf) return;

  pendingPdfCapture = false;

  const checkComplete = setInterval(() => {
    chrome.downloads.search({ id: downloadItem.id }, (results) => {
      if (!results || results.length === 0) return;
      const dl = results[0];
      if (dl.state === 'complete') {
        clearInterval(checkComplete);
        chrome.tabs.query({}, (tabs) => {
          const irisTabs = tabs.filter(t => t.url && t.url.includes('iris'));
          if (irisTabs.length > 0) {
            chrome.tabs.sendMessage(irisTabs[0].id, {
              type: 'PDF_DOWNLOADED',
              downloadId: downloadItem.id,
              filename: dl.filename
            });
          }
        });
      } else if (dl.state === 'interrupted') {
        clearInterval(checkComplete);
        relayToPanel({ type: 'LOG', level: 'err', text: 'PDF download interrupted.' });
      }
    });
  }, 500);
});

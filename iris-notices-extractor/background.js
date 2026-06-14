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
              relayToPanel({ type: 'LOG', level: 'err', text: `Content script error: ${chrome.runtime.lastError.message}. Please REFRESH the IRIS tab then try again.` });
              relayToPanel({ type: 'ALL_DONE', error: 'Content script not ready' });
            } else {
              relayToPanel({ type: 'LOG', level: 'ok', text: 'Content script acknowledged — running...' });
            }
          });
        });
      }

      if (message.type === 'EXPECT_PDF_DOWNLOAD') {
        pendingPdfCapture = true;
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

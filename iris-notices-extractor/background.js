// Routes messages between side panel and content script
// Also intercepts PDF downloads triggered by the Print button in IRIS

let sidePanelPort = null;
let pendingPdfCapture = false;

// Track connections from side panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    sidePanelPort = port;
    port.onDisconnect.addListener(() => { sidePanelPort = null; });
  }
});

// Message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_TO_CONTENT') {
    // Forward to content script in the active IRIS tab
    chrome.tabs.query({ url: ['https://iris.fbr.gov.pk/*', 'https://irisv1.fbr.gov.pk/*'] }, (tabs) => {
      if (tabs.length === 0) {
        chrome.runtime.sendMessage({ type: 'LOG', level: 'err', text: 'No IRIS tab found. Please open iris.fbr.gov.pk first.' });
        return;
      }
      const irisTab = tabs[0];
      chrome.tabs.sendMessage(irisTab.id, message);
    });
  }

  if (message.type === 'STOP_TO_CONTENT') {
    chrome.tabs.query({ url: ['https://iris.fbr.gov.pk/*', 'https://irisv1.fbr.gov.pk/*'] }, (tabs) => {
      if (tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, message);
    });
  }

  if (message.type === 'EXPECT_PDF_DOWNLOAD') {
    pendingPdfCapture = true;
    sendResponse({ ok: true });
  }

  // Forward all other messages from content script to side panel
  if (sender.tab && [
    'LOG', 'STATUS_UPDATE', 'CATEGORIES_LOADED', 'CLIENT_RESULT',
    'ALL_DONE', 'SAVE_NOTICE_PDF', 'SAVE_SUMMARY_TXT', 'PDF_READY'
  ].includes(message.type)) {
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  return true;
});

// Intercept PDF downloads from IRIS Print button
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!pendingPdfCapture) return;
  const isTaxPdf = downloadItem.filename.includes('Taxpayer_Correspondence') ||
                   (downloadItem.url && downloadItem.url.includes('iris'));
  if (!isTaxPdf) return;

  pendingPdfCapture = false;

  // Wait for download to complete then read the file
  const checkComplete = setInterval(() => {
    chrome.downloads.search({ id: downloadItem.id }, (results) => {
      if (!results || results.length === 0) return;
      const dl = results[0];
      if (dl.state === 'complete') {
        clearInterval(checkComplete);
        // Notify content script that the PDF downloaded
        chrome.tabs.query({ url: ['https://iris.fbr.gov.pk/*', 'https://irisv1.fbr.gov.pk/*'] }, (tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'PDF_DOWNLOADED',
              downloadId: downloadItem.id,
              filename: dl.filename
            });
          }
        });
      } else if (dl.state === 'interrupted') {
        clearInterval(checkComplete);
        chrome.runtime.sendMessage({ type: 'LOG', level: 'err', text: 'PDF download interrupted.' }).catch(() => {});
      }
    });
  }, 500);
});

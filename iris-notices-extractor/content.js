// IRIS Notices Extractor — Content Script
// Runs on iris.fbr.gov.pk and irisv1.fbr.gov.pk

const T_S  = 800;
const T_M  = 1800;
const T_L  = 3000;
const T_XL = 5000;

let runInProgress = false;
let stopRequested = false;
let currentPdfResolve = null;

// ─── Utilities ────────────────────────────────────────────────────────────────

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(level, text) {
  chrome.runtime.sendMessage({ type: 'LOG', level, text });
}

function status(text, current, total) {
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', text, current, total });
}

// React-compatible input fill
function fill(el, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('focus', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('keyup', { bubbles: true }));
}

function findButtonByText(text) {
  return Array.from(document.querySelectorAll('button, a')).find(
    el => el.textContent.trim().toLowerCase().includes(text.toLowerCase())
  );
}

async function waitFor(selectorOrFn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = typeof selectorOrFn === 'function' ? selectorOrFn() : document.querySelector(selectorOrFn);
    if (el) return el;
    await wait(300);
  }
  return null;
}

async function waitForDomChange(timeout = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      observer.disconnect();
      setTimeout(resolve, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ─── Filter Modal ─────────────────────────────────────────────────────────────

async function clickFilters() {
  const btn = Array.from(document.querySelectorAll('button, a, span')).find(
    el => el.textContent.trim().toUpperCase() === 'FILTERS' ||
          el.textContent.trim().toUpperCase().includes('FILTER')
  );
  if (!btn) throw new Error('FILTERS button not found');
  btn.click();
  await wait(T_L);
}

async function fillRegistrationNo(ntn) {
  const modal = await waitFor(() => document.querySelector('.ui-dialog, [role="dialog"], .modal'));
  if (!modal) throw new Error('Filter modal did not open');

  // Find the Registration No input
  const inputs = modal.querySelectorAll('input[type="text"], input:not([type])');
  let regInput = null;

  // Try label-based lookup
  const labels = modal.querySelectorAll('label');
  for (const label of labels) {
    if (label.textContent.toLowerCase().includes('registration') ||
        label.textContent.toLowerCase().includes('reg no')) {
      const id = label.getAttribute('for');
      if (id) regInput = modal.querySelector(`#${id}`);
      if (!regInput) regInput = label.nextElementSibling?.querySelector('input') || label.parentElement?.querySelector('input');
      break;
    }
  }

  // Fallback: first text input in modal
  if (!regInput && inputs.length > 0) regInput = inputs[0];
  if (!regInput) throw new Error('Registration No input not found in filter modal');

  fill(regInput, ntn);
  await wait(T_S);
}

async function clickApply() {
  const btn = Array.from(document.querySelectorAll('button, a')).find(
    el => el.textContent.trim().toUpperCase() === 'APPLY'
  );
  if (!btn) throw new Error('APPLY button not found');
  btn.click();
  await wait(T_XL);
}

async function clearFilter() {
  const btn = Array.from(document.querySelectorAll('button, a')).find(
    el => el.textContent.trim().toUpperCase() === 'CLEAR'
  );
  if (btn) { btn.click(); await wait(T_S); }
}

// ─── Client Verification ──────────────────────────────────────────────────────

async function verifyClientLoaded(expectedNtn, maxAttempts = 3) {
  const ntnClean = expectedNtn.replace(/[^A-Z0-9]/gi, '');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await wait(T_L);
    const pageText = document.body.innerText;
    if (pageText.includes(ntnClean) || pageText.includes(expectedNtn)) return true;
    log('warn', `Client verification attempt ${attempt + 1} failed — retrying filter...`);
    try {
      await clickFilters();
      await fillRegistrationNo(expectedNtn);
      await clickApply();
    } catch (e) {
      log('err', `Retry filter error: ${e.message}`);
    }
  }
  return false;
}

// ─── Section Tabs ─────────────────────────────────────────────────────────────

const SECTION_LABELS = {
  'Inbox': ['inbox'],
  'Draft': ['draft'],
  'Outbox': ['outbox'],
  'Completed Tasks': ['completed', 'completed tasks']
};

async function clickSectionTab(section) {
  const keywords = SECTION_LABELS[section] || [section.toLowerCase()];
  const tabs = document.querySelectorAll('[role="tab"], .ui-tabs-header li, .tab-header, li[class*="tab"]');

  let found = null;
  for (const tab of tabs) {
    const text = tab.textContent.trim().toLowerCase();
    if (keywords.some(k => text.includes(k))) { found = tab; break; }
  }

  if (!found) {
    // Broader search
    found = Array.from(document.querySelectorAll('a, button, li, span')).find(
      el => keywords.some(k => el.textContent.trim().toLowerCase() === k)
    );
  }

  if (!found) throw new Error(`Section tab "${section}" not found`);
  found.click();
  await wait(T_L);
}

// ─── Category Tabs ────────────────────────────────────────────────────────────

function readCategories() {
  const categories = [];
  const tabEls = document.querySelectorAll('[role="tab"], .category-tab, li[class*="tab"]');

  for (const el of tabEls) {
    const text = el.textContent.trim();
    const match = text.match(/^(.+?)\s*\((\d+)\)$/);
    if (match) {
      categories.push({
        label: match[1].trim().toUpperCase(),
        count: parseInt(match[2], 10),
        element: el
      });
    }
  }

  // If no tabs with counts found, try a broader approach
  if (categories.length === 0) {
    const allEls = document.querySelectorAll('a, button, li, span, div');
    for (const el of allEls) {
      const text = el.textContent.trim();
      const match = text.match(/^([A-Z][A-Z\s\/]+[A-Z])\s*\((\d+)\)$/);
      if (match && !categories.find(c => c.label === match[1].trim())) {
        categories.push({
          label: match[1].trim(),
          count: parseInt(match[2], 10),
          element: el
        });
      }
    }
  }

  return categories;
}

async function clickCategoryTab(categoryLabel) {
  const tabs = readCategories();
  const tab = tabs.find(t => t.label === categoryLabel.toUpperCase());
  if (!tab) {
    // Try clicking by text search
    const el = Array.from(document.querySelectorAll('[role="tab"], li, a, button')).find(
      el => el.textContent.trim().toUpperCase().includes(categoryLabel.toUpperCase())
    );
    if (!el) throw new Error(`Category tab "${categoryLabel}" not found`);
    el.click();
  } else {
    tab.element.click();
  }
  await wait(T_M);
}

// ─── Notice Table ─────────────────────────────────────────────────────────────

function parseNoticeRows() {
  const rows = [];
  const table = document.querySelector('table.ui-datatable-data, table[class*="notice"], .ui-datatable table, table');
  if (!table) return rows;

  const trs = table.querySelectorAll('tbody tr');
  for (const tr of trs) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 4) continue;

    // Column order: Task | Client Name | Reg No | Period | Tax Year | Due Date | Action
    const taskCell = tds[0]?.textContent.trim() || '';
    const clientName = tds[1]?.textContent.trim() || '';
    const regNo = tds[2]?.textContent.trim() || '';
    const period = tds[3]?.textContent.trim() || '';
    const taxYear = tds[4]?.textContent.trim() || '';
    const dueDate = tds[5]?.textContent.trim() || '';

    // Find View button in last cell
    const viewBtn = tr.querySelector('a[title*="view" i], button[title*="view" i], a[aria-label*="view" i], .view-btn, [class*="view"]');

    if (taskCell) {
      rows.push({ taskName: taskCell, clientName, regNo, period, taxYear, dueDate, viewBtn, tr });
    }
  }
  return rows;
}

function getNextPageButton() {
  return document.querySelector('.ui-paginator-next:not(.ui-state-disabled), [aria-label="Next Page"]:not([disabled]), .paginator-next:not(.disabled)');
}

// ─── Notice Detail ────────────────────────────────────────────────────────────

async function readNoticeDetail() {
  await wait(T_L);

  const readField = (label) => {
    const els = document.querySelectorAll('label, th, td, span, div');
    for (const el of els) {
      if (el.textContent.trim().toLowerCase().includes(label.toLowerCase())) {
        const sibling = el.nextElementSibling || el.parentElement?.nextElementSibling;
        if (sibling) return sibling.textContent.trim();
      }
    }
    return '';
  };

  const fields = {
    task:            readField('Task'),
    transactionDate: readField('Transaction Date'),
    name:            readField('Name'),
    regNo:           readField('Registration Number'),
    period:          readField('Period'),
    taxYear:         readField('Tax Year'),
    validUpto:       readField('Valid Upto'),
    dueDate:         readField('Due Date'),
    documentDate:    readField('Document Date'),
    submissionDate:  readField('Submission Date'),
  };

  // Click Contents tab
  const contentsTabs = Array.from(document.querySelectorAll('[role="tab"], li, a, button')).filter(
    el => el.textContent.trim().toLowerCase() === 'contents' ||
          el.textContent.trim().toLowerCase().includes('content')
  );
  if (contentsTabs.length > 0) {
    contentsTabs[0].click();
    await wait(T_M);
  }

  // Read contents text
  const contentsArea = document.querySelector('.contents-area, [class*="content-body"], .notice-content, .notice-text, .rich-text, textarea');
  let contentsText = contentsArea ? contentsArea.textContent.trim() : '';

  // Fallback: grab from a prominent text block
  if (!contentsText) {
    const divs = document.querySelectorAll('.ui-panel-content, .form-content, .task-content');
    for (const d of divs) {
      const t = d.textContent.trim();
      if (t.length > 100) { contentsText = t; break; }
    }
  }

  return { fields, contentsText };
}

async function clickPrint() {
  const btn = Array.from(document.querySelectorAll('button, a')).find(
    el => el.textContent.trim().toUpperCase() === 'PRINT' ||
          el.getAttribute('title')?.toUpperCase() === 'PRINT'
  );
  if (!btn) throw new Error('Print button not found');

  // Tell background.js to intercept the download
  await chrome.runtime.sendMessage({ type: 'EXPECT_PDF_DOWNLOAD' });
  btn.click();
}

async function waitForPdfDownload(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('PDF download timed out'));
    }, timeoutMs);

    function handler(message) {
      if (message.type === 'PDF_DOWNLOADED') {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(handler);
        resolve(message.filename);
      }
    }
    chrome.runtime.onMessage.addListener(handler);
  });
}

// ─── File naming ──────────────────────────────────────────────────────────────

function sanitizeFilename(str) {
  return str.replace(/[\/\\:*?"<>|]/g, '-').trim();
}

function buildFilename(taskName, clientName, taxYear, index) {
  const base = sanitizeFilename(`${taskName} - ${clientName} - TY${taxYear}`);
  return index > 1 ? `${base} (${index})` : base;
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function runExtraction(config) {
  const { clients, section, selectedCategories, apiKey, folderPrefix, startIndex } = config;
  const allResults = [];

  for (let i = startIndex; i < clients.length; i++) {
    if (stopRequested) { log('warn', 'Stopped by user.'); break; }

    const client = clients[i];
    const clientLabel = `${client.name} (${client.ntn})`;
    log('info', `Processing client ${i + 1}/${clients.length}: ${clientLabel}`);
    status(`Client ${i + 1}/${clients.length}: ${clientLabel}`, i, clients.length);

    // Save checkpoint
    await chrome.storage.local.set({ irisNoticesCheckpoint: { index: i, clientNtn: client.ntn } });

    try {
      // Apply filter for this client
      await clickFilters();
      await fillRegistrationNo(client.ntn);
      await clickApply();

      const verified = await verifyClientLoaded(client.ntn);
      if (!verified) {
        log('err', `Could not verify client ${clientLabel} — skipping`);
        continue;
      }
      log('ok', `Client loaded: ${clientLabel}`);

      // Click target section tab
      await clickSectionTab(section);

      // Read dynamic categories
      const categories = readCategories();
      log('info', `Found ${categories.length} categories`);
      chrome.runtime.sendMessage({ type: 'CATEGORIES_LOADED', categories: categories.map(c => ({ label: c.label, count: c.count })) });

      // Determine which categories to process
      const toProcess = (selectedCategories && selectedCategories.length > 0 && !selectedCategories.includes('ALL'))
        ? categories.filter(c => selectedCategories.includes(c.label))
        : categories;

      const clientNotices = [];

      for (const cat of toProcess) {
        if (stopRequested) break;
        log('info', `  Category: ${cat.label} (${cat.count})`);
        await clickCategoryTab(cat.label);

        let page = 1;
        while (true) {
          if (stopRequested) break;
          const rows = parseNoticeRows();
          log('info', `    Page ${page}: ${rows.length} notices`);

          for (const row of rows) {
            if (stopRequested) break;

            const noticeId = `${row.regNo}|${row.taskName}|${row.taxYear}|${row.period}`;
            const isNew = await isNoticeNew(client.ntn, noticeId);

            if (!isNew) {
              log('info', `    SKIP (already seen): ${row.taskName} TY${row.taxYear}`);
              continue;
            }

            log('info', `    Downloading: ${row.taskName} TY${row.taxYear}`);
            status(`${clientLabel} → ${cat.label} → ${row.taskName}`, i, clients.length);

            try {
              // Click View button
              if (!row.viewBtn) { log('warn', '    No View button — skipping row'); continue; }
              row.viewBtn.click();
              await wait(T_XL);

              // Read notice detail
              const { fields, contentsText } = await readNoticeDetail();

              const metadata = {
                name:         fields.name || row.clientName,
                regNo:        fields.regNo || row.regNo,
                task:         fields.task || row.taskName,
                taxYear:      fields.taxYear || row.taxYear,
                period:       fields.period || row.period,
                dueDate:      fields.dueDate || row.dueDate,
                documentDate: fields.documentDate || '',
                transactionDate: fields.transactionDate || '',
                submissionDate: fields.submissionDate || '',
                category:     cat.label,
                section:      section
              };

              let textToSummarise = contentsText;

              if (!textToSummarise || textToSummarise.length < 50) {
                // Click Print to get PDF
                log('info', '    Contents empty — downloading PDF...');
                try {
                  await clickPrint();
                  const pdfFilename = await waitForPdfDownload();
                  log('ok', `    PDF downloaded: ${pdfFilename}`);
                  // Signal side panel to read the PDF and extract text
                  chrome.runtime.sendMessage({ type: 'EXTRACT_PDF_TEXT', filename: pdfFilename, metadata, noticeId, clientNtn: client.ntn });
                  // We'll get the text back async — for now mark as seen and continue
                  await markNoticeSeen(client.ntn, noticeId);
                  await wait(T_M);
                  history.back();
                  await wait(T_L);
                  continue;
                } catch (e) {
                  log('err', `    PDF download error: ${e.message}`);
                }
              }

              if (textToSummarise && apiKey) {
                try {
                  log('info', '    Generating AI summary...');
                  const summary = await generateNoticeSummary(textToSummarise, metadata, apiKey);
                  const riskLevel = extractRiskLevel(summary);

                  // Build filename
                  const taskShort = sanitizeFilename(metadata.task.split('(')[0].trim() || metadata.task).substring(0, 40);
                  const clientShort = sanitizeFilename(metadata.name).substring(0, 40);
                  const fyStr = metadata.taxYear || 'XX';
                  const filenameBase = buildFilename(taskShort, clientShort, fyStr, 1);

                  // Save summary .txt
                  chrome.runtime.sendMessage({
                    type: 'SAVE_SUMMARY_TXT',
                    filename: `${filenameBase}.txt`,
                    content: summary,
                    folderPrefix
                  });

                  const noticeRecord = {
                    id: noticeId,
                    ...metadata,
                    pdfFilename: `${filenameBase}.pdf`,
                    summaryFilename: `${filenameBase}.txt`,
                    riskLevel,
                    isNew: true,
                    extractedAt: new Date().toISOString()
                  };

                  clientNotices.push(noticeRecord);
                  log('ok', `    Done: ${metadata.task} — Risk: ${riskLevel}`);
                } catch (e) {
                  log('err', `    AI summary error: ${e.message}`);
                }
              }

              await markNoticeSeen(client.ntn, noticeId);

              // Go back to notice list
              history.back();
              await wait(T_L);

            } catch (e) {
              log('err', `    Notice error: ${e.message}`);
              history.back();
              await wait(T_L);
            }
          }

          // Pagination
          const nextBtn = getNextPageButton();
          if (!nextBtn) break;
          nextBtn.click();
          await wait(T_M);
          page++;
        }
      }

      allResults.push({ client, notices: clientNotices });
      chrome.runtime.sendMessage({ type: 'CLIENT_RESULT', client, notices: clientNotices });

    } catch (e) {
      log('err', `Client ${clientLabel} error: ${e.message}`);
    }
  }

  // Save accumulated results for portal export
  const existing = (await chrome.storage.local.get('irisNoticesRunResults')).irisNoticesRunResults || [];
  await chrome.storage.local.set({ irisNoticesRunResults: [...existing, ...allResults] });

  // Clear checkpoint
  await chrome.storage.local.remove('irisNoticesCheckpoint');

  chrome.runtime.sendMessage({ type: 'ALL_DONE', results: allResults });
  log('ok', 'All clients processed.');
  runInProgress = false;
}

// ─── Incremental store helpers (in-content wrappers) ─────────────────────────

async function isNoticeNew(clientNtn, noticeId) {
  const key = `notices_seen_${clientNtn.replace(/[^A-Z0-9]/gi, '')}`;
  const data = await chrome.storage.local.get(key);
  const seen = new Set(data[key] || []);
  return !seen.has(noticeId);
}

async function markNoticeSeen(clientNtn, noticeId) {
  const key = `notices_seen_${clientNtn.replace(/[^A-Z0-9]/gi, '')}`;
  const data = await chrome.storage.local.get(key);
  const seen = new Set(data[key] || []);
  seen.add(noticeId);
  await chrome.storage.local.set({ [key]: Array.from(seen) });
}

// ─── AI Summary stubs (loaded from aiSummary.js in side panel context) ───────

async function generateNoticeSummary(text, metadata, apiKey) {
  const prompt = `You are a senior Pakistani tax advisor at S. Saeed Tax Consultants, Islamabad.

Analyse the following FBR IRIS notice and provide a detailed structured summary.

NOTICE METADATA:
- Client Name: ${metadata.name}
- Registration No: ${metadata.regNo}
- Notice Type: ${metadata.task}
- Tax Year: ${metadata.taxYear}
- Period: ${metadata.period}
- Due Date: ${metadata.dueDate}
- Document Date: ${metadata.documentDate}
- Category: ${metadata.category}
- Section: ${metadata.section}

NOTICE TEXT:
${text}

---

## NOTICE SUMMARY
**Client:** [Name]
**Registration No:** [NTN/CNIC]
**Notice Type:** [Section number and title]
**Tax Year:** [Year]
**Period:** [Period]
**Document Date:** [Date]
**Due Date:** [Date — highlight if urgent, i.e. within 30 days]

---

## LEGAL SECTION ANALYSIS
[Explain what legal provision this notice is issued under]

---

## KEY ALLEGATIONS / DEMANDS
[List all specific allegations, tax demands, amounts, and issues raised by FBR]

---

## DEADLINES & URGENCY
[List all deadlines. Flag any past due or within 30 days as URGENT.]

---

## RECOMMENDED RESPONSE / ACTION
[Specific practical advice on how to respond]

---

## RISK ASSESSMENT
[Rate the risk level: LOW / MEDIUM / HIGH / CRITICAL — and explain why]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`API ${response.status}`);
  const data = await response.json();
  return data.content[0].text;
}

function extractRiskLevel(summaryText) {
  const match = summaryText.match(/##\s*RISK ASSESSMENT[\s\S]*?(LOW|MEDIUM|HIGH|CRITICAL)/i);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_TO_CONTENT') {
    if (runInProgress) {
      log('warn', 'Already running — ignoring start.');
      return;
    }
    runInProgress = true;
    stopRequested = false;
    runExtraction(message).catch(e => {
      log('err', `Fatal error: ${e.message}`);
      runInProgress = false;
      chrome.runtime.sendMessage({ type: 'ALL_DONE', error: e.message });
    });
  }

  if (message.type === 'STOP_TO_CONTENT') {
    stopRequested = true;
    log('warn', 'Stop requested...');
  }

  return true;
});

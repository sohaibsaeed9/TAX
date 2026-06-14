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
  // Try multiple strategies to find the FILTERS button
  let btn = null;

  // Strategy 1: exact text match
  btn = Array.from(document.querySelectorAll('button, a')).find(
    el => el.textContent.trim().toUpperCase() === 'FILTERS'
  );

  // Strategy 2: contains text
  if (!btn) btn = Array.from(document.querySelectorAll('button, a, span[onclick]')).find(
    el => el.textContent.trim().toUpperCase().includes('FILTER')
  );

  // Strategy 3: by class (PrimeFaces filter button often has specific classes)
  if (!btn) btn = document.querySelector('[class*="filter" i], [id*="filter" i]');

  if (!btn) {
    // Log all buttons to help diagnose
    const allBtns = Array.from(document.querySelectorAll('button, a')).map(el => `"${el.textContent.trim().substring(0,20)}"`).join(', ');
    log('warn', `FILTERS btn not found. Buttons on page: ${allBtns.substring(0, 200)}`);
    throw new Error('FILTERS button not found');
  }

  log('info', `  Clicking FILTERS button: "${btn.textContent.trim().substring(0,30)}"`);
  btn.click();
  await wait(T_XL); // Wait longer for PrimeFaces overlay to render
}

async function fillRegistrationNo(ntn) {
  // PrimeFaces uses ui-dialog, ui-overlaypanel, or just a visible panel
  // Wait for ANY new overlay/panel/dialog to appear
  const modalSel = [
    '.ui-dialog:not([style*="display: none"])',
    '.ui-overlaypanel:not([style*="display: none"])',
    '[role="dialog"]',
    '.ui-widget-overlay + .ui-dialog',
    '.filter-panel',
    '.filter-container',
    // Generic: any element that appeared containing an input after clicking
  ].join(', ');

  const modal = await waitFor(() => document.querySelector(modalSel), 8000);

  // If specific modal not found, search for the registration input anywhere on page
  // (IRIS sometimes renders filters inline, not in a dialog)
  let regInput = null;

  if (modal) {
    const inputs = modal.querySelectorAll('input[type="text"], input:not([type])');
    const labels = modal.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent.toLowerCase().includes('registration') ||
          label.textContent.toLowerCase().includes('reg no') ||
          label.textContent.toLowerCase().includes('reg.')) {
        const id = label.getAttribute('for');
        if (id) regInput = modal.querySelector(`#${id}`);
        if (!regInput) regInput = label.nextElementSibling?.querySelector('input') || label.parentElement?.querySelector('input');
        break;
      }
    }
    if (!regInput && inputs.length > 0) regInput = inputs[0];
  }

  // Broader fallback: search entire page for registration input
  if (!regInput) {
    const allLabels = document.querySelectorAll('label');
    for (const label of allLabels) {
      const text = label.textContent.toLowerCase();
      if (text.includes('registration') || text.includes('reg no') || text.includes('reg.')) {
        const id = label.getAttribute('for');
        if (id) regInput = document.getElementById(id);
        if (!regInput) regInput = label.nextElementSibling?.querySelector('input') || label.parentElement?.querySelector('input');
        if (regInput) break;
      }
    }
  }

  // Last resort: find visible inputs that appeared recently
  if (!regInput) {
    const allInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(
      el => el.offsetParent !== null // visible
    );
    log('info', `  Found ${allInputs.length} visible text inputs on page`);
    if (allInputs.length > 0) regInput = allInputs[0];
  }

  if (!regInput) throw new Error('Filter modal did not open — Registration No input not found');

  fill(regInput, ntn);
  log('info', `  Filled Registration No: ${ntn}`);
  await wait(T_S);
}

async function clickApply() {
  // Confirmed selector: button.btn.btn-sm with text "Apply"
  let btn = Array.from(document.querySelectorAll('button.btn.btn-sm')).find(
    el => el.textContent.trim().toLowerCase() === 'apply'
  );
  // Fallback
  if (!btn) btn = Array.from(document.querySelectorAll('button, a')).find(
    el => el.textContent.trim().toLowerCase() === 'apply' && el.offsetParent !== null
  );
  if (!btn) throw new Error('APPLY button not found');
  log('info', '  Clicking APPLY...');
  btn.click();
  await wait(T_XL);
  window.scrollTo(0, 0);
  await wait(T_S);
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
    // Check if NTN appears on page (client has records) OR if page shows "No Record Found"
    // (filter was applied but client has no records in this section — still valid)
    if (pageText.includes(ntnClean) || pageText.includes(expectedNtn)) {
      log('ok', `  Client NTN found on page`);
      return true;
    }
    if (pageText.toLowerCase().includes('no record') || pageText.toLowerCase().includes('inbox') || pageText.toLowerCase().includes('draft')) {
      log('info', `  Filter applied — task view visible (client may have no records in this section)`);
      return true;
    }
    log('warn', `  Verification attempt ${attempt + 1} — page not ready, retrying filter...`);
    try {
      await clickFilters();
      await fillRegistrationNo(expectedNtn);
      await clickApply();
    } catch (e) {
      log('err', `  Retry filter error: ${e.message}`);
    }
  }
  // After max attempts, proceed anyway — don't skip client due to verification
  log('warn', `  Verification inconclusive — proceeding anyway`);
  return true;
}

// ─── Section Tabs ─────────────────────────────────────────────────────────────

// Confirmed CSS selectors from IRIS DOM inspection
const SECTION_CSS = {
  'Inbox':           'a.inbox',
  'Draft':           'a.ng-tns-c178-2:not(.inbox):not(.left):not(.completed_tasks)',
  'Outbox':          'a.left',
  'Completed Tasks': 'a.completed_tasks'
};

const SECTION_LABELS = {
  'Inbox': ['inbox'],
  'Draft': ['draft', 'unsubmitted'],
  'Outbox': ['outbox', 'awaiting'],
  'Completed Tasks': ['completed']
};

async function clickSectionTab(section) {
  await wait(T_M);

  // Try confirmed CSS selector first
  const cssSelector = SECTION_CSS[section];
  if (cssSelector) {
    const el = document.querySelector(cssSelector);
    if (el && el.offsetParent !== null) {
      log('info', `  Clicking section tab via CSS: "${el.textContent.trim().substring(0, 40)}"`);
      el.click();
      await wait(T_L);
      return;
    }
  }

  const keywords = SECTION_LABELS[section] || [section.toLowerCase()];

  // Search all clickable elements — pick shortest text match that contains keyword
  const candidates = Array.from(document.querySelectorAll('a, button, li, div[onclick], span[onclick]'));

  // First pass: look for elements where the DIRECT text node contains the keyword
  // (avoids matching outer containers that contain the keyword inside a child)
  let found = null;
  for (const el of candidates) {
    const ownText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim().toLowerCase())
      .join(' ');
    if (keywords.some(k => ownText.includes(k)) && el.offsetParent !== null) {
      found = el;
      break;
    }
  }

  // Second pass: full textContent with length limit
  if (!found) {
    const matches = candidates.filter(el => {
      const text = el.textContent.trim().toLowerCase();
      return keywords.some(k => text.includes(k)) && text.length < 60 && el.offsetParent !== null;
    });
    if (matches.length > 0) {
      found = matches.sort((a, b) => a.textContent.trim().length - b.textContent.trim().length)[0];
    }
  }

  if (!found) {
    // Log visible candidates to diagnose
    const visible = Array.from(document.querySelectorAll('a, button, li')).filter(el => el.offsetParent !== null);
    log('warn', `Section "${section}" not found. Visible links: ${visible.slice(0,15).map(el => `"${el.textContent.trim().substring(0,20)}"`).join(', ')}`);
    throw new Error(`Section tab "${section}" not found`);
  }

  log('info', `  Clicking section tab: "${found.textContent.trim().substring(0,40)}"`);
  found.click();
  await wait(T_L);
}

// ─── Category Tabs ────────────────────────────────────────────────────────────

function readCategories() {
  const categories = [];

  // Confirmed: category tabs are button.btn elements with text "CATEGORY NAME (COUNT)"
  const tabEls = document.querySelectorAll('button.btn');
  for (const el of tabEls) {
    const text = el.textContent.trim();
    const match = text.match(/^(.+?)\s*\((\d+)\)$/);
    if (match && el.offsetParent !== null) {
      categories.push({
        label: match[1].trim().toUpperCase(),
        count: parseInt(match[2], 10),
        element: el
      });
    }
  }

  // Fallback: search all elements
  if (categories.length === 0) {
    const allEls = document.querySelectorAll('a, button, li, span, div');
    for (const el of allEls) {
      const text = el.textContent.trim();
      const match = text.match(/^([A-Z\s\/]+)\s*\((\d+)\)$/);
      if (match && el.offsetParent !== null && !categories.find(c => c.label === match[1].trim())) {
        categories.push({
          label: match[1].trim().toUpperCase(),
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
    sendResponse({ ok: true });
    if (runInProgress) {
      log('warn', 'Already running — ignoring start.');
      return;
    }
    log('info', `Content script ready. Starting on ${window.location.hostname}...`);
    runInProgress = true;
    stopRequested = false;
    runExtraction(message).catch(e => {
      log('err', `Fatal error: ${e.message}`);
      console.error('[IRIS Extractor] Fatal:', e);
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

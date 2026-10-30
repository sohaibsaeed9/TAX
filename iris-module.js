/* ═══════════════════════════════════════════════════════════════════════════
   S. Saeed & Co. Staff Portal — IRIS module
   • IRIS Sync page   : run the extractor on the office PC (sections/tabs/mode), live log, stop, history
   • IRIS Notices page: every notice from IRIS, filters, status, deadlines, PDF, client mapping
   • Correspondence   : client-profile tab listing that client's notices
   Depends on the portal globals: _sb (Supabase client, signed in), _cloud, _cloudEmail, ALL_CLIENTS, role.
   Exposes: window.IRIS = { syncPage(el), noticesPage(el), clientTab(el, client), matchClient(regNo) }
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var SECTIONS = ["Inbox", "Outbox", "Completed Tasks"];          // Draft is never offered
  var STATUS = [["new","New"],["in_progress","In progress"],["reply_drafted","Reply drafted"],
                ["submitted","Submitted"],["closed","Closed"],["archived","Archived"],["not_ours","Not our client"]];
  var STATUS_L = {}; STATUS.forEach(function (s) { STATUS_L[s[0]] = s[1]; });
  var HIGH = /^(122|121|138|182|161|137|124)\b/;                   // demands / orders / recovery first

  function sb() { return window._sb; }
  function online() { return !!(window._sb && window._cloud); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function fmtDate(d) { if (!d) return "—"; var x = new Date(d + "T00:00:00"); return isNaN(x) ? d : x.toLocaleDateString("en-PK", {day:"numeric", month:"short", year:"numeric"}); }
  function daysTo(d) { if (!d) return null; var t = new Date(); t.setHours(0,0,0,0); return Math.round((new Date(d + "T00:00:00") - t) / 864e5); }
  function ago(ts) { if (!ts) return "never"; var s = (Date.now() - new Date(ts)) / 1000; return s < 90 ? Math.round(s) + " s ago" : s < 5400 ? Math.round(s/60) + " min ago" : Math.round(s/3600) + " h ago"; }
  function q(el, sel) { return el.querySelector(sel); }
  function offlineMsg(el) { el.innerHTML = '<div class="page-header"><div class="page-title">IRIS</div><div class="page-sub">Needs the online database — sign in while connected to use this page.</div></div>'; }

  /* ── CSS ─────────────────────────────────────────────────────────────── */
  var css = ""
    + ".ir-wrap{padding:0 0 40px}.ir-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}"
    + ".ir-card{background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:16px 18px;margin-bottom:16px}"
    + ".ir-card h3{font-family:var(--serif);font-size:19px;font-weight:600;margin:0 0 12px;color:var(--ink)}"
    + ".ir-dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}"
    + ".ir-ok{background:#2e7d4f}.ir-warn{background:#c98a1b}.ir-bad{background:#9c3a32}"
    + ".ir-sec{border:1px solid var(--line-2);border-radius:8px;padding:10px 12px;margin-bottom:10px}"
    + ".ir-sec>label{font-weight:600}.ir-tabs{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:13px;color:var(--ink-2)}"
    + ".ir-tabs label{display:flex;gap:6px;align-items:center;cursor:pointer}"
    + ".ir-log{background:#0f1623;color:#d7dde8;font-family:var(--mono);font-size:12px;line-height:1.5;border-radius:8px;padding:10px 12px;height:280px;overflow:auto;white-space:pre-wrap}"
    + ".ir-log .ok{color:#7fd29b}.ir-log .warn{color:#f0c36b}.ir-log .err{color:#f08a80}"
    + ".ir-bar{height:8px;background:var(--line-2);border-radius:99px;overflow:hidden}.ir-bar>i{display:block;height:100%;background:var(--gold);width:0}"
    + ".ir-t{width:100%;border-collapse:collapse;font-size:13px}.ir-t th{position:sticky;top:0;background:#fbfaf7;text-align:left;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);padding:8px 10px;border-bottom:1px solid var(--line)}"
    + ".ir-t td{padding:8px 10px;border-bottom:1px solid var(--line-2);vertical-align:top}.ir-t tr:hover td{background:#fbfaf7}"
    + ".ir-pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--line-2);color:var(--ink-2);white-space:nowrap}"
    + ".ir-pill.hi{background:#f6e3e1;color:#9c3a32}.ir-pill.due{background:#fbefd9;color:#8a5a0b}.ir-pill.od{background:#9c3a32;color:#fff}"
    + ".ir-in{height:34px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font-size:13px;background:var(--card);color:var(--ink)}"
    + ".ir-sm{height:30px!important;font-size:12px!important;padding:0 10px!important}"
    + ".ir-muted{color:var(--ink-3);font-size:12.5px}.ir-scroll{max-height:62vh;overflow:auto;border:1px solid var(--line);border-radius:10px}"
    + ".ir-modal{position:fixed;inset:0;background:rgba(10,20,36,.45);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:40px 16px}"
    + ".ir-modal>div{background:var(--card);border-radius:12px;max-width:900px;width:100%;max-height:85vh;overflow:auto;padding:20px 22px}"
    + ".ir-modal pre{white-space:pre-wrap;font-family:var(--mono);font-size:12px}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ── client mapping ─────────────────────────────────────────────────── */
  var LINKS = null;  // reg_no -> client_key (manual links)
  function clientKey(c) { return digits(c.id) || digits(c.ntn) || (c.name || "").toUpperCase(); }
  function loadLinks() {
    if (LINKS) return Promise.resolve(LINKS);
    return Promise.resolve(sb().from("iris_client_links").select("reg_no,client_key")).then(function (r) {
      LINKS = {}; (r.data || []).forEach(function (x) { LINKS[x.reg_no] = x.client_key; }); return LINKS;
    });
  }
  function matchClient(regNo) {
    var d = digits(regNo); if (!d) return null;
    var list = window.ALL_CLIENTS || [];
    if (LINKS && LINKS[d]) {
      for (var j = 0; j < list.length; j++) if (list[j] && clientKey(list[j]) === LINKS[d]) return {idx: j, client: list[j], why: "linked"};
    }
    var i, c;
    for (i = 0; i < list.length; i++) {                                   // exact CNIC or full NTN
      c = list[i]; if (!c) continue;
      if (digits(c.id) === d || digits(c.ntn) === d) return {idx: i, client: c, why: "auto"};
    }
    if (d.length >= 7 && d.length <= 8) {                                  // 7-digit NTN prefix: only when it is unique, else do not guess
      var hit = -1, n = 0;
      for (i = 0; i < list.length; i++) { c = list[i]; if (c && digits(c.ntn).slice(0, 7) === d.slice(0, 7)) { hit = i; if (++n > 1) break; } }
      if (n === 1) return {idx: hit, client: list[hit], why: "ntn"};
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     IRIS SYNC PAGE
     ══════════════════════════════════════════════════════════════════════ */
  var syncSubs = [];
  function unsub() { syncSubs.forEach(function (ch) { try { sb().removeChannel(ch); } catch (e) {} }); syncSubs = []; }

  function syncPage(el) {
    if (!online()) return offlineMsg(el);
    unsub();
    el.innerHTML = ''
      + '<div class="page-header" data-group="Automation"><div class="page-title">IRIS Sync</div>'
      + '<div class="page-sub">Pull notices from IRIS on the office computer. Pick what to run, watch it live, stop any time.</div></div>'
      + '<div class="ir-wrap">'
      + '<div class="ir-card"><div class="ir-row" id="ir-runner">Checking runner…</div>'
      + '<div class="ir-row" style="margin-top:14px"><button class="btn" id="ir-all">Update everything now</button>'
      + '<span class="ir-muted" id="ir-all-msg">Checks Inbox, Outbox and Completed Tasks for new notices (quick scan).</span></div></div>'
      + '<div class="ir-card"><h3>What to run</h3><div id="ir-sel"></div>'
      + '<div class="ir-row" style="margin-top:10px">'
      + '<label>Mode <select class="ir-in" id="ir-mode">'
      + '<option value="quick">Quick — new notices only (weekly)</option>'
      + '<option value="full">Full scan — every page</option>'
      + '<option value="test">Test — N per tab</option>'
      + '<option value="register">Register only — list, don\'t download</option></select></label>'
      + '<label id="ir-pt-w" style="display:none">N per tab <input class="ir-in" id="ir-pt" type="number" min="1" value="4" style="width:70px"></label>'
      + '<label>Only due on/after <input class="ir-in" id="ir-due" type="date"></label>'
      + '<button class="btn" id="ir-run">Run</button></div>'
      + '<div class="ir-muted" style="margin-top:8px">Draft is never processed. Pre-2020 notices are listed but not downloaded (except Appeals and s.124).</div></div>'
      + '<div class="ir-card" id="ir-cur" style="display:none"><h3>Running now</h3>'
      + '<div class="ir-row" style="justify-content:space-between"><div id="ir-prog-t" class="ir-muted"></div><button class="btn-sec ir-sm" id="ir-stop">Stop</button></div>'
      + '<div class="ir-bar" style="margin:8px 0 12px"><i id="ir-prog"></i></div><div class="ir-log" id="ir-log"></div></div>'
      + '<div class="ir-card"><h3>History</h3><div id="ir-hist" class="ir-muted">Loading…</div></div>'
      + '</div>';

    var runner = null, current = null;
    q(el, "#ir-mode").onchange = function () { q(el, "#ir-pt-w").style.display = this.value === "test" ? "" : "none"; };

    function runnerOnline() { return !!(runner && runner.last_heartbeat && (Date.now() - new Date(runner.last_heartbeat)) / 1000 <= 120); }
    /* asks Windows to start the runner on THIS computer (works on the office PC once the link handler is installed) */
    function launchRunner() { var a = document.createElement("a"); a.href = "iris-runner://start"; a.style.display = "none"; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500); }
    function startHint() {
      return '<div class="ir-muted" style="flex-basis:100%;margin-top:6px"><a href="#" id="ir-start" class="btn-sec ir-sm" style="display:inline-flex;align-items:center;padding:0 12px;text-decoration:none">Start the runner on this computer</a> '
        + 'Works on the office PC only. The first time, Chrome asks to open IRIS Runner: tick <b>Always allow</b> and press Open.</div>';
    }
    function renderRunner() {
      var box = q(el, "#ir-runner");
      if (!runner) { box.innerHTML = '<span class="ir-dot ir-bad"></span><b>No runner set up yet.</b>&nbsp;<span class="ir-muted">Install it on the office PC (see SETUP).</span>' + startHint(); wireStart(); return; }
      var age = (Date.now() - new Date(runner.last_heartbeat)) / 1000;
      var cls = age > 120 ? "ir-bad" : runner.iris_logged_in === false ? "ir-warn" : "ir-ok";
      var txt = age > 120 ? "Offline — the runner computer is off or asleep"
              : runner.iris_logged_in === false ? "IRIS login needed — log in on " + esc(runner.machine)
              : runner.current_job ? "Working on job #" + runner.current_job : "Online and ready";
      box.innerHTML = '<span class="ir-dot ' + cls + '"></span><b>' + txt + '</b>&nbsp;<span class="ir-muted">· ' + esc(runner.runner_id) + ' · ' + esc(runner.machine || "") + ' · last seen ' + ago(runner.last_heartbeat) + '</span>'
        + (age > 120 ? startHint() : runner.iris_logged_in === false ? '<div class="ir-muted" style="flex-basis:100%;margin-top:6px">Switch to the Chrome window on the office PC and log in to IRIS. The run carries on by itself.</div>' : "");
      wireStart();
    }
    function wireStart() {
      var b = q(el, "#ir-start"); if (!b) return;
      b.onclick = function (e) { e.preventDefault(); launchRunner(); b.textContent = "Starting… the light turns green in about a minute"; };
    }

    var lastTabs = "";
    function applyRunner(row) {
      runner = row; renderRunner();
      var j = JSON.stringify((row && row.tab_counts) || {});
      if (j === lastTabs) return;
      var keep = {};                                    // remember what is ticked, then redraw the tab lists
      el.querySelectorAll(".ir-s").forEach(function (x) { keep["s|" + x.dataset.s] = x.checked; });
      el.querySelectorAll(".ir-all").forEach(function (x) { keep["a|" + x.dataset.s] = x.checked; });
      el.querySelectorAll(".ir-t").forEach(function (x) { keep["t|" + x.dataset.s + "|" + x.dataset.t] = x.checked; });
      renderSelection(); lastTabs = j;
      el.querySelectorAll(".ir-s").forEach(function (x) { if (("s|" + x.dataset.s) in keep) x.checked = keep["s|" + x.dataset.s]; });
      el.querySelectorAll(".ir-all").forEach(function (x) { var k = "a|" + x.dataset.s; if (k in keep) { x.checked = keep[k]; x.onchange(); } });
      el.querySelectorAll(".ir-t").forEach(function (x) { var k = "t|" + x.dataset.s + "|" + x.dataset.t; if (k in keep && !x.disabled) x.checked = keep[k]; });
    }
    function renderSelection() {
      var tc = (runner && runner.tab_counts) || {};
      var h = "";
      SECTIONS.forEach(function (s, si) {
        var tabs = Object.keys(tc[s] || {});
        h += '<div class="ir-sec"><label><input type="checkbox" class="ir-s" data-s="' + esc(s) + '"' + (si === 0 ? " checked" : "") + '> ' + s + '</label>';
        h += '<div class="ir-tabs">' + (tabs.length
          ? '<label><input type="checkbox" class="ir-all" data-s="' + esc(s) + '" checked> <b>All tabs</b></label>'
            + tabs.map(function (t) { return '<label><input type="checkbox" class="ir-t" data-s="' + esc(s) + '" data-t="' + esc(t) + '" checked disabled> ' + esc(t) + ' <span class="ir-muted">(' + tc[s][t] + ')</span></label>'; }).join("")
          : '<span class="ir-muted">All tabs (tab list appears after the first run)</span>') + '</div></div>';
      });
      q(el, "#ir-sel").innerHTML = h;
      el.querySelectorAll(".ir-all").forEach(function (a) {
        a.onchange = function () { el.querySelectorAll('.ir-t[data-s="' + a.dataset.s + '"]').forEach(function (t) { t.disabled = a.checked; t.checked = true; }); };
      });
    }

    function renderCurrent() {
      var box = q(el, "#ir-cur");
      if (!current || ["queued","running"].indexOf(current.status) < 0) { box.style.display = "none"; return; }
      box.style.display = "";
      var p = current.progress || {};
      var pct = p.total ? Math.min(100, Math.round(100 * p.done / p.total)) : 0;
      q(el, "#ir-prog").style.width = pct + "%";
      var c = current.counts || {};
      q(el, "#ir-prog-t").textContent = current.status === "queued" ? "Job #" + current.id + " waiting for the runner…"
        : "Job #" + current.id + " · " + (p.section ? p.section + " → " + p.tab + " " + p.done + " / " + p.total : "starting") + " · downloaded " + (c.fetched || 0) + (c.failed ? " · failed " + c.failed : "");
      q(el, "#ir-stop").disabled = !!current.stop_requested;
      q(el, "#ir-stop").textContent = current.stop_requested ? "Stopping…" : "Stop";
    }

    function addLog(rows) {
      var box = q(el, "#ir-log"); if (!box) return;
      rows.forEach(function (r) {
        var d = document.createElement("div"); d.className = r.level;
        d.textContent = new Date(r.ts).toLocaleTimeString("en-PK", {hour12:false}) + "  " + r.message;
        box.appendChild(d);
      });
      while (box.childNodes.length > 800) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
    }

    function loadLog(jobId) {
      q(el, "#ir-log").innerHTML = "";
      return Promise.resolve(sb().from("iris_job_log").select("*").eq("job_id", jobId).order("id", {ascending: false}).limit(300))
        .then(function (r) { addLog((r.data || []).reverse()); });
    }

    function renderHistory() {
      return Promise.resolve(sb().from("iris_jobs").select("*").order("id", {ascending: false}).limit(25)).then(function (r) {
        var jobs = r.data || [];
        var live = jobs.filter(function (j) { return j.status === "running" || j.status === "queued"; })[0];
        if (live && (!current || current.id !== live.id)) { current = live; loadLog(live.id); }
        else if (!live) current = null;
        renderCurrent();
        if (!jobs.length) { q(el, "#ir-hist").innerHTML = "No runs yet."; return; }
        var h = '<div class="ir-scroll" style="max-height:320px"><table class="ir-t"><thead><tr><th>#</th><th>Started</th><th>What</th><th>Mode</th><th>Status</th><th>Result</th><th></th></tr></thead><tbody>';
        jobs.forEach(function (j) {
          var c = j.counts || {}, sel = j.selection || {};
          var what = Object.keys(sel).map(function (s) { return s + (sel[s] && sel[s][0] !== "*" ? " (" + sel[s].length + " tabs)" : ""); }).join(", ");
          h += "<tr><td>" + j.id + "</td><td>" + (j.started_at ? new Date(j.started_at).toLocaleString("en-PK") : "—") + "</td><td>" + esc(what) + "</td><td>" + esc(j.mode) + (j.per_tab ? " ×" + j.per_tab : "") + "</td>"
            + '<td><span class="ir-pill' + (j.status === "failed" ? " hi" : "") + '">' + esc(j.status) + "</span></td>"
            + "<td>" + (c.fetched || 0) + " downloaded" + (c.new ? ", " + c.new + " new" : "") + (c.failed ? ', <b style="color:var(--red)">' + c.failed + " failed</b>" : "") + (j.error ? '<div class="ir-muted">' + esc(j.error) + "</div>" : "") + "</td>"
            + '<td><button class="btn-sec ir-sm" data-log="' + j.id + '">Log</button></td></tr>';
        });
        q(el, "#ir-hist").innerHTML = h + "</tbody></table></div>";
        el.querySelectorAll("[data-log]").forEach(function (b) {
          b.onclick = function () {
            Promise.resolve(sb().from("iris_job_log").select("*").eq("job_id", +b.dataset.log).order("id").limit(2000)).then(function (r) {
              modal("Job #" + b.dataset.log + " log", "<pre>" + esc((r.data || []).map(function (x) { return new Date(x.ts).toLocaleTimeString("en-PK", {hour12:false}) + "  " + x.message; }).join("\n")) + "</pre>");
            });
          };
        });
      });
    }

    q(el, "#ir-run").onclick = function () {
      if (window.role !== "admin") { alert("Only the admin can start IRIS runs."); return; }
      if (current) { alert("A run is already queued or running."); return; }
      var selection = {};
      el.querySelectorAll(".ir-s:checked").forEach(function (s) {
        var sec = s.dataset.s, all = q(el, '.ir-all[data-s="' + sec + '"]');
        if (!all || all.checked) selection[sec] = ["*"];
        else selection[sec] = Array.prototype.map.call(el.querySelectorAll('.ir-t[data-s="' + sec + '"]:checked'), function (t) { return t.dataset.t; });
        if (!selection[sec].length) delete selection[sec];
      });
      if (!Object.keys(selection).length) { alert("Pick at least one section/tab."); return; }
      var mode = q(el, "#ir-mode").value;
      var row = {created_by: window._cloudEmail || "", selection: selection, mode: mode,
                 per_tab: mode === "test" ? Math.max(1, +q(el, "#ir-pt").value || 4) : null,
                 fetch_due_from: q(el, "#ir-due").value || null};
      this.disabled = true; var btn = this;
      Promise.resolve(sb().from("iris_jobs").insert(row).select()).then(function (r) {
        btn.disabled = false;
        if (r.error) { alert("Could not start: " + r.error.message); return; }
        current = r.data[0]; q(el, "#ir-log").innerHTML = ""; renderCurrent(); renderHistory();
      });
    };
    q(el, "#ir-stop").onclick = function () {
      if (!current) return;
      if (current.status === "queued") {          // nobody has started it yet: cancel it outright
        var id = current.id;
        sb().from("iris_jobs").update({status: "stopped", stop_requested: true, finished_at: new Date().toISOString()}).eq("id", id).then(function () { current = null; renderCurrent(); renderHistory(); });
        return;
      }
      sb().from("iris_jobs").update({stop_requested: true}).eq("id", current.id).then(function () { current.stop_requested = true; renderCurrent(); });
    };
    q(el, "#ir-all").onclick = function () {
      if (window.role !== "admin") { alert("Only the admin can start IRIS runs."); return; }
      if (current) { alert("A run is already queued or running."); return; }
      var btn = this, msg = q(el, "#ir-all-msg"); btn.disabled = true;
      var row = {created_by: window._cloudEmail || "", mode: "quick", selection: {"Inbox": ["*"], "Outbox": ["*"], "Completed Tasks": ["*"]}};
      Promise.resolve(sb().from("iris_jobs").insert(row).select()).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.textContent = "Could not start: " + r.error.message; return; }
        current = r.data[0]; q(el, "#ir-log").innerHTML = ""; renderCurrent(); renderHistory();
        if (!runnerOnline()) { launchRunner(); msg.textContent = "Update queued. Starting the runner on this computer; if IRIS asks for a login, switch to the Chrome window it opens."; }
        else msg.textContent = "Update started. If IRIS asks for a login, switch to the Chrome window on the office PC.";
      });
    };

    // initial load + live updates
    Promise.resolve(sb().from("iris_runner").select("*").order("last_heartbeat", {ascending: false}).limit(1)).then(function (r) {
      applyRunner((r.data || [])[0] || null);
    });
    renderHistory();
    syncSubs.push(sb().channel("ir-runner").on("postgres_changes", {event: "*", schema: "public", table: "iris_runner"}, function (ev) {
      applyRunner(ev.new);
    }).subscribe());
    syncSubs.push(sb().channel("ir-jobs").on("postgres_changes", {event: "*", schema: "public", table: "iris_jobs"}, function (ev) {
      if (current && ev.new && ev.new.id === current.id) { current = ev.new; renderCurrent(); if (["done","failed","stopped"].indexOf(current.status) > -1) renderHistory(); }
      else renderHistory();
    }).subscribe());
    syncSubs.push(sb().channel("ir-log").on("postgres_changes", {event: "INSERT", schema: "public", table: "iris_job_log"}, function (ev) {
      if (current && ev.new.job_id === current.id) addLog([ev.new]);
    }).subscribe());
    var t = setInterval(function () {                 // re-read the runner row now and then, in case a live update was missed
      if (!document.body.contains(el.firstChild)) { clearInterval(t); return; }
      Promise.resolve(sb().from("iris_runner").select("*").order("last_heartbeat", {ascending: false}).limit(1)).then(function (r) { applyRunner((r.data || [])[0] || null); });
    }, window.IRIS && window.IRIS._pollMs || 30000);
  }

  /* ══════════════════════════════════════════════════════════════════════
     IRIS NOTICES PAGE
     ══════════════════════════════════════════════════════════════════════ */
  var NCACHE = null;
  function loadNotices(force) {
    if (NCACHE && !force) return Promise.resolve(NCACHE);
    var all = [], from = 0, size = 1000;
    function page() {
      return Promise.resolve(sb().from("iris_notices")
        .select("id,section,tab,task,law_section,client_name,reg_no,period,tax_year,due_date,pdf_path,pdf_ok,archived,iris_status,status,client_key,notes,internal_deadline,demand_amount,due_date_history,first_seen,last_seen")
        .order("due_date", {ascending: false, nullsFirst: false}).range(from, from + size - 1)).then(function (r) {
          if (r.error) throw r.error;
          all = all.concat(r.data || []);
          if ((r.data || []).length === size) { from += size; return page(); }
          NCACHE = all; return all;
        });
    }
    return loadLinks().then(page);
  }

  function dueBadge(n) {
    if (!n.due_date || ["closed","archived","not_ours","submitted"].indexOf(n.status) > -1) return "";
    var d = daysTo(n.due_date);
    if (d < 0) return '<span class="ir-pill od">Overdue ' + (-d) + 'd</span>';
    if (d <= 7) return '<span class="ir-pill due">Due in ' + d + 'd</span>';
    return "";
  }

  function noticeRow(n, showClient) {
    var m = matchClient(n.reg_no);
    var hi = HIGH.test(n.law_section || n.task || "");
    var moved = (n.due_date_history || []).length ? ' <span class="ir-pill due" title="IRIS changed the due date">date moved</span>' : "";
    return '<tr data-id="' + esc(n.id) + '">'
      + (showClient ? '<td><b>' + esc(n.client_name || "—") + '</b><div class="ir-muted">' + esc(n.reg_no || "") + (m ? ' · <a href="#" data-prof="' + m.idx + '">profile</a>' : ' · <a href="#" data-link="' + esc(digits(n.reg_no)) + '" style="color:var(--amber)">link client</a>') + '</div></td>' : "")
      + '<td>' + (hi ? '<span class="ir-pill hi">' + esc(n.law_section || "") + '</span> ' : "") + esc(n.task) + '<div class="ir-muted">' + esc(n.section) + ' › ' + esc(n.tab) + '</div></td>'
      + '<td>TY ' + esc(n.tax_year || "") + '<div class="ir-muted">' + esc(n.period || "") + '</div></td>'
      + '<td>' + fmtDate(n.due_date) + moved + '<div>' + dueBadge(n) + '</div></td>'
      + '<td><select class="ir-in ir-sm" data-st>' + STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (n.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + '</select></td>'
      + '<td style="white-space:nowrap">' + (n.pdf_ok ? '<button class="btn-sec ir-sm" data-pdf>PDF</button> ' : '<span class="ir-muted">' + (n.archived ? "archived" : "no PDF") + '</span> ')
      + '<button class="btn-sec ir-sm" data-txt>Text</button></td></tr>';
  }

  function wireRows(root, list) {
    var byId = {}; list.forEach(function (n) { byId[n.id] = n; });
    root.querySelectorAll("tr[data-id]").forEach(function (tr) {
      var n = byId[tr.dataset.id];
      var s = tr.querySelector("[data-st]");
      if (s) s.onchange = function () {
        var v = s.value;
        sb().from("iris_notices").update({status: v, updated_by: window._cloudEmail || ""}).eq("id", n.id).then(function (r) {
          if (r.error) { alert(r.error.message); s.value = n.status; } else n.status = v;
        });
      };
      var p = tr.querySelector("[data-pdf]");
      if (p) p.onclick = function () {
        var w = window.open("", "_blank");
        sb().storage.from("notices").createSignedUrl(n.pdf_path, 600).then(function (r) {
          if (r.error) { w.close(); alert(r.error.message); } else w.location = r.data.signedUrl;
        });
      };
      var t = tr.querySelector("[data-txt]");
      if (t) t.onclick = function () {
        sb().from("iris_notices").select("full_text,notes").eq("id", n.id).single().then(function (r) {
          modal(esc(n.client_name) + " — " + esc(n.task), "<pre>" + esc((r.data && r.data.full_text) || "No text captured for this notice.") + "</pre>");
        });
      };
      var pr = tr.querySelector("[data-prof]");
      if (pr) pr.onclick = function (e) { e.preventDefault(); if (window.openProfile) window.openProfile(+pr.dataset.prof); };
      var lk = tr.querySelector("[data-link]");
      if (lk) lk.onclick = function (e) { e.preventDefault(); linkDialog(lk.dataset.link, n.client_name); };
    });
  }

  function linkDialog(regNo, name) {
    var list = (window.ALL_CLIENTS || []).filter(Boolean);
    var opts = list.map(function (c, i) { return '<option value="' + i + '">' + esc(c.name) + " — " + esc(c.ntn || c.id || "") + "</option>"; }).join("");
    var m = modal("Link " + esc(name || regNo), '<p class="ir-muted">IRIS registration ' + esc(regNo) + ' didn\'t match the Client Index. Choose the client — future notices for this number will map automatically.</p>'
      + '<input class="ir-in" id="ir-lq" placeholder="Search client…" style="width:100%;margin-bottom:8px"><select class="ir-in" id="ir-lc" size="10" style="width:100%;height:auto">' + opts + '</select>'
      + '<div style="margin-top:12px"><button class="btn" id="ir-lok">Link</button></div>');
    var sel = m.querySelector("#ir-lc");
    m.querySelector("#ir-lq").oninput = function () { var v = this.value.toLowerCase(); Array.prototype.forEach.call(sel.options, function (o) { o.hidden = o.text.toLowerCase().indexOf(v) < 0; }); };
    m.querySelector("#ir-lok").onclick = function () {
      var c = list[+sel.value]; if (!c) return;
      sb().from("iris_client_links").upsert({reg_no: regNo, client_key: clientKey(c), linked_by: window._cloudEmail || ""}).then(function (r) {
        if (r.error) { alert(r.error.message); return; }
        LINKS = null; m.remove(); if (window.IRIS._refresh) window.IRIS._refresh();
      });
    };
  }

  function modal(title, html) {
    var m = document.createElement("div"); m.className = "ir-modal";
    m.innerHTML = '<div><div class="ir-row" style="justify-content:space-between;margin-bottom:10px"><h3 style="margin:0;font-family:var(--serif)">' + title + '</h3><button class="btn-sec ir-sm">Close</button></div>' + html + "</div>";
    m.querySelector("button").onclick = function () { m.remove(); };
    m.onclick = function (e) { if (e.target === m) m.remove(); };
    document.body.appendChild(m); return m;
  }

  function noticesPage(el) {
    if (!online()) return offlineMsg(el);
    el.innerHTML = '<div class="page-header" data-group="Correspondence"><div class="page-title">IRIS Notices</div><div class="page-sub" id="ir-n-sub">Loading…</div></div>'
      + '<div class="ir-wrap"><div class="ir-card"><div class="ir-row">'
      + '<input class="ir-in" id="ir-f-q" placeholder="Client, CNIC/NTN or section (e.g. 122(9))" style="min-width:260px">'
      + '<select class="ir-in" id="ir-f-sec"><option value="">All sections</option>' + SECTIONS.map(function (s) { return "<option>" + s + "</option>"; }).join("") + '</select>'
      + '<select class="ir-in" id="ir-f-tab"><option value="">All tabs</option></select>'
      + '<select class="ir-in" id="ir-f-st"><option value="open">Open (not closed/archived)</option><option value="">All statuses</option>' + STATUS.map(function (s) { return '<option value="' + s[0] + '">' + s[1] + "</option>"; }).join("") + '</select>'
      + '<select class="ir-in" id="ir-f-due"><option value="">Any due date</option><option value="od">Overdue</option><option value="7">Due in 7 days</option><option value="30">Due in 30 days</option></select>'
      + '<select class="ir-in" id="ir-f-map"><option value="">All clients</option><option value="un">Unmatched only</option></select>'
      + '<button class="btn-sec ir-sm" id="ir-f-r">Refresh</button></div></div>'
      + '<div class="ir-scroll"><table class="ir-t"><thead><tr><th>Client</th><th>Notice</th><th>Year</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody id="ir-n-body"></tbody></table></div></div>';
    var data = [];
    function render() {
      var qv = q(el, "#ir-f-q").value.toLowerCase().trim(), sec = q(el, "#ir-f-sec").value, tab = q(el, "#ir-f-tab").value,
          stv = q(el, "#ir-f-st").value, due = q(el, "#ir-f-due").value, map = q(el, "#ir-f-map").value;
      var list = data.filter(function (n) {
        if (sec && n.section !== sec) return false;
        if (tab && n.tab !== tab) return false;
        if (stv === "open" && ["closed","archived","not_ours"].indexOf(n.status) > -1) return false;
        if (stv && stv !== "open" && n.status !== stv) return false;
        if (due) { var d = daysTo(n.due_date); if (d === null) return false; if (due === "od" ? d >= 0 : (d < 0 || d > +due)) return false; }
        if (map === "un" && matchClient(n.reg_no)) return false;
        if (qv && ((n.client_name || "") + " " + (n.reg_no || "") + " " + (n.task || "")).toLowerCase().indexOf(qv) < 0) return false;
        return true;
      });
      list.sort(function (a, b) {   // priority: overdue/soonest first, then high-risk sections
        var da = daysTo(a.due_date), db = daysTo(b.due_date);
        var oa = ["closed","archived","not_ours","submitted"].indexOf(a.status) > -1, ob = ["closed","archived","not_ours","submitted"].indexOf(b.status) > -1;
        if (oa !== ob) return oa ? 1 : -1;
        if (da !== db) return (da === null ? 1e9 : da) - (db === null ? 1e9 : db);
        return (HIGH.test(b.law_section || "") ? 1 : 0) - (HIGH.test(a.law_section || "") ? 1 : 0);
      });
      var shown = list.slice(0, 500);
      q(el, "#ir-n-body").innerHTML = shown.map(function (n) { return noticeRow(n, true); }).join("") || '<tr><td colspan="6" class="ir-muted">No notices match.</td></tr>';
      wireRows(el, shown);
      var od = data.filter(function (n) { var d = daysTo(n.due_date); return d !== null && d < 0 && ["closed","archived","not_ours","submitted"].indexOf(n.status) < 0; }).length;
      var un = data.filter(function (n) { return !n.archived && !matchClient(n.reg_no); }).length;
      q(el, "#ir-n-sub").textContent = data.length + " notices from IRIS · " + list.length + " shown" + (list.length > 500 ? " (first 500)" : "") + " · " + od + " overdue · " + un + " unmatched";
    }
    function load(force) {
      loadNotices(force).then(function (d) {
        data = d;
        var tabs = {}; d.forEach(function (n) { tabs[n.tab] = 1; });
        q(el, "#ir-f-tab").innerHTML = '<option value="">All tabs</option>' + Object.keys(tabs).sort().map(function (t) { return "<option>" + esc(t) + "</option>"; }).join("");
        render();
      }).catch(function (e) { q(el, "#ir-n-sub").textContent = "Could not load: " + (e.message || e); });
    }
    ["#ir-f-q","#ir-f-sec","#ir-f-tab","#ir-f-st","#ir-f-due","#ir-f-map"].forEach(function (s) { q(el, s).oninput = render; q(el, s).onchange = render; });
    q(el, "#ir-f-r").onclick = function () { load(true); };
    window.IRIS._refresh = function () { load(true); };
    load(false);
  }

  /* ══════════════════════════════════════════════════════════════════════
     CLIENT PROFILE → CORRESPONDENCE TAB
     ══════════════════════════════════════════════════════════════════════ */
  function clientTab(el, client) {
    if (!online()) { el.innerHTML = '<div class="task-empty">Connect to the online database to see IRIS correspondence.</div>'; return; }
    el.innerHTML = '<div class="ir-muted">Loading IRIS correspondence…</div>';
    loadNotices(false).then(function (all) {
      var key = clientKey(client), ids = [digits(client.id), digits(client.ntn)].filter(Boolean);
      var mine = all.filter(function (n) {
        var d = digits(n.reg_no);
        return ids.indexOf(d) > -1 || (LINKS && LINKS[d] === key);
      });
      if (!mine.length) { el.innerHTML = '<div class="task-empty">No IRIS notices for this client yet.</div>'; return; }
      var open = mine.filter(function (n) { return ["closed","archived","not_ours"].indexOf(n.status) < 0; }).length;
      el.innerHTML = '<div class="ir-row" style="margin-bottom:10px"><b>' + mine.length + ' notices</b><span class="ir-muted">· ' + open + ' open</span></div>'
        + '<div class="ir-scroll"><table class="ir-t"><thead><tr><th>Notice</th><th>Year</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>'
        + mine.map(function (n) { return noticeRow(n, false); }).join("") + "</tbody></table></div>";
      wireRows(el, mine);
    }).catch(function (e) { el.innerHTML = '<div class="task-empty">Could not load: ' + esc(e.message || e) + "</div>"; });
  }

  /* The filed income tax returns that IRIS Sync downloaded (Completed Tasks > DECLARATION, s.114, one tax year), each matched to a client */
  function returns(ty) {
    return loadNotices(true).then(function (all) {
      var out = [];
      all.forEach(function (n) {
        if (n.section !== "Completed Tasks" || String(n.tab || "").toUpperCase() !== "DECLARATION") return;
        if (!/^\s*114/.test(n.law_section || n.task || "")) return;
        if (String(n.tax_year || "") !== String(ty)) return;
        if (!n.pdf_ok || !n.pdf_path) return;
        var m = matchClient(n.reg_no);
        out.push({id: n.id, reg_no: n.reg_no, name: n.client_name, path: n.pdf_path, idx: m ? m.idx : -1, seen: n.first_seen || ""});
      });
      out.sort(function (a, b) { return String(a.seen).localeCompare(String(b.seen)); });   // newest last, so it wins when a client has two
      return out;
    });
  }

  window.IRIS = {returns: returns, syncPage: syncPage, noticesPage: noticesPage, clientTab: clientTab, matchClient: matchClient,
                 reload: function () { NCACHE = null; LINKS = null; }};
})();

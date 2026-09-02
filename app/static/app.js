/* ITR notice tool - dashboard behaviour.
   No framework and no build step: this file is served as-is.
   Sections: theme, toast, websocket, pipeline, viewport, notices table,
   Claude surfaces, drawer, command palette, keyboard. */

const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ theme */
// Cookie, not localStorage: the server may want it later, and it survives a
// hard reload without a flash of the wrong theme.
function readCookie(name) {
  return document.cookie.split('; ').find(c => c.startsWith(name + '='))?.split('=')[1];
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.cookie = `theme=${t}; path=/; max-age=31536000; samesite=lax`;
  const btn = $('theme');
  if (btn) btn.setAttribute('aria-label',
    t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
setTheme(readCookie('theme') === 'light' ? 'light' : 'dark');
$('theme').onclick = () =>
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ------------------------------------------------------------------ toast */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

/* ------------------------------------------------------------------- log */
function log(msg) {
  const el = $('log');
  el.textContent += '\n' + msg;
  el.scrollTop = el.scrollHeight;
  $('caption').textContent = msg.trim();
}

const STATE_LABEL = {
  idle: 'idle', running: 'syncing', failed: 'failed',
  credentials_required: 'needs portal login', otp_required: 'waiting for OTP',
  done: 'done', disconnected: 'disconnected',
};

function setState(s) {
  $('state').textContent = STATE_LABEL[s] || s;
  const dot = $('dot');
  dot.className = 'dot' + (s === 'running' ? ' running' : s === 'failed' ? ' failed' : '');
}

/* -------------------------------------------------------------- pipeline */
const STAGES = [
  { key: 'login', label: 'Login' },
  { key: 'list', label: 'Open list' },
  { key: 'walk', label: 'Walk proceedings' },
  { key: 'download', label: 'Download PDFs' },
  { key: 'done', label: 'Done' },
];
let stageNow = null, stageCounts = {};

function renderPipe() {
  const at = STAGES.findIndex(s => s.key === stageNow);
  $('pipe').innerHTML = STAGES.map((s, i) => {
    const cls = at < 0 ? '' : i < at ? 'done' : i === at ? 'active' : '';
    const counts = (i === at && stageCounts) ? Object.entries(stageCounts)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ') : '';
    return `<span class="step ${cls}">
        <span class="bead">${cls === 'done' ? '&check;' : i + 1}</span>
        ${esc(s.label)}${counts ? ` <span class="count">${counts}</span>` : ''}
      </span>${i < STAGES.length - 1 ? '<span class="sep"></span>' : ''}`;
  }).join('');
}
renderPipe();

/* -------------------------------------------------------------- viewport */
function showFrame(b64) {
  const screen = $('screen');
  let img = screen.querySelector('img');
  if (!img) {
    screen.innerHTML = '';
    img = document.createElement('img');
    img.alt = 'What the bot is looking at right now';
    screen.appendChild(img);
  }
  img.src = 'data:image/jpeg;base64,' + b64;
  $('mon-hint').textContent = 'live';
}

/* ------------------------------------------------------------- websocket */
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://')
  + location.host + '/ws');

ws.onmessage = ev => {
  const d = JSON.parse(ev.data);
  if (d.type === 'log') log(d.msg);
  if (d.type === 'state') {
    setState(d.state);
    if (d.state === 'credentials_required') showGate('creds');
  }
  if (d.type === 'credentials_required') { showGate('creds', d.error); setState('login needed'); }
  if (d.type === 'otp_required') { showGate('otp'); setState('waiting for OTP'); }
  if (d.type === 'progress') {
    stageNow = d.stage;
    stageCounts = d.counts || {};
    renderPipe();
    $('monitor').open = true;          // a run started: show the viewport
  }
  if (d.type === 'speed') { MODE = d.mode; paintSpeed(); }
  if (d.type === 'viewport') showFrame(d.img);
  if (d.type === 'sync_finished') {
    setState(d.status);
    stageNow = d.status === 'done' ? 'done' : stageNow;
    renderPipe();
    $('mon-hint').textContent = 'run finished';
    loadNotices();
  }
};
ws.onclose = () => setState('disconnected');

/* ------------------------------------------------------------- the gates */
function showGate(which, err) {
  $(which).classList.add('show');
  if (which === 'creds') $('credserr').textContent = err || '';
  const focus = which === 'creds' ? 'uid' : 'otpcode';
  $(focus).focus();
}
function hideGate(which) {
  $(which).classList.remove('show');
  if (which === 'creds') $('credserr').textContent = '';
}

const limitValue = () => {
  const v = parseInt($('limit').value, 10);
  return Number.isFinite(v) && v > 0 ? v : null;
};

async function startSync() {
  const limit = limitValue();
  const r = await fetch('/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  if (r.status === 409) { toast('A sync is already running.'); return; }
  const d = await r.json();
  if (d.state === 'credentials_required') { showGate('creds'); return; }
  setState('running');
  $('monitor').open = true;
  log(limit ? `Sync started (at most ${limit} new PDFs)` : 'Sync started (all notices)');
}
$('sync').onclick = startSync;

$('credform').onsubmit = async (ev) => {
  ev.preventDefault();                     // stay on the page, post it ourselves
  const user_id = $('uid').value.trim();
  const pwdBox = $('pwd');
  const password = pwdBox.value;
  if (!user_id || !password) {
    $('credserr').textContent = 'Enter both the user ID and the password.';
    return;
  }
  const r = await fetch('/api/credentials', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id, password, limit: limitValue() }),
  });
  pwdBox.value = '';                       // never leave the password in the DOM
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    $('credserr').textContent = e.error || 'Could not store the login.';
    return;
  }
  hideGate('creds');
  setState('running');
  $('monitor').open = true;
  log('Login sent (server memory only). Sync started');
};

$('otpsend').onclick = async () => {
  const code = $('otpcode').value.trim();
  if (!/^\d{4,8}$/.test(code)) { toast('Enter the numeric OTP first.'); return; }
  await fetch('/api/otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  hideGate('otp');
  $('otpcode').value = '';
  setState('running');
};

$('signout').onclick = async () => { await fetch('/logout', { method: 'POST' }); location.reload(); };

/* ----------------------------------------------------------- speed control */
// The pace belongs to the server, not to this browser: it is the delay the
// scraper waits before every action, read fresh each time. So a click here
// changes the speed of a sync that is already running, not just the next one.
let MODE = 'fast';
function paintSpeed() {
  document.querySelectorAll('.seg button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.speed === MODE)));
  $('speednote').hidden = MODE !== 'extreme';
}
async function setSpeed(next) {
  try {
    const r = await fetch('/api/speed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Could not change the speed.'); return; }
    MODE = d.mode;                   // the ws push repaints every other tab
    paintSpeed();
    toast(`Speed: ${MODE} (${d.delay_ms}ms per action)`);
  } catch (e) {
    toast('Could not reach the server.');
  }
}
document.querySelectorAll('.seg button').forEach(b => {
  b.onclick = () => setSpeed(b.dataset.speed);
});
paintSpeed();

/* ----------------------------------------------------------------- table */
// The one button that spends money, marked with the same ✦ as everything
// else Claude wrote on this page.
const DATE_BTN = '&#10022; Date';
let NOTICES = [];
let LOADING = true;

function dueInDays(due) {
  if (!due) return null;
  const t = Date.parse(due);
  if (Number.isNaN(t)) return null;
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  return Math.round((t - midnight.getTime()) / 86400000);
}

// Countdown chip: green with room, amber inside two weeks, red inside three
// days or already gone.
function dueChip(n) {
  if (!n.due_date) {
    return '<span class="chip none">no date</span>';
  }
  const d = dueInDays(n.due_date);
  if (d === null) return `<span class="chip none">${esc(n.due_date)}</span>`;
  // vcfo's countdown tones: overdue or under a week is danger, under a month
  // is warning, beyond that is fine.
  const cls = d < 7 ? 'late' : d < 30 ? 'soon' : 'ok';
  const label = d < 0 ? `overdue ${Math.abs(d)}d` : d === 0 ? 'today' : `${d}d`;
  const badge = n.due_date_source === 'claude'
    ? `<span class="ai-chip" title="${esc(n.due_date_basis || 'found by Claude')}">&#10022; by Claude</span>`
    : '';
  return `<span class="chip ${cls}" title="${esc(n.due_date)}">${label}</span>${badge}`;
}

// Five numbers, counted over everything the account holds - never over the
// filtered view, which would make the filters look like they changed the facts.
function renderStats(rows) {
  const week = rows.filter(n => {
    const d = dueInDays(n.due_date);
    return d !== null && d >= 0 && d <= 7;
  }).length;
  const noDue = rows.filter(n => !n.due_date).length;
  const docs = rows.filter(n => n.has_pdf).length;
  const drafts = rows.filter(n => n.has_draft).length;

  const put = (id, value) => {
    const el = $(id);
    el.textContent = value;
    el.parentElement.classList.toggle('zero', value === 0);
  };
  put('s-total', rows.length);
  put('s-week', week);
  put('s-nodue', noDue);
  put('s-docs', docs);
  put('s-drafts', drafts);
}

// What the last finished run did, in one line, from the runs table. A run
// that failed says only that - its message is a whole sentence, so it goes
// in the tooltip rather than across the page.
function renderLastSync(run) {
  const el = $('lastsync');
  if (!run) { el.textContent = 'No sync has finished yet.'; return; }
  const when = relTime(run.finished) || run.finished || '';
  if (run.status !== 'done') {
    el.innerHTML = `Last sync <b>${esc(when)}</b> · `
      + `<span class="bad" title="${esc(run.message || 'no reason recorded')}">`
      + `${esc(run.status || 'failed')}</span>`;
    return;
  }
  const n = v => (v === null || v === undefined ? 0 : v);
  el.innerHTML = `Last sync <b>${esc(when)}</b> · <b>${n(run.notices_new)}</b> new`
    + ` · <b>${n(run.pdfs_saved)}</b> PDFs saved`
    + ` · <b>${n(run.skipped_cached)}</b> already held`;
}

function fillYears(rows) {
  const sel = $('f-ay');
  const years = [...new Set(rows.map(n => n.assessment_year).filter(Boolean))].sort();
  const keep = sel.value;
  sel.innerHTML = '<option value="">All</option>' + years.map(y => `<option>${esc(y)}</option>`).join('');
  if (years.includes(keep)) sel.value = keep;
}

// Three dots per row, so the table reads as the checklist it is: do we hold
// the document, do we know the deadline, is there a draft waiting. Filled
// green when done, hollow grey when not, and each one says which it is.
function statusCell(n) {
  const marks = [
    ['PDF', !!n.has_pdf, n.has_pdf ? 'PDF saved' : 'no PDF stored yet'],
    ['date', !!n.due_date, n.due_date
      ? `due ${n.due_date}` : 'no due date on this notice'],
    ['draft', !!n.has_draft, n.has_draft ? 'draft written' : 'no draft yet'],
  ];
  return `<div class="ticks">${marks.map(([label, on, title]) =>
    `<span class="tick${on ? ' on' : ''}" role="img" title="${esc(label)}: ${
      esc(title)}" aria-label="${esc(label)} ${on ? 'done' : 'not yet'}"></span>`
  ).join('')}</div>`;
}

function visibleRows() {
  const ay = $('f-ay').value;
  const name = $('f-name').value.trim().toLowerCase();
  const noDue = $('f-nodue').checked;
  return NOTICES.filter(n =>
    (!ay || n.assessment_year === ay)
    && (!name || (n.proceeding_name || '').toLowerCase().includes(name))
    && (!noDue || !n.due_date));
}

const SKELETON = Array.from({ length: 5 }, () => `<tr>${
  ['58%', '70%', '40%', '34%', '52%', '46%'].map(w =>
    `<td><div class="skel" style="width:${w}"></div></td>`).join('')}</tr>`).join('');

const EMPTY_SVG = `<svg width="42" height="42" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true"><path d="M14 3v4a1 1 0 0 0 1 1h4"/>
  <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/>
  <path d="M9 13h6M9 17h4"/></svg>`;

function applyFilters() {
  const tb = $('rows');
  if (LOADING) { tb.innerHTML = SKELETON; $('f-count').textContent = ''; return; }

  const rows = visibleRows();
  $('f-count').textContent = rows.length === NOTICES.length
    ? `${NOTICES.length} notice(s)` : `${rows.length} of ${NOTICES.length}`;

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6"><div class="empty-state">
        ${EMPTY_SVG}
        <div class="mut">${NOTICES.length
          ? 'Nothing matches these filters.'
          : 'No notices stored yet.'}</div>
        ${NOTICES.length ? '' : '<button class="primary" onclick="startSync()">Run first sync</button>'}
      </div></td></tr>`;
    return;
  }

  tb.innerHTML = rows.map(n => `<tr>
      <td>${esc(n.notice_us || '—')}
        <div class="sub">${esc(n.description || '')}</div>
        <div><span class="idchip">${esc(n.ref_id || '')}</span></div></td>
      <td>${esc(n.proceeding_name || '—')}
        <div class="sub mono">${esc(n.pan || '')} · AY ${esc(n.assessment_year || '—')}</div></td>
      <td class="mono">${esc(n.issued_on || '—')}</td>
      <td>${dueChip(n)}</td>
      <td>${statusCell(n)}</td>
      <td class="right"><div class="rowacts">
        ${n.has_pdf ? `<button onclick="view('${esc(n.ref_id)}')">View</button>
                       <button onclick="savePdf('${esc(n.ref_id)}')">Save</button>` : ''}
        ${(!n.due_date && n.has_pdf)
          ? `<button onclick="askClaude('${esc(n.ref_id)}', this)">${DATE_BTN}</button>` : ''}
        ${n.has_pdf
          ? `<button class="primary" onclick="generateDraft('${esc(n.ref_id)}', this)">Draft</button>` : ''}
      </div></td>
    </tr>`).join('');
}

async function loadNotices() {
  try {
    const r = await fetch('/api/notices');
    if (r.status === 401) { location.reload(); return; }
    const d = await r.json();
    LOADING = false;
    if (d.state === 'credentials_required') showGate('creds'); else setState(d.state);
    NOTICES = d.notices || [];
    renderStats(NOTICES);
    renderLastSync(d.last_run);
    fillYears(NOTICES);
    applyFilters();
  } catch (e) {
    LOADING = false;
    $('rows').innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <div class="mut">Could not reach the server.</div>
      <button onclick="loadNotices()">Try again</button></div></td></tr>`;
  }
}

for (const id of ['f-ay', 'f-name', 'f-nodue']) {
  const el = $(id);
  el.addEventListener(el.type === 'text' ? 'input' : 'change', applyFilters);
}

/* --------------------------------------------------------------- actions */
// Read it here, in a modal, rather than in a tab: the point of the table is
// that you never leave it.
const viewer = $('viewer');

function view(refId) {
  $('v-ref').textContent = refId;
  $('v-frame').src = `/api/notices/${encodeURIComponent(refId)}/pdf?inline=1`;
  viewer.classList.add('show');
  $('v-close').focus();
}

function closeViewer() {
  viewer.classList.remove('show');
  $('v-frame').src = 'about:blank';   // stop the PDF plugin running behind it
}

// The server already answers this one with Content-Disposition: attachment,
// so the browser saves it instead of navigating anywhere.
function savePdf(refId) {
  location.href = `/api/notices/${encodeURIComponent(refId)}/pdf`;
}

$('v-close').onclick = closeViewer;
$('v-save').onclick = () => savePdf($('v-ref').textContent);
viewer.onclick = ev => { if (ev.target === viewer) closeViewer(); };

async function askClaude(refId, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const r = await fetch(`/api/notices/${refId}/ask-claude`, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Could not ask Claude.'); return; }
    if (d.due_date) {
      const row = NOTICES.find(n => n.ref_id === refId);
      if (row) {
        row.due_date = d.due_date;
        row.due_date_source = d.source || 'claude';
        row.due_date_basis = d.basis;
      }
      renderStats(NOTICES);          // one fewer "missing date"
      applyFilters();
      toast(`Due ${d.due_date}${d.basis ? ' — ' + d.basis : ''}`);
    } else {
      // Plenty of letters genuinely set no deadline: say so quietly.
      btn.replaceWith(Object.assign(document.createElement('span'),
        { className: 'mut', textContent: 'no date stated',
          title: d.basis || 'Claude found no deadline in this notice' }));
    }
  } catch (e) {
    toast('Could not reach the server.');
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = DATE_BTN; }
  }
}

/* ---------------------------------------------------------------- drawer */
let DRAFT_REF = null;
const drawer = $('drawer');

function relTime(stamp) {
  if (!stamp) return '';
  const t = Date.parse(stamp.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return stamp;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function aiCard(body, footer, basis) {
  return `<div class="ai-card">
      <div class="ai-head"><span class="mark" style="display:grid;place-items:center">&#10022;</span>
        <span class="h" style="margin:0">Summary</span></div>
      <div>${body}</div>
      <div class="ai-foot">&#10022; Generated by Claude${footer ? ' · ' + footer : ''}${basis ? ' · basis: ' + esc(basis) : ''}
        <button class="regen" onclick="regenerate()">Regenerate</button></div>
    </div>`;
}

function showDraft(d) {
  DRAFT_REF = d.ref_id;
  $('d-summary').innerHTML = aiCard(esc(d.summary || '(no summary)'),
                                    relTime(d.generated_at), d.basis);
  $('d-checklist').innerHTML = (d.checklist && d.checklist.length)
    ? d.checklist.map(c => `<div class="checkline"><span class="box"></span><span>${esc(c)}</span></div>`).join('')
    : '<div class="mut">Nothing specific demanded.</div>';
  $('d-text').value = d.draft_text || '';
  $('d-meta').textContent = (d.cached ? 'saved ' : 'generated ') + relTime(d.generated_at);
  drawer.classList.add('show');
  $('d-close').focus();
}

async function generateDraft(refId, btn, regen) {
  const label = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    const url = `/api/notices/${refId}/draft` + (regen ? '?regenerate=1' : '');
    const r = await fetch(url, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Could not generate a draft.'); return; }
    showDraft(d);
    // the row's draft tick, without a refetch
    const row = NOTICES.find(n => n.ref_id === refId);
    if (row && !row.has_draft) {
      row.has_draft = 1;
      renderStats(NOTICES);          // one more "drafts ready"
      applyFilters();
    }
  } catch (e) {
    toast('Could not reach the server.');
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label || 'Draft'; }
  }
}

function regenerate() {
  if (DRAFT_REF) generateDraft(DRAFT_REF, $('d-regen'), true);
}
$('d-regen').onclick = regenerate;
$('d-close').onclick = () => drawer.classList.remove('show');
drawer.onclick = ev => { if (ev.target === drawer) drawer.classList.remove('show'); };

$('d-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('d-text').value);
    toast('Draft copied.');
  } catch (e) {
    $('d-text').select();
    toast('Press Ctrl+C to copy.');
  }
};

/* ------------------------------------------------------- command palette */
const palette = $('palette'), palInput = $('pal-input'), palList = $('pal-list');
let palItems = [], palAt = 0;

function commands() {
  const base = [
    { label: 'Run sync', hint: 's', run: startSync },
    { label: 'Toggle theme', hint: '', run: () => $('theme').click() },
    { label: 'Speed: slow', run: () => setSpeed('slow') },
    { label: 'Speed: fast', run: () => setSpeed('fast') },
    { label: 'Speed: extreme (testing only)', run: () => setSpeed('extreme') },
    { label: 'Filter: missing due date', run: () => { $('f-nodue').checked = true; applyFilters(); } },
    { label: 'Clear filters', run: () => { $('f-ay').value = ''; $('f-name').value = ''; $('f-nodue').checked = false; applyFilters(); } },
    { label: 'Toggle live viewport', run: () => { $('monitor').open = !$('monitor').open; } },
  ];
  const notices = NOTICES.filter(n => n.has_pdf).map(n => ({
    label: `Open notice ${n.ref_id}`,
    hint: (n.description || n.proceeding_name || '').slice(0, 40),
    haystack: `${n.ref_id} ${n.description || ''} ${n.proceeding_name || ''}`,
    run: () => view(n.ref_id),
  }));
  return base.concat(notices);
}

// Subsequence match, the way every command palette does it: "rs" finds "Run sync".
function fuzzy(needle, hay) {
  if (!needle) return true;
  const h = hay.toLowerCase();
  let i = 0;
  for (const ch of needle.toLowerCase()) {
    i = h.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

function palRender() {
  const q = palInput.value.trim();
  palItems = commands().filter(c => fuzzy(q, c.haystack || c.label)).slice(0, 40);
  palAt = Math.min(palAt, Math.max(0, palItems.length - 1));
  palList.innerHTML = palItems.length
    ? palItems.map((c, i) => `<li role="option" aria-selected="${i === palAt}" data-i="${i}">
         <span>${esc(c.label)}</span>${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}</li>`).join('')
    : '<li class="mut" aria-disabled="true">Nothing matches.</li>';
}

function palOpen() {
  palette.classList.add('show');
  palInput.value = '';
  palAt = 0;
  palRender();
  palInput.focus();
}
function palClose() { palette.classList.remove('show'); }

palInput.addEventListener('input', palRender);
palList.addEventListener('click', ev => {
  const li = ev.target.closest('li[data-i]');
  if (!li) return;
  const cmd = palItems[+li.dataset.i];
  palClose();
  cmd && cmd.run();
});
palette.addEventListener('click', ev => { if (ev.target === palette) palClose(); });
$('palette-open').onclick = palOpen;

palInput.addEventListener('keydown', ev => {
  if (ev.key === 'ArrowDown') { palAt = Math.min(palAt + 1, palItems.length - 1); palRender(); ev.preventDefault(); }
  if (ev.key === 'ArrowUp') { palAt = Math.max(palAt - 1, 0); palRender(); ev.preventDefault(); }
  if (ev.key === 'Enter') { const c = palItems[palAt]; palClose(); c && c.run(); }
});

/* --------------------------------------------------------------- keyboard */
document.addEventListener('keydown', ev => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palOpen(); return; }
  if (ev.key === 'Escape') { palClose(); closeViewer(); drawer.classList.remove('show'); return; }
  if (typing) return;
  if (ev.key === 's') { ev.preventDefault(); startSync(); }
  if (ev.key === '/') { ev.preventDefault(); $('f-name').focus(); }
});

loadNotices();

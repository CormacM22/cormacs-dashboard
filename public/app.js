const main = document.getElementById('main');
const navTabs = document.querySelectorAll('.nav-tab');
const navTimer = document.getElementById('nav-timer');

const QUOTES = [
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: "Whether you think you can or you think you can't, you're right.", author: 'Henry Ford' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { text: 'Do the hard jobs first. The easy jobs will take care of themselves.', author: 'Dale Carnegie' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso' },
  { text: 'You miss 100% of the shots you don’t take.', author: 'Wayne Gretzky' },
  { text: 'What you get by achieving your goals is not as important as what you become by achieving your goals.', author: 'Zig Ziglar' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Quality means doing it right when no one is looking.', author: 'Henry Ford' },
  { text: 'Small daily improvements are the key to staggering long-term results.', author: 'James Clear' },
  { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Abraham Lincoln' },
  { text: 'Don’t watch the clock; do what it does. Keep going.', author: 'Sam Levenson' },
  { text: 'You don’t have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  { text: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
];

let clientsCache = [];
let currentView = 'home'; // 'home', 'briefing', 'clients', or a client slug

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Time helpers ----------
//
// These mirror dashboard/lib/time.js. That module is the tested source of truth for
// anything billed; these exist only so the browser can render a live-ticking clock
// without a round trip. Keep them in step — if they ever disagree, the server wins.

const LONG_RUNNING_MS = 8 * 60 * 60 * 1000;

function entryDurationMs(entry, now = Date.now()) {
  if (!entry || !entry.start) return 0;
  const start = new Date(entry.start).getTime();
  const end = entry.end ? new Date(entry.end).getTime() : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function totalDurationMs(entries, now = Date.now()) {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, e) => sum + entryDurationMs(e, now), 0);
}

function formatDuration(ms) {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** With seconds — only for the live ticking timer, so it visibly moves. */
function formatDurationLive(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Truncate to whole minutes first so this always matches formatDuration above —
// see the note in lib/time.js. Mirrors billableHours() there.
function billableHours(ms) {
  const wholeMinutes = Math.floor(Math.max(0, ms) / 60000);
  return (Math.round((wholeMinutes / 60) * 100) / 100).toFixed(2);
}

function weekStartOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday-based week
  return d;
}

function entriesThisWeek(entries) {
  const from = weekStartOf().getTime();
  return (entries || []).filter((e) => new Date(e.start).getTime() >= from);
}

/** For datetime-local inputs, which expect local time with no timezone suffix. */
function toLocalInputValue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return '🖼️';
  if (['mp3', 'm4a', 'wav', 'aac', 'ogg'].includes(ext)) return '🎙️';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return '🎬';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  return '📎';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadClients() {
  clientsCache = await api('/api/clients');
}

function updateNavActive() {
  // A client hub is a sub-page of "Clients", so that tab stays highlighted there too.
  let activeTab = 'clients';
  if (currentView === 'home') activeTab = 'home';
  else if (currentView === 'briefing') activeTab = 'briefing';
  navTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === activeTab));
}

async function goto(view) {
  currentView = view;
  updateNavActive();
  if (view === 'home') {
    renderHome();
  } else if (view === 'briefing') {
    await loadClients(); // re-fetch: a to-do/note/money change on another view must be reflected here
    renderBriefing();
  } else if (view === 'clients') {
    await loadClients();
    renderClientsGrid();
  } else {
    renderClientHub(view);
  }
}

navTabs.forEach((tab) => tab.addEventListener('click', () => goto(tab.dataset.view)));

// ---------- Nav timer ----------
//
// Visible on every page. The running timer is stored server-side, so it survives a
// page reload, a closed browser, or the server restarting — the clock below is only a
// display of `runningTimer.entry.start`, never the source of the elapsed time.

let runningTimer = null;
let hubClient = null; // the client currently shown on the hub, for live total updates

async function refreshTimer() {
  try {
    const { running } = await api('/api/timer');
    runningTimer = running;
  } catch {
    runningTimer = null; // server unreachable: show nothing rather than a stale time
  }
  renderNavTimer();
}

function renderNavTimer() {
  if (!runningTimer) {
    navTimer.hidden = true;
    return;
  }
  const ms = entryDurationMs(runningTimer.entry);
  const overlong = ms >= LONG_RUNNING_MS;
  navTimer.hidden = false;
  navTimer.classList.toggle('overlong', overlong);
  navTimer.innerHTML = `
    <span class="nav-timer-dot"></span>
    <span class="nav-timer-name">${escapeHtml(runningTimer.name)}</span>
    <span class="nav-timer-clock">${formatDurationLive(ms)}</span>
    ${overlong ? '<span class="nav-timer-warn" title="Running over 8 hours — did you forget to stop it?">⚠</span>' : ''}
  `;
}

navTimer.addEventListener('click', () => {
  if (runningTimer) goto(runningTimer.slug);
});

/** One-second tick for every live clock on screen. */
function tickLiveClocks() {
  renderNavTimer();

  // The hub's own clock, when you're looking at the client being timed.
  const hubClock = document.getElementById('hub-timer-clock');
  if (hubClock && runningTimer && runningTimer.slug === currentView) {
    hubClock.textContent = formatDurationLive(entryDurationMs(runningTimer.entry));

    // Keep the totals moving too. Left static, they'd read "0m total" beside a timer
    // that had been running an hour — the screen disagreeing with reality.
    const entries = (hubClient && hubClient.timeEntries) || [];
    const totalEl = document.getElementById('time-total');
    const weekEl = document.getElementById('time-week');
    if (totalEl) totalEl.textContent = formatDuration(totalDurationMs(entries));
    if (weekEl) weekEl.textContent = formatDuration(totalDurationMs(entriesThisWeek(entries)));
  }
}

// Tick the display every second; re-check the server every 30s in case the timer was
// changed from another tab.
setInterval(tickLiveClocks, 1000);
setInterval(refreshTimer, 30000);

// ---------- Home ----------

function renderHome() {
  const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  main.innerHTML = `
    <div class="hero">
      <h1 class="hero-title">Cormac's Hub</h1>
      <p class="hero-quote">“${escapeHtml(quote.text)}”<br /><span class="hero-author">— ${escapeHtml(quote.author)}</span></p>
      <button class="hero-shuffle" id="shuffle-quote">Another one →</button>
    </div>
  `;
  document.getElementById('shuffle-quote').addEventListener('click', renderHome);
}

// ---------- Briefing ----------

function renderBriefing() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dueItems = [];
  clientsCache.forEach((client) => {
    client.todos
      .filter((t) => !t.done && t.due)
      .forEach((t) => dueItems.push({ client, todo: t }));
  });
  dueItems.sort((a, b) => a.todo.due.localeCompare(b.todo.due));

  const noDateItems = [];
  clientsCache.forEach((client) => {
    client.todos
      .filter((t) => !t.done && !t.due)
      .forEach((t) => noDateItems.push({ client, todo: t }));
  });

  const dueRowsHtml = dueItems.length
    ? dueItems
        .map(({ client, todo }) => {
          const dueDate = new Date(todo.due);
          const overdue = dueDate < today;
          return `<div class="due-row${overdue ? ' overdue' : ''}">
            <span class="due-client-tag">${escapeHtml(client.name)}</span>
            <span class="due-text">${escapeHtml(todo.text)}</span>
            <span class="due-date">${overdue ? 'overdue · ' : ''}${formatDate(todo.due)}</span>
          </div>`;
        })
        .join('')
    : '<div class="empty">Nothing with a due date. Clear skies.</div>';

  const noDateHtml = noDateItems.length
    ? noDateItems
        .map(
          ({ client, todo }) => `<div class="due-row">
            <span class="due-client-tag">${escapeHtml(client.name)}</span>
            <span class="due-text">${escapeHtml(todo.text)}</span>
          </div>`
        )
        .join('')
    : '<div class="empty">Nothing open without a date.</div>';

  const moneyHtml = clientsCache.length
    ? clientsCache
        .map(
          (c) => `<div class="money-row">
            <span>${escapeHtml(c.name)}</span>
            <span class="money-badge">${escapeHtml(c.money || 'not started')}</span>
          </div>`
        )
        .join('')
    : '<div class="empty">Add a client to see them here.</div>';

  // Time this week, biggest first — answers "which client is eating my week".
  const weekRows = clientsCache
    .map((c) => ({ client: c, ms: totalDurationMs(entriesThisWeek(c.timeEntries)) }))
    .filter((r) => r.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const weekTotal = weekRows.reduce((sum, r) => sum + r.ms, 0);

  const timeHtml = weekRows.length
    ? weekRows
        .map(
          (r) => `<div class="money-row">
            <span>${escapeHtml(r.client.name)}</span>
            <span class="time-badge">${formatDuration(r.ms)} <span class="time-hours">(${billableHours(r.ms)} h)</span></span>
          </div>`
        )
        .join('') +
      `<div class="money-row week-total"><span><strong>Total</strong></span><span class="time-badge"><strong>${formatDuration(weekTotal)}</strong> <span class="time-hours">(${billableHours(weekTotal)} h)</span></span></div>`
    : '<div class="empty">No time logged this week yet.</div>';

  main.innerHTML = `
    <h1>Today's briefing</h1>
    <p class="subtitle">${today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    <div class="card">
      <h2>Due soon</h2>
      ${dueRowsHtml}
    </div>
    <div class="card">
      <h2>Open, no date set</h2>
      ${noDateHtml}
    </div>
    <div class="card">
      <h2>Time this week</h2>
      ${timeHtml}
    </div>
    <div class="card">
      <h2>Where things stand — money</h2>
      ${moneyHtml}
    </div>
  `;
}

// ---------- Clients grid ----------

function renderClientsGrid() {
  const cardsHtml = clientsCache.length
    ? clientsCache
        .map((c) => {
          const openTodos = c.todos.filter((t) => !t.done).length;
          return `<button class="client-card" data-slug="${escapeHtml(c.slug)}">
            <div class="client-card-name">${escapeHtml(c.name)}</div>
            <div class="client-card-building">${escapeHtml(c.building || '')}</div>
            <div class="client-card-footer">
              <span class="client-card-todos">${openTodos ? `${openTodos} open to-do${openTodos === 1 ? '' : 's'}` : 'No open to-dos'}</span>
              <span class="client-card-time" title="Total time logged">${formatDuration(totalDurationMs(c.timeEntries))}</span>
              <span class="money-badge" title="Payment status">Payment: ${escapeHtml(c.money || 'not started')}</span>
            </div>
          </button>`;
        })
        .join('')
    : '<div class="empty">No clients yet — add one to get started.</div>';

  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Clients</h1>
        <p class="subtitle">${clientsCache.length} active</p>
      </div>
      <button class="btn-primary" id="add-client-btn">+ Add client</button>
    </div>
    <div class="client-grid">${cardsHtml}</div>
  `;

  main.querySelectorAll('.client-card').forEach((card) =>
    card.addEventListener('click', () => goto(card.dataset.slug))
  );
  document.getElementById('add-client-btn').addEventListener('click', () => backdrop.classList.add('open'));
}

// ---------- Time section (client hub) ----------

function renderTimeEntryRow(e) {
  const open = !e.end;
  const duration = formatDuration(entryDurationMs(e));
  return `<div class="time-row${open ? ' running' : ''}" data-id="${e.id}">
    <div class="time-row-view">
      <span class="time-row-when">${escapeHtml(formatDateTime(e.start))}${e.end ? ` – ${escapeHtml(new Date(e.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}` : ''}</span>
      <span class="time-row-note">${escapeHtml(e.note || '')}</span>
      <span class="time-row-dur">${open ? 'running' : duration}</span>
      <button class="icon-btn time-edit" title="Edit">✎</button>
      <button class="icon-btn time-delete" title="Delete">✕</button>
    </div>
    <form class="time-row-edit" hidden>
      <label>Start<input type="datetime-local" name="start" value="${toLocalInputValue(e.start)}" required /></label>
      <label>End<input type="datetime-local" name="end" value="${e.end ? toLocalInputValue(e.end) : ''}" /></label>
      <label>Note<input type="text" name="note" value="${escapeHtml(e.note || '')}" placeholder="what you worked on" /></label>
      <div class="time-row-edit-actions">
        <button type="button" class="btn-secondary time-cancel">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>
  </div>`;
}

function renderTimeSection(client) {
  const entries = [...(client.timeEntries || [])].sort((a, b) => b.start.localeCompare(a.start));
  const total = totalDurationMs(entries);
  const week = totalDurationMs(entriesThisWeek(entries));
  const open = entries.find((e) => !e.end);

  const rows = entries.length
    ? entries.map(renderTimeEntryRow).join('')
    : '<div class="empty">No time logged yet.</div>';

  return `
    <section class="section" id="time-section">
      <div class="time-head">
        <h2>Time</h2>
        <div class="time-stats">
          <span class="time-stat"><strong id="time-total">${formatDuration(total)}</strong> total <span class="time-hours">(${billableHours(total)} h)</span></span>
          <span class="time-stat"><strong id="time-week">${formatDuration(week)}</strong> this week</span>
        </div>
      </div>

      <button class="timer-btn${open ? ' running' : ''}" id="timer-toggle" data-slug="${escapeHtml(client.slug)}">
        ${open
          ? `<span class="timer-btn-label">Stop timer</span><span class="timer-btn-clock" id="hub-timer-clock">${formatDurationLive(entryDurationMs(open))}</span>`
          : '<span class="timer-btn-label">Start timer</span>'}
      </button>
      ${open && entryDurationMs(open) >= LONG_RUNNING_MS
        ? '<div class="time-warning">⚠ This timer has been running over 8 hours. If you left it on, stop it and correct the entry below.</div>'
        : ''}

      <div id="time-entries">${rows}</div>

      <button class="btn-link" id="show-manual-time">+ Add time manually</button>
      <form class="manual-time" id="manual-time-form" hidden>
        <label>Start<input type="datetime-local" name="start" required /></label>
        <label>End<input type="datetime-local" name="end" required /></label>
        <label>Note<input type="text" name="note" placeholder="what you worked on" /></label>
        <button type="submit" class="btn-primary">Add</button>
      </form>
    </section>`;
}

function wireTimeEvents(slug) {
  const section = document.getElementById('time-section');
  if (!section) return;

  const reload = () => renderClientHub(slug);

  document.getElementById('timer-toggle').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; // a double-click must not open two timers
    try {
      if (btn.classList.contains('running')) {
        await api(`/api/clients/${slug}/timer/stop`, { method: 'POST' });
      } else {
        const res = await api(`/api/clients/${slug}/timer/start`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        // Never stop another client's timer silently — that would look like lost time.
        if (res.stopped) {
          showToast(`Stopped the timer on ${res.stopped.name} first — only one runs at a time.`);
        }
      }
      await refreshTimer();
      reload();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  });

  document.getElementById('show-manual-time').addEventListener('click', () => {
    const form = document.getElementById('manual-time-form');
    form.hidden = !form.hidden;
    if (!form.hidden) form.start.focus();
  });

  document.getElementById('manual-time-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/clients/${slug}/time-entries`, {
        method: 'POST',
        body: JSON.stringify({
          start: new Date(f.start.value).toISOString(),
          end: new Date(f.end.value).toISOString(),
          note: f.note.value,
        }),
      });
      reload();
    } catch (err) {
      alert(err.message);
    }
  });

  section.querySelectorAll('.time-row').forEach((row) => {
    const id = row.dataset.id;
    const view = row.querySelector('.time-row-view');
    const form = row.querySelector('.time-row-edit');

    row.querySelector('.time-edit').addEventListener('click', () => {
      view.hidden = true;
      form.hidden = false;
    });
    row.querySelector('.time-cancel').addEventListener('click', () => {
      form.hidden = true;
      view.hidden = false;
    });

    row.querySelector('.time-delete').addEventListener('click', async () => {
      if (!confirm('Delete this time entry? This cannot be undone.')) return;
      try {
        await api(`/api/clients/${slug}/time-entries/${id}`, { method: 'DELETE' });
        await refreshTimer();
        reload();
      } catch (err) {
        alert(err.message);
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/clients/${slug}/time-entries/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            start: new Date(form.start.value).toISOString(),
            end: form.end.value ? new Date(form.end.value).toISOString() : null,
            note: form.note.value,
          }),
        });
        await refreshTimer();
        reload();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function showToast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 4000);
}

// ---------- Client hub ----------

async function renderClientHub(slug) {
  main.innerHTML = '<p class="subtitle">Loading…</p>';
  let client;
  try {
    client = await api(`/api/clients/${encodeURIComponent(slug)}`);
    hubClient = client;
  } catch (err) {
    main.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    return;
  }

  const todosHtml = client.todos.length
    ? client.todos
        .slice()
        .sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))
        .map((t) => {
          const overdue = !t.done && t.due && new Date(t.due) < startOfToday();
          return `<label class="todo-row${t.done ? ' done' : ''}" data-id="${t.id}">
            <input type="checkbox" class="todo-check" ${t.done ? 'checked' : ''} />
            <span class="todo-text">${escapeHtml(t.text)}</span>
            ${t.due ? `<span class="todo-due${overdue ? ' overdue' : ''}">${formatDate(t.due)}</span>` : ''}
            <button class="icon-btn todo-delete" title="Delete">✕</button>
          </label>`;
        })
        .join('')
    : '<div class="empty">Nothing to do here yet.</div>';

  const notesHtml = client.notes.length
    ? client.notes
        .map(
          (n) => `<div class="note-card" data-id="${n.id}">
            <div class="note-date">${formatDate(n.date)} <button class="icon-btn note-delete" title="Delete" style="float:right;">✕</button></div>
            <div class="note-text">${escapeHtml(n.text)}</div>
          </div>`
        )
        .join('')
    : '<div class="empty">No notes yet — paste a Pocket transcript in here.</div>';

  main.innerHTML = `
    <button class="breadcrumb" id="back-to-clients">← All clients</button>

    <div class="hub-hero">
      <input class="hub-name-input" id="edit-name" value="${escapeHtml(client.name)}" />
      <div class="hub-hero-meta">
        <input id="edit-building" value="${escapeHtml(client.building)}" placeholder="what you're building" />
        <span class="hub-dot">·</span>
        <input id="edit-contact" value="${escapeHtml(client.contact)}" placeholder="contact" />
        <span class="money-status">
          <span class="money-status-label">Payment</span>
          <input class="money-status-input" id="edit-money" value="${escapeHtml(client.money)}" />
        </span>
      </div>
    </div>

    <div class="hub-columns">
      <div class="hub-main">
        ${renderTimeSection(client)}

        <section class="section">
          <h2>To-dos</h2>
          <div id="todo-list">${todosHtml}</div>
          <form class="todo-add" id="todo-form">
            <input type="text" name="text" placeholder="Add a to-do…" required />
            <input type="date" name="due" />
            <button class="btn-primary" type="submit">Add</button>
          </form>
        </section>

        <section class="section">
          <h2>Notes &amp; transcripts</h2>
          <textarea class="note-input" id="note-input" rows="3" placeholder="Paste a Pocket transcript or jot a note…"></textarea>
          <button class="btn-secondary" id="note-submit">Add note</button>
          <div id="note-list" style="margin-top:14px;">${notesHtml}</div>
        </section>
      </div>

      <aside class="hub-side">
        <h2>Files</h2>
        <div class="dropzone" id="dropzone">
          <span class="dropzone-plus">+</span>
          Drop files or click
        </div>
        <input type="file" id="file-input" style="display:none" multiple />
        <div id="file-list">Loading…</div>
      </aside>
    </div>
  `;

  document.getElementById('back-to-clients').addEventListener('click', () => goto('clients'));
  wireHubEvents(client.slug);
  wireTimeEvents(client.slug);
  loadFiles(client.slug);
}

function wireHubEvents(slug) {
  const saveField = async (field, value) => {
    const updated = await api(`/api/clients/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ [field]: value }),
    });
    const idx = clientsCache.findIndex((c) => c.slug === slug);
    if (idx !== -1) clientsCache[idx] = updated;
  };

  ['name', 'contact', 'building', 'money'].forEach((field) => {
    const el = document.getElementById(`edit-${field}`);
    el.addEventListener('blur', () => saveField(field, el.value));
  });

  document.getElementById('todo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const text = form.text.value.trim();
    const due = form.due.value || null;
    if (!text) return;
    await api(`/api/clients/${slug}/todos`, { method: 'POST', body: JSON.stringify({ text, due }) });
    form.reset();
    renderClientHub(slug);
  });

  document.getElementById('todo-list').addEventListener('click', async (e) => {
    const row = e.target.closest('.todo-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.classList.contains('todo-check')) {
      await api(`/api/clients/${slug}/todos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ done: e.target.checked }),
      });
      renderClientHub(slug);
    } else if (e.target.classList.contains('todo-delete')) {
      e.preventDefault(); // the row is a <label> — don't toggle the checkbox on delete
      await api(`/api/clients/${slug}/todos/${id}`, { method: 'DELETE' });
      renderClientHub(slug);
    }
  });

  document.getElementById('note-submit').addEventListener('click', async () => {
    const input = document.getElementById('note-input');
    const text = input.value.trim();
    if (!text) return;
    await api(`/api/clients/${slug}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
    renderClientHub(slug);
  });

  document.getElementById('note-list').addEventListener('click', async (e) => {
    if (!e.target.classList.contains('note-delete')) return;
    const card = e.target.closest('.note-card');
    await api(`/api/clients/${slug}/notes/${card.dataset.id}`, { method: 'DELETE' });
    renderClientHub(slug);
  });

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => uploadFiles(slug, fileInput.files));
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    })
  );
  dropzone.addEventListener('drop', (e) => uploadFiles(slug, e.dataTransfer.files));
}

async function uploadFiles(slug, fileList) {
  for (const file of fileList) {
    const formData = new FormData();
    formData.append('file', file);
    await fetch(`/api/clients/${slug}/files`, { method: 'POST', body: formData });
  }
  loadFiles(slug);
}

async function loadFiles(slug) {
  const files = await api(`/api/clients/${slug}/files`);
  const listEl = document.getElementById('file-list');
  if (!listEl) return;
  listEl.innerHTML = files.length
    ? files
        .map((f) => {
          // Uploads are stored with an 8-char hex prefix to avoid collisions; show the
          // original name back to the user, not the prefix.
          const display = f.filename.replace(/^[0-9a-f]{8}-/, '');
          return `<a class="file-tile" data-filename="${escapeHtml(f.filename)}"
                     href="/api/clients/${slug}/files/${encodeURIComponent(f.filename)}" target="_blank">
            <span class="file-icon">${fileIcon(display)}</span>
            <span class="file-info">
              <span class="file-name">${escapeHtml(display)}</span>
              <span class="file-meta">${formatSize(f.size)} · ${formatDate(f.uploadedAt)}</span>
            </span>
            <button class="icon-btn file-delete" title="Delete">✕</button>
          </a>`;
        })
        .join('')
    : '<div class="empty">No files yet.</div>';

  listEl.querySelectorAll('.file-delete').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); // the tile is a link — don't open the file while deleting it
      e.stopPropagation();
      const filename = btn.closest('.file-tile').dataset.filename;
      await fetch(`/api/clients/${slug}/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      loadFiles(slug);
    })
  );
}

// ---------- Add client modal ----------

const backdrop = document.getElementById('add-client-backdrop');
document.getElementById('cancel-add-client').addEventListener('click', () => backdrop.classList.remove('open'));
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.classList.remove('open'); });

document.getElementById('add-client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.name.value.trim(),
    contact: form.contact.value.trim(),
    building: form.building.value.trim(),
  };
  if (!payload.name) return;
  try {
    const client = await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    backdrop.classList.remove('open');
    await loadClients();
    goto(client.slug);
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Init ----------

goto('home');
refreshTimer();

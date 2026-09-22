const main = document.getElementById('main');
const navTabs = document.querySelectorAll('.nav-tab');

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

// ---------- Client hub ----------

async function renderClientHub(slug) {
  main.innerHTML = '<p class="subtitle">Loading…</p>';
  let client;
  try {
    client = await api(`/api/clients/${encodeURIComponent(slug)}`);
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

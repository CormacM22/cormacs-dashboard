const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const clients = require('./lib/clients');

fs.mkdirSync(clients.CLIENTS_DIR, { recursive: true });
fs.mkdirSync(clients.FILES_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Loads the client for :slug onto req.client, or 404s. Every /api/clients/:slug/*
// route depends on this — it's also what keeps the file routes below from letting an
// arbitrary slug reach the filesystem.
function loadClient(req, res, next) {
  const client = clients.getClient(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  req.client = client;
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, clients.clientFilesDir(req.params.slug));
    },
    filename(req, file, cb) {
      const safeName = path.basename(file.originalname);
      const prefix = crypto.randomBytes(4).toString('hex');
      cb(null, `${prefix}-${safeName}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

app.get('/api/clients', (req, res) => {
  res.json(clients.listClients());
});

app.post('/api/clients', (req, res) => {
  try {
    const client = clients.createClient(req.body || {});
    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/clients/:slug', loadClient, (req, res) => {
  res.json(req.client);
});

app.put('/api/clients/:slug', loadClient, (req, res) => {
  const { name, contact, building, money } = req.body || {};
  const client = req.client;
  if (name !== undefined) client.name = name;
  if (contact !== undefined) client.contact = contact;
  if (building !== undefined) client.building = building;
  if (money !== undefined) client.money = money;
  res.json(clients.saveClient(client));
});

app.post('/api/clients/:slug/todos', loadClient, (req, res) => {
  const { text, due } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Todo text required' });
  const client = req.client;
  client.todos.push({ id: crypto.randomUUID(), text: text.trim(), due: due || null, done: false });
  res.status(201).json(clients.saveClient(client));
});

app.put('/api/clients/:slug/todos/:id', loadClient, (req, res) => {
  const client = req.client;
  const todo = client.todos.find((t) => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  const { text, due, done } = req.body || {};
  if (text !== undefined) todo.text = text;
  if (due !== undefined) todo.due = due;
  if (done !== undefined) todo.done = done;
  res.json(clients.saveClient(client));
});

app.delete('/api/clients/:slug/todos/:id', loadClient, (req, res) => {
  const client = req.client;
  client.todos = client.todos.filter((t) => t.id !== req.params.id);
  res.json(clients.saveClient(client));
});

app.post('/api/clients/:slug/notes', loadClient, (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Note text required' });
  const client = req.client;
  client.notes.unshift({ id: crypto.randomUUID(), text: text.trim(), date: new Date().toISOString() });
  res.status(201).json(clients.saveClient(client));
});

app.delete('/api/clients/:slug/notes/:id', loadClient, (req, res) => {
  const client = req.client;
  client.notes = client.notes.filter((n) => n.id !== req.params.id);
  res.json(clients.saveClient(client));
});

app.get('/api/clients/:slug/files', loadClient, (req, res) => {
  res.json(clients.listFiles(req.params.slug));
});

app.post('/api/clients/:slug/files', loadClient, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json(clients.listFiles(req.params.slug));
});

// Resolves filename to a real path inside this client's folder, or null if it
// escapes (e.g. via "../"). path.basename already strips directory components, but
// the resolve+prefix check is the actual guarantee, not the basename call.
function resolveClientFile(slug, filename) {
  const dir = clients.clientFilesDir(slug);
  const target = path.resolve(dir, path.basename(filename));
  if (!target.startsWith(dir + path.sep)) return null;
  return target;
}

app.get('/api/clients/:slug/files/:filename', loadClient, (req, res) => {
  const target = resolveClientFile(req.params.slug, req.params.filename);
  if (!target || !fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(target);
});

app.delete('/api/clients/:slug/files/:filename', loadClient, (req, res) => {
  const target = resolveClientFile(req.params.slug, req.params.filename);
  if (!target || !fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(target);
  res.json(clients.listFiles(req.params.slug));
});

// Bind to loopback only. This app has no login and holds real client details, notes
// and files — binding to 0.0.0.0 (the default) would expose all of it to anyone on
// the same wifi. Change this only if you deliberately want it reachable from another
// device, and add auth first if you do.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});

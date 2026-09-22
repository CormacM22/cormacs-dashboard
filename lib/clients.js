const fs = require('fs');
const path = require('path');

const CLIENTS_DIR = path.join(__dirname, '..', 'data', 'clients');
const FILES_DIR = path.join(__dirname, '..', 'data', 'files');

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function clientPath(slug) {
  return path.join(CLIENTS_DIR, `${slug}.json`);
}

function clientFilesDir(slug) {
  return path.join(FILES_DIR, slug);
}

function listClients() {
  return fs
    .readdirSync(CLIENTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, f), 'utf8')));
}

function getClient(slug) {
  const p = clientPath(slug);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveClient(client) {
  client.updatedAt = new Date().toISOString();
  fs.writeFileSync(clientPath(client.slug), JSON.stringify(client, null, 2));
  return client;
}

function createClient({ name, contact, building }) {
  const slug = slugify(name);
  if (!slug) throw new Error('Client name required');
  if (getClient(slug)) throw new Error('A client with that name already exists');

  const client = {
    slug,
    name,
    contact: contact || '',
    building: building || '',
    money: 'not started',
    todos: [],
    notes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveClient(client);
  fs.mkdirSync(clientFilesDir(slug), { recursive: true });
  return client;
}

function listFiles(slug) {
  const dir = clientFilesDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((filename) => {
      const stat = fs.statSync(path.join(dir, filename));
      return { filename, size: stat.size, uploadedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

module.exports = {
  CLIENTS_DIR,
  FILES_DIR,
  slugify,
  clientFilesDir,
  listClients,
  getClient,
  saveClient,
  createClient,
  listFiles,
};

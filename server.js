'use strict';
/*
 * FastLang server - zero dependencies (only Node.js built-ins).
 *  - serves the static site from /public
 *  - register / login / logout with hashed passwords and cookie sessions
 *  - /account.html is served only to logged-in users
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRIVATE_DIR = path.join(__dirname, 'private');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_BODY = 10 * 1024;

/* ---------- user storage: MongoDB if MONGODB_URI is set, otherwise a local JSON file ---------- */
function fileStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let users = {}; // keyed by lower-case email
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = {}; }
  return {
    name: 'JSON file (' + USERS_FILE + ')',
    async init() {},
    async find(email) { return users[email] || null; },
    async create(user) {
      if (users[user.email]) return false;
      users[user.email] = user;
      const tmp = USERS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
      fs.renameSync(tmp, USERS_FILE);
      return true;
    }
  };
}
function mongoStore(uri) {
  const { MongoClient } = require('mongodb'); // run "npm install" first
  let col;
  return {
    name: 'MongoDB',
    async init() {
      const client = new MongoClient(uri);
      await client.connect();
      col = client.db(process.env.MONGODB_DB || 'fastlang').collection('users');
      await col.createIndex({ email: 1 }, { unique: true });
    },
    async find(email) { return col.findOne({ email }, { projection: { _id: 0 } }); },
    async create(user) {
      try { await col.insertOne({ ...user }); return true; }
      catch (e) { if (e && e.code === 11000) return false; throw e; } // 11000 = duplicate email
    }
  };
}
let store;
try {
  store = process.env.MONGODB_URI ? mongoStore(process.env.MONGODB_URI) : fileStore();
} catch (e) {
  console.error('MONGODB_URI is set but the "mongodb" package is missing. Run: npm install');
  process.exit(1);
}

/* ---------- passwords ---------- */
async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
let DUMMY_HASH = null;
hashPassword('dummy-password', DUMMY_SALT).then(h => { DUMMY_HASH = h; });

async function verifyPassword(user, password) {
  // compare against a dummy hash for unknown users so timing does not reveal them
  const salt = user ? user.salt : DUMMY_SALT;
  const expected = Buffer.from(user ? user.hash : (DUMMY_HASH || ''), 'hex');
  const actual = Buffer.from(await hashPassword(password, salt), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) && !!user;
}

/* ---------- sessions (in memory) ---------- */
const sessions = new Map(); // token -> { email, expires }
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
}, 10 * 60 * 1000).unref();

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
async function getUser(req) {
  const token = parseCookies(req).sid;
  const s = token && sessions.get(token);
  if (!s || s.expires < Date.now()) return null;
  return store.find(s.email);
}
function isSecure(req) {
  return !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}
function cookieHeader(req, value, maxAgeSec) {
  return `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}` + (isSecure(req) ? '; Secure' : '');
}
function startSession(req, res, email) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { email, expires: Date.now() + SESSION_TTL });
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_TTL / 1000));
}
function endSession(req, res) {
  const token = parseCookies(req).sid;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
}

/* ---------- simple rate limiting ---------- */
const hits = new Map(); // key -> { count, start }
function allow(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now - h.start > windowMs) { h = { count: 0, start: now }; hits.set(key, h); }
  h.count++;
  return h.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (now - h.start > 60 * 60 * 1000) hits.delete(k);
}, 10 * 60 * 1000).unref();

/* ---------- helpers ---------- */
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      return reject({ status: 415, message: 'Content-Type must be application/json' });
    }
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject({ status: 413, message: 'Request too large' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject({ status: 400, message: 'Invalid JSON' }); }
    });
    req.on('error', () => reject({ status: 400, message: 'Bad request' }));
  });
}
const publicUser = u => ({ name: u.name, email: u.email, createdAt: u.createdAt });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- API ---------- */
async function handleApi(req, res, pathname) {
  const ip = req.socket.remoteAddress || 'unknown';

  if (pathname === '/api/me' && req.method === 'GET') {
    const u = await getUser(req);
    return u ? sendJson(res, 200, { user: publicUser(u) }) : sendJson(res, 401, { error: 'Not logged in' });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    endSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    if (!allow('reg:' + ip, 30, 60 * 60 * 1000)) return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
    const b = await readJson(req);
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!name || name.length > 60) return sendJson(res, 400, { error: 'Please enter your name (max 60 characters).' });
    if (!EMAIL_RE.test(email) || email.length > 254) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return sendJson(res, 400, { error: 'Password must be 8-128 characters.' });
    if (await store.find(email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id: crypto.randomUUID(), name, email, salt, hash: await hashPassword(password, salt), createdAt: new Date().toISOString() };
    if (!(await store.create(user))) return sendJson(res, 409, { error: 'An account with this email already exists.' });
    startSession(req, res, email);
    return sendJson(res, 201, { user: publicUser(user) });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const b = await readJson(req);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!allow('login:' + email, 8, 10 * 60 * 1000)) return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    if (password.length > 128) return sendJson(res, 401, { error: 'Incorrect email or password.' });
    const user = await store.find(email);
    if (!(await verifyPassword(user, password))) return sendJson(res, 401, { error: 'Incorrect email or password.' });
    hits.delete('login:' + email);
    startSession(req, res, email);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* ---------- static files ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8'
};

function serveFile(req, res, filePath, status) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(status || 200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404 - Page not found</h1><p><a href="/">Back to home</a></p>');
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return notFound(res); }
  if (rel.includes('\0') || rel.split('/').some(seg => seg.startsWith('.'))) return notFound(res);
  let filePath = path.join(PUBLIC_DIR, rel);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);
  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) filePath = path.join(filePath, 'index.html');
    serveFile(req, res, filePath);
  });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }

    // protected page
    if (pathname === '/account.html' || pathname === '/account') {
      if (!(await getUser(req))) {
        res.writeHead(302, { Location: '/login.html?next=' + encodeURIComponent('/account.html') });
        return res.end();
      }
      res.setHeader('Cache-Control', 'no-store');
      return serveFile(req, res, path.join(PRIVATE_DIR, 'account.html'));
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    if (err && err.status) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
  }
});

store.init().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`FastLang running at http://localhost:${PORT}`);
    console.log(`Users stored in: ${store.name}`);
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const n of nets) {
        if (n.family === 'IPv4' && !n.internal) console.log(`On your network:   http://${n.address}:${PORT}`);
      }
    }
  });
}).catch(err => {
  console.error('Could not start the user database:', err.message);
  process.exit(1);
});

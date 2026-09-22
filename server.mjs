import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dataDir, 'financas.sqlite'));
db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS households (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, household_id INTEGER NOT NULL REFERENCES households(id));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id), name TEXT NOT NULL, cost INTEGER NOT NULL, asking INTEGER NOT NULL, sale INTEGER, acquired TEXT NOT NULL, sold_on TEXT, notes TEXT NOT NULL DEFAULT '', photo TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, household_id INTEGER NOT NULL REFERENCES households(id), description TEXT NOT NULL, amount INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense')), category TEXT NOT NULL, due TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);

const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('hex');
const cookie = (token, age) => `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `Confira o campo ${label}.`);
  return value.trim();
}
function money(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000000000) fail(400, 'Informe um valor válido.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, 'Informe uma data válida.');
  return value;
}
function photo(value = '') {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 4200000) fail(400, 'Use uma foto JPG, PNG ou WebP de até 3 MB.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail(400, 'Formato de foto inválido.');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid || bytes.length > 3 * 1024 * 1024) fail(400, 'Foto inválida ou maior que 3 MB.');
  return value;
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Envie dados em JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4400000) fail(413, 'Arquivo muito grande.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'Dados inválidos.'); }
}
function send(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
function session(req) {
  const token = /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  return token ? db.prepare('SELECT u.id, u.name, u.email, u.household_id, s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token), Date.now()) : undefined;
}
function startSession(res, userId) {
  const token = random(); const csrf = random();
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token), userId, csrf, Date.now() + 30 * 86400000);
  res.setHeader('Set-Cookie', cookie(token, 30 * 86400));
}
function throttle(key) {
  db.prepare('DELETE FROM attempts WHERE expires<?').run(Date.now());
  const row = db.prepare('SELECT count FROM attempts WHERE key=?').get(key);
  if (row?.count >= 20) fail(429, 'Muitas tentativas. Tente novamente em 15 minutos.');
  db.prepare('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, Date.now() + 900000);
}
async function api(req, res, url) {
  const route = url.pathname; const method = req.method;
  const write = !['GET', 'HEAD'].includes(method);
  if (write) {
    const expected = process.env.APP_URL || `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== new URL(expected).origin) fail(403, 'Origem não autorizada.');
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origem não autorizada.');
  }
  if (method === 'POST' && ['/api/register', '/api/login'].includes(route)) {
    throttle(req.socket.remoteAddress || 'local');
    const input = await body(req);
    const email = text(input.email, 'e-mail', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe um e-mail válido.');
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) fail(400, 'Use uma senha entre 8 e 128 caracteres.');
    if (route === '/api/login') {
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const [salt, digest] = (user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
      const derived = await scrypt(input.password, salt, 64);
      if (!user || !timingSafeEqual(derived, Buffer.from(digest, 'hex'))) fail(401, 'E-mail ou senha incorretos.');
      startSession(res, user.id); return send(res, 200, { ok: true });
    }
    const name = text(input.name, 'nome', 80);
    const salt = randomBytes(16).toString('hex'); const digest = (await scrypt(input.password, salt, 64)).toString('hex');
    let userId;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Este e-mail já possui cadastro. Entre na sua conta.');
      let household;
      if (input.invite) {
        const invite = db.prepare('SELECT * FROM invites WHERE token=? AND expires>?').get(hash(String(input.invite)), Date.now());
        if (!invite) fail(400, 'O convite expirou ou já foi usado. Peça um novo convite.');
        household = invite.household_id;
        db.prepare('DELETE FROM invites WHERE token=?').run(invite.token);
      } else household = Number(db.prepare('INSERT INTO households(name) VALUES (?)').run('Nossa casa').lastInsertRowid);
      userId = Number(db.prepare('INSERT INTO users(name,email,password,household_id) VALUES (?,?,?,?)').run(name,email,`${salt}:${digest}`,household).lastInsertRowid);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    startSession(res, userId); return send(res, 201, { ok: true });
  }
  const user = session(req);
  if (!user) fail(401, 'Entre na sua conta para continuar.');
  if (write && req.headers['x-csrf-token'] !== user.csrf) fail(403, 'Atualize a página e tente novamente.');
  if (method === 'GET' && route === '/api/state') {
    return send(res, 200, { user, members: db.prepare('SELECT name,email FROM users WHERE household_id=?').all(user.household_id), items: db.prepare('SELECT * FROM items WHERE household_id=? ORDER BY id DESC').all(user.household_id), transactions: db.prepare('SELECT * FROM transactions WHERE household_id=? ORDER BY due,id DESC').all(user.household_id) });
  }
  if (method === 'POST' && route === '/api/logout') {
    db.prepare('DELETE FROM sessions WHERE user_id=? AND csrf=?').run(user.id, user.csrf);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (method === 'POST' && route === '/api/invite') {
    const token = random();
    db.prepare('DELETE FROM invites WHERE household_id=?').run(user.household_id);
    db.prepare('INSERT INTO invites VALUES (?,?,?)').run(hash(token), user.household_id, Date.now() + 7 * 86400000);
    return send(res, 201, { token });
  }
  const match = /^\/api\/(items|transactions)(?:\/(\d+))?$/.exec(route);
  if (!match) fail(404, 'Página não encontrada.');
  const table = match[1]; const id = match[2] ? Number(match[2]) : null;
  if (id && !db.prepare(`SELECT id FROM ${table} WHERE id=? AND household_id=?`).get(id,user.household_id)) fail(404, 'Registro não encontrado.');
  if (method === 'DELETE' && id) {
    db.prepare(`DELETE FROM ${table} WHERE id=? AND household_id=?`).run(id,user.household_id);
    return send(res, 200, { ok: true });
  }
  if (!(method === 'POST' && !id || method === 'PUT' && id)) fail(405, 'Ação não permitida.');
  const input = await body(req);
  let values, columns;
  if (table === 'items') {
    const sale = input.sale === null || input.sale === '' || input.sale === undefined ? null : money(input.sale);
    const acquired = date(input.acquired); const soldOn = sale === null ? null : date(input.sold_on);
    if (soldOn && soldOn < acquired) fail(400, 'A venda não pode ser anterior à compra.');
    columns = ['name','cost','asking','sale','acquired','sold_on','notes','photo'];
    if (typeof (input.notes ?? '') !== 'string' || (input.notes || '').length > 4000) fail(400, 'Use até 4.000 caracteres nas observações.');
    values = [text(input.name,'produto',120),money(input.cost),money(input.asking),sale,acquired,soldOn,input.notes || '',photo(input.photo)];
  } else {
    if (!['income','expense'].includes(input.kind) || typeof input.paid !== 'boolean') fail(400,'Confira o tipo e a situação da conta.');
    if (money(input.amount) === 0) fail(400,'O valor deve ser maior que zero.');
    columns = ['description','amount','kind','category','due','paid'];
    values = [text(input.description,'descrição',120),input.amount,input.kind,text(input.category,'categoria',60),date(input.due),input.paid ? 1 : 0];
  }
  if (id) db.prepare(`UPDATE ${table} SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=? AND household_id=?`).run(...values,id,user.household_id);
  else db.prepare(`INSERT INTO ${table} (household_id,${columns.join(',')}) VALUES (${columns.map(() => '?').concat('?').join(',')})`).run(user.household_id,...values);
  return send(res, id ? 200 : 201, { ok: true });
}
const assets = { '/': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req,res,url);
    const asset = assets[url.pathname];
    if (!asset || req.method !== 'GET') return send(res,404,{error:'Página não encontrada.'});
    res.writeHead(200,{'Content-Type':asset[1], 'Cache-Control':'no-cache'});
    res.end(readFileSync(path.join(root,'public',asset[0])));
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) send(res,error.status || 500,{error:error.status ? error.message : 'Não foi possível salvar. Tente novamente.'});
    else res.end();
  }
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',() => console.log(`Finanças disponível na porta ${server.address().port}`));

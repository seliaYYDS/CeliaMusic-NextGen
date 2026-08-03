const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const runtimeDir = process.env.KUGOU_RUNTIME_DIR || __dirname;
const sessionFile = process.env.KUGOU_SESSION_FILE || path.join(runtimeDir, 'session.json');
const runtimeRequire = createRequire(path.join(runtimeDir, 'package.json'));
process.env.platform = 'lite';
const api = runtimeRequire('kugoumusicapi');
const authKeys = new Set(['token', 'userid', 'user_id', 'dfid', 't1', 'vip_type', 'vip_token']);

const parseCookie = value => Object.fromEntries(String(value || '').split(';').map(entry => {
  const index = entry.indexOf('=');
  return index > 0 ? [entry.slice(0, index).trim(), entry.slice(index + 1).trim()] : [];
}).filter(entry => entry.length === 2));

const parseSetCookie = value => {
  const first = String(value || '').split(';', 1)[0];
  const index = first.indexOf('=');
  return index > 0 ? [first.slice(0, index).trim(), first.slice(index + 1).trim()] : null;
};

const loadSession = () => {
  try {
    const value = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (value && typeof value === 'object') return value;
  } catch {}
  return {};
};

let session = loadSession();
const guid = process.env.KUGOU_API_GUID || crypto.randomUUID().replace(/-/g, '').toUpperCase();
session = {
  ...session,
  KUGOU_API_PLATFORM: 'lite',
  KUGOU_API_GUID: guid,
  KUGOU_API_MID: BigInt(`0x${crypto.createHash('md5').update(guid).digest('hex')}`).toString(10),
  KUGOU_API_DEV: process.env.KUGOU_API_DEV || session.KUGOU_API_DEV,
  KUGOU_API_MAC: process.env.KUGOU_API_MAC || session.KUGOU_API_MAC,
  KUGOU_API_WEBGL: process.env.KUGOU_API_WEBGL || session.KUGOU_API_WEBGL,
};

const persist = () => {
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify(session));
};

const mergeResult = result => {
  for (const entry of Array.isArray(result?.cookie) ? result.cookie : []) {
    const parsed = parseSetCookie(entry);
    if (parsed) session[parsed[0]] = parsed[1];
  }
  const body = result?.body ?? result;
  const data = body?.data ?? body;
  if (data?.token) session.token = String(data.token);
  if (data?.userid ?? data?.user_id) session.userid = String(data.userid ?? data.user_id);
  if (data?.dfid) session.dfid = String(data.dfid);
  persist();
  return body && typeof body === 'object' && !Buffer.isBuffer(body)
    ? { ...body, cookie: Array.isArray(result?.cookie) ? result.cookie : [] }
    : body;
};

const invoke = async (operation, params) => {
  const fn = api[operation] || (operation === 'playlist_track_all' ? api.playlist_track_all_new : null);
  if (typeof fn !== 'function') throw Object.assign(new Error(`Unsupported KuGou operation: ${operation}`), { status: 404 });
  const userId = session.userid || session.user_id;
  const result = await fn({
    ...params,
    ...(userId ? { userid: userId, uid: userId } : {}),
    cookie: { ...session },
  });
  return mergeResult(result);
};

const isVerificationRequired = body => {
  const code = Number(body?.errcode ?? body?.error_code);
  const message = String(body?.error ?? body?.error_msg ?? body?.msg ?? '');
  return code === 20028 || message.includes('本次请求需要验证');
};

let registration = null;
const ensureRegistered = async force => {
  if (registration) return registration;
  if (!force && session.dfid) return;
  if (force) {
    delete session.dfid;
    persist();
  }
  registration = invoke('register_dev', {}).finally(() => { registration = null; });
  await registration;
};

const send = (request, response, status, body) => {
  const origin = request.headers.origin || '*';
  response.writeHead(status, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  });
  response.end(JSON.stringify(body));
};

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(request, response, 204, {});
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    const operation = url.pathname.replace(/^\/+|\/+$/g, '').replaceAll('/', '_');
    const params = Object.fromEntries(url.searchParams);
    const incoming = parseCookie(params.cookie || request.headers.authorization);
    delete params.cookie;
    for (const [key, value] of Object.entries(incoming)) {
      if (authKeys.has(key.toLowerCase()) && (key.toLowerCase() !== 'dfid' || !session.dfid)) session[key] = value;
    }
    persist();
    if (!operation) return send(request, response, 200, { status: 1 });
    if (operation === 'logout') {
      session = Object.fromEntries(Object.entries(session).filter(([key]) => !authKeys.has(key.toLowerCase())));
      persist();
      return send(request, response, 200, { status: 1, code: 200 });
    }
    if (operation !== 'register_dev') await ensureRegistered(false);
    let body;
    try {
      body = await invoke(operation, params);
    } catch (error) {
      if (operation === 'register_dev' || !isVerificationRequired(error?.body)) throw error;
      await ensureRegistered(true);
      body = await invoke(operation, params);
    }
    if (operation !== 'register_dev' && isVerificationRequired(body)) {
      await ensureRegistered(true);
      body = await invoke(operation, params);
    }
    return send(request, response, 200, body);
  } catch (error) {
    const body = error?.body ?? { status: 0, msg: error instanceof Error ? error.message : String(error) };
    return send(request, response, Number(error?.status) || 502, body);
  }
});

persist();
server.listen(port, host, () => console.log(`server running @ http://${host}:${port}`));

 import express from 'express';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Sesiones en memoria
const sessions = new Map(); // sessionId -> { userId, email, name }
const cookieName = 'session_id';

const PORT = process.env.PORT || 3000;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'change_me';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/finanzas-procesar';

// Almacén en memoria para demo. En producción: DB cifrada.
const userIdToRefreshToken = new Map();
const users = new Map(); // userId -> { email, name, connectedAt }

// Middleware para leer sesión
function getSession(req) {
  const sessionId = req.cookies?.session_id || req.headers.cookie?.split(';').find(c => c.trim().startsWith(`${cookieName}=`))?.split('=')[1];
  if (!sessionId) return null;
  return sessions.get(sessionId);
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autenticado' });
  req.session = session;
  next();
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Faltan variables GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function generateAuthUrl(state) {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state,
  });
}

async function exchangeCodeForTokens(code) {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

async function getUserInfo(accessToken) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
  const { data } = await oauth2.userinfo.get();
  return data;
}

async function refreshAccessToken(refreshToken) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token;
}

// API: Obtener lista de usuarios
app.get('/api/users', (req, res) => {
  const usersArray = Array.from(users.entries()).map(([userId, data]) => ({
    userId,
    ...data
  }));
  res.json(usersArray);
});

// API: Obtener sesión actual
app.get('/api/session', (req, res) => {
  const session = getSession(req);
  res.json(session || { authenticated: false });
});

// API: Cerrar sesión
app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies?.[cookieName];
  if (sessionId) sessions.delete(sessionId);
  res.clearCookie(cookieName);
  res.json({ success: true });
});

// Página simple
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Inicia OAuth de Google
app.get('/auth/google', (req, res) => {
  const userId = crypto.randomBytes(16).toString('hex');
  const url = generateAuthUrl(JSON.stringify({ userId }));
  res.redirect(url);
});

// Callback de Google
app.get('/auth/google/callback', async (req, res) => {
  try {
    console.log('=== CALLBACK OAUTH ===');
    console.log('Query:', req.query);
    const code = req.query.code;
    const state = req.query.state;
    if (!code || !state) {
      console.error('Faltan code/state');
      return res.status(400).send('Faltan code/state');
    }
    
    console.log('Exchanging code for tokens...');
    const { userId } = JSON.parse(state);
    const tokens = await exchangeCodeForTokens(code);
    console.log('Tokens received');
    
    if (tokens.refresh_token) {
      userIdToRefreshToken.set(userId, tokens.refresh_token);
    }
    
    // Obtener info del usuario
    console.log('Getting user info...');
    const userInfo = await getUserInfo(tokens.access_token);
    console.log('User info:', userInfo);
    const email = userInfo.email;
    const name = userInfo.name || email.split('@')[0];
    
    // Guardar usuario
    users.set(userId, { email, name, connectedAt: new Date().toISOString() });
    console.log('User saved:', userId);
    
    // Crear sesión
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, { userId, email, name });
    console.log('Session created:', sessionId);
    
    // Set cookie
    res.cookie(cookieName, sessionId, { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }); // 7 días
    console.log('Cookie set, redirecting...');
    
    return res.redirect('/');
  } catch (err) {
    console.error('ERROR EN CALLBACK:', err);
    return res.status(500).send(`
      <h1>Error en callback</h1>
      <p>${err.message}</p>
      <pre>${err.stack}</pre>
      <a href="/">Volver al inicio</a>
    `);
  }
});

// Endpoint protegido: n8n lo llama para obtener un access_token fresco
app.get('/tokens/:userId', async (req, res) => {
  try {
    const apiKey = req.header('x-api-key');
    if (apiKey !== INTERNAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const { userId } = req.params;
    const refreshToken = userIdToRefreshToken.get(userId);
    if (!refreshToken) return res.status(404).json({ error: 'No refresh token' });
    const accessToken = await refreshAccessToken(refreshToken);
    return res.json({ accessToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Token refresh error' });
  }
});

// Dispara el webhook de n8n con el contexto de usuario
app.post('/process', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const filtros = req.body?.filtros || {};
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ userId, filtros }),
    });
    const contentType = n8nRes.headers.get('content-type') || '';
    const text = await n8nRes.text();
    if (!n8nRes.ok) {
      return res.status(n8nRes.status).send(text);
    }
    if (contentType.includes('application/json')) {
      try { return res.json(JSON.parse(text)); } catch (_) { /* fallthrough */ }
    }
    return res.send(text);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error llamando a n8n' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});



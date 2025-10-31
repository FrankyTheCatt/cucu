 import express from 'express';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'change_me';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/finanzas-procesar';

// Almacén en memoria para demo. En producción: DB cifrada.
const userIdToRefreshToken = new Map();

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

async function refreshAccessToken(refreshToken) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token;
}

// Página simple
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Inicia OAuth de Google para el userId indicado
app.get('/auth/google', (req, res) => {
  const userId = req.query.userId || 'demo-user-1';
  const url = generateAuthUrl(JSON.stringify({ userId }));
  res.redirect(url);
});

// Callback de Google
app.get('/auth/google/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    if (!code || !state) return res.status(400).send('Faltan code/state');
    const { userId } = JSON.parse(state);
    const tokens = await exchangeCodeForTokens(code);
    if (tokens.refresh_token) {
      userIdToRefreshToken.set(userId, tokens.refresh_token);
    }
    return res.redirect('/?connected=1');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error en callback');
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
app.post('/process', async (req, res) => {
  try {
    const userId = req.body?.userId || 'demo-user-1';
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



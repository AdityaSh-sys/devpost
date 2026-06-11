const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const http = require('http');
const path = require('path');

const DEV_MODE = process.env.BLACKOUT_DEV === 'true' || process.argv.includes('--dev');
const DEV_URL = 'http://localhost:3000';
const PROD_URL = 'https://blackout-ai.vercel.app';

const OLLAMA_URL = 'http://localhost:11434';
const LOCAL_OLLAMA_KEY = 'blackout_ollama_confirmed';
const LOCAL_MODEL_KEY = 'blackout_model_confirmed';
const MODEL_NAME = 'gemma2:2b';

let mainWindow = null;

function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const params = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || { 'Content-Type': 'application/json' },
      timeout: options.timeout || 10000,
    };

    const req = http.request(params, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

async function checkOllama() {
  try {
    const res = await nodeFetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return { ollama: false, available: false };
    const models = (res.data.models || []).map((m) => m.name);
    return { ollama: true, available: models.includes(MODEL_NAME) };
  } catch {
    return { ollama: false, available: false };
  }
}

async function queryOllama(messages) {
  const body = JSON.stringify({ model: MODEL_NAME, messages, stream: false });
  const res = await nodeFetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeout: 120000,
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  return res.data;
}

async function pullOllamaModel() {
  const body = JSON.stringify({ name: MODEL_NAME });
  const res = await nodeFetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeout: 3600000,
  });
  return res.ok;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Blackout AI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Blackout',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  const targetUrl = DEV_MODE ? DEV_URL : PROD_URL;
  console.log(`[Blackout Desktop] Loading ${targetUrl} (dev=${DEV_MODE})`);
  mainWindow.loadURL(targetUrl);

  if (DEV_MODE) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIPC() {
  ipcMain.handle('ollama:check', async () => {
    return await checkOllama();
  });

  ipcMain.handle('ollama:query', async (_event, messages) => {
    try {
      const data = await queryOllama(messages);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ollama:pull', async () => {
    try {
      await pullOllamaModel();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('app:getInfo', async () => {
    return {
      isElectron: true,
      version: app.getVersion(),
      devMode: DEV_MODE,
      platform: process.platform,
    };
  });
}

app.whenReady().then(() => {
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

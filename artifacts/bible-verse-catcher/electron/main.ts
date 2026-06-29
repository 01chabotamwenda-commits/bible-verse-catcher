import { app, BrowserWindow, session, ipcMain, globalShortcut, dialog } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';

// ── Single-instance lock ──────────────────────────────────────────────────────
// Prevents Windows from spawning a second copy when the user double-clicks
// the icon while the app is already starting up (window has show:false).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── File logger ─────────────────────────────────────────────────────────────
function makeLogger() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'main.log');
  fs.writeFileSync(logFile, `=== Verse Catcher started ${new Date().toISOString()} ===\n`);

  function write(level: string, msg: string) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    process.stdout.write(line);
    fs.appendFileSync(logFile, line);
  }

  console.log(`Log file: ${logFile}`);
  return {
    info:  (msg: string) => write('INFO',  msg),
    warn:  (msg: string) => write('WARN',  msg),
    error: (msg: string) => write('ERROR', msg),
    path:  logFile,
  };
}

const log = makeLogger();

// ── Config (API keys stored in userData) ─────────────────────────────────────
interface AppConfig {
  deepgramApiKey?: string;
  groqApiKey?: string;
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'verse-catcher-config.json');
}

function readConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: AppConfig): void {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    log.error(`Failed to write config: ${e}`);
  }
}

// ── API Server ───────────────────────────────────────────────────────────────
const API_SERVER_PORT = 5000;
let apiServerProcess: ChildProcess | null = null;

function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const apiServerDir = path.join(__dirname, '../api-server');
    const apiServerPath = path.join(apiServerDir, 'index.mjs');

    if (!fs.existsSync(apiServerPath)) {
      log.error(`API server not found at ${apiServerPath}`);
      reject(new Error('API server not found'));
      return;
    }

    const config = readConfig();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(API_SERVER_PORT),
      NODE_ENV: 'production',
      ...(config.deepgramApiKey ? { DEEPGRAM_API_KEY: config.deepgramApiKey } : {}),
      ...(config.groqApiKey     ? { GROQ_API_KEY:     config.groqApiKey     } : {}),
    };

    log.info(`Starting API server on port ${API_SERVER_PORT}...`);
    apiServerProcess = spawn(process.execPath, ['--enable-source-maps', apiServerPath], {
      cwd: apiServerDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    apiServerProcess.stdout?.on('data', (data) => {
      log.info(`[API server] ${data.toString().trim()}`);
    });
    apiServerProcess.stderr?.on('data', (data) => {
      log.error(`[API server] ${data.toString().trim()}`);
    });
    apiServerProcess.on('error', (err) => {
      log.error(`API server process error: ${err.message}`);
    });
    apiServerProcess.on('exit', (code) => {
      log.warn(`API server exited with code ${code}`);
    });

    const maxAttempts = 30;
    let attempts = 0;
    const checkReady = () => {
      attempts++;
      http.get(`http://127.0.0.1:${API_SERVER_PORT}/api/healthz`, (res) => {
        if (res.statusCode === 200) {
          log.info(`API server ready on http://127.0.0.1:${API_SERVER_PORT}`);
          resolve();
        } else {
          retry();
        }
      }).on('error', retry);
    };
    const retry = () => {
      if (attempts >= maxAttempts) {
        reject(new Error('API server failed to start'));
        return;
      }
      setTimeout(checkReady, 500);
    };
    setTimeout(checkReady, 500);
  });
}

function stopApiServer() {
  if (apiServerProcess) {
    apiServerProcess.kill();
    apiServerProcess = null;
  }
}

app.on('before-quit', () => stopApiServer());

// ── Local HTTP server (required for Web Speech API) ──────────────────────────
function startLocalServer(staticDir: string): Promise<number> {
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.mjs':  'application/javascript',
    '.css':  'text/css',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.txt':  'text/plain',
  };

  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    let filePath = path.join(staticDir, urlPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(staticDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    fs.createReadStream(filePath).on('error', (e) => {
      log.error(`Static serve error: ${e.message}`);
      res.writeHead(500);
      res.end('Internal error');
    }).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('Bad server address'));
      log.info(`Local HTTP server listening on http://127.0.0.1:${addr.port}`);
      resolve(addr.port);
    });
    server.on('error', (e) => {
      log.error(`Server error: ${e.message}`);
      reject(e);
    });
    app.on('before-quit', () => server.close());
  });
}

// ── IPC handlers (registered once at module level) ───────────────────────────
// These must live outside createWindow() — registering inside would duplicate
// them on every call and throw "second handler" errors in Electron.
let mainWindow: BrowserWindow | null = null;

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', async (_e, config: AppConfig) => {
  writeConfig(config);
  log.info('Config updated — restarting API server with new keys');
  stopApiServer();
  try {
    await startApiServer();
    log.info('API server restarted successfully');
  } catch (e) {
    log.error(`API server restart failed after config change: ${e}`);
  }
});

// ── Window ───────────────────────────────────────────────────────────────────
let isCreatingWindow = false;

async function createWindow(): Promise<void> {
  // Guard against concurrent calls (e.g. activate firing while startup is async)
  if (isCreatingWindow || mainWindow !== null) return;
  isCreatingWindow = true;

  try {
    const publicDir = path.join(__dirname, '../public');
    log.info(`Static dir: ${publicDir}`);
    log.info(`Static dir exists: ${fs.existsSync(publicDir)}`);
    log.info(`index.html exists: ${fs.existsSync(path.join(publicDir, 'index.html'))}`);

    try {
      await startApiServer();
    } catch (e) {
      log.error(`Failed to start API server: ${e}`);
      dialog.showErrorBox(
        'Verse Catcher — API Server Error',
        `The local API server failed to start.\n\n${String(e)}\n\nLog file: ${log.path}`
      );
    }

    let port: number;
    try {
      port = await startLocalServer(publicDir);
    } catch (e) {
      log.error(`Failed to start local server: ${e}`);
      throw e;
    }

    process.env.ELECTRON_API_URL = `http://127.0.0.1:${API_SERVER_PORT}`;

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 620,
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
      title: 'Verse Catcher',
      backgroundColor: '#adb9c7',
      show: false,
    });

    mainWindow = win;

    globalShortcut.register('CommandOrControl+Shift+I', () => {
      win.webContents.toggleDevTools();
    });
    globalShortcut.register('F12', () => {
      win.webContents.toggleDevTools();
    });

    win.on('maximize',   () => win.webContents.send('window:maximized-change', true));
    win.on('unmaximize', () => win.webContents.send('window:maximized-change', false));

    win.on('closed', () => {
      mainWindow = null;
    });

    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      log.info(`Permission requested: ${permission}`);
      callback(permission === 'media');
    });

    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      log.info(`[renderer][L${level}] ${message} (${sourceId}:${line})`);
    });

    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      log.error(`did-fail-load: ${code} ${desc} url=${url}`);
    });

    win.once('ready-to-show', () => {
      log.info('Window ready to show');
      win.show();
    });

    const url = `http://127.0.0.1:${port}/`;
    log.info(`Loading URL: ${url}`);
    win.loadURL(url);
  } finally {
    isCreatingWindow = false;
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.on('second-instance', () => {
  // A second instance was launched — focus the existing window instead.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  log.info('app.whenReady');
  createWindow().catch((e) => log.error(`createWindow failed: ${e}`));

  app.on('activate', () => {
    if (mainWindow === null && !isCreatingWindow) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

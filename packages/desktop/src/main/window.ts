import { BrowserWindow, shell } from 'electron';
import path from 'path';
import { desktopOrigin, isDesktopOrigin } from './navigation';

let setupWindow: BrowserWindow | null = null;
let appWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let configuredOrigin: string | null = null;

/**
 * Create the first-run setup window.
 * Shows a local HTML form for server URL + credentials.
 */
export function createSetupWindow(): BrowserWindow {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return setupWindow;
  }

  setupWindow = new BrowserWindow({
    width: 480,
    height: 580,
    resizable: false,
    title: 'Plum Code WebUI — Setup',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load local setup HTML
  const setupHtml = getSetupHTML();
  setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(setupHtml)}`);

  setupWindow.on('closed', () => {
    setupWindow = null;
  });

  return setupWindow;
}

/**
 * Create the main app window that loads the remote WebUI.
 */
export function createAppWindow(serverUrl: string, token: string): BrowserWindow {
  const origin = desktopOrigin(serverUrl);
  if (configuredOrigin && configuredOrigin !== origin) {
    closeMiniWindow();
    appWindow?.destroy();
  }
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.focus();
    return appWindow;
  }
  configuredOrigin = origin;

  appWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Plum',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the WebUI with auth token injection
  const authUrl = `${origin}/auth/callback?token=${encodeURIComponent(token)}`;
  appWindow.loadURL(authUrl);

  // Intercept external navigation — open in default browser
  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isDesktopOrigin(url, origin)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Intercept navigation to external URLs
  appWindow.webContents.on('will-navigate', (event, url) => {
    if (!isDesktopOrigin(url, origin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const primary = appWindow;
  appWindow.on('closed', () => {
    if (appWindow === primary) {
      appWindow = null;
      configuredOrigin = null;
      closeMiniWindow();
    }
  });

  return appWindow;
}

/** Same origin/session as the full client; no token is placed in the mini URL. */
export function createMiniWindow(): BrowserWindow | null {
  if (!configuredOrigin || !appWindow || appWindow.isDestroyed()) return null;
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show();
    miniWindow.focus();
    return miniWindow;
  }
  const origin = configuredOrigin;
  miniWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 340,
    minHeight: 460,
    title: 'Plum Mini',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const window = miniWindow;
  void window.loadURL(`${origin}/mini`);
  const sameOrigin = (value: string) => {
    try {
      return isDesktopOrigin(value, origin);
    } catch {
      return false;
    }
  };
  const external = (value: string) => {
    try {
      const url = new URL(value);
      if (['http:', 'https:', 'mailto:'].includes(url.protocol)) void shell.openExternal(value);
    } catch {
      /* Invalid URL cannot be launched. */
    }
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url) && appWindow && !appWindow.isDestroyed()) {
      void appWindow.loadURL(url);
      appWindow.show();
      appWindow.focus();
    } else external(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url)) {
      event.preventDefault();
      external(url);
    }
  });
  window.on('closed', () => {
    if (miniWindow === window) miniWindow = null;
  });
  return window;
}
export function closeMiniWindow() {
  const window = miniWindow;
  miniWindow = null;
  if (window && !window.isDestroyed()) window.destroy();
}

export function getSetupWindow(): BrowserWindow | null {
  return setupWindow;
}

export function getAppWindow(): BrowserWindow | null {
  return appWindow;
}

export function closeSetupWindow(): void {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
    setupWindow = null;
  }
}

function getSetupHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plum Code WebUI — Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .container {
      width: 100%;
      max-width: 380px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      color: #a0a0a0;
      font-size: 0.875rem;
      text-align: center;
      margin-bottom: 32px;
    }
    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: #d4d4d4;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fafafa;
      font-size: 0.9375rem;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus {
      border-color: #3b82f6;
    }
    input::placeholder {
      color: #666;
    }
    button {
      width: 100%;
      padding: 12px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      margin-top: 8px;
      transition: background 0.15s;
    }
    button:hover:not(:disabled) {
      background: #2563eb;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      background: #7f1d1d;
      border: 1px solid #991b1b;
      color: #fca5a5;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.875rem;
      margin-bottom: 16px;
      display: none;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Connect to Server</h1>
    <p class="subtitle">Enter your Plum Code WebUI server details</p>

    <div id="error" class="error"></div>

    <form id="setupForm">
      <label for="serverUrl">Server URL</label>
      <input type="url" id="serverUrl" placeholder="https://your-domain.example.com" required autofocus>

      <label for="username">Username</label>
      <input type="text" id="username" placeholder="admin" required>

      <label for="password">Password</label>
      <input type="password" id="password" placeholder="Password" required>

      <button type="submit" id="submitBtn">Connect & Register Device</button>
    </form>
  </div>

  <script>
    const form = document.getElementById('setupForm');
    const errorEl = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span>Connecting...';

      const serverUrl = document.getElementById('serverUrl').value.replace(/\\/+$/, '');
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const result = await window.electronAPI.registerDevice(serverUrl, username, password);
        if (!result.success) {
          throw new Error(result.error || 'Registration failed');
        }
        // Success — main process will open app window
      } catch (err) {
        errorEl.textContent = err.message || 'Connection failed';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Connect & Register Device';
      }
    });
  </script>
</body>
</html>`;
}

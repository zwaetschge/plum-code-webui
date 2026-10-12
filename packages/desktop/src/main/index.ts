import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  type NativeImage,
} from 'electron';
import path from 'path';
import { tryDeviceAuth, registerDevice } from './auth';
import { generateFingerprint, getDeviceName } from './fingerprint';
import { loadDeviceConfig, clearDeviceConfig } from './store';
import {
  createSetupWindow,
  createAppWindow,
  closeSetupWindow,
  getAppWindow,
  createMiniWindow,
  closeMiniWindow,
} from './window';

let tray: Tray | null = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  const win = getAppWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  // Register IPC handlers
  setupIpcHandlers();

  // Try device auth first
  const authResult = await tryDeviceAuth();

  if (authResult.success && authResult.token && authResult.serverUrl) {
    createAppWindow(authResult.serverUrl, authResult.token);
  } else {
    createSetupWindow();
  }

  // Setup system tray
  setupTray();
  // Conflicts are reported; the tray action remains available without rebinding.
  if (
    !globalShortcut.register('CommandOrControl+Alt+Space', () => {
      createMiniWindow();
    })
  )
    console.info('Plum Mini: shortcut unavailable; use the tray entry.');
});
app.on('will-quit', () => {
  globalShortcut.unregister('CommandOrControl+Alt+Space');
  closeMiniWindow();
});

// macOS: keep app running when all windows closed (tray mode)
app.on('window-all-closed', () => {
  // Don't quit — tray keeps running
});

app.on('activate', () => {
  // macOS dock click
  const win = getAppWindow();
  if (win) {
    win.show();
  }
});

function setupIpcHandlers(): void {
  // Register device (called from setup page)
  ipcMain.handle(
    'register-device',
    async (_event, serverUrl: string, username: string, password: string) => {
      const result = await registerDevice(serverUrl, username, password);

      if (result.success && result.token && result.serverUrl) {
        // Close setup, open app
        closeSetupWindow();
        createAppWindow(result.serverUrl, result.token);
      }

      return result;
    }
  );

  // Get device info
  ipcMain.handle('get-device-info', () => {
    const config = loadDeviceConfig();
    return {
      fingerprint: generateFingerprint(),
      deviceName: getDeviceName(),
      serverUrl: config?.serverUrl || null,
      deviceId: config?.deviceId || null,
    };
  });

  // Window controls
  ipcMain.on('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.hide(); // Hide to tray instead of closing
    }
  });
}

function setupTray(): void {
  // Create a simple tray icon (16x16 transparent PNG)
  const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.png');
  let trayIcon: NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    // Fallback: create a simple colored square
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Plum');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Plum Mini',
      click: () => {
        createMiniWindow();
      },
    },
    {
      label: 'Open',
      click: () => {
        const win = getAppWindow();
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    {
      label: 'Reconnect',
      click: async () => {
        const authResult = await tryDeviceAuth();
        if (authResult.success && authResult.token && authResult.serverUrl) {
          const previous = getAppWindow();
          const win = createAppWindow(authResult.serverUrl, authResult.token);
          if (win === previous) {
            const authUrl = `${authResult.serverUrl}/auth/callback?token=${encodeURIComponent(authResult.token)}`;
            win.loadURL(authUrl);
          }
          win.show();
        } else {
          createSetupWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Reset Device',
      click: () => {
        clearDeviceConfig();
        closeMiniWindow();
        const win = getAppWindow();
        if (win && !win.isDestroyed()) {
          win.close();
        }
        createSetupWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    const win = getAppWindow();
    if (win) {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
      }
    }
  });
}

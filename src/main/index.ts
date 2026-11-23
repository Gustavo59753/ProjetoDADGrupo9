import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { initDb, closeDb } from './database/connection';

const isDev = !app.isPackaged;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    title: 'Oficina Manager — Gestão de Oficina Mecânica',
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Diagnóstico opcional: OFICINA_SMOKE=1 encerra sozinho e imprime logs do renderer
  if (process.env.OFICINA_SMOKE === '1') {
    win.webContents.on('console-message', (event: any) =>
      console.log('[renderer]', event.message ?? event));
    win.webContents.on('did-fail-load', (_event, code, description) =>
      console.error('[renderer] falha ao carregar:', code, description));
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    win.webContents.on('did-finish-load', async () => {
      await wait(1200);
      const routes = [
        'dashboard', 'clientes', 'veiculos', 'mecanicos', 'fornecedores',
        'pecas', 'ordens_servico', 'itens_ordem', 'notificacoes', 'integracoes',
      ];
      for (const route of routes) {
        try {
          await win.webContents.executeJavaScript(`location.hash = "/${route}"`);
          await wait(400);
          const text = await win.webContents.executeJavaScript(
            'document.getElementById("content")?.innerText.slice(0, 110) || "SEM CONTEUDO"'
          );
          console.log(`[smoke] ${route}:`, String(text).replace(/\n/g, ' | '));
        } catch (error) {
          console.error(`[smoke] erro em ${route}:`, error);
        }
      }
      app.quit();
    });
  }

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Links externos (wa.me, APIs) abrem no navegador do sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function bootstrap(): Promise<void> {
  try {
    await initDb();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[banco]', message);
    dialog.showErrorBox(
      'Não foi possível iniciar o banco de dados',
      `${message}\n\nO aplicativo será encerrado. Configure o arquivo .env antes de abrir novamente.`
    );
    app.quit();
    return;
  }

  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[app] falha ao iniciar:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  void closeDb().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});

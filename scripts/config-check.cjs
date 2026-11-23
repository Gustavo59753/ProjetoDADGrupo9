/* Valida o comportamento quando o .env não está configurado: avisar e não iniciar. */
const Module = require('node:module');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// Garante que nenhum .env seja encontrado neste teste.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-sem-env-'));
process.chdir(tempDir);
for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) delete process.env[key];

let dialogCalled = null;
let quitCalled = false;
const handlers = {};

const electronStub = {
  app: {
    isPackaged: true,
    getAppPath: () => process.cwd(),
    getPath: () => tempDir,
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => { quitCalled = true; },
  },
  ipcMain: { handle: (channel) => { handlers[channel] = true; } },
  dialog: { showErrorBox: (title, message) => { dialogCalled = { title, message }; } },
  Menu: { setApplicationMenu: () => {} },
  BrowserWindow: class {},
  shell: { openExternal: async () => {} },
  clipboard: { writeText: () => {} },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return originalLoad.apply(this, arguments);
};

require(path.join(__dirname, '..', 'out', 'main', 'index.js'));

setTimeout(() => {
  const ok = dialogCalled
    && /banco de dados/i.test(dialogCalled.title)
    && /\.env/.test(dialogCalled.message)
    && quitCalled
    && Object.keys(handlers).length === 0;
  if (ok) {
    console.log('  ok - sem .env: aviso exibido, app encerrado e nenhum handler registrado');
    process.exit(0);
  }
  console.error('FALHOU: comportamento sem .env não foi o esperado', { dialogCalled, quitCalled, handlers });
  process.exit(1);
}, 300);

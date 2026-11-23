/* Executa os testes com o Node embutido do Electron. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
let failed = false;

for (const script of ['smoke-test.cjs', 'config-check.cjs']) {
  console.log(`\n=== ${script} ===`);
  const result = spawnSync(electron, [path.join(__dirname, script)], { stdio: 'inherit', env });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const cachePath = path.join(process.cwd(), 'cache', 'npm');
const env = {
  ...process.env,
  npm_config_cache: cachePath
};

function run(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  }).status ?? 1;
}

const nodeRebuildStatus = run(npmCommand, ['rebuild', 'better-sqlite3']);
let testStatus = nodeRebuildStatus;

if (nodeRebuildStatus === 0) {
  testStatus = run(npxCommand, ['vitest', 'run']);
}

const electronRebuildStatus = run(npmCommand, ['run', 'rebuild:native']);

if (testStatus !== 0) {
  process.exit(testStatus);
}

process.exit(electronRebuildStatus);

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist', 'index.js');
const NODE_PATH = process.execPath;

// Confirmed Microsoft Store path (Prioritized)
const STORE_PATH = path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
// Standard path
const STD_PATH = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');

let configPath = STD_PATH;
if (fs.existsSync(STORE_PATH) || fs.existsSync(path.dirname(STORE_PATH))) {
  configPath = STORE_PATH;
} else if (fs.existsSync(STD_PATH) || fs.existsSync(path.dirname(STD_PATH))) {
  configPath = STD_PATH;
}

console.error(`Registering eClass MCP...`);
console.error(`TARGETING: ${configPath}`);

if (!fs.existsSync(path.dirname(configPath))) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
}

let config = { mcpServers: {} };
if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
    if (!config.mcpServers) config.mcpServers = {};
  } catch (e) {
    console.error(`Error reading config: ${e.message}`);
  }
}

config.mcpServers.eclass = {
  command: NODE_PATH,
  args: [DIST_PATH]
};

try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.error('✅ Successfully updated your Microsoft Store Claude config.');
  console.error('\n🚀 RESTART CLAUDE NOW! (Right-click tray icon > Quit)');
} catch (e) {
  console.error(`Error saving config: ${e.message}`);
  process.exit(1);
}

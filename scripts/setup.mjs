import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist', 'index.js');
const NODE_PATH = process.execPath; // Full path to the current node.exe

let configPath;
if (os.platform() === 'win32') {
  configPath = path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
} else {
  configPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

console.error(`Registering eClass MCP with FOOLPROOF paths...`);
console.error(`Config Path: ${configPath}`);
console.error(`Node Path: ${NODE_PATH}`);

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
  console.error('Successfully updated Claude Desktop configuration.');
  console.error('Restart Claude Desktop and check for the 🔨 icon!');
} catch (e) {
  console.error(`Error saving config: ${e.message}`);
  process.exit(1);
}

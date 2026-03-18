import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist', 'index.js');

let configPath;
if (os.platform() === 'win32') {
  configPath = path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
} else {
  configPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

console.error(`Registering eClass MCP in Claude Desktop configuration...`);
console.error(`Config Path: ${configPath}`);
console.error(`Dist Path: ${DIST_PATH}`);

if (!fs.existsSync(path.dirname(configPath))) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
}

let config = { mcpServers: {} };
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.mcpServers) config.mcpServers = {};
  } catch (e) {
    console.error(`Error reading config: ${e.message}`);
  }
}

config.mcpServers.eclass = {
  command: 'node',
  args: [DIST_PATH]
};

try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.error('Successfully updated Claude Desktop configuration.');
  console.error('Done! Restart Claude Desktop to activate eClass MCP.');
} catch (e) {
  console.error(`Error saving config: ${e.message}`);
  process.exit(1);
}

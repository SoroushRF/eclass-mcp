#!/bin/bash

# Detect current working directory
PROJECT_PATH=$(pwd)
DIST_PATH="$PROJECT_PATH/dist/index.js"

# Determine OS and config path
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  # Windows
  CONFIG_PATH="$APPDATA/Claude/claude_desktop_config.json"
  # Standardize path for windows node command
  DIST_PATH=$(echo "$DIST_PATH" | sed -e 's/^\/\([a-z]\)\//\1:\//' -e 's/\//\\/g')
else
  # macOS
  CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
fi

echo "Registering eClass MCP in Claude Desktop configuration..."
echo "Config path: $CONFIG_PATH"
echo "Dist path: $DIST_PATH"

# Check if config exists, if not create empty one
if [ ! -f "$CONFIG_PATH" ]; then
  mkdir -p "$(dirname "$CONFIG_PATH")"
  echo '{"mcpServers": {}}' > "$CONFIG_PATH"
fi

# Use node to merge the config to ensure valid JSON
node -e "
const fs = require('fs');
const path = require('path');
const configPath = process.argv[1];
const distPath = process.argv[2];

try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.mcpServers) config.mcpServers = {};
  
  config.mcpServers.eclass = {
    command: 'node',
    args: [distPath]
  };
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('Successfully updated Claude Desktop configuration.');
} catch (e) {
  console.error('Error updating config:', e.message);
  process.exit(1);
}
" "$CONFIG_PATH" "$DIST_PATH"

echo "Done! Restart Claude Desktop to activate eClass MCP."

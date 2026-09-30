#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/kilo"
CONFIG_FILE="$CONFIG_DIR/kilo.jsonc"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_FILE="$SCRIPT_DIR/kilo-notification-plugin.ts"

if [[ "$SCRIPT_DIR" == "$CONFIG_DIR/plugins" || "$SCRIPT_DIR" == "$CONFIG_DIR/plugins/"* ]]; then
  PLUGIN_PATH=".${PLUGIN_FILE#"$CONFIG_DIR"}"
else
  PLUGIN_PATH="$PLUGIN_FILE"
fi

mkdir -p "$CONFIG_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
  printf '{\n  "plugin": ["%s"]\n}\n' "$PLUGIN_PATH" > "$CONFIG_FILE"
  printf 'Created %s and registered %s\n' "$CONFIG_FILE" "$PLUGIN_PATH"
  exit 0
fi

if grep -Fq "$PLUGIN_PATH" "$CONFIG_FILE"; then
  printf 'Plugin is already registered in %s\n' "$CONFIG_FILE"
  exit 0
fi

cp "$CONFIG_FILE" "$CONFIG_FILE.bak"

node - "$CONFIG_FILE" "$PLUGIN_PATH" <<'NODE'
const main = async () => {
  const [configFile, pluginPath] = process.argv.slice(2);
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(configFile, "utf8");
  const pluginKey = /("plugin"\s*:\s*\[)/;
  let updated;

  if (pluginKey.test(source)) {
    updated = source.replace(pluginKey, `$1\n    "${pluginPath}",`);
  } else {
    const objectStart = source.indexOf("{");
    if (objectStart === -1) {
      throw new Error("kilo.jsonc does not contain a JSON object");
    }
    updated = `${source.slice(0, objectStart + 1)}\n  "plugin": ["${pluginPath}"],${source.slice(objectStart + 1)}`;
  }

  await fs.writeFile(configFile, updated);
};

main();
NODE

printf 'Registered %s in %s (backup: %s.bak)\n' "$PLUGIN_PATH" "$CONFIG_FILE" "$CONFIG_FILE"

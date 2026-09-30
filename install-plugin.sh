#!/usr/bin/env bash
#
# kilo-notification-plugin installer
#
# Installs the kilo-notification-plugin Kilo server plugin:
# - If run from anywhere other than ~/.config/kilo/plugins/kilo-notification-plugin,
#   copies the files needed by the plugin (kilo-notification-plugin.ts, README.md
#   and this installer) into that directory.
# - Registers the plugin in ~/.config/kilo/kilo.jsonc, creating the config when
#   needed and saving a .bak backup before modifying an existing one.
#
# The plugin itself runs the script from the KILO_NOTIFY_SCRIPT env var when a
# session becomes idle, asks a permission or asks a question. See README.md.
#
# Usage: ./install-plugin.sh
set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/kilo"
CONFIG_FILE="$CONFIG_DIR/kilo.jsonc"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$CONFIG_DIR/plugins/kilo-notification-plugin"
PLUGIN_FILE="$PLUGIN_DIR/kilo-notification-plugin.ts"
PLUGIN_PATH=".${PLUGIN_FILE#"$CONFIG_DIR"}"

if [[ "$SCRIPT_DIR" != "$PLUGIN_DIR" ]]; then
  mkdir -p "$PLUGIN_DIR"
  for f in kilo-notification-plugin.ts README.md install-plugin.sh; do
    if [[ -f "$SCRIPT_DIR/$f" ]]; then
      cp -f "$SCRIPT_DIR/$f" "$PLUGIN_DIR/$f"
    fi
  done
  printf 'Copied plugin files to %s\n' "$PLUGIN_DIR"
fi

if [[ ! -f "$PLUGIN_FILE" ]]; then
  printf 'Error: %s not found; nothing to register\n' "$PLUGIN_FILE" >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
  printf '{\n  "plugin": ["%s"]\n}\n' "$PLUGIN_PATH" > "$CONFIG_FILE"
  printf 'Created %s and registered %s\n' "$CONFIG_FILE" "$PLUGIN_PATH"
  exit 0
fi

if grep -Fq "kilo-notification-plugin.ts" "$CONFIG_FILE"; then
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

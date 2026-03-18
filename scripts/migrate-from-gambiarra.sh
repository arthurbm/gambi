#!/bin/bash
set -e

REPO="arthurbm/gambi"
OLD_BINARY="gambiarra"
NEW_CONFIG_DIR="$HOME/.gambi"
OLD_CONFIG_DIR="$HOME/.gambiarra"
OLD_BINARY_PATH="$HOME/.local/bin/gambiarra"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

best_effort_remove_binary() {
  local binary_path

  if command -v "$OLD_BINARY" >/dev/null 2>&1; then
    binary_path=$(command -v "$OLD_BINARY")
  elif [ -f "$OLD_BINARY_PATH" ]; then
    binary_path="$OLD_BINARY_PATH"
  else
    return
  fi

  info "Removing legacy binary at ${binary_path}"
  if [ -w "$(dirname "$binary_path")" ]; then
    rm -f "$binary_path"
  else
    sudo rm -f "$binary_path"
  fi
}

best_effort_remove_package_manager_installs() {
  if command -v npm >/dev/null 2>&1; then
    npm uninstall -g gambiarra >/dev/null 2>&1 || true
  fi

  if command -v bun >/dev/null 2>&1; then
    bun remove -g gambiarra >/dev/null 2>&1 || true
  fi
}

migrate_config() {
  local old_config_file="${OLD_CONFIG_DIR}/config.json"
  local new_config_file="${NEW_CONFIG_DIR}/config.json"

  if [ ! -f "$old_config_file" ] || [ -f "$new_config_file" ]; then
    return
  fi

  mkdir -p "$NEW_CONFIG_DIR"
  cp "$old_config_file" "$new_config_file"
  info "Copied config from ${old_config_file} to ${new_config_file}"
}

install_new_cli() {
  info "Installing gambi"
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh" | bash
}

main() {
  info "Migrating from gambiarra to gambi"
  best_effort_remove_package_manager_installs
  best_effort_remove_binary
  migrate_config
  install_new_cli
  info "Migration complete. Run 'gambi --help' to verify."
}

main

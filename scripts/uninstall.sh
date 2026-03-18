#!/bin/bash
set -e

# Gambi CLI Uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/uninstall.sh | bash

BINARY_NAME="gambi"
DEFAULT_INSTALL_DIR="$HOME/.local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
  exit 1
}

uninstall() {
  local binary_path

  # Try to find the binary
  if command -v "$BINARY_NAME" &> /dev/null; then
    binary_path=$(command -v "$BINARY_NAME")
  elif [ -f "${DEFAULT_INSTALL_DIR}/${BINARY_NAME}" ]; then
    binary_path="${DEFAULT_INSTALL_DIR}/${BINARY_NAME}"
  else
    error "gambi not found. Nothing to uninstall."
  fi

  info "Found gambi at: ${binary_path}"

  # Remove the binary
  if [ -w "$(dirname "$binary_path")" ]; then
    rm "$binary_path"
  else
    info "Removing requires sudo..."
    sudo rm "$binary_path"
  fi

  info "gambi has been uninstalled successfully."
}

main() {
  echo ""
  echo "  Gambi CLI Uninstaller"
  echo ""

  uninstall
}

main

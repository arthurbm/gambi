#!/bin/bash
set -e

# Gambi CLI Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/install.sh | bash

REPO="arthurbm/gambi"
INSTALL_DIR="${GAMBI_INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="gambi"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Detect OS and architecture
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) error "Unsupported operating system: $(uname -s)" ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
  esac

  echo "${os}-${arch}"
}

# Get the latest release version
get_latest_version() {
  local version
  version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')

  if [ -z "$version" ]; then
    error "Failed to get latest version. Check your internet connection."
  fi

  echo "$version"
}

# Download and install
install() {
  local platform version download_url binary_name temp_file

  platform=$(detect_platform)
  info "Detected platform: ${platform}"

  version=$(get_latest_version)
  info "Latest version: ${version}"

  # Build download URL
  binary_name="gambi-${platform}"
  if [ "${platform}" = "windows-x64" ]; then
    binary_name="${binary_name}.exe"
  fi

  download_url="https://github.com/${REPO}/releases/download/v${version}/${binary_name}"
  info "Downloading from: ${download_url}"

  # Create temp file
  temp_file=$(mktemp)
  trap 'rm -f "$temp_file"' EXIT

  # Download binary
  if ! curl -fsSL "$download_url" -o "$temp_file"; then
    error "Failed to download binary. The release might not exist yet."
  fi

  # Make executable
  chmod +x "$temp_file"

  # Ensure install directory exists
  mkdir -p "$INSTALL_DIR"

  # Install to destination
  if [ -w "$INSTALL_DIR" ]; then
    mv "$temp_file" "${INSTALL_DIR}/${BINARY_NAME}"
  else
    info "Installing to ${INSTALL_DIR} requires sudo..."
    sudo mv "$temp_file" "${INSTALL_DIR}/${BINARY_NAME}"
  fi

  info "Installed gambi to ${INSTALL_DIR}/${BINARY_NAME}"

  # Check if install dir is in PATH
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      warn "${INSTALL_DIR} is not in your PATH."
      warn "Add it by running:"
      warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
      warn "Then restart your terminal or run: source ~/.bashrc"
      return
      ;;
  esac

  # Verify installation
  if command -v gambi &> /dev/null; then
    info "Installation successful!"
    gambi --version
  fi
}

# Main
main() {
  echo ""
  echo "  ██████╗  █████╗ ███╗   ███╗██████╗ ██╗ █████╗ ██████╗ ██████╗  █████╗ "
  echo " ██╔════╝ ██╔══██╗████╗ ████║██╔══██╗██║██╔══██╗██╔══██╗██╔══██╗██╔══██╗"
  echo " ██║  ███╗███████║██╔████╔██║██████╔╝██║███████║██████╔╝██████╔╝███████║"
  echo " ██║   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║██╔══██║██╔══██╗██╔══██╗██╔══██║"
  echo " ╚██████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝██║██║  ██║██║  ██║██║  ██║██║  ██║"
  echo "  ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝"
  echo "                            CLI Installer"
  echo ""

  install
}

main

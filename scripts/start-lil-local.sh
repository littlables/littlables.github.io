#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_DIR"

NODE_LTS_MAJOR=24
NODE_BIN_DIR="${HOME}/.local/bin"
mkdir -p "$NODE_BIN_DIR"
export PATH="${NODE_BIN_DIR}:${PATH}"

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
fi

if (( node_major < 22 )); then
  if ! command -v curl >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
    echo "Installing Node.js needs curl, sha256sum, tar, and xz. Install those system tools, then run this script again." >&2
    exit 1
  fi

  case "$(uname -s):$(uname -m)" in
    Linux:x86_64) node_arch="x64" ;;
    Linux:aarch64|Linux:arm64) node_arch="arm64" ;;
    *)
      echo "Automatic Node.js setup supports Linux x64 and arm64. Install Node.js 22 or newer, then run this script again." >&2
      exit 1
      ;;
  esac

  echo "Installing Node.js ${NODE_LTS_MAJOR} LTS in ${HOME}/.local…"
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT
  node_dist_url="https://nodejs.org/dist/latest-v${NODE_LTS_MAJOR}.x"
  curl --fail --silent --show-error --location "${node_dist_url}/SHASUMS256.txt" -o "${temp_dir}/SHASUMS256.txt"
  node_archive="$(awk -v arch="$node_arch" -v major="$NODE_LTS_MAJOR" '$2 ~ ("^node-v" major "\\..*-linux-" arch "\\.tar\\.xz$") { print $2; exit }' "${temp_dir}/SHASUMS256.txt")"
  if [[ -z "$node_archive" ]]; then
    echo "Could not find an official Node.js ${NODE_LTS_MAJOR} Linux ${node_arch} archive." >&2
    exit 1
  fi
  node_checksum="$(awk -v archive="$node_archive" '$2 == archive { print $1; exit }' "${temp_dir}/SHASUMS256.txt")"
  if [[ ! "$node_checksum" =~ ^[[:xdigit:]]{64}$ ]]; then
    echo "Could not read a valid Node.js archive checksum." >&2
    exit 1
  fi
  curl --fail --silent --show-error --location "${node_dist_url}/${node_archive}" -o "${temp_dir}/${node_archive}"
  printf '%s  %s\n' "$node_checksum" "${temp_dir}/${node_archive}" | sha256sum --check --status - || {
    echo "The downloaded Node.js archive failed checksum verification." >&2
    exit 1
  }

  install_dir="${HOME}/.local/lib/${node_archive%.tar.xz}"
  mkdir -p "${HOME}/.local/lib"
  tar -xJf "${temp_dir}/${node_archive}" -C "${HOME}/.local/lib"
  ln -sfn "${install_dir}/bin/node" "${NODE_BIN_DIR}/node"
  ln -sfn "${install_dir}/bin/npm" "${NODE_BIN_DIR}/npm"
  ln -sfn "${install_dir}/bin/npx" "${NODE_BIN_DIR}/npx"
  rm -rf "$temp_dir"
  trap - EXIT
  echo "Installed $(node --version) and npm."
fi

if [[ ! -x node_modules/.bin/vite ]]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Installing littlables dependencies with npm…"
    npm install
  elif command -v bun >/dev/null 2>&1; then
    echo "Installing littlables dependencies with bun…"
    bun install
  else
    echo "npm or bun is required to install project dependencies." >&2
    exit 1
  fi
fi

echo "Starting the littlables website dev server at http://127.0.0.1:3000"
echo "For local Lil requests, start the API with ~/.lil/start-api.sh"
exec ./node_modules/.bin/vite --host 0.0.0.0 --port 3000

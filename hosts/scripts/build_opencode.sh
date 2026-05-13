#!/usr/bin/env bash
set -euo pipefail

# Build opencode for multiple platforms and place binaries plus webgui-dist in
# both JetBrains and VSCode plugin resources.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPENCODE_DIR="$ROOT_DIR/packages/opencode"
WEBGUI_DIR="$OPENCODE_DIR/webgui"
WEBGUI_DIST="$OPENCODE_DIR/webgui-dist"
DIST_DIR="$OPENCODE_DIR/dist"
JETBRAINS_BIN_DIR="$ROOT_DIR/hosts/jetbrains-plugin/src/main/resources/bin"
VSCODE_BIN_DIR="$ROOT_DIR/hosts/vscode-plugin/resources/bin"

if [[ ! -d "$OPENCODE_DIR" ]]; then
  echo "Error: opencode package directory not found at $OPENCODE_DIR" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun command not found in PATH" >&2
  exit 1
fi

prepare_output_dir() {
  local dir="$1"
  if [[ -z "$dir" ]]; then
    echo "Error: output directory path is empty" >&2
    exit 1
  fi
  if [[ "$dir" == "/" ]]; then
    echo "Error: refusing to clear root directory" >&2
    exit 1
  fi
  rm -rf "$dir"
  mkdir -p "$dir"
}

OPENCODE_VERSION="${OPENCODE_VERSION:-$(node -p "require('$OPENCODE_DIR/package.json').version")}"
export OPENCODE_VERSION

echo "=> Building webgui-dist"
(
  cd "$WEBGUI_DIR"
  bun run build
)

if [[ ! -d "$WEBGUI_DIST" ]]; then
  echo "Error: expected webgui-dist directory not found at $WEBGUI_DIST" >&2
  exit 1
fi

echo "=> Building opencode distribution (version $OPENCODE_VERSION)"
(
  cd "$OPENCODE_DIR"
  bun script/build.ts
)

if [[ ! -d "$DIST_DIR" ]]; then
  echo "Error: expected dist directory not found at $DIST_DIR" >&2
  exit 1
fi

prepare_output_dir "$JETBRAINS_BIN_DIR"
prepare_output_dir "$VSCODE_BIN_DIR"

shopt -s nullglob
dist_entries=("$DIST_DIR"/opencode-*)
if [[ ${#dist_entries[@]} -eq 0 ]]; then
  echo "Error: no opencode distribution folders found in $DIST_DIR" >&2
  exit 1
fi

for dir in "${dist_entries[@]}"; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  suffix="${name#opencode-}"
  if [[ "$suffix" == "$name" ]]; then
    echo "Warning: skipping unrecognised dist folder $name" >&2
    continue
  fi

  os="${suffix%%-*}"
  arch="${suffix#${os}-}"
  if [[ -z "$arch" || "$arch" == "$suffix" ]]; then
    echo "Warning: skipping $name due to missing architecture component" >&2
    continue
  fi

  if [[ "$arch" == "x64-baseline" ]]; then
    echo "Skipping baseline target $name"
    continue
  fi

  os_dir="$os"
  if [[ "$os_dir" == "darwin" ]]; then
    os_dir="macos"
  fi

  arch_dir="$arch"
  if [[ "$arch_dir" == "x64" ]]; then
    arch_dir="amd64"
  fi

  binary_src="$dir/bin/opencode"
  binary_name="opencode"
  if [[ "$os" == "windows" ]]; then
    binary_src="$dir/bin/opencode.exe"
    binary_name="opencode.exe"
  fi

  if [[ ! -f "$binary_src" ]]; then
    echo "Warning: binary not found at $binary_src" >&2
    continue
  fi

  jetbrains_target="$JETBRAINS_BIN_DIR/$os_dir/$arch_dir"
  vscode_target="$VSCODE_BIN_DIR/$os_dir/$arch_dir"

  mkdir -p "$jetbrains_target"
  mkdir -p "$vscode_target"

  cp "$binary_src" "$jetbrains_target/$binary_name"
  cp "$binary_src" "$vscode_target/$binary_name"
  cp -R "$WEBGUI_DIST" "$jetbrains_target/webgui-dist"
  cp -R "$WEBGUI_DIST" "$vscode_target/webgui-dist"

  if [[ "$os" != "windows" ]]; then
    chmod +x "$jetbrains_target/$binary_name"
    chmod +x "$vscode_target/$binary_name"
  fi

  echo "=> Prepared binaries and webgui-dist for $os/$arch"
done

shopt -u nullglob

echo
echo "All done. Binaries and webgui-dist placed under:"
echo "  JetBrains: $JETBRAINS_BIN_DIR"
echo "  VSCode: $VSCODE_BIN_DIR"
echo "opencode dists remain in $DIST_DIR"

#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-firefox}"
OUTPUT_FILE="${2:-firefox-extension.xpi}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_PATH="${REPO_ROOT}/${SOURCE_DIR}"
OUTPUT_PATH="${REPO_ROOT}/${OUTPUT_FILE}"

if [[ ! -d "${SOURCE_PATH}" ]]; then
  echo "Source folder '${SOURCE_PATH}' was not found." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "The 'zip' command is required but was not found in PATH." >&2
  exit 1
fi

rm -f "${OUTPUT_PATH}"

(
  cd "${SOURCE_PATH}"
  zip -r "${OUTPUT_PATH}" . >/dev/null
)

echo "Created XPI at ${OUTPUT_PATH}"

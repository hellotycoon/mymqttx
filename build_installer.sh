#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(sed -n 's/^Version: //p' "${ROOT_DIR}/packaging/DEBIAN/control" | head -n 1)"
OUTPUT_DIR="${ROOT_DIR}/dist"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mymqttx-deb.XXXXXX")"

cleanup() {
  rm -rf "${STAGE_DIR}"
}
trap cleanup EXIT

mkdir -p \
  "${STAGE_DIR}/DEBIAN" \
  "${STAGE_DIR}/opt/mymqttx/static" \
  "${STAGE_DIR}/usr/bin" \
  "${STAGE_DIR}/usr/share/applications" \
  "${STAGE_DIR}/usr/share/doc/mymqttx" \
  "${OUTPUT_DIR}"

cp -a "${ROOT_DIR}/packaging/DEBIAN/." "${STAGE_DIR}/DEBIAN/"
cp "${ROOT_DIR}/app.py" "${ROOT_DIR}/defaults.py" "${ROOT_DIR}/mqtt_client.py" "${STAGE_DIR}/opt/mymqttx/"
cp "${ROOT_DIR}"/static/*.html "${ROOT_DIR}"/static/*.css "${ROOT_DIR}"/static/*.js "${ROOT_DIR}"/static/*.svg "${STAGE_DIR}/opt/mymqttx/static/"
cp "${ROOT_DIR}/packaging/usr/bin/mymqttx" "${STAGE_DIR}/usr/bin/mymqttx"
cp "${ROOT_DIR}/packaging/usr/share/applications/mymqttx.desktop" "${STAGE_DIR}/usr/share/applications/mymqttx.desktop"
cp "${ROOT_DIR}/README.md" "${STAGE_DIR}/usr/share/doc/mymqttx/README.md"

find "${STAGE_DIR}" -type d -exec chmod 0755 {} +
find "${STAGE_DIR}" -type f -exec chmod 0644 {} +
chmod 0755 "${STAGE_DIR}/DEBIAN/postinst" "${STAGE_DIR}/usr/bin/mymqttx"

dpkg-deb --build --root-owner-group "${STAGE_DIR}" "${OUTPUT_DIR}/mymqttx_${VERSION}_all.deb"

echo "Built: ${OUTPUT_DIR}/mymqttx_${VERSION}_all.deb"

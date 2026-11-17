#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
profile=release
for arg in "$@"; do
  if [ "$arg" = --debug ]; then profile=debug; fi
done
npm run tauri -- build --no-bundle "$@"
mkdir -p build
strip --strip-debug -o build/s75-studio.next "target/$profile/s75-studio"
chmod 755 build/s75-studio.next
mv -f build/s75-studio.next build/s75-studio
install -m 755 scripts/iniciar-s75-studio.sh build/iniciar-s75-studio.sh
cp LICENSE THIRD_PARTY.md build/
tar -czf build/s75-studio-linux-x86_64.tar.gz -C build s75-studio iniciar-s75-studio.sh LICENSE THIRD_PARTY.md
printf '%s\n' 'Pronto: build/s75-studio e build/s75-studio-linux-x86_64.tar.gz'

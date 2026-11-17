#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$(id -u)" -ne 0 ]; then
  exec sudo -- "$0" "$@"
fi
install -m 0644 "$app_dir/permissions/70-s75-studio.rules" /etc/udev/rules.d/70-s75-studio.rules
udevadm control --reload-rules
printf '%s\n' 'Regra instalada. Desconecte e reconecte o teclado por USB.' 'Abra o S75 Studio como usuário normal, sem sudo.'

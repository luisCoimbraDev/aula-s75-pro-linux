#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
native_menu=0
case "${XDG_CURRENT_DESKTOP:-}" in
  *GNOME*|*gnome*)
    if ! gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com; then
      printf '%s\n' 'Não foi possível ativar o AppIndicator. Use o botão Ativar ícone no GNOME dentro do app.' >&2
    fi
    panel_dir=${XDG_DATA_HOME:-"$HOME/.local/share"}/gnome-shell/extensions/s75-studio@luisdev.local
    if [ -f "$panel_dir/metadata.json" ]; then
      if ! gnome-extensions enable s75-studio@luisdev.local; then
        printf '%s\n' 'Para ativar o painel fixo pela primeira vez, saia e entre na sessão GNOME e abra este launcher novamente.' >&2
      fi
    fi
    panel_info=$(LC_ALL=C gnome-extensions info s75-studio@luisdev.local 2>/dev/null || true)
    case "$panel_info" in *'Version: 2'*|*'Version: 3'*) case "$panel_info" in *'State: ACTIVE'*|*'State: ENABLED'*) native_menu=1;; esac;; esac
    ;;
esac
if [ "$#" -eq 0 ]; then if [ "$native_menu" -eq 1 ]; then set -- --tray; else set -- --quick; fi; fi
umask 077
state_dir=${XDG_STATE_HOME:-"$HOME/.local/state"}/dev.aula.s75studio
mkdir -p -- "$state_dir"
nohup "$app_dir/s75-studio" "$@" >"$state_dir/session.log" 2>&1 </dev/null &
printf '%s\n' 'S75 Studio iniciado. Use o ícone do teclado na barra superior.' "Log: $state_dir/session.log"

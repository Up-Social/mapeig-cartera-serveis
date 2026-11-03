#!/usr/bin/env bash
# CLI de Vercel para mapeig, siempre contra la cuenta del cliente y nunca contra la sesión personal.
# Usa un token del equipo de Vercel del cliente guardado fuera del repositorio y una carpeta de
# configuración propia, de forma que no depende del login global de la CLI ni lo modifica.
# Uso: ./scripts/vercel.sh <ls|inspect|logs|whoami|project ls|project inspect> [opciones]. Solo consulta.
# No se crea ningún alias de pnpm para este script, porque saltaría los permisos de Claude Code.

set -euo pipefail

VERCEL_SCOPE="upsocial"
TOKEN_FILE="${VERCEL_TOKEN_FILE:-$HOME/.config/mapeig/vercel-token}"
# Carpeta de configuración propia de la CLI, desechable, para no tocar la sesión global.
CONFIG_DIR="${VERCEL_CONFIG_DIR:-${TMPDIR:-/tmp}/mapeig-vercel-cli}"

if [ ! -r "$TOKEN_FILE" ]; then
  echo "No encuentro el token de Vercel del cliente en $TOKEN_FILE." >&2
  exit 1
fi

# Lista cerrada de lo que este script puede hacer, solo lectura. Cualquier otro subcomando se
# rechaza, incluidos deploy, link, teams, project add, git, env, domains, alias y login, para que
# desde aquí no se pueda publicar, crear proyectos ni equipos, invitar usuarios, conectar nada ni
# cambiar de sesión. Publicar lo hace Vercel solo con cada push; el resto es cosa del dashboard.
case "${1:-}" in
  ls|list|inspect|logs|whoami) ;;
  project)
    case "${2:-}" in
      ls|list|inspect) ;;
      *)
        echo "Este script solo consulta. 'project ${2:-}' no está permitido." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Este script solo consulta. Permitido: ls, inspect, logs, whoami, project ls, project inspect." >&2
    exit 1
    ;;
esac

mkdir -p "$CONFIG_DIR"
export VERCEL_TELEMETRY_DISABLED=1
export NO_UPDATE_NOTIFIER=1
VERCEL_TOKEN_VALUE="$(tr -d '[:space:]' < "$TOKEN_FILE")"

exec vercel --global-config "$CONFIG_DIR" --token "$VERCEL_TOKEN_VALUE" --scope "$VERCEL_SCOPE" "$@"

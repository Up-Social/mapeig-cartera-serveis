#!/bin/sh
# Arranca el servidor MCP de Supabase contra PRODUCCIÓN (vvzxlevbfjvzygorbpxn). No hay staging.
#
# Uso (desde .mcp.json): sh scripts/mcp-supabase.sh ro | rw
#   ro: --read-only. El SQL se ejecuta con un rol de solo lectura y no se exponen las herramientas
#       que modifican (migraciones, funciones). Es el servidor de uso diario.
#   rw: sin --read-only. Claude pide confirmación en cada migración o SQL (ver .claude/settings.json).
#
# El token personal de Supabase (sbp_…) se lee de ~/.config/mapeig/supabase-token, fuera del
# repositorio, con permisos 600. Crearlo con caducidad corta y revocarlo al terminar la entrega.
# Se pasa por entorno y no por --access-token para que no aparezca en `ps`.
set -eu

mode="${1:-}"
case "$mode" in
  ro) read_only="--read-only" ;;
  rw) read_only="" ;;
  *) echo "mcp-supabase: indica ro o rw." >&2; exit 2 ;;
esac

token_file="${SUPABASE_TOKEN_FILE:-$HOME/.config/mapeig/supabase-token}"
if [ ! -r "$token_file" ]; then
  echo "mcp-supabase: no encuentro el token en $token_file." >&2
  exit 1
fi
token="$(tr -d '[:space:]' < "$token_file")"
case "$token" in
  sbp_*) ;;
  *) echo "mcp-supabase: el token de $token_file no empieza por sbp_." >&2; exit 1 ;;
esac

SUPABASE_ACCESS_TOKEN="$token"
export SUPABASE_ACCESS_TOKEN
# shellcheck disable=SC2086
exec npx -y @supabase/mcp-server-supabase@latest --project-ref=vvzxlevbfjvzygorbpxn $read_only

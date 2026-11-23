#!/bin/sh
set -e

# Identité du processus Node et du répertoire de données. Les défauts suivent la
# convention Docker la plus répandue ; PUID/PGID permettent de coller à l'hôte
# (sur UnRAID : 99/100).
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Port d'écoute de nginx (#33). Avec `-p hôte:80`, on choisit le port de l'hôte
# à gauche et cette variable est inutile. Elle sert quand le conteneur n'a pas
# de correspondance de ports : réseau « host », ou une IP à lui (macvlan, br0
# d'Unraid). Absente, rien ne change : 80. Une valeur invalide arrête le
# démarrage avec un message, plutôt qu'un repli silencieux sur 80.
FRIRSS_PORT="${FRIRSS_PORT:-80}"
NGINX_SITE=/etc/nginx/http.d/default.conf
case "$FRIRSS_PORT" in
  ''|0*|*[!0-9]*) port_ok=no ;;
  *) if [ "${#FRIRSS_PORT}" -le 5 ] && [ "$FRIRSS_PORT" -le 65535 ]; then port_ok=yes; else port_ok=no; fi ;;
esac
if [ "$port_ok" != yes ]; then
  echo "FriRSS: FRIRSS_PORT=$FRIRSS_PORT is not a port number (1-65535)." >&2
  exit 1
fi
# 3001 est le port interne de Node, auquel nginx envoie l'API.
if [ "$FRIRSS_PORT" = 3001 ]; then
  echo "FriRSS: FRIRSS_PORT cannot be 3001, the internal port of the backend." >&2
  exit 1
fi
# Réécrire la ligne `listen` seulement si elle diffère : idempotent au
# redémarrage, et aucune écriture dans le cas habituel (utile sous `--user`,
# où le fichier n'est pas modifiable).
if ! grep -Eq "^[[:space:]]*listen ${FRIRSS_PORT};$" "$NGINX_SITE"; then
  if ! sed -i -E "s/^([[:space:]]*listen )[0-9]+;$/\1${FRIRSS_PORT};/" "$NGINX_SITE" 2>/dev/null; then
    echo "FriRSS: cannot set FRIRSS_PORT=$FRIRSS_PORT (nginx config not writable by this user)." >&2
    exit 1
  fi
fi

# nginx d'abord, avec les privilèges qu'il a toujours eus : un master root qui
# se lie à son port (80 par défaut), et des workers abaissés au compte `nginx` par la directive
# `user` de nginx.conf. Ce sont les workers qui touchent aux données des
# requêtes. On ne cherche PAS à rendre le master non privilégié : il faudrait
# une capacité de fichier, refusée sous `no-new-privileges` ou `cap_drop: ALL`,
# et cette image casserait alors là où elle fonctionnait avant.
nginx

# Node écoute toujours sur 3001, où nginx lui envoie l'API : une variable PORT
# posée pour changer le port public le déplaçait et cassait toute l'API.
#
# Node, lui, exécute le code applicatif, analyse du contenu non fiable et détient
# la base — c'est là que root coûtait cher. Il tourne donc sans privilèges.
if [ "$(id -u)" = "0" ]; then
  # Le volume de données existe peut-être déjà, créé par une version qui
  # tournait en root : on l'adopte plutôt que d'échouer dessus.
  mkdir -p /app/data
  chown -R "$PUID:$PGID" /app/data
  # shellcheck disable=SC2086
  NODE_ENV=production PORT=3001 exec su-exec "$PUID:$PGID" node server-dist/index.js
fi

# Déjà non privilégié (`docker run --user`) : rien à abandonner, et le chown
# échouerait. On fait confiance à l'opérateur qui a choisi cet utilisateur.
NODE_ENV=production PORT=3001 exec node server-dist/index.js

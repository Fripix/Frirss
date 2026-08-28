#!/bin/sh
set -e

# Identité du processus Node et du répertoire de données. Les défauts suivent la
# convention Docker la plus répandue ; PUID/PGID permettent de coller à l'hôte
# (sur UnRAID : 99/100).
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# nginx d'abord, avec les privilèges qu'il a toujours eus : un master root qui
# se lie au port 80, et des workers abaissés au compte `nginx` par la directive
# `user` de nginx.conf. Ce sont les workers qui touchent aux données des
# requêtes. On ne cherche PAS à rendre le master non privilégié : il faudrait
# une capacité de fichier, refusée sous `no-new-privileges` ou `cap_drop: ALL`,
# et cette image casserait alors là où elle fonctionnait avant.
nginx

# Node, lui, exécute le code applicatif, analyse du contenu non fiable et détient
# la base — c'est là que root coûtait cher. Il tourne donc sans privilèges.
if [ "$(id -u)" = "0" ]; then
  # Le volume de données existe peut-être déjà, créé par une version qui
  # tournait en root : on l'adopte plutôt que d'échouer dessus.
  mkdir -p /app/data
  chown -R "$PUID:$PGID" /app/data
  # shellcheck disable=SC2086
  NODE_ENV=production exec su-exec "$PUID:$PGID" node server-dist/index.js
fi

# Déjà non privilégié (`docker run --user`) : rien à abandonner, et le chown
# échouerait. On fait confiance à l'opérateur qui a choisi cet utilisateur.
NODE_ENV=production exec node server-dist/index.js

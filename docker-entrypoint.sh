#!/bin/sh
set -e

# Identité du compte de service. Les défauts suivent la convention Docker la
# plus répandue ; PUID/PGID permettent de coller à l'hôte (sur UnRAID : 99/100).
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Le conteneur démarre en root uniquement pour cette étape : adopter le volume
# de données puis abandonner les privilèges. Toute installation antérieure a un
# /app/data appartenant à root — l'adopter est la seule migration acceptable,
# échouer dessus casserait chaque mise à jour.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data /run/nginx /var/lib/nginx /var/log/nginx
  chown -R "$PUID:$PGID" /app/data /run/nginx /var/lib/nginx /var/log/nginx
  RUN_AS="su-exec $PUID:$PGID"
else
  # Déjà non privilégié (`docker run --user`) : rien à abandonner, et le chown
  # échouerait. On fait confiance à l'opérateur qui a choisi cet utilisateur.
  RUN_AS=""
fi

# nginx en arrière-plan (il se démonise lui-même), Express au premier plan pour
# que le conteneur vive et meure avec lui.
# shellcheck disable=SC2086
$RUN_AS nginx

# shellcheck disable=SC2086
NODE_ENV=production exec $RUN_AS node server-dist/index.js

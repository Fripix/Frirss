#!/bin/sh

# Start nginx in background
nginx

# Start Express backend (compiled TS → server-dist; foreground — container stays alive)
NODE_ENV=production exec node server-dist/index.js

#!/bin/bash
set -e

SERVER="ec2-user@mitbrain.org"
KEY="$HOME/.ssh/MIT Brain.pem"
APP_DIR="/opt/mitbrain/app"

echo "Syncing brain data..."
scp -i "$KEY" brain/mit_brain_test17.jsonl $SERVER:$APP_DIR/brain/

echo "Syncing people directory..."
rsync -avz -e "ssh -i \"$KEY\"" \
  --exclude='dropbox-settings.json' \
  people/ $SERVER:$APP_DIR/people/

echo "Restarting server..."
ssh -i "$KEY" $SERVER "pm2 restart mitbrain"

echo "Data sync complete!"

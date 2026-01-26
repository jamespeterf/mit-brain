#!/bin/bash
set -e

SERVER="ec2-user@mitbrain.org"
KEY="$HOME/.ssh/MIT Brain.pem"
APP_DIR="/opt/mitbrain/app"

echo "Deploying to mitbrain.org..."

# Push latest code to GitHub
git push origin main

# SSH into server, pull, and restart
ssh -i "$KEY" $SERVER << 'EOF'
  cd /opt/mitbrain/app
  git pull origin main
  npm install --production
  pm2 restart mitbrain
  echo "Deploy complete!"
EOF

echo "Done! Check https://mitbrain.org"

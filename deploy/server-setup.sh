#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 EC2 server. Run as the default "ubuntu" user:
#   bash server-setup.sh
set -euo pipefail

echo "==> Installing Docker and the Compose plugin (Ubuntu packages)"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 unattended-upgrades
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "==> Enabling automatic security updates"
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# The React build needs more memory than a 2 GB instance has free; a swap file prevents
# out-of-memory failures during 'docker compose build'.
if ! swapon --show | grep -q /swapfile; then
  echo "==> Adding a 2 GB swap file"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

mkdir -p ~/billing
echo
echo "Done. Log out and back in (so the docker group applies), then run deploy.ps1 from your PC."

# crygup Website

The website runs as three hardened Docker containers behind the host Nginx server:

- `static` serves the files in `src/` on `127.0.0.1:8081`
- `avatar-api` serves the avatar lookup API on `127.0.0.1:8000`
- `download-api` processes restricted media downloads on `127.0.0.1:8002`
- Fishie's separate container continues to serve `/fishie/` on `127.0.0.1:8001`
- Nginx remains the public entry point used by Cloudflare

The containers run as the host user, use read-only root filesystems, drop Linux capabilities, and only publish loopback ports. Runtime credentials stay in the ignored `src/server/config/.env` file and are mounted read-only into the avatar API container. Optional downloader cookies stay in the ignored `src/server/cookies/` directory and are mounted read-only into the download container.

## First deployment

Create the non-secret Compose environment file with your host user and group IDs:

```bash
cp .env.example .env
id -u
id -g
```

Update `WEBSITE_UID` and `WEBSITE_GID` in `.env` if the displayed values differ. Confirm that `src/server/config/.env` contains the existing `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and `DATABASE_URL`, then deploy:

```bash
./deploy.sh
```

The deployment builds and checks the static container first. It then stops the legacy avatar systemd service, starts and checks the avatar API container, installs the Nginx proxy configuration, and disables the legacy service. If the avatar container fails its initial health check, the script restores the old service when it was previously active.

## Daily commands

```bash
# Show status
sudo docker compose --env-file .env -f compose.production.yaml ps

# Follow logs
sudo docker compose --env-file .env -f compose.production.yaml logs -f

# Restart both services
sudo docker compose --env-file .env -f compose.production.yaml restart

# Rebuild after source or dependency changes
./deploy.sh
```

Application logs are written to the ignored `src/logs/` directory. Docker also keeps size-limited service logs for startup and container diagnostics. Downloaded media is held temporarily in the ignored `src/downloads/` directory, expires automatically, and is cleared whenever the download container starts.

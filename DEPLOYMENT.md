# Production deployment

Production uses Docker Compose for Fishie and for every Website service. Nginx
is the host reverse proxy and Cloudflare provides the public DNS and TLS edge.
The old `fish.service` and `avatar-lookup.service` systemd units are retired.

Keep the two repositories checked out beside each other. Configuration, cookies,
media, downloads, logs, credentials, and backups stay in the ignored paths
documented by each repository's `.gitignore`; never copy those files into a
commit or a public image.

## Fishie

From the Fish repository, set `FISHIE_UID` and `FISHIE_GID` in `.env`, verify
the ignored `config.toml` and credential key, then apply migrations with the
same image used by production:

```bash
sudo docker compose --env-file .env -f compose.production.yaml build
sudo docker compose --env-file .env -f compose.production.yaml run --rm --no-deps fishie-new python manage.py migrate
sudo docker compose --env-file .env -f compose.production.yaml up -d fishie fishie-new
sudo docker compose --env-file .env -f compose.production.yaml ps
```

`fishie-new` owns the Fishie API on `127.0.0.1:8001`. The legacy `fishie`
container can remain online during a handoff, but its API is disabled. Check
that the replacement container is healthy before changing any traffic or
stopping the legacy container.

## Website

From the Website repository, copy `.env.example` to the ignored `.env` and set
the host UID/GID plus both media API keys. Run:

```bash
./deploy.sh
```

The script builds and health-checks the static site (`127.0.0.1:8081`), avatar
API (`127.0.0.1:8000`), download API (`127.0.0.1:8002`), and temporary media
API (`127.0.0.1:8003`). It backs up the installed Nginx configuration, tests
the replacement configuration, and reloads Nginx. If validation fails, it
restores the previous Nginx file.

Nginx routes `crygup.com` to the static service and `api.crygup.com` to the
Fishie, avatar, and media endpoints. Cloudflare must continue to proxy those
hostnames to the server; the origin services should remain loopback-only.

## Verification and rollback

After either deployment, inspect container health and recent logs:

```bash
sudo docker compose --env-file .env -f compose.production.yaml ps
sudo docker compose --env-file .env -f compose.production.yaml logs --tail 100 fishie-new
sudo docker compose --env-file .env -f compose.production.yaml logs --tail 100 fishie
sudo nginx -t
sudo systemctl status nginx --no-pager
```

Keep the backup created before the deployment until the new containers and
public health endpoints have been checked. Roll back by restoring that Nginx
backup, then redeploying the previous Docker image or checkout; do not restart
the retired systemd units.

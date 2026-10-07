#!/usr/bin/env bash
set -euo pipefail

ROOT="$(dirname "$(realpath "$0")")"
COMPOSE_FILE="$ROOT/compose.production.yaml"
ENV_FILE="$ROOT/.env"
NGINX_CONFIG="$ROOT/nginx/crygup.conf"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE. Copy .env.example to .env and set the host UID and GID."
    exit 1
fi

compose() {
    sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_for_health() {
    local service="$1"
    local attempts="${2:-24}"
    local container_id status

    container_id="$(compose ps -q "$service")"
    if [[ -z "$container_id" ]]; then
        echo "No container was created for $service."
        return 1
    fi

    for ((i = 1; i <= attempts; i++)); do
        status="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
        if [[ "$status" == "healthy" ]]; then
            return 0
        fi
        if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
            compose logs --tail 100 "$service"
            return 1
        fi
        sleep 5
    done

    compose logs --tail 100 "$service"
    echo "$service did not become healthy in time."
    return 1
}

cd "$ROOT"

echo "Building website images"
compose build

echo "Starting the static site on 127.0.0.1:8081"
compose up --detach --no-deps static
wait_for_health static 12

echo "Starting the temporary media API on 127.0.0.1:8003"
if ! compose up --detach --no-deps media-api || ! wait_for_health media-api 18; then
    compose stop media-api || true
    echo "Temporary media API deployment failed. Set FISHIE_MEDIA_API_KEY in .env and try again."
    exit 1
fi

echo "Starting the private Roblox API proxy on 127.0.0.1:8004"
if ! compose up --detach --no-deps rapi-api || ! wait_for_health rapi-api 18; then
    compose stop rapi-api || true
    echo "Roblox API proxy deployment failed. Set a 32+ character RAPI_KEY in .env and try again."
    exit 1
fi

echo "Starting the RObase PostgreSQL database"
if ! compose up --detach robase-db || ! wait_for_health robase-db 18; then
    echo "RObase database deployment failed. Set RODB_DB_PASSWORD in .env and try again."
    exit 1
fi

echo "Starting the RObase API on 127.0.0.1:8005"
if ! compose up --detach --no-deps rodb-api || ! wait_for_health rodb-api 18; then
    compose stop rodb-api || true
    echo "RObase API deployment failed. Set a 32+ character RODB_KEY in .env and try again."
    exit 1
fi

echo "Starting the avatar API on 127.0.0.1:8000"
if ! compose up --detach --no-deps avatar-api || ! wait_for_health avatar-api 30; then
    compose stop avatar-api || true
    compose stop media-api || true
    compose stop rapi-api || true
    compose stop rodb-api || true
    echo "Avatar API deployment failed. Inspect the container logs before retrying."
    exit 1
fi

echo "Installing and validating the Nginx proxy configuration"
backup_dir="$ROOT/../backup/website-deploy-$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$backup_dir"
nginx_backup="$backup_dir/nginx-crygup.conf"
sudo cp /etc/nginx/sites-available/crygup "$nginx_backup"
sudo install -m 644 "$NGINX_CONFIG" /etc/nginx/sites-available/crygup
if ! sudo nginx -t || ! sudo systemctl reload nginx; then
    sudo install -m 644 "$nginx_backup" /etc/nginx/sites-available/crygup
    sudo nginx -t
    sudo systemctl reload nginx
    compose stop media-api || true
    compose stop rapi-api || true
    compose stop rodb-api || true
    echo "Nginx rejected the new configuration. The previous configuration was restored."
    exit 1
fi


echo "Website containers are running"
compose ps

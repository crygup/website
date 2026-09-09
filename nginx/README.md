# Production security

- Install `download-egress.nft` as `/etc/fishie-download-egress.nft` and
  `fishie-download-egress.service` in `/etc/systemd/system/`. Enable/start the
  service **before** starting the downloader. Install `fishie-download.service`
  alongside it (adjust WorkingDirectory if needed), then enable/start that
  service. It requires and is stopped with the firewall. Docker's automatic
  restart policy is disabled for this container; use the systemd service,
  not a manual Compose start, to preserve that dependency. Its dedicated `fish-download`
  bridge must retain that name. The rules block internal destinations for
  every downloader process, including curl and FFmpeg.
  Reload the firewall with `systemctl reload fishie-download-egress`;
  nftables replaces the rules atomically and retains the old policy on errors.
- Install `crygup.conf` in Nginx's sites configuration, validate with
  `nginx -t`, then reload. Only Cloudflare peers and localhost may reach these
  virtual hosts. Keep the Cloudflare ranges current.
- The origin certificate covers `crygup.com`, `www.crygup.com`, and
  `api.crygup.com`. Use Cloudflare **Full (strict)**. ACME challenges use
  `/var/lib/letsencrypt`. Install `renew-nginx.sh` as an executable Certbot
  deploy hook so renewed certificates are loaded.
- Rebuild API images when deploying source changes; a restart alone does not
  update their code. Check all `/health/ready` endpoints after deployment.
- Cookies remain private mounts, excluded from images and Git. Use only
  limited burner accounts. Working copies are removed after each job.
- Proxy logs omit queries, referrers and media/job tokens. Raw Nginx error
  logging is disabled for these hosts because it includes request targets;
  use application logs and HTTP status counts. Cloudflare logging is managed
  separately and should omit callback queries and temporary-media URLs too.

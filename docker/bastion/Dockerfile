# Secondlayer tenant DB bastion.
#
# Accepts SSH connections on port 22, forwards to the tenant's pg container
# via `ssh -L 5432:sl-pg-<slug>:5432 tenant-<slug>@bastion`. One Unix user
# per tenant; per-user PermitOpen restricts forwarding to that tenant's pg.
#
# Config is split so the provisioner can add/remove tenants by writing a
# single file to /etc/ssh/sshd_config.d/ via docker exec + SIGHUP.

FROM alpine:3.20

RUN apk add --no-cache openssh bash shadow tini \
  && mkdir -p /etc/ssh/sshd_config.d /var/empty \
  && chmod 700 /var/empty

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY tenant-add.sh /usr/local/bin/tenant-add.sh
COPY tenant-remove.sh /usr/local/bin/tenant-remove.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  /usr/local/bin/tenant-add.sh \
  /usr/local/bin/tenant-remove.sh

EXPOSE 22

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]

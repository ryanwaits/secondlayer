#!/usr/bin/env bash
# Egress + host-access firewall for the workload host (plan 044, step 1).
# This file is the ONLY copy of these rules (review fix C — two copies used
# to drift). `cloud-init.yaml`'s `write_files` entry for this same path
# holds a placeholder (`__DOCKER_USER_EGRESS_SCRIPT__`); `provision.sh`
# inlines this file verbatim at render time, before `hcloud server create`
# ever sees it, so cloud-init always runs an exact copy of what's here — no
# hand-syncing, and `bash -n`/shellcheck can validate this file directly
# outside the surrounding YAML.
#
# Two independent rule sets, both idempotent (flush-then-rebuild, safe to
# re-run on reboot or re-provision):
#
# 1. DOCKER-USER (FORWARD chain hook Docker leaves empty for operator
#    rules): egress allowlist for every tenant compose network — only
#    app-server:443 and the open internet, never another tenant, never the
#    Hetzner metadata IP, never an RFC1918 range (Design: "egress:
#    app-server :443 + public internet only").
#
#    Review fix 6a: a blanket RFC1918 drop also cuts a tenant's OWN
#    api → postgres traffic when `br_netfilter` is active (bridged intra-network
#    traffic then also traverses FORWARD/DOCKER-USER, and Docker's default
#    bridge subnets sit inside 172.16.0.0/12). Fixed two ways:
#      - `-m physdev --physdev-is-bridged` ACCEPTs same-bridge traffic
#        unconditionally, right after the ESTABLISHED rule — this is
#        specifically traffic stayin on ONE bridge (a tenant's own network),
#        never traffic routed between two different bridges.
#      - Cross-tenant is instead blocked explicitly by interface, not by
#        address range: `-i br+ -o br+` matches routed (not bridged) traffic
#        between two different docker bridges — exactly tenant-to-tenant.
#      - The private-range drops are scoped `-i br+`: they refuse a
#        CONTAINER reaching those ranges (the Hetzner private network,
#        another bridge's subnet, etc.), without touching any non-container
#        forwarding this host might ever do.
#
# 2. WORKLOAD-INPUT (a dedicated chain hooked into INPUT for docker-bridge
#    traffic): review fix 6b — DOCKER-USER only ever sees FORWARDED traffic.
#    A packet from a tenant container addressed to the HOST itself (the
#    bridge gateway IP, e.g. a tenant reaching the gateway's :8080, the
#    control Postgres port, or another tenant's loopback-published api port
#    via that IP) goes through INPUT, which DOCKER-USER never touches. This
#    chain drops every NEW connection arriving from a docker bridge, keeping
#    only ESTABLISHED/RELATED (replies to something the HOST initiated).
set -euo pipefail

APP_SERVER_IP="${APP_SERVER_IP:?set APP_SERVER_IP before running}"
METADATA_IP="169.254.169.254"

### 1. DOCKER-USER — egress allowlist ###

iptables -F DOCKER-USER 2>/dev/null || iptables -N DOCKER-USER

# Established/related first — replies to outbound connections tenants are
# allowed to make (and, via physdev below, intra-tenant replies too).
iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Same-bridge (intra-tenant) traffic — api <-> postgres <-> webhook-service
# on ONE tenant's own network. `--physdev-is-bridged` only matches traffic
# actually being bridged (both ends on the same L2 segment); it does not
# match traffic routed between two different bridges, so this can never
# become a tenant-to-tenant hole.
iptables -A DOCKER-USER -m physdev --physdev-is-bridged -j ACCEPT

# Always allow app-server:443 — the gateway's own introspect/meters/tenant-key
# calls and any tenant's own outbound webhook-service reads.
iptables -A DOCKER-USER -d "$APP_SERVER_IP" -p tcp --dport 443 -j ACCEPT

# Refuse the metadata IP outright (SSRF-into-cloud-credentials class).
iptables -A DOCKER-USER -d "$METADATA_IP" -j DROP

# Cross-tenant: routed (not bridged) traffic between two different docker
# bridges. This is the actual tenant-to-tenant path — each tenant's compose
# project is its own bridge (`br-xxxxxxxx`), so `-i br+ -o br+` is exactly
# "entered one tenant's bridge, forwarded toward another's."
iptables -A DOCKER-USER -i br+ -o br+ -j DROP

# Private ranges, scoped to traffic ORIGINATING from a docker bridge
# (`-i br+`) — a container reaching the Hetzner private network, another
# bridge's subnet directly, link-local, or loopback. Scoping to `-i br+`
# means this only ever restricts CONTAINER-originated traffic.
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 127.0.0.0/8; do
	iptables -A DOCKER-USER -i br+ -d "$net" -j DROP
done

# Everything else (the public internet) — accepted.
iptables -A DOCKER-USER -j ACCEPT

### 2. WORKLOAD-INPUT — container-to-host protection ###

iptables -F WORKLOAD-INPUT 2>/dev/null || iptables -N WORKLOAD-INPUT
iptables -A WORKLOAD-INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A WORKLOAD-INPUT -j DROP

# Hook it into INPUT for anything arriving via a docker bridge or docker0.
# Delete-then-insert (ignoring a missing-rule error) keeps this idempotent —
# a re-run never stacks duplicate jumps into INPUT.
iptables -D INPUT -i docker0 -j WORKLOAD-INPUT 2>/dev/null || true
iptables -D INPUT -i br+ -j WORKLOAD-INPUT 2>/dev/null || true
iptables -I INPUT 1 -i docker0 -j WORKLOAD-INPUT
iptables -I INPUT 1 -i br+ -j WORKLOAD-INPUT

netfilter-persistent save

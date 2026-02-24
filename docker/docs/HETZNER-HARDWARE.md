# Hetzner AX52 Hardware & Storage

Server-specific hardware configuration for the Hetzner AX52 deployment.

---

## Server Spec

- **CPU**: AMD Ryzen 7 7700 (8c/16t)
- **RAM**: 64GB DDR5
- **Drives**: 4x NVMe (2x 512GB Toshiba + 2x 1TB Samsung)
- **Network**: 1 Gbit/s
- **Cost**: ~$60/mo

---

## Drive Layout

| Drive | Model | Size | RAID Usage | Free |
|-------|-------|------|------------|------|
| nvme0n1 | Toshiba 512GB | 477GB | All used | 0 |
| nvme1n1 | Toshiba 512GB | 477GB | All used | 0 |
| nvme2n1 | Samsung 1TB | 954GB | 477GB | **477GB** |
| nvme3n1 | Samsung 1TB | 954GB | 477GB | **477GB** |

The 4 drives are in RAID6 (~887GB usable). The two Samsung drives each have ~477GB free space beyond their RAID partitions.

---

## LVM Stripe for Chainstate

We stripe the free space on both Samsung drives into a single ~938GB volume for chainstate data.

**LVM config:**
- PVs: `/dev/nvme2n1p4`, `/dev/nvme3n1p4`
- VG: `chainstate-vg`
- LV: `chainstate` (striped across both, ~938GB)
- Mounted at `/mnt/chainstate`

No redundancy — if either Samsung fails, chainstate is lost. Acceptable since it can be restored from [Hiro's archive snapshot](BACKFILL.md#chainstate-snapshot-restore).

### Setup Commands (already done)

```bash
# Create p4 partitions on free space of Samsung drives
parted /dev/nvme2n1 mkpart primary 512GB 100%
parted /dev/nvme3n1 mkpart primary 512GB 100%

# LVM: stripe across both drives
pvcreate /dev/nvme2n1p4 /dev/nvme3n1p4
vgcreate chainstate-vg /dev/nvme2n1p4 /dev/nvme3n1p4
lvcreate -l 100%FREE -n chainstate -i 2 chainstate-vg

# Format, mount, persist
mkfs.ext4 /dev/chainstate-vg/chainstate
mkdir -p /mnt/chainstate
mount /dev/chainstate-vg/chainstate /mnt/chainstate
echo '/dev/chainstate-vg/chainstate /mnt/chainstate ext4 defaults 0 2' >> /etc/fstab

# Point secondlayer at the new volume
echo 'CHAINSTATE_DIR=/mnt/chainstate' >> /opt/secondlayer/docker/.env
```

---

## Storage Requirements

| Component | Size |
|-----------|------|
| Stacks blockchain (mainnet, fully synced) | 800-900 GB |
| PostgreSQL (secondlayer) | ~50 GB |
| Hiro PG archive (temporary, for backfill) | ~120-150 GB |
| Views cache | ~10 GB |

The RAID6 volume (~887GB) is tight for a fully synced node — hence the LVM stripe.

---

## Future: Drive Swap

The AX52 is at max drive count. Hetzner can replace a 512GB Toshiba with a 2TB NVMe (~30min downtime). This would allow partitioning the 2TB for RAID rebuild (~477GB) + ~1.5TB standalone chainstate, eliminating the LVM stripe.

Contact Hetzner via Robot → Support to schedule.

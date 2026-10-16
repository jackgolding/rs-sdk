terraform {
  required_version = ">= 1.9.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# Single pilot box: 4 vCPU / 8 GB (fleet uses ~3 GB for 100 procs on the Mac;
# one bot is a rounding error — this size leaves room to grow the pilot).
resource "hcloud_server" "pilot" {
  name        = "fleet-pilot"
  server_type = var.server_type
  location    = "sin" # Singapore — closest Hetzner region to Perth
  image       = "ubuntu-24.04"

  ssh_keys     = [hcloud_ssh_key.deployer.id]
  firewall_ids = [hcloud_firewall.pilot.id]

  # Docker via cloud-init so a rebuild is reproducible, not snowflaked by hand.
  user_data = file("${path.module}/cloud-init.yml")

  lifecycle {
    # Server type/location/image force replacement — say so loudly, not silently.
    prevent_destroy = false
  }
}

resource "hcloud_ssh_key" "deployer" {
  name       = "fleet-pilot-deployer"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# Default-deny ingress, SSH only. Fleet-desk stays off the public internet;
# reach the box over SSH (or add Tailscale later — no open ports needed).
resource "hcloud_firewall" "pilot" {
  name = "fleet-pilot"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

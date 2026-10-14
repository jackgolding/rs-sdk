variable "hcloud_token" {
  description = "Hetzner Cloud API token (Read & Write). Pass via TF_VAR_hcloud_token env var — never commit it."
  type        = string
  sensitive   = true
}

variable "ssh_public_key_path" {
  description = "Local public key uploaded as the server's deployer key."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "location" {
  description = "Hetzner region. sin = Singapore (closest to Perth); alternatives: fsn1, nbg1, hel1."
  type        = string
  default     = "sin"
}

variable "server_type" {
  description = "CPX22 (2 vCPU / 4 GB, ~6.50 EUR) fits the 1-bot pilot easily; the full 48-bot fleet measured ~3.1 GB, so step up to cpx32/cpx42 when migrating en masse. Resizing needs no rebuild."
  type        = string
  default     = "cpx22"
}

variable "allowed_ssh_cidr" {
  description = "Who may reach port 22. Pilot default is open; lock to your IP (e.g. 1.2.3.4/32) for production."
  type        = string
  default     = "0.0.0.0/0"
}

output "pilot_ipv4" {
  description = "Public IPv4 of the pilot box. SSH as root; repo lives at /srv/fleet/repo. Use for the VPS_HOST Actions secret."
  value       = hcloud_server.pilot.ipv4_address
}

output "server_name" {
  value = hcloud_server.pilot.name
}

# -----------------------------------------------------------------------------
# Un workspace = un ambiente. Todo nombre de recurso deriva de terraform.workspace,
# por lo que un apply en "test" jamás puede tocar recursos ni estado de "prod".
# -----------------------------------------------------------------------------
locals {
  env         = terraform.workspace
  name_prefix = "aegisvolt-${local.env}"

  services = ["graphql-gateway", "station-reservation-service", "billing-wallet-service", "energy-dispatch-service"]

  environments = {
    dev = {
      vpc_cidr            = "10.10.0.0/16"
      log_retention_days  = 7
      pitr                = false
      deletion_protection = false
      throttle_rate       = 50
      flags = {
        ENABLE_DYNAMIC_SURGE_PRICING    = true
        ENABLE_FAST_CHARGE_BOOST        = true
        SIMULATE_CHARGER_HARDWARE_FAULT = false
      }
    }
    test = {
      vpc_cidr            = "10.20.0.0/16"
      log_retention_days  = 14
      pitr                = false
      deletion_protection = false
      throttle_rate       = 50
      flags = {
        ENABLE_DYNAMIC_SURGE_PRICING    = true
        ENABLE_FAST_CHARGE_BOOST        = true
        SIMULATE_CHARGER_HARDWARE_FAULT = false
      }
    }
    prod = {
      vpc_cidr            = "10.30.0.0/16"
      log_retention_days  = 30
      pitr                = true
      deletion_protection = true
      throttle_rate       = 200
      flags = {
        ENABLE_DYNAMIC_SURGE_PRICING    = false
        ENABLE_FAST_CHARGE_BOOST        = false
        SIMULATE_CHARGER_HARDWARE_FAULT = false
      }
    }
  }

  # lookup con default {} + precondition => error explícito si se usa el workspace "default".
  cfg = lookup(local.environments, local.env, local.environments["dev"])
}

resource "terraform_data" "workspace_guard" {
  lifecycle {
    precondition {
      condition     = contains(keys(local.environments), terraform.workspace)
      error_message = "Workspace inválido \"${terraform.workspace}\". Use: terraform workspace select dev|test|prod"
    }
  }
}

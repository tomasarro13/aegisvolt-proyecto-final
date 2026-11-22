# Feature flags propias en DynamoDB: una tabla por ambiente => estado independiente dev/test/prod.
# Terraform solo SIEMBRA el valor inicial; ignore_changes permite cambiarlas en caliente
# (GraphQL / aws cli) sin que el siguiente apply las revierta ni haya que redesplegar.
resource "aws_dynamodb_table" "flags" {
  name         = "aegisvolt-feature-flags-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "flagKey"

  attribute {
    name = "flagKey"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  tags = { Service = "feature-flags" }
}

locals {
  descriptions = {
    ENABLE_DYNAMIC_SURGE_PRICING    = "Activa tarifas dinámicas (x1.35) en horas pico"
    ENABLE_FAST_CHARGE_BOOST        = "Habilita reserva prioritaria de ultra-carga (hold 30 min, x1.2)"
    SIMULATE_CHARGER_HARDWARE_FAULT = "Inyección de fallos: el cargador reporta falla física (demo de rollback SAGA)"
  }
}

resource "aws_dynamodb_table_item" "flag" {
  for_each   = var.initial_flags
  table_name = aws_dynamodb_table.flags.name
  hash_key   = aws_dynamodb_table.flags.hash_key

  item = jsonencode({
    flagKey     = { S = each.key }
    enabled     = { BOOL = each.value }
    description = { S = local.descriptions[each.key] }
    environment = { S = var.environment }
    updatedAt   = { S = "terraform-seed" }
    updatedBy   = { S = "terraform" }
  })

  lifecycle {
    ignore_changes = [item]
  }
}

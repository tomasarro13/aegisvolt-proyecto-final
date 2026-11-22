# Database-per-Service: cada microservicio es dueño exclusivo de su tabla, separada por ambiente.
locals {
  tables = {
    reservations = { owner = "station-reservation-service", hash_key = "pk", range_key = "sk" }
    billing      = { owner = "billing-wallet-service", hash_key = "pk", range_key = "sk" }
    dispatch     = { owner = "energy-dispatch-service", hash_key = "pk", range_key = "sk" }
    sagas        = { owner = "graphql-gateway", hash_key = "sagaId", range_key = null }
  }
}

resource "aws_dynamodb_table" "this" {
  for_each     = local.tables
  name         = "aegisvolt-${each.key}-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = each.value.hash_key
  range_key    = each.value.range_key

  attribute {
    name = each.value.hash_key
    type = "S"
  }

  dynamic "attribute" {
    for_each = each.value.range_key == null ? [] : [each.value.range_key]
    content {
      name = attribute.value
      type = "S"
    }
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  server_side_encryption {
    enabled = true
  }

  deletion_protection_enabled = var.deletion_protection

  tags = { Service = each.value.owner, DataOwner = each.value.owner }
}

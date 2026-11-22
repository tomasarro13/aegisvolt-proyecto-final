# Catálogo inicial (estaciones/conectores y billeteras de flotas) sembrado por ambiente.
# ignore_changes: el estado operativo (RESERVED, saldos...) lo gestionan los microservicios.
locals {
  stations = {
    "BOG-01" = { name = "AegisVolt Hub Calle 80", city = "Bogotá", address = "Av. Calle 80 #69-70", lat = 4.6951, lng = -74.0866,
    connectors = { "BOG-01-C1" = ["CCS2", 180], "BOG-01-C2" = ["CCS2", 60], "BOG-01-C3" = ["TYPE2", 22] } }
    "BOG-02" = { name = "Electrolinera Zona Franca", city = "Bogotá", address = "Cra. 106 #15A-25", lat = 4.6644, lng = -74.1475,
    connectors = { "BOG-02-C1" = ["CCS2", 150], "BOG-02-C2" = ["CHADEMO", 50] } }
    "MDE-01" = { name = "AegisVolt Las Palmas", city = "Medellín", address = "Vía Las Palmas km 2", lat = 6.2163, lng = -75.5599,
    connectors = { "MDE-01-C1" = ["CCS2", 120], "MDE-01-C2" = ["TYPE2", 22] } }
    "CLO-01" = { name = "Hub Logístico Acopi", city = "Cali", address = "Cl. 15 #26-101 Yumbo", lat = 3.5155, lng = -76.4930,
    connectors = { "CLO-01-C1" = ["CCS2", 60], "CLO-01-C2" = ["CCS2", 60] } }
    "MEX-01" = { name = "AegisVolt Vallejo", city = "Ciudad de México", address = "Av. Poniente 140 #720", lat = 19.4890, lng = -99.1610,
    connectors = { "MEX-01-C1" = ["CCS2", 180], "MEX-01-C2" = ["CCS2", 150], "MEX-01-C3" = ["TYPE2", 22] } }
    "SCL-01" = { name = "Electrolinera Pudahuel", city = "Santiago", address = "Av. Américo Vespucio 1001", lat = -33.4447, lng = -70.7570,
    connectors = { "SCL-01-C1" = ["CCS2", 150], "SCL-01-C2" = ["CHADEMO", 50] } }
    "LIM-01" = { name = "AegisVolt Callao", city = "Lima", address = "Av. Néstor Gambetta 5200", lat = -12.0219, lng = -77.1143,
    connectors = { "LIM-01-C1" = ["CCS2", 120] } }
  }

  connectors = merge([
    for sid, s in local.stations : {
      for cid, c in s.connectors : cid => { station_id = sid, type = c[0], power = c[1] }
    }
  ]...)

  wallets = {
    "FLEET-ANDES"   = { name = "Andes Express Logistics", balance = 850000 }
    "FLEET-CONDOR"  = { name = "Cóndor Última Milla", balance = 250000 }
    "FLEET-COLIBRI" = { name = "Colibrí Delivery (saldo bajo)", balance = 15000 }
  }
}

resource "aws_dynamodb_table_item" "station" {
  for_each   = local.stations
  table_name = module.dynamodb.table_names["reservations"]
  hash_key   = "pk"
  range_key  = "sk"
  item = jsonencode({
    pk        = { S = "STATION#${each.key}" }, sk = { S = "META" }, entityType = { S = "STATION" },
    stationId = { S = each.key }, name = { S = each.value.name }, city = { S = each.value.city },
    address   = { S = each.value.address }, latitude = { N = tostring(each.value.lat) }, longitude = { N = tostring(each.value.lng) },
  })
}

resource "aws_dynamodb_table_item" "connector" {
  for_each   = local.connectors
  table_name = module.dynamodb.table_names["reservations"]
  hash_key   = "pk"
  range_key  = "sk"
  item = jsonencode({
    pk        = { S = "STATION#${each.value.station_id}" }, sk = { S = "CONNECTOR#${each.key}" }, entityType = { S = "CONNECTOR" },
    stationId = { S = each.value.station_id }, connectorId = { S = each.key }, type = { S = each.value.type },
    powerKw   = { N = tostring(each.value.power) }, status = { S = "AVAILABLE" }, version = { N = "1" }, updatedAt = { S = "terraform-seed" },
  })
  lifecycle {
    ignore_changes = [item]
  }
}

resource "aws_dynamodb_table_item" "wallet" {
  for_each   = local.wallets
  table_name = module.dynamodb.table_names["billing"]
  hash_key   = "pk"
  range_key  = "sk"
  item = jsonencode({
    pk       = { S = "WALLET#${each.key}" }, sk = { S = "META" }, entityType = { S = "WALLET" },
    fleetId  = { S = each.key }, fleetName = { S = each.value.name }, balance = { N = tostring(each.value.balance) },
    currency = { S = "COP" }, version = { N = "1" }, updatedAt = { S = "terraform-seed" },
  })
  lifecycle {
    ignore_changes = [item]
  }
}

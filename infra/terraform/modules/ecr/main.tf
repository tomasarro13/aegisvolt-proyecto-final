resource "aws_ecr_repository" "this" {
  for_each             = toset(var.services)
  name                 = "aegisvolt-${var.environment}/${each.key}"
  image_tag_mutability = "IMMUTABLE" # una etiqueta = un build: trazabilidad de qué versión está en canary/stable
  force_delete         = var.environment != "prod"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar las últimas 15 imágenes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 15 }
      action       = { type = "expire" }
    }]
  })
}

locals {
  floci_services = [
    "apigateway", "apigatewayv2", "cloudwatch", "cloudwatchlogs", "dynamodb", "ec2", "ecr", "eks", "iam", "s3", "sts",
  ]
}

provider "aws" {
  region                      = var.aws_region
  access_key                  = var.use_floci ? "test" : null
  secret_key                  = var.use_floci ? "test" : null
  skip_credentials_validation = var.use_floci
  skip_metadata_api_check     = var.use_floci
  skip_requesting_account_id  = var.use_floci
  s3_use_path_style           = var.use_floci

  # En Floci todos los servicios responden en el mismo endpoint; en AWS real (null) se usan los oficiales.
  endpoints {
    apigateway     = var.use_floci ? var.floci_endpoint : null
    apigatewayv2   = var.use_floci ? var.floci_endpoint : null
    cloudwatch     = var.use_floci ? var.floci_endpoint : null
    cloudwatchlogs = var.use_floci ? var.floci_endpoint : null
    dynamodb       = var.use_floci ? var.floci_endpoint : null
    ec2            = var.use_floci ? var.floci_endpoint : null
    ecr            = var.use_floci ? var.floci_endpoint : null
    eks            = var.use_floci ? var.floci_endpoint : null
    iam            = var.use_floci ? var.floci_endpoint : null
    s3             = var.use_floci ? var.floci_endpoint : null
    sts            = var.use_floci ? var.floci_endpoint : null
  }

  default_tags {
    tags = {
      Project     = "aegisvolt"
      Environment = local.env
      Workspace   = terraform.workspace
      ManagedBy   = "terraform"
    }
  }
}

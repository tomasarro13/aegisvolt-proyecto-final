# -----------------------------------------------------------------------------
# Bootstrap del backend remoto (se ejecuta UNA sola vez, con estado local).
# Crea el bucket S3 con VERSIONAMIENTO para los terraform.tfstate de todos los
# workspaces (env:/dev, env:/test, env:/prod) y la tabla de locks.
# -----------------------------------------------------------------------------
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "use_floci" {
  description = "true = apuntar a Floci (emulador local de AWS); false = AWS real"
  type        = bool
  default     = true
}

variable "floci_endpoint" {
  type    = string
  default = "http://localhost:4566"
}

variable "state_bucket_name" {
  type    = string
  default = "aegisvolt-tfstate"
}

provider "aws" {
  region                      = var.aws_region
  access_key                  = var.use_floci ? "test" : null
  secret_key                  = var.use_floci ? "test" : null
  skip_credentials_validation = var.use_floci
  skip_metadata_api_check     = var.use_floci
  skip_requesting_account_id  = var.use_floci
  s3_use_path_style           = var.use_floci

  endpoints {
    s3       = var.use_floci ? var.floci_endpoint : null
    dynamodb = var.use_floci ? var.floci_endpoint : null
    sts      = var.use_floci ? var.floci_endpoint : null
  }

  default_tags {
    tags = { Project = "aegisvolt", ManagedBy = "terraform", Component = "tfstate-backend" }
  }
}

resource "aws_s3_bucket" "tfstate" {
  bucket        = var.state_bucket_name
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

# Requisito clave: versionamiento -> historial/backup de cada tfstate.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Conserva versiones antiguas 90 días (backups) y limpia uploads incompletos.
resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket     = aws_s3_bucket.tfstate.id
  depends_on = [aws_s3_bucket_versioning.tfstate]

  rule {
    id     = "retain-noncurrent-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Locking del estado: evita que dos pipelines hagan apply simultáneo sobre el mismo workspace.
resource "aws_dynamodb_table" "locks" {
  name         = "aegisvolt-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.locks.name
}

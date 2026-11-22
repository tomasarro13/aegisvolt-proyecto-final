terraform {
  required_version = ">= 1.10"
  required_providers {
    aws      = { source = "hashicorp/aws", version = "~> 6.0" }
    external = { source = "hashicorp/external", version = "~> 2.3" }
  }

  # Estado remoto en S3 versionado. Con workspaces, Terraform guarda cada ambiente en
  #   s3://aegisvolt-tfstate/env:/dev/aegisvolt/terraform.tfstate
  #   s3://aegisvolt-tfstate/env:/test/aegisvolt/terraform.tfstate
  #   s3://aegisvolt-tfstate/env:/prod/aegisvolt/terraform.tfstate
  # Los parámetros de conexión (Floci o AWS real) se pasan con -backend-config=backend/<target>.hcl
  backend "s3" {
    key                  = "aegisvolt/terraform.tfstate"
    workspace_key_prefix = "env:"
    encrypt              = true
  }
}

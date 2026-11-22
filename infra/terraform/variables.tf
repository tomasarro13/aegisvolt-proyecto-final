variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "use_floci" {
  description = "true = Floci (emulación local de AWS, sin costo). false = AWS real."
  type        = bool
  default     = true
}

variable "floci_endpoint" {
  type    = string
  default = "http://localhost:4566"
}

variable "enable_eks" {
  description = "Crear el clúster EKS. En CI efímero se desactiva y el backend corre con docker compose."
  type        = bool
  default     = true
}

variable "fallback_backend_url" {
  description = "Backend del API Gateway cuando enable_eks=false (p. ej. gateway en docker compose)."
  type        = string
  default     = "http://host.docker.internal:4000"
}

variable "nlb_listener_arn" {
  description = "Solo AWS real: listener del NLB interno del clúster para el VPC Link."
  type        = string
  default     = null
}

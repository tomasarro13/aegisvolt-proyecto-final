variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "backend_base_url" {
  description = "URL privada del backend (Floci: http://<ip-nodo-eks>:30080)"
  type        = string
}
variable "nlb_listener_arn" {
  description = "AWS real: ARN del listener del NLB interno creado por el AWS Load Balancer Controller"
  type        = string
  default     = null
}
variable "access_log_group_arn" { type = string }
variable "cors_origins" {
  type    = list(string)
  default = ["*"]
}
variable "throttling_burst_limit" {
  type    = number
  default = 100
}
variable "throttling_rate_limit" {
  type    = number
  default = 50
}

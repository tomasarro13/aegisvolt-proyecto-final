variable "environment" { type = string }
variable "services" { type = list(string) }
variable "retention_days" {
  type    = number
  default = 7
}
variable "canary_error_threshold" {
  type    = number
  default = 5
}

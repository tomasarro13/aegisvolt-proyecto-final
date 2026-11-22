variable "environment" { type = string }
variable "point_in_time_recovery" {
  type    = bool
  default = false
}
variable "deletion_protection" {
  type    = bool
  default = false
}

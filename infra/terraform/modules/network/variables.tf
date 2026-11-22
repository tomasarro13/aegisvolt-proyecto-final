variable "name_prefix" { type = string }
variable "cidr_block" { type = string }
variable "region" { type = string }
variable "az_count" {
  type    = number
  default = 2
}

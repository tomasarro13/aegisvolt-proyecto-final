variable "cluster_name" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "kubernetes_version" {
  type    = string
  default = "1.31"
}
variable "endpoint_public_access" {
  type    = bool
  default = false
}
variable "create_node_group" {
  type    = bool
  default = true
}
variable "node_instance_types" {
  type    = list(string)
  default = ["t3.medium"]
}
variable "node_count" {
  type    = number
  default = 2
}

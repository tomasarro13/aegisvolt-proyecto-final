module "network" {
  source      = "./modules/network"
  name_prefix = local.name_prefix
  cidr_block  = local.cfg.vpc_cidr
  region      = var.aws_region
  depends_on  = [terraform_data.workspace_guard]
}

module "dynamodb" {
  source                 = "./modules/dynamodb"
  environment            = local.env
  point_in_time_recovery = local.cfg.pitr
  deletion_protection    = local.cfg.deletion_protection
  depends_on             = [terraform_data.workspace_guard]
}

module "feature_flags" {
  source                 = "./modules/feature_flags"
  environment            = local.env
  initial_flags          = local.cfg.flags
  point_in_time_recovery = local.cfg.pitr
  depends_on             = [terraform_data.workspace_guard]
}

module "observability" {
  source         = "./modules/observability"
  environment    = local.env
  services       = local.services
  retention_days = local.cfg.log_retention_days
}

module "ecr" {
  source      = "./modules/ecr"
  environment = local.env
  services    = local.services
}

module "eks" {
  count                  = var.enable_eks ? 1 : 0
  source                 = "./modules/eks"
  cluster_name           = local.name_prefix
  vpc_id                 = module.network.vpc_id
  vpc_cidr               = module.network.vpc_cidr
  private_subnet_ids     = module.network.private_subnet_ids
  endpoint_public_access = var.use_floci # local: kubectl desde la máquina del desarrollador
  create_node_group      = !var.use_floci
}

# Floci: IP privada del nodo EKS dentro de la subred privada de la VPC.
data "external" "eks_node_ip" {
  count      = var.enable_eks && var.use_floci ? 1 : 0
  program    = ["bash", "${path.module}/scripts/floci-eks-node-ip.sh"]
  query      = { cluster = module.eks[0].cluster_name, vpc_id = module.network.vpc_id }
  depends_on = [module.eks]
}

locals {
  graphql_node_port = 30080
  backend_base_url  = var.enable_eks && var.use_floci ? "http://${data.external.eks_node_ip[0].result.ip}:${local.graphql_node_port}" : var.fallback_backend_url
}

module "api_gateway" {
  source                = "./modules/api_gateway"
  name_prefix           = local.name_prefix
  environment           = local.env
  vpc_id                = module.network.vpc_id
  vpc_cidr              = module.network.vpc_cidr
  private_subnet_ids    = module.network.private_subnet_ids
  backend_base_url      = local.backend_base_url
  nlb_listener_arn      = var.nlb_listener_arn
  access_log_group_arn  = module.observability.api_gateway_log_group_arn
  throttling_rate_limit = local.cfg.throttle_rate
}

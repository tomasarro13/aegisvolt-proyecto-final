output "environment" { value = local.env }
output "workspace" { value = terraform.workspace }
output "vpc_id" { value = module.network.vpc_id }
output "private_subnet_ids" { value = module.network.private_subnet_ids }
output "vpc_endpoint_ids" { value = module.network.vpc_endpoint_ids }
output "dynamodb_tables" {
  value = merge(module.dynamodb.table_names, { feature_flags = module.feature_flags.table_name })
}
output "log_groups" { value = module.observability.log_groups }
output "ecr_repositories" { value = module.ecr.repository_urls }
output "eks_cluster_name" { value = var.enable_eks ? module.eks[0].cluster_name : null }
output "eks_cluster_endpoint" { value = var.enable_eks ? module.eks[0].cluster_endpoint : null }
output "api_gateway_id" { value = module.api_gateway.api_id }
output "api_gateway_endpoint" { value = module.api_gateway.api_endpoint }
output "api_gateway_backend" { value = local.backend_base_url }
output "graphql_url" {
  description = "URL que consume el frontend de este ambiente"
  value       = var.use_floci ? "${var.floci_endpoint}/_aws/execute-api/${module.api_gateway.api_id}/$default/graphql" : "${module.api_gateway.api_endpoint}/graphql"
}
output "initial_feature_flags" { value = module.feature_flags.initial_flags }

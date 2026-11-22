output "log_groups" {
  value = merge(
    { for k, g in aws_cloudwatch_log_group.service : k => g.name },
    { for k, g in aws_cloudwatch_log_group.platform : k => g.name },
  )
}
output "api_gateway_log_group_arn" { value = aws_cloudwatch_log_group.platform["api-gateway"].arn }
output "metrics_namespace" { value = "AegisVolt/${var.environment}" }

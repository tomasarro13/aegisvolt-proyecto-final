# Logs centralizados por ambiente: /aegisvolt/<env>/<servicio>.
# Metric filters sobre los logs JSON => métricas de error usadas por el Canary Deployment.
resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(var.services)
  name              = "/aegisvolt/${var.environment}/${each.key}"
  retention_in_days = var.retention_days
  tags              = { Service = each.key }
}

resource "aws_cloudwatch_log_group" "platform" {
  for_each          = toset(["api-gateway", "prefect", "canary"])
  name              = "/aegisvolt/${var.environment}/${each.key}"
  retention_in_days = var.retention_days
}

resource "aws_cloudwatch_log_metric_filter" "errors" {
  for_each       = toset(var.services)
  name           = "${each.key}-errors"
  log_group_name = aws_cloudwatch_log_group.service[each.key].name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name      = "ServiceErrors"
    namespace = "AegisVolt/${var.environment}"
    value     = "1"
    dimensions = {
      service = "$.service"
      track   = "$.track"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "requests" {
  for_each       = toset(var.services)
  name           = "${each.key}-requests"
  log_group_name = aws_cloudwatch_log_group.service[each.key].name
  pattern        = "{ $.message = \"request completed\" }"

  metric_transformation {
    name      = "ServiceRequests"
    namespace = "AegisVolt/${var.environment}"
    value     = "1"
    dimensions = {
      service = "$.service"
      track   = "$.track"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "saga_compensations" {
  name           = "saga-compensations"
  log_group_name = aws_cloudwatch_log_group.service["graphql-gateway"].name
  pattern        = "{ $.message = \"SAGA compensada\" }"

  metric_transformation {
    name      = "SagaCompensations"
    namespace = "AegisVolt/${var.environment}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "canary_errors" {
  for_each            = toset(var.services)
  alarm_name          = "aegisvolt-${var.environment}-${each.key}-canary-errors"
  alarm_description   = "Errores en la versión canary de ${each.key}: dispara rollback"
  namespace           = "AegisVolt/${var.environment}"
  metric_name         = "ServiceErrors"
  dimensions          = { service = each.key, track = "canary" }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = var.canary_error_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

# API Gateway HTTP (punto de entrada público HTTPS) -> VPC Link (ENIs en subredes privadas)
# -> NodePort/NLB del clúster EKS -> pod graphql-gateway.
# En Floci el VPC Link se crea igual, y la integración apunta a la IP privada del nodo EKS
# dentro de la subred de la VPC (Floci materializa la subred como red de Docker).
resource "aws_security_group" "vpc_link" {
  name        = "${var.name_prefix}-apigw-vpclink-sg"
  description = "API Gateway VPC Link ENIs"
  vpc_id      = var.vpc_id

  egress {
    description = "Only to the VPC (cluster NodePort / internal NLB)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_apigatewayv2_vpc_link" "this" {
  name               = "${var.name_prefix}-vpclink"
  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.vpc_link.id]
}

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"
  description   = "AegisVolt GraphQL API (${var.environment})"

  cors_configuration {
    allow_origins = var.cors_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "x-correlation-id", "authorization"]
    max_age       = 600
  }
}

resource "aws_apigatewayv2_integration" "graphql" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  payload_format_version = "1.0"
  # AWS real: VPC_LINK hacia el listener del NLB interno. Floci: IP privada del nodo EKS.
  connection_type      = var.nlb_listener_arn == null ? "INTERNET" : "VPC_LINK"
  connection_id        = var.nlb_listener_arn == null ? null : aws_apigatewayv2_vpc_link.this.id
  integration_uri      = var.nlb_listener_arn == null ? "${var.backend_base_url}/{proxy}" : var.nlb_listener_arn
  timeout_milliseconds = 29000
}

resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.graphql.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }

  access_log_settings {
    destination_arn = var.access_log_group_arn
    format = jsonencode({
      requestId      = "$context.requestId"
      correlation_id = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      latency        = "$context.integrationLatency"
      environment    = var.environment
    })
  }
}

output "vpc_id" { value = aws_vpc.this.id }
output "vpc_cidr" { value = aws_vpc.this.cidr_block }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "private_route_table_id" { value = aws_route_table.private.id }
output "vpce_security_group_id" { value = aws_security_group.vpce.id }
output "vpc_endpoint_ids" {
  value = merge(
    { for k, v in aws_vpc_endpoint.gateway : k => v.id },
    { for k, v in aws_vpc_endpoint.interface : k => v.id },
  )
}
output "execute_api_vpce_id" { value = aws_vpc_endpoint.interface["execute-api"].id }

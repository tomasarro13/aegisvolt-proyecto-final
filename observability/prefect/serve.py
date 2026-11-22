"""Registra y sirve los flujos con programación periódica (visible en el dashboard de Prefect)."""
from prefect import serve

from aegisvolt_observability.flows import aegisvolt_observability, saga_consistency_audit

if __name__ == "__main__":
    serve(
        aegisvolt_observability.to_deployment(name="observability-every-5m", interval=300, tags=["aegisvolt", "observability"]),
        *[saga_consistency_audit.to_deployment(name=f"saga-audit-{env}", interval=120, parameters={"environment": env}, tags=["aegisvolt", env])
          for env in ("dev", "test", "prod")],
    )

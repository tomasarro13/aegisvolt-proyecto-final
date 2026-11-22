"""
Flujos Prefect de observabilidad de AegisVolt:

* environment_health_flow   -> salud de dev/test/prod (GraphQL vía API Gateway, health de cada
                               microservicio, tablas DynamoDB, log groups y errores recientes en CloudWatch).
* saga_consistency_audit    -> audita las SAGAs cruzando el log del orquestador con las tablas de
                               cada microservicio: detecta transacciones huérfanas, compensadas e inconsistentes.
* aegisvolt_observability   -> flujo padre que ejecuta ambos para todos los ambientes.

Los resultados se publican como artifacts (tablas/markdown) en el dashboard de Prefect, como métricas
en CloudWatch (AegisVolt/<env>) y como logs JSON en /aegisvolt/<env>/prefect con correlation_id.
"""
from __future__ import annotations

import json
import time
from datetime import timedelta

import boto3
import httpx
from prefect import flow, get_run_logger, task
from prefect.artifacts import create_markdown_artifact, create_table_artifact
from prefect.events import emit_event

from .config import ENVIRONMENTS, SERVICES, aws_kwargs, env_config
from .saga_rules import SagaEvidence, evaluate, summarize, utcnow

HEALTH_QUERY = "{ environment { name version track } systemHealth { service status latencyMs } }"


# --------------------------------------------------------------------------- utilidades
def _cloudwatch_log(env: str, message: str, **fields) -> None:
    """Log estructurado en CloudWatch: mismo formato JSON que los microservicios."""
    cfg = env_config(env)
    logs = boto3.client("logs", **aws_kwargs(cfg))
    group, stream = cfg.log_group("prefect"), f"prefect-{time.strftime('%Y%m%d')}"
    try:
        logs.create_log_stream(logGroupName=group, logStreamName=stream)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    except Exception:  # noqa: BLE001 - la observabilidad nunca debe romper el flujo
        return
    entry = {"timestamp": utcnow().isoformat(), "level": fields.pop("level", "info"), "message": message,
             "service": "prefect-observability", "environment": env, **fields}
    try:
        logs.put_log_events(logGroupName=group, logStreamName=stream,
                            logEvents=[{"timestamp": int(time.time() * 1000), "message": json.dumps(entry, default=str)}])
    except Exception:  # noqa: BLE001
        pass


def _put_metrics(env: str, metrics: dict[str, float]) -> None:
    cfg = env_config(env)
    cw = boto3.client("cloudwatch", **aws_kwargs(cfg))
    try:
        cw.put_metric_data(Namespace=cfg.metrics_namespace,
                           MetricData=[{"MetricName": k, "Value": float(v), "Unit": "Count"} for k, v in metrics.items()])
    except Exception:  # noqa: BLE001
        pass


# --------------------------------------------------------------------------- health
@task(retries=2, retry_delay_seconds=3, task_run_name="graphql-health-{env}")
def check_graphql(env: str) -> dict:
    cfg = env_config(env)
    if not cfg.graphql_url:
        return {"env": env, "status": "NOT_CONFIGURED", "services": []}
    started = time.perf_counter()
    res = httpx.post(cfg.graphql_url, json={"query": HEALTH_QUERY}, timeout=10)
    latency = round((time.perf_counter() - started) * 1000)
    body = res.json()
    data = body.get("data") or {}
    services = data.get("systemHealth") or []
    up = res.status_code == 200 and services and all(s["status"] == "UP" for s in services)
    return {"env": env, "status": "UP" if up else "DEGRADED", "latency_ms": latency, "version": (data.get("environment") or {}).get("version"),
            "services": services}


@task(task_run_name="dynamodb-tables-{env}")
def check_tables(env: str) -> dict:
    cfg = env_config(env)
    ddb = boto3.client("dynamodb", **aws_kwargs(cfg))
    result = {}
    for resource in ("reservations", "billing", "dispatch", "sagas", "feature-flags"):
        try:
            result[resource] = ddb.describe_table(TableName=cfg.table(resource))["Table"]["TableStatus"]
        except Exception as err:  # noqa: BLE001
            result[resource] = f"MISSING ({type(err).__name__})"
    return result


@task(task_run_name="cloudwatch-errors-{env}")
def recent_errors(env: str, minutes: int = 15) -> dict:
    cfg = env_config(env)
    logs = boto3.client("logs", **aws_kwargs(cfg))
    since = int((utcnow() - timedelta(minutes=minutes)).timestamp() * 1000)
    counts = {}
    for svc in SERVICES:
        try:
            events = logs.filter_log_events(logGroupName=cfg.log_group(svc), startTime=since).get("events", [])
            parsed = [json.loads(e["message"]) for e in events if e["message"].startswith("{")]
            counts[svc] = {"logs": len(parsed), "errors": sum(1 for p in parsed if p.get("level") == "error")}
        except Exception:  # noqa: BLE001
            counts[svc] = {"logs": 0, "errors": -1}
    return counts


@flow(name="environment-health", log_prints=True)
def environment_health_flow(environments: list[str] = list(ENVIRONMENTS)) -> list[dict]:
    logger = get_run_logger()
    rows, report = [], []
    for env in environments:
        gql = check_graphql.submit(env)
        tables = check_tables.submit(env)
        errors = recent_errors.submit(env)
        g, t, e = gql.result(raise_on_failure=False), tables.result(), errors.result()
        if isinstance(g, BaseException):
            g = {"env": env, "status": "DOWN", "services": [], "error": str(g)}
        tables_ok = all(v == "ACTIVE" for v in t.values())
        total_errors = sum(max(0, v["errors"]) for v in e.values())
        overall = "UP" if g["status"] == "UP" and tables_ok else ("NOT_CONFIGURED" if g["status"] == "NOT_CONFIGURED" else "DEGRADED")
        rows.append({"environment": env, "status": overall, "graphql": g["status"], "latency_ms": g.get("latency_ms", -1),
                     "version": g.get("version") or "-", "tables_ok": tables_ok, "errors_15m": total_errors})
        report.append(f"### {env}: **{overall}**\n" + "\n".join(f"- `{s['service']}` {s['status']} ({s['latencyMs']} ms)" for s in g.get("services", []))
                      + "\n" + "\n".join(f"- tabla `{k}`: {v}" for k, v in t.items()))
        _put_metrics(env, {"EnvironmentUp": 1 if overall == "UP" else 0, "RecentErrors": total_errors})
        _cloudwatch_log(env, "environment health", status=overall, errors_15m=total_errors, level="info" if overall == "UP" else "warn")
        emit_event(event=f"aegisvolt.environment.{overall.lower()}", resource={"prefect.resource.id": f"aegisvolt.env.{env}"}, payload=rows[-1])
        logger.info("%s => %s", env, rows[-1])
    create_table_artifact(key="aegisvolt-environment-health", table=rows, description="Salud de los ambientes estáticos")
    create_markdown_artifact(key="aegisvolt-environment-health-detail", markdown="\n\n".join(report))
    return rows


# --------------------------------------------------------------------------- auditoría SAGA
def _get(ddb, table: str, key: dict) -> dict | None:
    from boto3.dynamodb.types import TypeDeserializer
    item = ddb.get_item(TableName=table, Key={k: {"S": v} for k, v in key.items()}, ConsistentRead=True).get("Item")
    if not item:
        return None
    de = TypeDeserializer()
    return {k: de.deserialize(v) for k, v in item.items()}


@task(task_run_name="load-sagas-{env}")
def load_sagas(env: str) -> list[dict]:
    from boto3.dynamodb.types import TypeDeserializer
    cfg = env_config(env)
    ddb = boto3.client("dynamodb", **aws_kwargs(cfg))
    de, items, kwargs = TypeDeserializer(), [], {"TableName": cfg.table("sagas")}
    while True:
        page = ddb.scan(**kwargs)
        items += [{k: de.deserialize(v) for k, v in i.items()} for i in page.get("Items", [])]
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


@task(task_run_name="audit-saga-consistency-{env}")
def audit(env: str, sagas: list[dict], orphan_after_s: int) -> list[dict]:
    cfg = env_config(env)
    ddb = boto3.client("dynamodb", **aws_kwargs(cfg))
    now, findings = utcnow(), []
    for s in sagas:
        ctx, sid = s.get("context", {}), s["sagaId"]
        ev = SagaEvidence(
            saga=s,
            reservation=_get(ddb, cfg.table("reservations"), {"pk": f"RESERVATION#{sid}", "sk": "META"}),
            connector=_get(ddb, cfg.table("reservations"), {"pk": f"STATION#{ctx.get('stationId')}", "sk": f"CONNECTOR#{ctx.get('connectorId')}"}),
            charge=_get(ddb, cfg.table("billing"), {"pk": f"CHARGE#{sid}", "sk": "META"}),
            session=_get(ddb, cfg.table("dispatch"), {"pk": f"SESSION#{sid}", "sk": "META"}),
        )
        findings += [f.__dict__ for f in evaluate(ev, now, orphan_after_s)]
    return findings


@flow(name="saga-consistency-audit", log_prints=True)
def saga_consistency_audit(environment: str = "dev", orphan_after_s: int = 120) -> dict:
    logger = get_run_logger()
    sagas = load_sagas(environment)
    findings = audit(environment, sagas, orphan_after_s)
    summary = summarize(sagas)
    orphans = [f for f in findings if f["severity"] == "ORPHAN"]
    inconsistent = [f for f in findings if f["severity"] in ("INCONSISTENT", "NEEDS_INTERVENTION")]
    compensated = [s for s in sagas if s["status"] == "COMPENSATED"]

    for f in findings:  # cada hallazgo queda trazable en CloudWatch por correlation_id
        _cloudwatch_log(environment, "saga audit finding", level="error" if f["severity"] != "ORPHAN" else "warn",
                        correlation_id=f["saga_id"], severity=f["severity"], detail=f["detail"], saga_status=f["status"])
    _put_metrics(environment, {"SagaTotal": summary["total"], "SagaCompensated": len(compensated), "SagaOrphans": len(orphans),
                               "SagaInconsistencies": len(inconsistent), "SagaCompensationRate": summary["compensation_rate"]})

    create_table_artifact(
        key=f"saga-audit-{environment}",
        table=[{"environment": environment, **{k: v for k, v in summary.items() if k != "by_status"}, **summary["by_status"],
                "orphans": len(orphans), "inconsistencies": len(inconsistent)}],
        description=f"Resumen de consistencia SAGA en {environment}",
    )
    create_table_artifact(
        key=f"saga-compensations-{environment}",
        table=[{"saga_id": s["sagaId"], "failed_step": (s.get("failure") or {}).get("step"), "code": (s.get("failure") or {}).get("code"),
                "compensated_steps": ", ".join(st["name"] for st in s["steps"] if st["status"] == "COMPENSATED"), "updated": s["updatedAt"]}
               for s in sorted(compensated, key=lambda x: x["updatedAt"], reverse=True)[:25]] or [{"saga_id": "-"}],
        description="Últimas SAGAs compensadas (rollback distribuido)",
    )
    if findings:
        create_table_artifact(key=f"saga-findings-{environment}", table=findings, description="Transacciones huérfanas / inconsistentes")
    emit_event(event="aegisvolt.saga.audit", resource={"prefect.resource.id": f"aegisvolt.env.{environment}"},
               payload={"orphans": len(orphans), "inconsistencies": len(inconsistent), **summary})
    logger.info("auditoría %s: %s | huérfanas=%d inconsistentes=%d", environment, summary, len(orphans), len(inconsistent))
    return {"summary": summary, "orphans": orphans, "inconsistencies": inconsistent}


@flow(name="aegisvolt-observability", log_prints=True)
def aegisvolt_observability(environments: list[str] = list(ENVIRONMENTS)) -> dict:
    health = environment_health_flow(environments)
    audits = {}
    for row in health:
        if row["tables_ok"]:
            audits[row["environment"]] = saga_consistency_audit(row["environment"])
    return {"health": health, "audits": {k: v["summary"] for k, v in audits.items()}}


if __name__ == "__main__":
    aegisvolt_observability()

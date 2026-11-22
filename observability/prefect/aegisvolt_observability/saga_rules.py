"""Reglas puras de consistencia de SAGAs (sin Prefect ni AWS: testeables con pytest)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

TERMINAL = {"COMPLETED", "FINISHED", "FAILED", "COMPENSATED", "COMPENSATION_FAILED"}


@dataclass
class SagaEvidence:
    """Estado de una SAGA visto desde las tablas de cada microservicio (Database-per-Service)."""
    saga: dict
    reservation: dict | None = None
    connector: dict | None = None
    charge: dict | None = None
    session: dict | None = None


@dataclass
class Finding:
    saga_id: str
    environment: str
    severity: str  # ORPHAN | INCONSISTENT | NEEDS_INTERVENTION
    detail: str
    status: str
    extra: dict = field(default_factory=dict)


def evaluate(ev: SagaEvidence, now: datetime, orphan_after_s: int = 120) -> list[Finding]:
    s = ev.saga
    sid, env, status = s["sagaId"], s.get("environment", "?"), s["status"]
    findings: list[Finding] = []

    def add(severity: str, detail: str) -> None:
        findings.append(Finding(sid, env, severity, detail, status))

    updated = datetime.fromisoformat(s["updatedAt"].replace("Z", "+00:00"))
    age = (now - updated).total_seconds()

    if status not in TERMINAL and age > orphan_after_s:
        add("ORPHAN", f"SAGA en {status} sin avanzar hace {int(age)}s (orquestador caído a mitad de la transacción)")
    if status == "COMPENSATION_FAILED":
        add("NEEDS_INTERVENTION", "Una compensación agotó sus reintentos")

    charge_status = (ev.charge or {}).get("status")
    res_status = (ev.reservation or {}).get("status")
    session_status = (ev.session or {}).get("status")
    connector_owner = (ev.connector or {}).get("reservedBy")

    if status == "COMPENSATED":
        if charge_status == "CHARGED":
            add("INCONSISTENT", "SAGA compensada pero el cobro sigue CHARGED (no se reembolsó)")
        if res_status not in (None, "RELEASED"):
            add("INCONSISTENT", f"SAGA compensada pero la reserva está {res_status}")
        if connector_owner == sid:
            add("INCONSISTENT", "SAGA compensada pero el conector sigue bloqueado por ella")
        if session_status == "ACTIVE":
            add("INCONSISTENT", "SAGA compensada pero la sesión de energía sigue ACTIVE")
    elif status == "COMPLETED":
        if charge_status != "CHARGED":
            add("INCONSISTENT", f"SAGA completada con cobro {charge_status}")
        if res_status != "CHARGING":
            add("INCONSISTENT", f"SAGA completada con reserva {res_status}")
        if session_status != "ACTIVE":
            add("INCONSISTENT", f"SAGA completada con sesión {session_status}")
    elif status == "FINISHED":
        if session_status != "STOPPED":
            add("INCONSISTENT", f"SAGA finalizada con sesión {session_status}")
        if res_status != "COMPLETED":
            add("INCONSISTENT", f"SAGA finalizada con reserva {res_status}")
    return findings


def summarize(sagas: list[dict]) -> dict:
    by_status: dict[str, int] = {}
    for s in sagas:
        by_status[s["status"]] = by_status.get(s["status"], 0) + 1
    total = len(sagas)
    compensated = by_status.get("COMPENSATED", 0)
    return {
        "total": total,
        "by_status": by_status,
        "compensation_rate": round(compensated / total, 4) if total else 0.0,
    }


def utcnow() -> datetime:
    return datetime.now(timezone.utc)

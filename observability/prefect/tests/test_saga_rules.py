from datetime import datetime, timedelta, timezone

from aegisvolt_observability.saga_rules import SagaEvidence, evaluate, summarize

NOW = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)


def saga(status, age_s=10):
    return {"sagaId": "saga-1", "environment": "test", "status": status,
            "updatedAt": (NOW - timedelta(seconds=age_s)).isoformat().replace("+00:00", "Z"),
            "context": {"stationId": "S1", "connectorId": "C1"}, "steps": []}


def test_compensated_consistent_has_no_findings():
    ev = SagaEvidence(saga("COMPENSATED"), reservation={"status": "RELEASED"}, connector={"reservedBy": None},
                      charge={"status": "REFUNDED"}, session={"status": "FAILED"})
    assert evaluate(ev, NOW) == []


def test_compensated_without_refund_is_inconsistent():
    ev = SagaEvidence(saga("COMPENSATED"), reservation={"status": "RELEASED"}, charge={"status": "CHARGED"})
    assert [f.severity for f in evaluate(ev, NOW)] == ["INCONSISTENT"]


def test_stuck_saga_is_orphan():
    ev = SagaEvidence(saga("COMPENSATING", age_s=600))
    assert evaluate(ev, NOW)[0].severity == "ORPHAN"


def test_compensation_failed_needs_intervention():
    assert evaluate(SagaEvidence(saga("COMPENSATION_FAILED"), reservation={"status": "RELEASED"}), NOW)[0].severity == "NEEDS_INTERVENTION"


def test_summary_compensation_rate():
    s = summarize([saga("COMPENSATED"), saga("COMPLETED"), saga("COMPLETED"), saga("FAILED")])
    assert s["total"] == 4 and s["compensation_rate"] == 0.25 and s["by_status"]["COMPLETED"] == 2

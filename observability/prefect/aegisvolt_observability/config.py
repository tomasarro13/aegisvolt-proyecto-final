"""Configuración por ambiente (dev/test/prod) a partir de variables de entorno o del archivo .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ENVIRONMENTS = ("dev", "test", "prod")
SERVICES = ("graphql-gateway", "station-reservation-service", "billing-wallet-service", "energy-dispatch-service")


def _load_dotenv() -> None:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()


@dataclass(frozen=True)
class EnvConfig:
    name: str
    graphql_url: str | None
    region: str
    endpoint_url: str | None

    def table(self, resource: str) -> str:
        return f"aegisvolt-{resource}-{self.name}"

    def log_group(self, component: str) -> str:
        return f"/aegisvolt/{self.name}/{component}"

    @property
    def metrics_namespace(self) -> str:
        return f"AegisVolt/{self.name}"


def env_config(name: str) -> EnvConfig:
    if name not in ENVIRONMENTS:
        raise ValueError(f"Ambiente inválido: {name}")
    return EnvConfig(
        name=name,
        graphql_url=os.environ.get(f"GRAPHQL_URL_{name.upper()}"),
        region=os.environ.get("AWS_REGION", "us-east-1"),
        endpoint_url=os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566"),
    )


def aws_kwargs(cfg: EnvConfig) -> dict:
    kwargs: dict = {"region_name": cfg.region}
    if cfg.endpoint_url:
        kwargs["endpoint_url"] = cfg.endpoint_url
        kwargs.setdefault("aws_access_key_id", os.environ.get("AWS_ACCESS_KEY_ID", "test"))
        kwargs.setdefault("aws_secret_access_key", os.environ.get("AWS_SECRET_ACCESS_KEY", "test"))
    return kwargs

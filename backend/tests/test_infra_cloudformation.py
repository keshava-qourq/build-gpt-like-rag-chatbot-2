"""Static checks on the declarative AWS deployment artifact (BUIL654BFB-35-1).

No AWS call is made here -- these assertions are string/structure checks
against backend/infra/cloudformation.yaml, proving the template declares
what AC-117/AC-118/AC-119 require without ever applying it.
"""

from __future__ import annotations

from pathlib import Path

import yaml

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "infra" / "cloudformation.yaml"


class _IgnoreCfnTags(yaml.SafeLoader):
    """CloudFormation's short-form intrinsic functions (!Ref, !Sub, !GetAtt,
    !If, ...) are not plain YAML -- this loader treats any such tag as an
    opaque placeholder so the rest of the document's structure can still be
    parsed and asserted on."""


def _construct_any(loader: yaml.SafeLoader, tag_suffix: str, node: yaml.Node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


_IgnoreCfnTags.add_multi_constructor("!", _construct_any)


def _load_template() -> dict:
    raw = TEMPLATE_PATH.read_text()
    return yaml.load(raw, Loader=_IgnoreCfnTags)


def test_template_file_exists_and_parses() -> None:
    assert TEMPLATE_PATH.exists()
    template = _load_template()
    assert template["AWSTemplateFormatVersion"] == "2010-09-09"


def test_three_fargate_services_on_one_cluster() -> None:
    """AC-117: backend API, worker and frontend each as their own ECS
    Fargate service, one shared cluster."""
    template = _load_template()
    resources = template["Resources"]

    assert resources["Cluster"]["Type"] == "AWS::ECS::Cluster"

    services = {
        name: res for name, res in resources.items() if res["Type"] == "AWS::ECS::Service"
    }
    assert {"BackendService", "WorkerService", "FrontendService"} <= services.keys()
    for service in services.values():
        assert service["Properties"]["LaunchType"] == "FARGATE"

    task_defs = {
        name: res
        for name, res in resources.items()
        if res["Type"] == "AWS::ECS::TaskDefinition"
    }
    assert {"BackendTaskDefinition", "WorkerTaskDefinition", "FrontendTaskDefinition"} <= (
        task_defs.keys()
    )
    for task_def in task_defs.values():
        props = task_def["Properties"]
        assert "FARGATE" in props["RequiresCompatibilities"]
        assert props["Cpu"]
        assert props["Memory"]
        for container in props["ContainerDefinitions"]:
            assert container["LogConfiguration"]["LogDriver"] == "awslogs"


def test_rds_postgres16_pgvector_and_s3_bucket_declared() -> None:
    """AC-117: an RDS Postgres 16 instance with pgvector enabled, and an S3
    bucket for originals."""
    template = _load_template()
    resources = template["Resources"]

    db = resources["Database"]
    assert db["Type"] == "AWS::RDS::DBInstance"
    assert db["Properties"]["Engine"] == "postgres"
    assert db["Properties"]["EngineVersion"] == "16"

    param_group = resources["DbParameterGroup"]
    assert param_group["Type"] == "AWS::RDS::DBParameterGroup"
    assert param_group["Properties"]["Family"] == "postgres16"
    assert param_group["Properties"]["Parameters"]["shared_preload_libraries"] == "vector"

    bucket = resources["DocumentsBucket"]
    assert bucket["Type"] == "AWS::S3::Bucket"


def test_backend_and_worker_env_names_match_env_example_and_no_s3_endpoint_url() -> None:
    """AC-117: env var names are reused from backend/.env.example (no
    parallel names), DATABASE_URL/S3_BUCKET/AWS_REGION are set, and
    S3_ENDPOINT_URL is never set so boto3 talks to real AWS S3."""
    template = _load_template()
    resources = template["Resources"]

    for task_def_name in ("BackendTaskDefinition", "WorkerTaskDefinition"):
        container = resources[task_def_name]["Properties"]["ContainerDefinitions"][0]
        env_names = {entry["Name"] for entry in container.get("Environment", [])}
        secret_names = {entry["Name"] for entry in container.get("Secrets", [])}

        assert {"DATABASE_URL", "S3_BUCKET", "AWS_REGION"} <= env_names
        assert "S3_ENDPOINT_URL" not in env_names
        assert "S3_ENDPOINT_URL" not in secret_names


def test_allowed_origins_set_to_frontend_origin_parameter() -> None:
    """AC-117: ALLOWED_ORIGINS on the backend task is the deployed frontend
    origin, not a hardcoded value."""
    template = _load_template()
    assert "FrontendOrigin" in template["Parameters"]

    backend_container = template["Resources"]["BackendTaskDefinition"]["Properties"][
        "ContainerDefinitions"
    ][0]
    allowed_origins = next(
        entry for entry in backend_container["Environment"] if entry["Name"] == "ALLOWED_ORIGINS"
    )
    assert allowed_origins["Value"] == "FrontendOrigin"  # !Ref FrontendOrigin, tag stripped


def test_https_listener_and_target_groups_for_frontend_and_backend() -> None:
    """AC-117: an ALB terminates TLS and routes HTTPS traffic to both the
    frontend and the backend API."""
    template = _load_template()
    resources = template["Resources"]

    listener = resources["HttpsListener"]
    assert listener["Type"] == "AWS::ElasticLoadBalancingV2::Listener"
    assert listener["Properties"]["Protocol"] == "HTTPS"
    assert listener["Properties"]["Certificates"][0]["CertificateArn"] == "CertificateArn"

    assert resources["FrontendTargetGroup"]["Type"] == "AWS::ElasticLoadBalancingV2::TargetGroup"
    assert resources["BackendTargetGroup"]["Type"] == "AWS::ElasticLoadBalancingV2::TargetGroup"
    assert resources["BackendTargetGroup"]["Properties"]["HealthCheckPath"] == "/health"


def test_secrets_are_arn_references_not_plaintext() -> None:
    """AC-118: OPENAI_API_KEY, DB credentials and JWT_SECRET are injected as
    `Secrets` (ValueFrom an ARN), never as plaintext `Environment` values,
    and no secret-looking literal value appears in the template."""
    template = _load_template()
    resources = template["Resources"]

    backend_container = resources["BackendTaskDefinition"]["Properties"]["ContainerDefinitions"][
        0
    ]
    secret_env_names = {entry["Name"] for entry in backend_container["Secrets"]}
    assert {"JWT_SECRET", "OPENAI_API_KEY"} <= secret_env_names

    plaintext_env_names = {entry["Name"] for entry in backend_container["Environment"]}
    assert "JWT_SECRET" not in plaintext_env_names
    assert "OPENAI_API_KEY" not in plaintext_env_names
    assert "ADMIN_PASSWORD" not in plaintext_env_names

    # Database credentials: master username/password resolved via
    # {{resolve:secretsmanager:...}} dynamic references, never literal.
    raw = TEMPLATE_PATH.read_text()
    assert "{{resolve:secretsmanager:" in raw
    assert "postgres:postgres" not in raw  # the local compose default, never here
    assert "change-me" not in raw


def test_execution_role_can_read_the_referenced_secrets() -> None:
    """AC-118: the execution role is granted exactly the permission needed
    to resolve the secret ARNs into container env values at task start."""
    template = _load_template()
    role = template["Resources"]["TaskExecutionRole"]
    policies = role["Properties"]["Policies"]
    actions = {
        action
        for policy in policies
        for statement in policy["PolicyDocument"]["Statement"]
        for action in statement["Action"]
    }
    assert "secretsmanager:GetSecretValue" in actions


def test_backend_container_health_check_targets_health_endpoint() -> None:
    """AC-119: the backend container's health check calls GET /health, and
    the ECS service rolls back a deployment whose tasks never report
    healthy (deployment circuit breaker)."""
    template = _load_template()
    resources = template["Resources"]

    backend_container = resources["BackendTaskDefinition"]["Properties"]["ContainerDefinitions"][
        0
    ]
    health_check_command = " ".join(backend_container["HealthCheck"]["Command"])
    assert "/health" in health_check_command

    deployment_config = resources["BackendService"]["Properties"]["DeploymentConfiguration"]
    assert deployment_config["DeploymentCircuitBreaker"]["Enable"] is True
    assert deployment_config["DeploymentCircuitBreaker"]["Rollback"] is True

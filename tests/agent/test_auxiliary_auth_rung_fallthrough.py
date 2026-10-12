"""The auxiliary recovery ladder on an explicit provider's auth failure.

A provider the user named explicitly (``auxiliary.<task>.provider``) owns its credentials: an auth
failure that the refresh rung cannot fix falls through to that task's configured
``fallback_chain`` and never to an unconfigured provider.
"""


import pytest

import agent.auxiliary_client as aux

AUX_MODEL = "z-ai/glm-5.3-flash"
FALLBACK_MODEL = "fallback-model"
class _ApiError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


def _auth_error():
    return _ApiError("Error code: 401 - Unauthorized", status_code=401)


class _FakeClient:
    api_key = "sk-test"
    base_url = "https://fallback.example/v1"


class _ExplicitProviderClient:
    api_key = "stale-key"
    base_url = "https://vertex.example/v1"


@pytest.mark.parametrize("spare_survives", [True, False])
def test_explicit_provider_auth_uses_its_configured_task_fallback(monkeypatch, spare_survives):
    """An explicit route may leave a 401 only through its own configured chain — including the
    re-walk after a chain entry is quarantined mid-request; an exhausted chain raises the primary
    error instead of spilling onto discovery / the main model."""
    dead_client, fallback_client = _ExplicitProviderClient(), _FakeClient()
    chain = [("fallback_chain[0](custom:dead)", dead_client)]
    if spare_survives:
        chain.append(("fallback_chain[1](custom:backup)", fallback_client))
    monkeypatch.setattr(
        aux,
        "_get_auxiliary_task_config",
        lambda task: {"fallback_chain": [{"provider": "custom:dead"}, {"provider": "custom:backup"}]},
    )
    monkeypatch.setattr(aux, "_auth_refresh_provider_for_route", lambda *args, **kwargs: "vertex")
    monkeypatch.setattr(aux, "_refresh_provider_credentials", lambda *args, **kwargs: False)
    monkeypatch.setattr(aux, "_recoverable_pool_provider", lambda *args, **kwargs: None)
    for name in ("_try_payment_fallback", "_try_main_fallback_chain", "_try_main_agent_model_fallback"):
        monkeypatch.setattr(aux, name, lambda *a, _n=name, **k: pytest.fail(f"{_n} must stay gated for explicit auth"))

    def configured_chain(*args, **kwargs):
        if not chain:
            return None, None, ""
        label, client = chain.pop(0)
        return client, FALLBACK_MODEL, label

    monkeypatch.setattr(aux, "_try_configured_fallback_chain", configured_chain)
    ladder = aux._aux_recovery_ladder(
        _auth_error(),
        client=_ExplicitProviderClient(),
        kwargs={"model": AUX_MODEL},
        task="compression",
        async_mode=False,
        base_info="https://vertex.example/v1",
        resolved_provider="vertex",
        resolved_model=AUX_MODEL,
        resolved_base_url=None,
        resolved_api_key=None,
        resolved_api_mode=None,
        final_model=AUX_MODEL,
        max_tokens=None,
        main_runtime=None,
        route_info={},
    )

    def perform(step):
        assert step.kind == "fallback"
        if step.args[0] is dead_client:
            return None  # quarantined mid-request → the ladder re-walks the chain
        assert step.args == (fallback_client, FALLBACK_MODEL, "fallback_chain[1](custom:backup)")
        return "fallback-response"

    if spare_survives:
        assert aux._drive_ladder(ladder, perform) == "fallback-response"
    else:
        with pytest.raises(_ApiError, match="Unauthorized"):
            aux._drive_ladder(ladder, perform)
    assert not chain


def test_explicit_provider_auth_never_uses_an_unconfigured_fallback(monkeypatch):
    """A 401 without a task chain preserves the explicit-provider boundary."""
    monkeypatch.setattr(aux, "_get_auxiliary_task_config", lambda task: {})
    monkeypatch.setattr(aux, "_auth_refresh_provider_for_route", lambda *args, **kwargs: "vertex")
    monkeypatch.setattr(aux, "_refresh_provider_credentials", lambda *args, **kwargs: False)
    monkeypatch.setattr(aux, "_recoverable_pool_provider", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        aux,
        "_try_main_agent_model_fallback",
        lambda *args, **kwargs: pytest.fail("explicit auth must not use the main-agent fallback"),
    )
    ladder = aux._aux_recovery_ladder(
        _auth_error(),
        client=_ExplicitProviderClient(),
        kwargs={"model": AUX_MODEL},
        task="compression",
        async_mode=False,
        base_info="https://vertex.example/v1",
        resolved_provider="vertex",
        resolved_model=AUX_MODEL,
        resolved_base_url=None,
        resolved_api_key=None,
        resolved_api_mode=None,
        final_model=AUX_MODEL,
        max_tokens=None,
        main_runtime=None,
        route_info={},
    )

    with pytest.raises(_ApiError, match="Unauthorized"):
        aux._drive_ladder(ladder, lambda step: pytest.fail("no fallback request expected"))


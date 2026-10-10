"""A pre-registered OAuth client signs in even when the server never challenges.

Google's Gmail MCP answers ``initialize`` and ``tools/list`` anonymously and returns 401 only on
``tools/call``. The SDK authorizes only on a 401, so ``scout mcp login gmail`` connected, found no
token and failed with "no OAuth token was obtained". With a pre-registered client the provider now
treats an anonymous success as the missing challenge, and asks for the CONFIGURED scope rather than
every scope the resource advertises.
"""
from __future__ import annotations

import json

import pytest

pytest.importorskip("mcp.client.auth.oauth2", reason="MCP SDK 1.26.0+ required")

SERVER = "https://mail.example.com/mcp/v1"
SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"


_seen: dict[str, str] = {}


async def _redirect(url: str) -> None:
    _seen["url"] = url


async def _callback():
    """The browser coming back with a code for the URL the redirect handler was given."""
    from urllib.parse import parse_qs, urlsplit

    from tools.mcp_oauth import _authorization_code_result
    state = parse_qs(urlsplit(_seen["url"]).query)["state"][0]
    return _authorization_code_result("code", state, None)


async def _flow(tmp_path, monkeypatch, *, challenge: bool, token: bool = False):
    from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthToken
    from pydantic import AnyUrl

    from tools.mcp_oauth import ScoutTokenStorage
    from tools.mcp_oauth_manager import _SCOUT_PROVIDER_CLS, reset_manager_for_tests
    from tools.mcp_tool import sdk_httpx

    httpx = sdk_httpx()
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    reset_manager_for_tests()
    storage = ScoutTokenStorage("gmail")
    redirect = [AnyUrl("http://127.0.0.1:27896/callback")]
    await storage.set_client_info(OAuthClientInformationFull(
        client_id="desktop-client", client_secret="s", redirect_uris=redirect,
        grant_types=["authorization_code", "refresh_token"], response_types=["code"],
        token_endpoint_auth_method="client_secret_post"))
    if token:
        await storage.set_tokens(OAuthToken(access_token="live", token_type="Bearer", expires_in=3600))
    provider = _SCOUT_PROVIDER_CLS(
        server_name="gmail", server_url=SERVER,
        client_metadata=OAuthClientMetadata(redirect_uris=redirect, client_name="Scout Agent", scope=SCOPE),
        storage=storage, redirect_handler=_redirect, callback_handler=_callback,
        challenge_unchallenged=challenge)
    request = httpx.Request("POST", SERVER)
    return httpx, request, provider, provider.async_auth_flow(request)


def _json(httpx, request, body):
    return httpx.Response(200, request=request, content=json.dumps(body).encode(),
                          headers={"content-type": "application/json"})


@pytest.mark.asyncio
async def test_anonymous_success_signs_in_with_the_configured_scope(tmp_path, monkeypatch):
    httpx, request, provider, flow = await _flow(tmp_path, monkeypatch, challenge=True)
    assert await flow.__anext__() is request

    # The server answered without asking for credentials: the SDK must start discovery anyway.
    step = await flow.asend(httpx.Response(200, request=request))
    assert "oauth-protected-resource" in str(step.url)

    step = await flow.asend(_json(httpx, step, {
        "resource": SERVER, "authorization_servers": ["https://accounts.example.com/"],
        "scopes_supported": ["https://mail.google.com/", "https://www.googleapis.com/auth/gmail.send"]}))
    while "oauth-authorization-server" not in str(step.url) and "openid-configuration" not in str(step.url):
        step = await flow.asend(httpx.Response(404, request=step))
    step = await flow.asend(_json(httpx, step, {
        "issuer": "https://accounts.example.com/", "authorization_endpoint": "https://accounts.example.com/auth",
        "token_endpoint": "https://accounts.example.com/token", "response_types_supported": ["code"]}))

    # Reaching the token exchange means authorization ran; it asked only for the configured scope.
    assert str(step.url) == "https://accounts.example.com/token"
    from urllib.parse import parse_qs, urlsplit
    assert parse_qs(urlsplit(_seen["url"]).query)["scope"] == [SCOPE]
    await flow.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(("challenge", "token"), [(False, False), (True, True)])
async def test_success_passes_through_without_a_client_or_with_a_token(tmp_path, monkeypatch, challenge, token):
    httpx, request, _provider, flow = await _flow(tmp_path, monkeypatch, challenge=challenge, token=token)
    assert await flow.__anext__() is request

    with pytest.raises(StopAsyncIteration):
        await flow.asend(httpx.Response(200, request=request))

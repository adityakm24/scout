"""A model reached through a ``custom`` endpoint on a known provider's API keeps its vision support.

Regression: ``provider: custom`` + ``base_url: https://api.mistral.ai/v1`` + ``ministral-14b-latest``
read as non-vision, so every screenshot a tool returned was stripped to text.
"""

from agent import models_dev
from agent.image_routing import _lookup_supports_vision

CATALOG = {
    "ministral-14b-2512": {"modalities": {"input": ["text", "image"]}},
    "ministral-14b-2410": {"modalities": {"input": ["text"]}},
    "codestral-2508": {"modalities": {"input": ["text"]}},
}


def test_custom_endpoint_on_a_known_api_resolves_latest_aliases(monkeypatch):
    seen = []

    def provider_models(provider, **kwargs):
        seen.append(provider)
        return CATALOG if provider == "mistral" else None

    monkeypatch.setattr(models_dev, "_get_provider_models", provider_models)
    cfg = {"model": {"provider": "custom", "base_url": "https://api.mistral.ai/v1"}}

    assert _lookup_supports_vision("custom", "ministral-14b-latest", cfg) is True  # newest dated entry
    assert _lookup_supports_vision("custom", "codestral-latest", cfg) is False
    assert "mistral" in seen

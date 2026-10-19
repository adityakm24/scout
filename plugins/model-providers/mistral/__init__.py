"""Mistral AI provider profile."""

from typing import Any

from providers import register_provider
from providers.base import ProviderProfile


class MistralProviderProfile(ProviderProfile):
    """Mistral AI native OpenAI-compatible inference profile."""

    @staticmethod
    def _needs_strip(msg: Any) -> bool:
        return isinstance(msg, dict) and msg.get("role") == "tool" and ("name" in msg or "tool_name" in msg)

    def prepare_messages(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not any(self._needs_strip(msg) for msg in messages):
            return messages
        return [
            {k: v for k, v in msg.items() if k not in ("name", "tool_name")} if self._needs_strip(msg) else msg
            for msg in messages
        ]


mistral = MistralProviderProfile(
    name="mistral",
    aliases=("mistralai", "mistral-ai", "codestral", "ministral"),
    display_name="Mistral AI",
    description="Mistral AI — native OpenAI-compatible inference",
    signup_url="https://console.mistral.ai/",
    env_vars=("MISTRAL_API_KEY", "MISTRAL_BASE_URL"),
    base_url="https://api.mistral.ai/v1",
    models_url="https://api.mistral.ai/v1/models",
    auth_type="api_key",
    default_aux_model="ministral-8b-latest",
    fallback_models=(
        "mistral-medium-latest",
        "mistral-small-latest",
        "codestral-latest",
        "ministral-14b-latest",
        "ministral-8b-latest",
        "magistral-medium-latest",
    ),
)

register_provider(mistral)

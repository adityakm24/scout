"""Mistral AI provider profile."""

from typing import Any

from providers import register_provider
from providers.base import ProviderProfile


class MistralProviderProfile(ProviderProfile):
    """Mistral AI native OpenAI-compatible inference profile."""

    def __post_init__(self) -> None:
        # Mistral Chat Completions rejects `reasoning_effort` on non-Magistral models
        # (HTTP 400 code 3051: "reasoning_effort is not enabled for this model").
        self.model_capabilities = {
            "codestral-latest": {"supports_reasoning": False},
            "mistral/codestral-latest": {"supports_reasoning": False},
            "ministral-8b-latest": {"supports_reasoning": False},
            "ministral-14b-latest": {"supports_reasoning": False},
            "mistral-small-latest": {"supports_reasoning": False},
            "mistral-medium-latest": {"supports_reasoning": False},
            "mistral-large-latest": {"supports_reasoning": False},
            "magistral-medium-latest": {"supports_reasoning": True},
            "magistral-small-latest": {"supports_reasoning": True},
        }

    def supported_reasoning_efforts(self, model: str | None) -> tuple[str, ...] | None:
        model_name = (model or "").strip().rsplit("/", 1)[-1].lower()
        if "magistral" in model_name:
            return None
        return ()

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
    supports_model_listing=False,
    default_aux_model="mistral/codestral-latest",
    fallback_models=(
        "mistral/codestral-latest",
    ),
)

register_provider(mistral)

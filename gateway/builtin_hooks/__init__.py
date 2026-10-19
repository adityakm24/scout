"""Built-in gateway hooks that are always registered (NVIDIA NemoClaw & NeMo Guardrails Zero-Trust)."""

from agent.nemoclaw_guardrails import (
    _on_pre_gateway_dispatch,
    _on_pre_llm_call,
    _on_pre_tool_call,
    _on_transform_llm_output,
    _on_transform_terminal_output,
    _on_transform_tool_result,
    install_builtin_nemoclaw_guardrails,
)

__all__ = [
    "_on_pre_gateway_dispatch",
    "_on_pre_llm_call",
    "_on_pre_tool_call",
    "_on_transform_llm_output",
    "_on_transform_terminal_output",
    "_on_transform_tool_result",
    "install_builtin_nemoclaw_guardrails",
]

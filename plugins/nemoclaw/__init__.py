"""NVIDIA NemoClaw, NVIDIA OpenShell & NVIDIA NeMo Guardrails Zero-Trust ("Trust Nobody") module.

Re-exports the core built-in implementation from :mod:`agent.nemoclaw_guardrails` (which is
always on by default in Scout Agent without requiring user plugin configuration).
"""

from agent.nemoclaw_guardrails import (
    NEMO_GUARDRAILS_COLANG_PATH,
    NEMO_GUARDRAILS_CONFIG_PATH,
    NEMO_GUARDRAILS_DIR,
    OpenShellEnvironment,
    OpenShellEnvironmentProvider,
    _CORE_REDACTION_REGEXES,
    _DESTRUCTIVE_COMMAND_PATTERNS,
    _EXFILTRATION_SINK_PATTERNS,
    _PROMPT_INJECTION_PATTERNS,
    _SECRET_REDACTION_PATTERNS,
    _SENSITIVE_PATH_PATTERNS,
    _ZERO_TRUST_SYSTEM_SECTION,
    _on_pre_gateway_dispatch,
    _on_pre_llm_call,
    _on_pre_tool_call,
    _on_transform_llm_output,
    _on_transform_terminal_output,
    _on_transform_tool_result,
    detect_prompt_injection,
    evaluate_tool_call_policy,
    install_builtin_nemoclaw_guardrails,
    redact_secrets_and_beacons,
    register,
)

__all__ = [
    "NEMO_GUARDRAILS_COLANG_PATH",
    "NEMO_GUARDRAILS_CONFIG_PATH",
    "NEMO_GUARDRAILS_DIR",
    "OpenShellEnvironment",
    "OpenShellEnvironmentProvider",
    "detect_prompt_injection",
    "evaluate_tool_call_policy",
    "install_builtin_nemoclaw_guardrails",
    "redact_secrets_and_beacons",
    "register",
]

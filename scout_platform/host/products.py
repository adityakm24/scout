"""Vendor SoC recognizers derived from host facts.

Recognition uses OS-reported CPU identity without environment-variable input.
"""

from __future__ import annotations


# Match the CPU string because the chassis vendor does not identify the SoC.
_NVIDIA_SOC_VENDOR = "NVIDIA"
_NVIDIA_SOC_MODEL_MARKERS = ("N1X", "SPARK")


def looks_like_nvidia_arm_soc(*, native_arch: str, cpu_model: str, cpu_vendor: str) -> bool:
    """Return whether the supplied facts identify an NVIDIA ARM SoC."""
    if native_arch != "arm64":
        return False
    model = cpu_model.upper()
    vendor_match = _NVIDIA_SOC_VENDOR in model or cpu_vendor.strip().upper() == _NVIDIA_SOC_VENDOR
    return vendor_match and any(marker in model for marker in _NVIDIA_SOC_MODEL_MARKERS)



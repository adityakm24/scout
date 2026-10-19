"""Local OpenAI-compatible proxy that forwards to OAuth-authenticated upstreams."""

from scout_backend.proxy.adapters.base import UpstreamAdapter

__all__ = ["UpstreamAdapter"]

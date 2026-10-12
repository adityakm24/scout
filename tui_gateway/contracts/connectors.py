"""Contracts for re-initiating connection-operation targets."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from .base import WireEnum
from .common import ConnectorOwner, ProfileParams
from .connectors_operation import ConnectionOperationStatus
from .registry import method

ConnectorSlug = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")]


class ConnectorErrorReason(WireEnum):
    invalid_params = "INVALID_PARAMS"
    not_owner = "NOT_OWNER"
    unsupported_runtime = "UNSUPPORTED_RUNTIME"
    connector_request_failed = "CONNECTOR_REQUEST_FAILED"
    unknown_target = "UNKNOWN_TARGET"
    link_still_valid = "LINK_STILL_VALID"
    reissue_refused = "REISSUE_REFUSED"
    unknown_operation = "UNKNOWN_OPERATION"
    invalid_answer = "INVALID_ANSWER"
    connectors_unavailable = "CONNECTORS_UNAVAILABLE"


class ConnectorsConnectParams(ProfileParams):
    owner: ConnectorOwner
    connectors: list[ConnectorSlug] = Field(min_length=1)


class ConnectorsConnectResult(ConnectionOperationStatus):
    """``methods_connectors._reissue``: the open operation after its failed targets were run again."""

    status: Literal["initiated", "settled"] | None = None
    note: str | None = None


method(
    "connectors.connect",
    params=ConnectorsConnectParams,
    result=ConnectorsConnectResult,
    doc="Run the named failed targets of the session's open connection operation again.",
)

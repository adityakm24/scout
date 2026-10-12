import contextvars

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method
_CONNECTOR_RPC_METHODS = frozenset({"connectors.connect", "connection.respond"})
_connector_rpc_origin: contextvars.ContextVar[tuple | None] = contextvars.ContextVar("connector_rpc_origin", default=None)


def _capture_connector_rpc_owner(params):
    owner = params.get("owner") if isinstance(params, dict) else None
    sid = owner.get("session_id") if isinstance(owner, dict) and owner.get("type") == "session" else ""
    _, session = _current_session_steer_authority(sid if isinstance(sid, str) else "")
    _connector_rpc_origin.set((session, session.get("profile_home") if session is not None else None))


def _connector_rpc_error(rid, code, reason, message):
    return _err(rid, code, message, data={"reason": reason})


def _connector_guard(fn):
    def handler(rid, params):
        from tui_gateway.contracts.connectors import ConnectorErrorReason

        try:
            return fn(rid, params)
        except ProfileUnavailableError:
            raise
        except Exception:
            return _connector_rpc_error(
                rid, 5034, ConnectorErrorReason.connector_request_failed, "Connector request failed. Try again explicitly."
            )

    return handler


def _connector_owner_matches(sid, owner, profile_home):
    _, current = _current_session_steer_authority(sid)
    return current is owner and not owner.get("_finalized") and owner.get("profile_home") == profile_home


def _session_owner(rid, owner):
    from tui_gateway.contracts.connectors import ConnectorErrorReason

    sid = owner.session_id
    _, session = _current_session_steer_authority(sid)
    origin = _connector_rpc_origin.get()
    if (session is None or session.get("_finalized")
            or origin is not None and (origin[0] is not session or origin[1] != session.get("profile_home"))):
        return None, _connector_rpc_error(
            rid, 4001, ConnectorErrorReason.not_owner, "session not found or not owned by this transport"
        )
    if _session_uses_compute_host(session):
        return None, _connector_rpc_error(
            rid, 5033, ConnectorErrorReason.unsupported_runtime, "Connectors must be managed on the session's compute host."
        )
    return session, None


def _parse_params(rid, params, model):
    from pydantic import ValidationError

    from tui_gateway.contracts.connectors import ConnectorErrorReason

    try:
        return model.model_validate(params), None
    except ValidationError:
        return None, _connector_rpc_error(rid, 4000, ConnectorErrorReason.invalid_params, "Connector parameters are invalid.")


def _connector_params(rid, params, model):
    request, error = _parse_params(rid, params, model)
    if error:
        return None, None, error
    session, error = _session_owner(rid, request.owner)
    return request, session, error


def _connector_rpc(rid, params):
    from tools.connectors import live
    from tui_gateway.contracts.connectors import ConnectorErrorReason, ConnectorsConnectParams

    request, session, error = _connector_params(rid, params, ConnectorsConnectParams)
    if error:
        return error
    operation = live.current(session["session_key"], profile_home=session.get("profile_home"))
    if operation is None:
        return _connector_rpc_error(
            rid, 4004, ConnectorErrorReason.unknown_operation, "No open connection operation for this session."
        )
    return _reissue(rid, operation, {"connectors": request.connectors})


def _reissue(rid, operation, args):
    from tools.connectors.run import (
        LINK_STILL_VALID,
        MIXED_KINDS,
        NOT_ALLOWED,
        REFUSED,
        SETTLED,
        UNKNOWN_TARGET,
        reissue,
    )
    from tui_gateway.connector_payload import connector_ui_payload
    from tui_gateway.contracts.connectors import ConnectorErrorReason

    reason = reissue(operation, args["connectors"])
    if reason == UNKNOWN_TARGET:
        return _connector_rpc_error(rid, 4004, ConnectorErrorReason.unknown_target, "No such target on the open operation.")
    if reason == MIXED_KINDS:
        return _connector_rpc_error(rid, 4000, ConnectorErrorReason.invalid_params, "One target kind per request.")
    if reason == LINK_STILL_VALID:
        return _connector_rpc_error(rid, 4002, ConnectorErrorReason.link_still_valid, "Reopen the stored link.")
    if reason == SETTLED:
        return _connector_rpc_error(rid, 4002, ConnectorErrorReason.reissue_refused, "The operation has settled.")
    if reason == NOT_ALLOWED:
        return _connector_rpc_error(rid, 4002, ConnectorErrorReason.reissue_refused, "This target cannot be run again.")
    if reason == REFUSED:
        return _connector_rpc_error(rid, 4002, ConnectorErrorReason.reissue_refused, "The target cannot be run again.")
    return _ok(rid, connector_ui_payload(_operation_view(operation)))


def _operation_params(rid, params):
    from tui_gateway.contracts.connectors_operation import ConnectionOperationParams

    return _connector_params(rid, params, ConnectionOperationParams)


@method("connectors.connect")
@_connector_guard
def _(rid, params):
    return _connector_rpc(rid, params)


def _operation_for_request(rid, request, session):
    from tools.connectors import live
    from tui_gateway.contracts.connectors import ConnectorErrorReason

    operation = live.get(session["session_key"], request.op_id, profile_home=session.get("profile_home"))
    if operation is None:
        return None, _connector_rpc_error(rid, 4004, ConnectorErrorReason.unknown_operation, "No open operation with that op_id.")
    return operation, None


@method("connectors.operation.status")
@_connector_guard
def _(rid, params):
    from tui_gateway.connector_payload import connector_ui_payload

    request, session, error = _operation_params(rid, params)
    if error:
        return error
    operation, error = _operation_for_request(rid, request, session)
    return error or _ok(rid, connector_ui_payload(_operation_view(operation)))


@method("connection.respond")
@_connector_guard
def _(rid, params):
    from pydantic import ValidationError

    from tui_gateway.contracts.connectors import ConnectorErrorReason
    from tui_gateway.contracts.connectors_operation import ConnectionAnswer

    envelope = {key: value for key, value in params.items() if key != "result"}
    request, session, error = _operation_params(rid, envelope)
    if error:
        return error
    try:
        answer = ConnectionAnswer.model_validate(params.get("result"))
    except ValidationError:
        return _connector_rpc_error(rid, 4002, ConnectorErrorReason.invalid_answer, "Connection answer is invalid.")
    operation, error = _operation_for_request(rid, request, session)
    if error:
        return error
    with _session_profile_runtime_scope({"profile_home": session.get("profile_home") or str(_scout_home)}):
        return _apply_connection_answer(rid, answer, operation)


def _apply_connection_answer(rid, answer, operation):
    from tools.connectors import live
    from tools.connectors.contract import SettleReason
    from tools.connectors.operation import IllegalTransition
    from tools.connectors.run import apply_answer
    from tui_gateway.contracts.connectors import ConnectorErrorReason

    try:
        apply_answer(operation, answer.model_dump_json(exclude_none=True))
    except IllegalTransition:
        return _connector_rpc_error(rid, 4002, ConnectorErrorReason.invalid_answer, "Connection answer is invalid.")
    if not operation.settled and operation.all_resolved:
        operation.settle(SettleReason.all_resolved)
    if operation.settled:
        live.close(operation)
    return _ok(rid, {"status": "ok", "settled": operation.settled})


def _snapshot_view(snapshot):
    return {**snapshot, "settled": snapshot.get("settled_at") is not None}


def _operation_view(operation):
    return _snapshot_view(operation.snapshot())


def _connection_update(operation, change, snapshot):
    from scout_constants import get_process_scout_home, scout_home_key
    from tui_gateway import server
    from tui_gateway.connector_payload import connector_ui_payload

    payload = _snapshot_view(snapshot)
    if change:
        payload.update(change)
    with server._sessions_lock:
        sid = next(
            (
                sid
                for sid, session in server._sessions.items()
                if session.get("session_key") == operation.session_key
                and scout_home_key(session.get("profile_home") or get_process_scout_home()) == operation.profile_key
            ),
            None,
        )
    if sid is not None:
        payload["owner"] = {"type": "session", "session_id": sid}
        server._emit("connection.update", sid, connector_ui_payload(payload))


def _install_update_hook():
    from tools.connectors import operation as op_module

    if getattr(op_module.ConnectionOperation, "_update_hook_installed", False):
        return
    op_module.ConnectionOperation._update_hook_installed = True
    op_module.ConnectionOperation.on_change = staticmethod(_connection_update)


def register(server):
    bind_module(globals(), server, skip=("_",))
    server._LONG_HANDLERS = server._LONG_HANDLERS | _CONNECTOR_RPC_METHODS
    _install_update_hook()

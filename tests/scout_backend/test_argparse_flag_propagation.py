"""Tests for parent→subparser flag propagation.

When flags like --yolo, -w, -s exist on both the parent parser and the 'chat'
subparser, placing the flag BEFORE the subcommand (e.g. 'scout --yolo chat')
must not silently drop the flag value.

Regression test for: argparse subparser default=False overwriting parent's
parsed True when the same argument is defined on both parsers.

Fix: chat subparser uses default=argparse.SUPPRESS for all duplicated flags,
so the subparser only sets the attribute when the user explicitly provides it.
"""

import argparse
import sys

import pytest


class TestChatVerboseArg:
    """Verify chat --verbose preserves config fallback when absent."""

    def test_chat_without_verbose_leaves_attribute_unset(self):
        from scout_backend._parser import build_top_level_parser

        parser, _subparsers, _chat_parser = build_top_level_parser()
        args = parser.parse_args(["chat"])

        assert not hasattr(args, "verbose")






class TestChatSubparserInheritedValueFlags:
    """Verify -t/--toolsets, -m/--model and --provider survive parent→chat
    subparser dispatch.

    Regression test for #28780: `scout -t web chat` silently dropped the
    toolset because the chat subparser re-declared `-t/--toolsets` with
    `default=None`, which clobbered the top-level parser's value during
    subparser dispatch.

    Uses the real `scout_backend._parser.build_top_level_parser()` rather than
    the hand-rolled replica above so this also fails if the production
    parser drifts back to `default=None` on these flags.
    """

    @pytest.fixture
    def real_parser(self):
        from scout_backend._parser import build_top_level_parser
        parser, _subparsers, _chat = build_top_level_parser()
        return parser


    def test_all_three_flags_before_chat(self, real_parser):
        """Issue #28780 reporter's case generalized: passing every inherited
        value flag before `chat` must preserve all of them simultaneously."""
        args, _ = real_parser.parse_known_args([
            "-t", "web",
            "-m", "anthropic/claude-sonnet-4",
            "--provider", "openrouter",
            "chat",
        ])
        assert args.toolsets == "web"
        assert args.model == "anthropic/claude-sonnet-4"
        assert args.provider == "openrouter"


    def test_chat_subparser_inherited_value_flags_use_suppress(self):
        """Contract test for the underlying invariant.

        Any chat-subparser flag whose `dest` also exists on the top-level
        parser MUST declare `default=argparse.SUPPRESS`, otherwise the
        subparser silently overwrites the top-level value with its own
        default during dispatch. This is the structural class behind #28780.
        """
        from scout_backend._parser import build_top_level_parser
        parser, _subparsers, chat_parser = build_top_level_parser()

        top_level_dests = {
            a.dest for a in parser._actions
            if a.option_strings and a.dest != "help"
        }

        offenders = []
        for action in chat_parser._actions:
            if not action.option_strings or action.dest == "help":
                continue
            if action.dest not in top_level_dests:
                continue
            if action.default is not argparse.SUPPRESS:
                offenders.append((action.option_strings, action.dest, action.default))

        assert not offenders, (
            "Chat subparser redeclares these top-level flags without "
            "default=argparse.SUPPRESS; they will silently clobber the "
            "top-level value when used as `scout <flag> <value> chat`:\n  "
            + "\n  ".join(f"{opts} dest={dest} default={d!r}"
                          for opts, dest, d in offenders)
        )

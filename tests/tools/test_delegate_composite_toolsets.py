"""Tests for composite toolset expansion in delegate_task intersection."""

import unittest

from tools.delegate_tool import _expand_parent_toolsets, _strip_blocked_tools


class TestExpandParentToolsets(unittest.TestCase):
    """Verify _expand_parent_toolsets recognises individual toolsets within composites."""

    def test_composite_scout_backend_expands_without_the_web(self):
        """scout-cli is the User Agent's surface: its children get its toolsets, never the web or the
        browser, which only the Browser Agent holds (agent/agent_bridge/)."""
        expanded = _expand_parent_toolsets({"scout-cli"})
        self.assertIn("terminal", expanded)
        self.assertIn("browse", expanded)
        self.assertNotIn("web", expanded)
        self.assertNotIn("browser", expanded)
        # Original composite is preserved
        self.assertIn("scout-cli", expanded)



    def test_included_toolsets_of_composite_parent_are_grantable(self):
        """A composite parent holds its ``includes`` too (#111700): ``debugging`` = terminal/process_manage +
        includes web/file, so a child may request ``web``/``file`` — but never a toolset the parent lacks."""
        expanded = _expand_parent_toolsets({"debugging"})
        self.assertTrue({"debugging", "terminal", "web", "file"} <= expanded)
        self.assertNotIn("browser", expanded)
        self.assertNotIn("scout-cli", expanded)

    def test_composites_with_allowed_included_tools_are_not_stripped(self):
        toolsets = ["safe", "scout-gateway", "scout-cli", "delegation", "kanban"]

        self.assertEqual(
            _strip_blocked_tools(toolsets),
            ["safe", "scout-gateway", "scout-cli"],
        )


if __name__ == "__main__":
    unittest.main()

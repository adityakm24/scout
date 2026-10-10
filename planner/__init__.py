"""The user's planner: a to-do list and reminders shared by the user and the agent.

One store per profile home, written by every surface (the ``planner`` tool inside any agent
turn, the ``scout todo`` / ``scout remind`` CLI, the desktop Dashboard over RPC). Nothing
here caches across calls, so each read reflects the latest write from any process.

- ``planner.todos``: the to-do list (``<home>/planner/todos.json``).
- ``planner.reminders``: reminders, stored as reminder-kind cron jobs so they fire from the
  cron ticker that already serves every profile.
"""

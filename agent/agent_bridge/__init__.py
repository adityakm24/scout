"""The bridge between the User Agent and the Browser Agent.

Scout runs two agents in separate OpenShell sandboxes. The User Agent holds the person's context
(mail, files, calendar, memory) and never touches the open web. The Browser Agent browses the web
and holds no personal data. A compromised page can take over the Browser Agent, so everything that
crosses back to the User Agent is constrained by four rules:

1. No natural language between the agents: the Browser Agent answers only with the enums and
   typed fields in ``protocol``, validated deterministically and then by NeMo Guardrails (``guard``).
2. Audit by metadata: the User Agent sees an action log (tool, domain, outcome), never page content
   (``action_log``), and the domain allowlist is enforced in code (``scope``).
3. Blind token injection: the Browser Agent types ``{{USER_ADDRESS}}``; the value is written into the
   page outside the model and never enters its context (``placeholders``).
4. Out-of-band gates: external writes run only after a prompt the model cannot answer
   (``tools/external_action_tool.py``, the sandbox's read-only network policy).
"""

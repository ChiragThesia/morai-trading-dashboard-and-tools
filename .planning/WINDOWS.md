---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 1
total_count: 2
last_updated: 2026-08-31T15:41:01.197Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02 | deviation | tests/test_isolation.py |  | Plan 02-02 Task 2 (admin-exemption tests, HTTP not-found posture, byte-identical-404 assertion) was never implemented -- tests/test_isolation.py has only Task 1's six tests. | fixed |  | 2026-08-31T11:05:09.671Z | 2026-08-31T11:23:13.513Z |
| 2 | 03 | deviation | tests/identity/test_login_logout.py |  | Pre-existing test-order-dependent flakiness across tests/identity/* (and occasionally tests/ledger/*), unrelated to plan 03-05 -- confirmed present before and after this plan's two new files were added; different tests fail on each run of the full suite, while tests/ledger/test_plaintext_queries.py passes reliably (4+ consecutive isolated runs). Root cause not investigated (out of scope, files_modified is oracle_seed.py + test_plaintext_queries.py only); likely a fixture-lifecycle race in the shared conftest engine-per-fixture pattern. | open |  | 2026-08-31T15:41:01.197Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "02",
    "file": "tests/test_isolation.py",
    "line": null,
    "description": "Plan 02-02 Task 2 (admin-exemption tests, HTTP not-found posture, byte-identical-404 assertion) was never implemented -- tests/test_isolation.py has only Task 1's six tests.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-31T11:05:09.671Z",
    "resolved_at": "2026-08-31T11:23:13.513Z"
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "03",
    "file": "tests/identity/test_login_logout.py",
    "line": null,
    "description": "Pre-existing test-order-dependent flakiness across tests/identity/* (and occasionally tests/ledger/*), unrelated to plan 03-05 -- confirmed present before and after this plan's two new files were added; different tests fail on each run of the full suite, while tests/ledger/test_plaintext_queries.py passes reliably (4+ consecutive isolated runs). Root cause not investigated (out of scope, files_modified is oracle_seed.py + test_plaintext_queries.py only); likely a fixture-lifecycle race in the shared conftest engine-per-fixture pattern.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-31T15:41:01.197Z",
    "resolved_at": null
  }
]
````

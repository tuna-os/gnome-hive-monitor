# Runbook: GNOME Hive Monitor Client Diagnostics & Troubleshooting

## Overview

This runbook covers operational troubleshooting, diagnostic log inspection, and issue escalation for the `gnome-hive-monitor` GNOME Shell Extension.

## Triage Procedure

### 1. Inspect GNOME Shell Logs
To filter extension diagnostic logs from systemd journald:
```bash
journalctl --user -f -o cat | grep -F '[HiveMonitor]'
```

Common log entries and actions:
- `[HiveMonitor] Network error fetching widget status: ...` -> Check the local network connection and the **Hive URL** setting.
- `[HiveMonitor] HTTP error from hive (HTTP 503)` -> Check the health of the Hive backend API.
- `[HiveMonitor] Authentication rejected by hive (HTTP 401)` -> Check the **Hive token** setting. It must be the `HIVE_DASHBOARD_TOKEN` of the hive. The GitHub token does not apply to this request.
- `[HiveMonitor] Hive redirected the status request (HTTP 301); not followed` -> Set the final HTTPS address of the hive in the **Hive URL** setting.
- `[HiveMonitor] Failed to parse hive JSON response: ...` -> Check the response format of the backend API.
- `[HiveMonitor] Network error filing idea to GitHub: ...` -> Check the local network connection to `api.github.com`.
- `[HiveMonitor] GitHub API error filing idea on owner/name: ...` -> Check the **Repository** setting and the **GitHub token** setting. The token needs `issues:write` on that repository.

### 2. Verify Extension State
Check the state of the extension:
```bash
gnome-extensions info hive-monitor@tunaos.org
```

To re-enable or reload:
```bash
gnome-extensions disable hive-monitor@tunaos.org
gnome-extensions enable hive-monitor@tunaos.org
```

## Escalation Path
If issues persist due to backend failures or breaking GNOME Shell API updates:
1. File an incident report using `.github/ISSUE_TEMPLATE/incident_report.md`.
2. Notify the operations maintainer team with journal logs attached.

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
- `[HiveMonitor] HTTP error from hive (HTTP 503)` -> Check local network connectivity or Hive backend API health.
- `[HiveMonitor] Authentication rejected by hive (HTTP 401)` -> Verify user GitHub Personal Access Token configured in Extension Preferences (`prefs.js`).
- `[HiveMonitor] Failed to parse hive JSON response: ...` -> Verify backend API response format.

### 2. Verify Extension State
Check extension enablement state via `gsettings`:
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

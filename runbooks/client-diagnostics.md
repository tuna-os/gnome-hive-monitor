# Runbook: GNOME Hive Monitor Client Diagnostics & Troubleshooting

## Overview

This runbook covers operational troubleshooting, diagnostic log inspection, and issue escalation for the `gnome-hive-monitor` GNOME Shell Extension.

## Triage Procedure

### 1. Inspect GNOME Shell Logs
To filter extension diagnostic logs from systemd journald:
```bash
journalctl --user -f -o cat | grep "\[GNOME Hive Monitor\]"
```

Common log entries and actions:
- `[GNOME Hive Monitor] HTTP Error: ...` -> Check local network connectivity or Hive backend API health.
- `[GNOME Hive Monitor] Token rejected (HTTP 401/403)` -> Verify user GitHub Personal Access Token configured in Extension Preferences (`prefs.js`).
- `[GNOME Hive Monitor] JSON Parse Error: ...` -> Verify backend API response format.

### 2. Verify Extension State
Check extension enablement state via `gsettings`:
```bash
gnome-extensions info gnome-hive-monitor@tuna-os.org
```

To re-enable or reload:
```bash
gnome-extensions disable gnome-hive-monitor@tuna-os.org
gnome-extensions enable gnome-hive-monitor@tuna-os.org
```

## Escalation Path
If issues persist due to backend failures or breaking GNOME Shell API updates:
1. File an incident report using `.github/ISSUE_TEMPLATE/incident_report.md`.
2. Notify the operations maintainer team with journal logs attached.

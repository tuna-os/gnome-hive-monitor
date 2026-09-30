name: Incident Report
description: Report an operational incident, client failure, or outage
title: '[incident] '
labels: ['incident', 'operations']
body:
  - type: markdown
    attributes:
      value: |
        Thank you for reporting an operational incident. Please fill out the details below.
  - type: textarea
    id: summary
    attributes:
      label: Incident Summary
      description: What happened? Describe the failure or error behavior observed.
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Relevant Logs (`journalctl`)
      description: Paste relevant `[GNOME Hive Monitor]` logs from `journalctl`.
    validations:
      required: false
  - type: textarea
    id: impact
    attributes:
      label: User Impact
      description: Describe the scope and severity of the impact.
    validations:
      required: true

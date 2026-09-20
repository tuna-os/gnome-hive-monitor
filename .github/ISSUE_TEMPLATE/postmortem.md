name: Postmortem Template
description: Standardized postmortem template for operational incidents
title: '[postmortem] '
labels: ['postmortem', 'operations']
body:
  - type: markdown
    attributes:
      value: |
        Please fill out this postmortem template following resolution of a high-severity operational incident.
  - type: textarea
    id: overview
    attributes:
      label: Incident Overview & Timeline
      description: Provide a concise summary of the incident and key event timeline.
    validations:
      required: true
  - type: textarea
    id: root_cause
    attributes:
      label: Root Cause Analysis
      description: Explain the underlying technical or operational root cause.
    validations:
      required: true
  - type: textarea
    id: action_items
    attributes:
      label: Action Items & Follow-ups
      description: List corrective action items and prevention measures.
    validations:
      required: true

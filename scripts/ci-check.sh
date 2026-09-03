#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. JavaScript Syntax Check ==="
node --check extension.js prefs.js
echo "OK"

echo "=== 2. Extension Metadata Validation ==="
python3 -c "
import json
with open('metadata.json') as f:
    data = json.load(f)
assert 'uuid' in data and data['uuid'] == 'hive-monitor@tunaos.org', 'Invalid or missing uuid'
assert 'name' in data, 'Missing name'
assert 'shell-version' in data and isinstance(data['shell-version'], list), 'Invalid shell-version list'
assert 'settings-schema' in data, 'Missing settings-schema'
print(f'Metadata valid for extension {data[\"name\"]} (uuid: {data[\"uuid\"]})')
"

echo "=== 3. GSettings Schema Validation ==="
python3 -c "
import xml.etree.ElementTree as ET
tree = ET.parse('schemas/org.gnome.shell.extensions.hive-monitor.gschema.xml')
root = tree.getroot()
assert root.tag == 'schemalist', 'Root element must be schemalist'
schema = root.find('schema')
assert schema is not None, 'No schema element found'
assert schema.get('id') == 'org.gnome.shell.extensions.hive-monitor', f'Incorrect schema id: {schema.get(\"id\")}'
keys = [k.get('name') for k in schema.findall('key')]
print(f'GSchema keys ({len(keys)}): {keys}')
required = {'hive-url', 'hive-token', 'poll-seconds', 'github-repo', 'github-token', 'idea-labels', 'show-counts'}
for req in required:
    assert req in keys, f'Missing required key: {req}'
print('All GSettings schema keys validated successfully')
"

echo "=== All CI checks passed! ==="

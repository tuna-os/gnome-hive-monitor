// Run with: node tests/test_settings_validation.mjs
// The pure rules run in Node; URL parsing needs the real GLib API in GJS.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../settingsValidation.js', import.meta.url), 'utf8')
    .replace("import GLib from 'gi://GLib';", 'const GLib = undefined;');
const {validateSetting, validateSettings, isValidRepo, parseLabels, IDEA_FIELDS} =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);

for (const repo of ['tuna-os/gnome-hive-monitor', 'a/b', 'a/b.c-d_e'])
    assert.equal(isValidRepo(repo), true);
for (const repo of ['a/..', 'a/.', 'a/b?x', 'a/b#x', 'a/b/../../x', 'a/b\n', ''])
    assert.equal(isValidRepo(repo), false);
for (const field of ['hive-token', 'github-token']) {
    for (const token of ['opaque-secret', 'github_pat_example', '  secret  '])
        assert.equal(validateSetting(field, token), null);
    for (const token of ['', 'a b', 'a\rb', 'a\nb', 'a\x00b'])
        assert.ok(validateSetting(field, token));
    assert.equal(validateSetting(field, '', {required: false}), null);
}
for (const seconds of [15, 60, 3600])
    assert.equal(validateSetting('poll-seconds', seconds), null);
for (const seconds of [0, 14, 3601, 15.5, '60', NaN])
    assert.ok(validateSetting('poll-seconds', seconds));
for (const labels of ['', 'bug, help wanted', 'x'.repeat(50), ',bug,,'])
    assert.equal(validateSetting('idea-labels', labels), null);
for (const labels of ['x'.repeat(51), 'bad\x00label', 'bad\nlabel'])
    assert.ok(validateSetting('idea-labels', labels));
assert.deepEqual(parseLabels(' bug, ,help wanted,'), ['bug', 'help wanted']);
const values = {'github-repo': 'a/b', 'github-token': 'opaque', 'idea-labels': ''};
const settings = {get_string: field => values[field] ?? ''};
assert.deepEqual(validateSettings(settings, IDEA_FIELDS), {valid: true, errors: []});
values['github-repo'] = 'a/..';
values['github-token'] = '';
const invalid = validateSettings(settings, IDEA_FIELDS);
assert.equal(invalid.valid, false);
assert.deepEqual(invalid.errors.map(error => error.field), ['github-repo', 'github-token']);
console.log('Settings validation tests passed.');

// Exercise the preferences write gate without a display or GNOME Shell.
const prefs = readFileSync(new URL('../prefs.js', import.meta.url), 'utf8');
const helper = prefs.slice(prefs.indexOf('function connectValidatedEntry'), prefs.indexOf('export default'));
const rows = [];
const row = {
    value: '', changed: null, error: false,
    connect(_signal, callback) { this.changed = callback; },
    get_text() { return this.value; },
    add_css_class() { this.error = true; },
    remove_css_class() { this.error = false; },
};
class ActionRow {
    set_title(title) { this.title = title; }
    set_visible(visible) { this.visible = visible; }
}
const connect = new Function('Adw', 'validateSetting', '_', `${helper}; return connectValidatedEntry;`)(
    {ActionRow}, validateSetting, text => text);
let saved = 'owner/original';
connect({set_string(_field, value) { saved = value; }}, row, 'github-repo', {add(item) { rows.push(item); }});
row.value = 'invalid/repo/path';
row.changed();
assert.equal(saved, 'owner/original');
assert.equal(row.error, true);
assert.equal(rows[1].visible, true);
row.value = 'owner/corrected';
row.changed();
assert.equal(saved, 'owner/corrected');
assert.equal(row.error, false);
assert.equal(rows[1].visible, false);
row.value = '';
row.changed();
assert.equal(saved, '');
console.log('Preferences write validation tests passed.');

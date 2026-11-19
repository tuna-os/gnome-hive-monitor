// Widget status and capacity display, run against the production ESM graph.
// Run with: node --experimental-vm-modules --test tests/test_widget.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runtime} = require('./gnome-runtime.cjs');

const base = {mode: 'IDLE', issues: 0, prs: 0, running: 0, paused: 0};
const json = value => JSON.stringify(value);

test('widget renders only bounded capacity states and keeps legacy responses', async () => {
    const r = await runtime();
    assert.equal(r.requests[0].msg.url, 'https://hive.example/api/widget');
    assert.equal(r.requests[0].msg.headers['X-Hive-Internal'], 'secret');
    r.requests[0].reply(200, json(base));
    assert.equal(r.indicator._capacityItem.text, 'Capacity status is unknown');
    assert.equal(r.indicator._label.text, 'IDLE 0/0');
    for (const [state, expected, icon] of [
        ['available', 'Capacity available', 'system-run-symbolic'],
        ['queue_limited', 'Queued work is capacity limited', 'dialog-warning-symbolic'],
        ['stale', 'Capacity status is stale', 'system-run-symbolic'],
        ['unknown', 'Capacity status is unknown', 'system-run-symbolic'],
        ['provider secret', 'Capacity status is unknown', 'system-run-symbolic'],
        [{account: 'secret'}, 'Capacity status is unknown', 'system-run-symbolic'],
    ]) {
        r.indicator._refresh();
        r.requests.at(-1).reply(200, json({...base, capacity_state: state}));
        assert.equal(r.indicator._capacityItem.text, expected);
        assert.equal(r.indicator._icon.icon_name, icon);
    }
    r.indicator._refresh();
    r.requests.at(-1).reply(200, json({...base, paused: 1, capacity_state: 'available'}));
    assert.equal(r.indicator._icon.icon_name, 'dialog-warning-symbolic');
});

test('authentication and network errors clear any previous capacity', async () => {
    const r = await runtime();
    r.requests[0].reply(200, json({...base, capacity_state: 'queue_limited'}));
    r.indicator._refresh();
    r.requests.at(-1).reply(403, '');
    assert.equal(r.indicator._statusItem.text, 'Hive rejected the token.');
    assert.equal(r.indicator._capacityItem.text, '');
    r.indicator._refresh();
    r.requests.at(-1).reply(500, '');
    assert.equal(r.indicator._statusItem.text, 'Hive returned HTTP 500.');
    assert.equal(r.indicator._capacityItem.text, '');
    r.indicator._refresh();
    r.requests.at(-1).reply(200, 'not json');
    assert.equal(r.indicator._statusItem.text, 'Unreadable response.');
    r.indicator._refresh();
    r.requests.at(-1).reply(0, '', new Error('offline'));
    assert.equal(r.indicator._statusItem.text, 'Cannot reach the hive.');
});

test('endpoint changes, incomplete settings and disable reject late replies', async () => {
    const r = await runtime();
    r.requests[0].reply(200, json({...base, capacity_state: 'queue_limited'}));
    r.indicator._refresh();
    const old = r.requests.at(-1);
    r.change('hive-url', 'https://other.example');
    assert.equal(r.indicator._statusItem.text, 'Refreshing hive status…');
    assert.equal(r.indicator._capacityItem.text, '');
    assert.equal(old.cancel.cancelled, true);
    const fresh = r.requests.at(-1);
    assert.equal(fresh.msg.url, 'https://other.example/api/widget');
    fresh.reply(200, json({...base, capacity_state: 'available'}));
    old.reply(200, json({...base, capacity_state: 'queue_limited'}));
    assert.equal(r.indicator._capacityItem.text, 'Capacity available');
    r.indicator._refresh();
    const pending = r.requests.at(-1);
    r.change('hive-token', '');
    pending.reply(200, json({...base, capacity_state: 'queue_limited'}));
    assert.equal(r.indicator._statusItem.text, 'No hive token set.');
    assert.equal(r.indicator._capacityItem.text, '');
    r.change('hive-token', 'new');
    const beforeDisable = r.requests.at(-1);
    const indicator = r.indicator;
    r.ext.disable();
    assert.equal(beforeDisable.cancel.cancelled, true);
    beforeDisable.reply(200, json({...base, capacity_state: 'queue_limited'}));
    assert.equal(indicator._capacityItem.text, '');
    const reenabled = await runtime();
    reenabled.requests[0].reply(200, json({...base, capacity_state: 'stale'}));
    assert.equal(reenabled.indicator._capacityItem.text, 'Capacity status is stale');
});

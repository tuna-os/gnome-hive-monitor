import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the production modules with only the GNOME platform boundary mocked.
const context = vm.createContext({Date});
const timers = new Map();
let nextTimer = 0;
const requests = [];
class Cancellable {
    cancelled = false;
    cancel() { this.cancelled = true; }
}
const GLib = {
    PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true, UriFlags: {NONE: 0},
    Source: {remove: id => timers.delete(id)},
    timeout_add_seconds: (_priority, seconds, callback) => {
        timers.set(++nextTimer, {seconds, callback});
        return nextTimer;
    },
    Uri: {parse: raw => {
        const url = new URL(raw);
        return {get_scheme: () => url.protocol.slice(0, -1),
            get_host: () => url.hostname,
            get_userinfo: () => url.username || url.password,
            to_string: () => url.toString()};
    }},
};
const mocks = {
    'gi://Gio': {default: {Cancellable}},
    'gi://GLib': {default: GLib},
    'resource:///org/gnome/shell/extensions/extension.js': {gettext: s => s},
    './hiveClient.js': {fetchWidgetStatus: (...args) => requests.push(args)},
};
async function load(name) {
    const module = new vm.SourceTextModule(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'), {context});
    await module.link(specifier => {
        const exports = mocks[specifier];
        assert.ok(exports, `Unexpected dependency: ${specifier}`);
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports))
                this.setExport(key, value);
        }, {context});
    });
    await module.evaluate();
    return module.namespace;
}
const {renderStatus, ago} = await load('statusRenderer.js');
const now = Date.parse('2026-10-24T12:00:00Z');
assert.equal(ago('2026-10-24T11:59:15Z', undefined, now), '45s ago');
assert.equal(ago('2026-10-24T11:58:00Z', undefined, now), '2m ago');
assert.equal(ago('2026-10-24T10:00:00Z', undefined, now), '2h ago');
assert.equal(ago('invalid', undefined, now), 'invalid');
assert.equal(ago('2026-10-25T12:00:00Z', undefined, now), '0s ago');
let display = renderStatus({kind: 'status', showCounts: true,
    data: {mode: 'busy', issues: 3, prs: 2, running: 4, paused: 1,
        last_eval: '2026-10-24T11:58:00Z'}}, undefined, now);
assert.equal(display.label, 'BUSY 3/2');
assert.equal(display.icon, 'dialog-warning-symbolic');
assert.equal(display.status, 'BUSY — 3 issues, 2 PRs');
assert.equal(display.detail, '4 agents running, 1 paused · last eval 2m ago');
display = renderStatus({kind: 'status', showCounts: false, data: {}});
assert.equal(display.label, '?');
assert.equal(display.icon, 'system-run-symbolic');
assert.equal(display.detail, '0 agents running');
assert.equal(renderStatus({kind: 'error', short: 'failed'}).detail, '');
assert.equal(renderStatus({kind: 'unconfigured', message: 'missing'}).status, 'missing');
assert.equal(renderStatus({kind: 'error', short: 'failed'}, s => `translated:${s}`).label, 'translated:hive!');

const {StatusPoller} = await load('statusPoller.js');
const values = {'hive-url': 'https://hive.example/', 'hive-token': 'token', 'poll-seconds': 30, 'show-counts': true};
let changed;
let disconnected = false;
const settings = {
    get_string: key => values[key], get_int: key => values[key], get_boolean: key => values[key],
    connect: (_signal, callback) => { changed = callback; return 1; },
    disconnect: id => { assert.equal(id, 1); disconnected = true; },
};
const states = [];
const poller = new StatusPoller(settings, {}, state => states.push(state));
poller.start();
poller.start();
assert.equal(timers.size, 1);
assert.equal(requests.length, 1);
assert.equal(requests[0][2], 'https://hive.example');
const first = requests[0];
timers.values().next().value.callback();
const second = requests[1];
second[4].onSuccess({mode: 'fresh'});
for (const callback of Object.values(first[4])) callback('stale', 'stale');
assert.equal(states.length, 1);
assert.equal(states[0].data.mode, 'fresh');
values['poll-seconds'] = 60;
changed();
assert.equal(first[1].cancelled, true);
assert.notEqual(requests.at(-1)[1], first[1]);
assert.equal(timers.size, 1);
assert.equal(timers.values().next().value.seconds, 60);
const pending = requests.at(-1);
values['hive-token'] = '';
changed();
assert.equal(states.at(-1).kind, 'unconfigured');
const count = states.length;
for (const callback of Object.values(pending[4])) callback('stale', 'stale');
assert.equal(states.length, count);
values['hive-token'] = 'token';
for (const url of ['http://hive.example', 'https://user:pass@hive.example', 'bad url', '']) {
    values['hive-url'] = url;
    changed();
    assert.equal(states.at(-1).kind, 'unconfigured');
}
values['hive-url'] = 'https://hive.example';
changed();
const last = requests.at(-1);
poller.destroy();
poller.destroy();
assert.equal(last[1].cancelled, true);
assert.equal(timers.size, 0);
assert.equal(disconnected, true);
const finalCount = states.length;
for (const callback of Object.values(last[4])) callback('late', 'late');
poller.refresh();
assert.equal(states.length, finalCount);
console.log('Status renderer and poller tests passed');

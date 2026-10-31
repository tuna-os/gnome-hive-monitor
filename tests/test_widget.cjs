// Exercise the production GJS modules with a small Shell/Soup test double.
// Run with: node --test tests/test_widget.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function load() {
    const requests = [];
    class Label {
        constructor(props = {}) { this.text = props.text || ''; }
        set_text(text) { this.text = text; }
    }
    class Item {
        constructor(text) { this.label = new Label({text}); }
        connect() {}
    }
    class Button {
        constructor(...args) { this._init(...args); }
        _init() { this.menu = {addMenuItem() {}}; }
        add_child() {}
        destroy() { this.destroyed = true; }
    }
    class Cancellable {
        cancel() { this.cancelled = true; }
    }
    class Session {
        send_and_read_async(msg, _priority, cancel, callback) {
            requests.push({msg, cancel, callback, session: this});
        }
        send_and_read_finish(result) {
            if (result.error) throw result.error;
            return {get_data: () => new TextEncoder().encode(result.body)};
        }
        abort() { this.aborted = true; }
    }
    const settings = {
        values: {'hive-url': 'https://hive.example', 'hive-token': 'secret',
            'poll-seconds': 60, 'show-counts': true},
        get_string(key) { return this.values[key] || ''; },
        get_int(key) { return this.values[key]; },
        get_boolean(key) { return this.values[key]; },
        connect(_name, cb) { this.changed = cb; return 1; },
        disconnect() {},
    };
    const ctx = vm.createContext({
        console: {debug() {}, error() {}}, TextDecoder,
        Gio: {Cancellable, IOErrorEnum: {CANCELLED: 1}},
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true,
            UriFlags: {NONE: 0},
            Uri: {parse(raw) {
                const url = new URL(raw);
                return {get_scheme: () => url.protocol.slice(0, -1),
                    get_host: () => url.hostname,
                    get_userinfo: () => url.username || url.password,
                    to_string: () => raw};
            }},
            timeout_add_seconds: () => 1, Source: {remove() {}}},
        Soup: {Session, Message: {new(method, url) {
            return {method, url, request_headers: {values: {}, append(k, v) { this.values[k] = v; }},
                get_status() { return this.status; }};
        }}},
        St: {Label, Icon: class { constructor(props) { Object.assign(this, props); } },
            BoxLayout: class { add_child() {} }},
        Clutter: {ActorAlign: {CENTER: 0}},
        GObject: {registerClass: cls => cls},
        PanelMenu: {Button}, PopupMenu: {PopupMenuItem: Item, PopupSeparatorMenuItem: Item},
        ModalDialog: {ModalDialog: class {}}, Main: {notify() {}}, Extension: class {},
        _: text => text,
    });
    // Imports are replaced with mocks, but the function and class bodies run
    // unchanged. This catches rendering and lifecycle regressions, not Shell ABI issues.
    const source = name => fs.readFileSync(path.join(root, name), 'utf8')
        .replace(/import\s+(?:\{[^}]*\}|[^;]+?)\s+from\s+['"][^'"]+['"];\s*/gs, '')
        .replace(/export default class /g, 'class ').replace(/export function /g, 'function ');
    vm.runInContext(`String.prototype.format = function (...args) {
        let i = 0; return this.replace(/%[sd]/g, () => String(args[i++]));
    };\n${source('hiveClient.js')}\n${source('extension.js')}\nglobalThis.Indicator = HiveIndicator;`, ctx);
    const indicator = new ctx.Indicator({getSettings: () => settings});
    function reply(req, status, body) {
        req.msg.status = status;
        req.callback(req.session, {body: typeof body === 'string' ? body : JSON.stringify(body)});
    }
    return {indicator, settings, requests, reply};
}

const base = {mode: 'IDLE', issues: 0, prs: 0, running: 0, paused: 0};

test('widget renders only bounded capacity states and keeps legacy responses', () => {
    const h = load();
    assert.equal(h.requests[0].msg.url, 'https://hive.example/api/widget');
    assert.equal(h.requests[0].msg.request_headers.values['X-Hive-Internal'], 'secret');
    h.reply(h.requests[0], 200, base);
    assert.equal(h.indicator._capacityItem.label.text, 'Capacity status is unknown');
    assert.equal(h.indicator._label.text, 'IDLE 0/0');
    for (const [state, expected, icon] of [
        ['available', 'Capacity available', 'system-run-symbolic'],
        ['queue_limited', 'Queued work is capacity limited', 'dialog-warning-symbolic'],
        ['stale', 'Capacity status is stale', 'system-run-symbolic'],
        ['unknown', 'Capacity status is unknown', 'system-run-symbolic'],
        ['provider secret', 'Capacity status is unknown', 'system-run-symbolic'],
        [{account: 'secret'}, 'Capacity status is unknown', 'system-run-symbolic'],
    ]) {
        h.indicator._refresh();
        h.reply(h.requests.at(-1), 200, {...base, capacity_state: state});
        assert.equal(h.indicator._capacityItem.label.text, expected);
        assert.equal(h.indicator._icon.icon_name, icon);
    }
    h.indicator._refresh();
    h.reply(h.requests.at(-1), 200, {...base, paused: 1, capacity_state: 'available'});
    assert.equal(h.indicator._icon.icon_name, 'dialog-warning-symbolic');
});

test('authentication and network errors clear any previous capacity', () => {
    const h = load();
    h.reply(h.requests[0], 200, {...base, capacity_state: 'queue_limited'});
    h.indicator._refresh();
    h.reply(h.requests.at(-1), 403, '');
    assert.equal(h.indicator._statusItem.label.text, 'Hive rejected the token.');
    assert.equal(h.indicator._capacityItem.label.text, '');
    h.indicator._refresh();
    h.reply(h.requests.at(-1), 500, '');
    assert.equal(h.indicator._statusItem.label.text, 'Hive returned HTTP 500.');
    assert.equal(h.indicator._capacityItem.label.text, '');
    h.indicator._refresh();
    h.reply(h.requests.at(-1), 200, 'not json');
    assert.equal(h.indicator._statusItem.label.text, 'Unreadable response.');
    h.indicator._refresh();
    const network = h.requests.at(-1);
    network.callback(network.session, {error: new Error('offline')});
    assert.equal(h.indicator._statusItem.label.text, 'Cannot reach the hive.');
});

test('endpoint changes, incomplete settings and disable reject late replies', () => {
    const h = load();
    h.reply(h.requests[0], 200, {...base, capacity_state: 'queue_limited'});
    h.indicator._refresh();
    const old = h.requests.at(-1);
    h.settings.values['hive-url'] = 'https://other.example';
    h.settings.changed();
    assert.equal(h.indicator._statusItem.label.text, 'Refreshing hive status…');
    assert.equal(h.indicator._capacityItem.label.text, '');
    assert.equal(old.cancel.cancelled, true);
    const fresh = h.requests.at(-1);
    assert.equal(fresh.msg.url, 'https://other.example/api/widget');
    h.reply(fresh, 200, {...base, capacity_state: 'available'});
    h.reply(old, 200, {...base, capacity_state: 'queue_limited'});
    assert.equal(h.indicator._capacityItem.label.text, 'Capacity available');
    h.indicator._refresh();
    const pending = h.requests.at(-1);
    h.settings.values['hive-token'] = '';
    h.settings.changed();
    h.reply(pending, 200, {...base, capacity_state: 'queue_limited'});
    assert.equal(h.indicator._statusItem.label.text, 'No hive token set.');
    assert.equal(h.indicator._capacityItem.label.text, '');
    h.settings.values['hive-token'] = 'new';
    h.settings.changed();
    const beforeDisable = h.requests.at(-1);
    h.indicator.destroy();
    assert.equal(beforeDisable.cancel.cancelled, true);
    h.reply(beforeDisable, 200, {...base, capacity_state: 'queue_limited'});
    assert.equal(h.indicator._capacityItem.label.text, '');
    const reenabled = load();
    reenabled.reply(reenabled.requests[0], 200, {...base, capacity_state: 'stale'});
    assert.equal(reenabled.indicator._capacityItem.label.text, 'Capacity status is stale');
});

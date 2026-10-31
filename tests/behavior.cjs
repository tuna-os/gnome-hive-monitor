// Execute the production ESM graph; only GNOME platform imports are doubles.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');

async function runtime() {
    const requests = [];
    class Actor {
        constructor(props = {}) {
            Object.assign(this, props);
            this.label = {set_text: text => { this.text = text; }};
            this.menu = {addMenuItem() {}};
            this._init(props);
        }
        _init() {}
        add_child() {}
        connect() {}
        set_text(text) { this.text = text; }
        destroy() { this.destroyed = true; }
    }
    class Cancellable {
        cancel() { this.cancelled = true; }
    }
    class Session {
        send_and_read_async(msg, priority, cancel, callback) {
            requests.push({msg, cancel, reply(code, body, error) {
                msg.code = code;
                callback({send_and_read_finish() {
                    if (error) throw error;
                    return {get_data: () => new TextEncoder().encode(body)};
                }}, {});
            }});
        }
        abort() { this.aborted = true; }
    }
    const Soup = {Session, Message: {new(method, url) {
        if (url.includes('invalid')) return null;
        return {method, url, headers: {}, request_headers: {append(key, value) {
            this.owner.headers[key] = value;
        }}, set_request_body_from_bytes(type, bytes) { this.body = bytes; },
        get_status() { return this.code; }};
    }}};
    const makeMessage = Soup.Message.new;
    Soup.Message.new = (...args) => {
        const msg = makeMessage(...args);
        if (msg) msg.request_headers.owner = msg;
        return msg;
    };
    const GLib = {PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true,
        Bytes: class { constructor(data) { this.data = data; } },
        Source: {remove() {}}, timeout_add_seconds: () => 1,
        UriFlags: {NONE: 0}, Uri: {parse(raw) {
            const url = new URL(raw);
            return {get_scheme: () => url.protocol.slice(0, -1),
                get_host: () => url.hostname, get_userinfo: () => url.username,
                to_string: () => url.href};
        }}};
    let indicator;
    const platform = {
        'gi://Gio': {default: {Cancellable, IOErrorEnum: {CANCELLED: 1}}},
        'gi://GLib': {default: GLib},
        'gi://Soup?version=3.0': {default: Soup},
        'gi://Clutter': {default: {ActorAlign: {CENTER: 0}}},
        'gi://St': {default: {BoxLayout: Actor, Icon: Actor, Label: Actor}},
        'gi://GObject': {default: {registerClass: klass => klass}},
        'resource:///org/gnome/shell/ui/main.js': {
            panel: {addToStatusArea(uuid, value) { indicator = value; }}, notify() {}},
        'resource:///org/gnome/shell/ui/panelMenu.js': {Button: Actor},
        'resource:///org/gnome/shell/ui/popupMenu.js': {
            PopupMenuItem: Actor, PopupSeparatorMenuItem: Actor},
        'resource:///org/gnome/shell/ui/modalDialog.js': {ModalDialog: Actor},
        'resource:///org/gnome/shell/extensions/extension.js': {
            Extension: class {}, gettext: text => text},
    };
    const context = vm.createContext({TextEncoder, TextDecoder, console, URL});
    vm.runInContext('Date.now = () => 1700000000000;', context);
    vm.runInContext(`String.prototype.format = function(...args) {
        let i = 0; return this.replace(/%[sd]/g, () => String(args[i++]));
    };`, context);
    const cache = new Map();
    async function load(id) {
        if (cache.has(id)) return cache.get(id);
        let module;
        if (platform[id]) {
            const exports = platform[id];
            module = new vm.SyntheticModule(Object.keys(exports), function() {
                for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
            }, {context, identifier: id});
        } else {
            module = new vm.SourceTextModule(await fs.readFile(id, 'utf8'),
                {context, identifier: id});
        }
        cache.set(id, module);
        await module.link((specifier, parent) => load(specifier.startsWith('.')
            ? path.resolve(path.dirname(parent.identifier), specifier) : specifier));
        return module;
    }
    const root = path.resolve(__dirname, '..');
    const extension = await load(path.join(root, 'extension.js'));
    await extension.evaluate();
    const github = cache.get(path.join(root, 'githubClient.js')).namespace;
    const hive = cache.get(path.join(root, 'hiveClient.js')).namespace;
    const values = {'hive-url': 'https://hive.example', 'hive-token': 'secret',
        'github-repo': 'o/n', 'github-token': 'github', 'idea-labels': 'idea, test'};
    let changed;
    const settings = {get_string: key => values[key], get_int: () => 60,
        get_boolean: () => true, connect(signal, callback) { changed = callback; return 1; },
        disconnect() { changed = null; }};
    const ext = new extension.namespace.default();
    ext.getSettings = () => settings;
    ext.enable();
    return {github, hive, requests, indicator, values, ext,
        change(key, value) { values[key] = value; changed(); }};
}

test('repository validation executes the guard before sending credentials', async () => {
    const r = await runtime();
    for (const repo of ['owner/name', 'a/b', 'x-y/a_b-c.d', 'A0/z9'])
        assert.equal(r.github.isValidRepo(repo), true, repo);
    for (const repo of ['', null, 4, 'o/..', 'o/.', 'o/n/issues', 'o/n?x',
        'o/n#x', 'o/n\n', '-o/n', 'a'.repeat(600) + '/b']) {
        assert.equal(r.github.isValidRepo(repo), false, String(repo));
        const before = r.requests.length;
        let errors = 0;
        r.github.fileIssue(r.indicator._session, r.indicator._ideaCancel,
            repo, 'secret', [], 'title', '', {onError() { errors++; }});
        assert.equal(errors, 1);
        assert.equal(r.requests.length, before);
    }
});

test('settings replace status ownership, preserve idea POST, and gate late replies', async () => {
    const r = await runtime();
    const old = r.requests[0];
    r.indicator._fileIdea('o/n', 'github', 'title', 'body');
    const idea = r.requests[1];
    assert.notEqual(old.cancel, idea.cancel);
    r.change('hive-token', 'new-token');
    assert.equal(old.cancel.cancelled, true);
    assert.equal(idea.cancel.cancelled, undefined);
    const fresh = r.requests[2];
    assert.equal(fresh.msg.headers['X-Hive-Internal'], 'new-token');
    fresh.reply(200, '{"mode":"busy","issues":3,"prs":2}');
    assert.equal(r.indicator._label.text, 'BUSY 3/2');
    for (const [code, body, error] of [[200, '{"mode":"old"}'], [401, ''],
        [500, ''], [200, 'bad'], [0, '', new Error('offline')]]) {
        old.reply(code, body, error);
        assert.equal(r.indicator._label.text, 'BUSY 3/2');
    }
    r.ext.disable();
    assert.equal(fresh.cancel.cancelled, true);
    assert.equal(idea.cancel.cancelled, true);
});

test('relative time uses production JavaScript rounding and invalid-date behavior', async () => {
    const {indicator} = await runtime();
    // Freeze the module realm clock, including half-second rounding boundaries.
    const now = 1700000000000;
    for (const [seconds, expected] of [[-10, '0s ago'], [0, '0s ago'],
        [45, '45s ago'], [0.5, '1s ago'], [59.5, '1m ago'], [60, '1m ago'], [90, '2m ago'],
        [3599, '60m ago'], [3600, '1h ago'], [86400, '24h ago']]) {
        assert.equal(indicator._ago(new Date(now - seconds * 1000).toISOString()), expected);
    }
    assert.equal(indicator._ago('invalid'), 'invalid');
});

test('HTTP status callback contract: success, auth, HTTP, JSON, network, cancellation', async () => {
    const r = await runtime();
    for (const [code, body, error, expected] of [
        [200, '{"issues":7}', null, 'onSuccess'],
        [401, '', null, 'onAuthError'], [403, '', null, 'onAuthError'],
        [500, '', null, 'onError'], [200, 'bad', null, 'onError'],
        [0, '', new Error('offline'), 'onError'],
        [0, '', {matches: () => true}, null]]) {
        const calls = [];
        const callbacks = Object.fromEntries(['onSuccess', 'onAuthError', 'onError', 'onInvalidUrl']
            .map(name => [name, (...args) => calls.push([name, ...args])]));
        r.hive.fetchWidgetStatus(r.indicator._session, r.indicator._statusCancel,
            'https://hive.example', 'token', callbacks);
        r.requests.at(-1).reply(code, body, error);
        assert.deepEqual(calls.map(call => call[0]), expected ? [expected] : []);
        if (expected === 'onSuccess') assert.equal(calls[0][1].issues, 7);
    }
});

test('GitHub POST serializes payload and maps filed, malformed, refused and cancelled replies', async () => {
    const r = await runtime();
    for (const [code, body, error, expected] of [
        [201, '{"number":42,"html_url":"https://github.com/o/n/issues/42"}', null, 'filed'],
        [201, 'bad', null, 'filed'], [422, '{"message":"denied"}', null, 'error'],
        [500, 'bad', null, 'error'], [0, '', new Error('offline'), 'error'],
        [0, '', {matches: () => true}, null]]) {
        const calls = [];
        r.github.fileIssue(r.indicator._session, r.indicator._ideaCancel,
            'o/n', 'token', ['idea'], 'Title', 'Body', {
                onFiled: (...args) => calls.push(['filed', ...args]),
                onError: (...args) => calls.push(['error', ...args]),
            });
        const request = r.requests.at(-1);
        assert.equal(request.msg.method, 'POST');
        assert.equal(request.msg.url, 'https://api.github.com/repos/o/n/issues');
        assert.equal(request.msg.headers.Authorization, 'Bearer token');
        const payload = JSON.parse(new TextDecoder().decode(request.msg.body.data));
        assert.equal(payload.title, 'Title');
        assert.deepEqual(payload.labels, ['idea']);
        request.reply(code, body, error);
        assert.deepEqual(calls.map(call => call[0]), expected ? [expected] : []);
        if (code === 201 && body !== 'bad') assert.equal(calls[0][1], '#42');
    }
});


test('overlapping polls render only the newest generation', async () => {
    const r = await runtime();
    r.indicator._refresh();
    r.indicator._refresh();
    r.requests[1].reply(200, '{"mode":"second"}');
    assert.equal(r.indicator._label.text, '…');
    r.requests[2].reply(200, '{"mode":"third"}');
    r.requests[0].reply(200, '{"mode":"first"}');
    assert.equal(r.indicator._label.text, 'THIRD 0/0');
});

test('invalid transport URLs call only onInvalidUrl without sending a request', async () => {
    const r = await runtime();
    for (const url of ['http://hive.example', 'https://invalid']) {
        const before = r.requests.length;
        const calls = [];
        const callbacks = Object.fromEntries(['onSuccess', 'onAuthError', 'onError', 'onInvalidUrl']
            .map(name => [name, () => calls.push(name)]));
        r.hive.fetchWidgetStatus(r.indicator._session, r.indicator._statusCancel,
            url, 'token', callbacks);
        assert.deepEqual(calls, ['onInvalidUrl']);
        assert.equal(r.requests.length, before);
    }
});

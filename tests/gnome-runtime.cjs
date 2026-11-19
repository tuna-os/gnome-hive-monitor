// The GNOME runtime the Node behaviour tests run in.
//
// Loads the production ESM graph (extension.js, prefs.js and every module they
// import) with vm.SourceTextModule. Only GNOME platform imports (gi://,
// resource://) are doubles; a relative import resolves to the real file, so a
// module split out of extension.js needs no change here.
//
// This file holds no tests. Run the tests that use it with
// --experimental-vm-modules.
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
    // Preferences doubles. A row has only members the real Adw rows have, so
    // a call to a method libadwaita lacks fails here as it does in GJS.
    const rows = {};
    const toasts = [];
    class Widget {
        constructor(props = {}) { Object.assign(this, props); }
        add() {}
        add_css_class() {}
    }
    class Row extends Widget {
        constructor(props) {
            super(props);
            this.handlers = {};
            rows[this.title] = this;
        }
        set_text(text) { this.text = text; }
        get_text() { return this.text; }
        connect(signal, callback) { this.handlers[signal] = callback; }
        // Typing changes the text and emits `changed`, once per character.
        type(text) { this.text = text; this.handlers.changed?.(); }
        // Adw emits `apply` only from a row that shows the apply button.
        apply() { if (this.show_apply_button) this.handlers.apply?.(); }
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
    const Soup = {Session, MessageFlags: {NO_REDIRECT: 2}, Message: {new(method, url) {
        if (url.includes('invalid')) return null;
        return {method, url, headers: {}, flags: 0, request_headers: {append(key, value) {
            this.owner.headers[key] = value;
        }}, set_request_body_from_bytes(type, bytes) { this.body = bytes; },
        add_flags(flags) { this.flags |= flags; },
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
                get_port: () => url.port ? Number(url.port) : -1,
                to_string: () => url.href};
        }}};
    let indicator;
    const platform = {
        'gi://Gio': {default: {Cancellable, IOErrorEnum: {CANCELLED: 1},
            SettingsBindFlags: {DEFAULT: 0}}},
        'gi://Adw': {default: {PreferencesPage: Widget, PreferencesGroup: Widget,
            ActionRow: Widget, SpinRow: Widget, SwitchRow: Widget, Toast: Widget,
            EntryRow: Row, PasswordEntryRow: Row}},
        'gi://Gtk': {default: {Adjustment: Widget}},
        'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js': {
            ExtensionPreferences: class {}, gettext: text => text},
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
        disconnect() { changed = null; },
        set_string(key, value) { values[key] = value; changed?.(); }, bind() {}};
    const ext = new extension.namespace.default();
    ext.getSettings = () => settings;
    ext.enable();
    // Build the preferences window against the settings the extension reads.
    async function openPrefs() {
        const module = await load(path.join(root, 'prefs.js'));
        await module.evaluate();
        const prefs = new module.namespace.default();
        prefs.getSettings = () => settings;
        const window = new Widget();
        window.add_toast = toast => toasts.push(toast);
        prefs.fillPreferencesWindow(window);
        return rows;
    }
    return {github, hive, requests, indicator, values, ext, Soup, openPrefs, toasts,
        change(key, value) { values[key] = value; changed(); }};
}

module.exports = {runtime};

/* Status polling and settings lifecycle; no Shell actors. */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {fetchWidgetStatus} from './hiveClient.js';

export class StatusPoller {
    constructor(settings, session, onUpdate) {
        this._settings = settings;
        this._session = session;
        this._onUpdate = onUpdate;
        this._statusCancel = new Gio.Cancellable();
        this._statusGen = 0;
        this._timer = null;
        this._destroyed = false;
    }

    start() {
        if (this._destroyed || this._settingsId)
            return;
        this._settingsId = this._settings.connect('changed', () => {
            this._abortStatus();
            this._restartTimer();
            this.refresh();
        });
        this._restartTimer();
        this.refresh();
    }

    _emit(state) {
        this._onUpdate({...state,
            showCounts: this._settings.get_boolean('show-counts')});
    }

    get url() {
        const raw = this._settings.get_string('hive-url').trim();
        if (!raw)
            return '';

        // GJS has no WHATWG URL global; GLib.Uri is the available parser.
        let parsed;
        try {
            parsed = GLib.Uri.parse(raw, GLib.UriFlags.NONE);
        } catch {
            return '';
        }

        // The token is sent on every poll, so never over cleartext or with
        // credentials embedded in the URL.
        if (parsed.get_scheme()?.toLowerCase() !== 'https' ||
            !parsed.get_host() || parsed.get_userinfo())
            return '';

        return parsed.to_string().replace(/\/+$/, '');
    }

    // Settings changes cancel status only; confirmed GitHub POSTs are separate.
    _abortStatus() {
        ++this._statusGen;
        this._statusCancel.cancel();
        this._statusCancel = new Gio.Cancellable();
    }

    _restartTimer() {
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = null;
        }
        const secs = this._settings.get_int('poll-seconds');
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    refresh() {
        if (this._destroyed)
            return;
        // Invalidate older replies even when settings are now incomplete.
        const gen = ++this._statusGen;
        const url = this.url;
        const token = this._settings.get_string('hive-token').trim();
        if (!url) {
            this._emit({kind: 'unconfigured', message: _('No hive URL set.')});
            return;
        }
        if (!token) {
            this._emit({kind: 'unconfigured', message: _('No hive token set.')});
            return;
        }

        // Cancellation alone cannot prevent an already queued callback.
        const current = () => gen === this._statusGen;

        fetchWidgetStatus(this._session, this._statusCancel, url, token, {
            onSuccess: data => {
                if (current())
                    this._emit({kind: 'status', data});
            },
            onInvalidUrl: message => {
                if (current())
                    this._emit({kind: 'unconfigured', message});
            },
            onError: (short, detail) => {
                if (current())
                    this._emit({kind: 'error', short, detail});
            },
            onAuthError: (short, detail) => {
                if (current())
                    this._emit({kind: 'error', short, detail});
            },
        });
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        ++this._statusGen;
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._timer = null;
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = null;
        this._statusCancel.cancel();
    }
}

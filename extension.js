/* Hive Monitor — a top-bar indicator for a kubestellar/hive instance.
 *
 * Deliberately NOT bound to any particular hive: every endpoint, credential
 * and target repo comes from GSettings, so the same extension works against
 * a self-hosted spoke, the hosted hub, or a colleague's instance.
 *
 * Two things it does:
 *   1. Polls GET /api/widget — the hive's own compact status endpoint
 *      ({issues, prs, mode, running, paused, last_eval}) — and renders it.
 *   2. Files an idea as a GitHub issue on a configured repo, labelled so the
 *      hive's governor treats it as work. Ideas go to GitHub rather than to a
 *      hive bead because GitHub issues ARE the hive's work queue: the governor
 *      polls them and its SURGE/BUSY modes are driven by their depth. Beads
 *      are per-agent internal state, and Inception is for scaffolding whole
 *      new projects — neither is an intake channel for "I had an idea".
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    Extension,
    gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import {newSession, HiveClient, GitHubClient} from './client.js';
import {IdeaDialog} from './dialog.js';

/* ── Panel indicator ──────────────────────────────────────────────────── */
const HiveIndicator = GObject.registerClass(
class HiveIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Hive Monitor');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._session = newSession();
        this._cancel = new Gio.Cancellable();
        this._hiveClient = new HiveClient(this._session, this._cancel);
        this._githubClient = new GitHubClient(this._session, this._cancel);
        this._timer = null;
        this._last = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            icon_name: 'system-run-symbolic',
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-left: 4px;',
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._buildMenu();

        // Re-read on any settings change: a corrected URL or token should take
        // effect immediately, not after the next poll interval.
        this._settingsId = this._settings.connect('changed', () => {
            this._restartTimer();
            this._refresh();
        });

        this._restartTimer();
        this._refresh();
    }

    _buildMenu() {
        this._statusItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            style_class: 'popup-inactive-menu-item',
        });
        this.menu.addMenuItem(this._statusItem);

        this._detailItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            style_class: 'popup-inactive-menu-item',
        });
        this.menu.addMenuItem(this._detailItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const idea = new PopupMenu.PopupMenuItem(_('New Idea…'));
        idea.connect('activate', () => this._openIdeaDialog());
        this.menu.addMenuItem(idea);

        const open = new PopupMenu.PopupMenuItem(_('Open Dashboard'));
        open.connect('activate', () => {
            const url = this._url();
            if (url)
                Gio.AppInfo.launch_default_for_uri(url, null);
        });
        this.menu.addMenuItem(open);

        const refresh = new PopupMenu.PopupMenuItem(_('Refresh Now'));
        refresh.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refresh);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupMenuItem(_('Settings'));
        prefs.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    _url() {
        return this._settings.get_string('hive-url').trim().replace(/\/+$/, '');
    }

    _restartTimer() {
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = null;
        }
        const secs = this._settings.get_int('poll-seconds');
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setUnconfigured(msg) {
        this._label.set_text(_('hive?'));
        this._icon.icon_name = 'dialog-question-symbolic';
        this._statusItem.label.set_text(msg);
        this._detailItem.label.set_text(_('Open Settings to configure.'));
    }

    _refresh() {
        const url = this._url();
        const token = this._settings.get_string('hive-token').trim();
        if (!url) {
            this._setUnconfigured(_('No hive URL set.'));
            return;
        }
        if (!token) {
            this._setUnconfigured(_('No hive token set.'));
            return;
        }

        this._hiveClient.fetchWidget(url, token, (status, data, extra) => {
            if (status === 'invalid_url') {
                this._setUnconfigured(_('That hive URL is not valid.'));
            } else if (status === 'network_error') {
                this._showError(_('Cannot reach the hive.'), extra);
            } else if (status === 'auth_error') {
                this._showError(_('Hive rejected the token.'),
                    _('Check the hive token in Settings (HTTP %d).').format(extra));
            } else if (status === 'http_error') {
                this._showError(_('Hive returned HTTP %d.').format(extra), '');
            } else if (status === 'parse_error') {
                this._showError(_('Unreadable response.'), extra);
            } else if (status === 'ok') {
                this._render(data);
            }
        });
    }

    _showError(short, detail) {
        this._icon.icon_name = 'dialog-warning-symbolic';
        this._label.set_text(_('hive!'));
        this._statusItem.label.set_text(short);
        this._detailItem.label.set_text(detail || '');
    }

    _render(d) {
        this._last = d;
        const mode = String(d.mode ?? '?').toUpperCase();
        const issues = Number(d.issues ?? 0);
        const prs = Number(d.prs ?? 0);
        const running = Number(d.running ?? 0);
        const paused = Number(d.paused ?? 0);

        this._label.set_text(
            this._settings.get_boolean('show-counts')
                ? `${mode} ${issues}/${prs}`
                : mode);

        // A paused agent is the quiet failure this widget exists to surface:
        // the hive looks alive while some of its lanes do nothing.
        this._icon.icon_name = paused > 0
            ? 'dialog-warning-symbolic'
            : 'system-run-symbolic';

        this._statusItem.label.set_text(
            _('%s — %d issues, %d PRs').format(mode, issues, prs));

        const agents = paused > 0
            ? _('%d agents running, %d paused').format(running, paused)
            : _('%d agents running').format(running);
        this._detailItem.label.set_text(
            d.last_eval
                ? `${agents} · ${_('last eval %s').format(this._ago(d.last_eval))}`
                : agents);
    }

    _ago(iso) {
        const then = Date.parse(iso);
        if (Number.isNaN(then))
            return iso;
        const s = Math.max(0, Math.round((Date.now() - then) / 1000));
        if (s < 60)
            return _('%ds ago').format(s);
        if (s < 3600)
            return _('%dm ago').format(Math.round(s / 60));
        return _('%dh ago').format(Math.round(s / 3600));
    }

    _openIdeaDialog() {
        const repo = this._settings.get_string('github-repo').trim();
        const tok = this._settings.get_string('github-token').trim();
        if (!repo || !tok) {
            Main.notify(_('Hive Monitor'),
                _('Set a repository and GitHub token in Settings first.'));
            this._ext.openPreferences();
            return;
        }
        new IdeaDialog((title, body) => this._fileIdea(repo, tok, title, body)).open();
    }

    _fileIdea(repo, token, title, body) {
        const labels = this._settings.get_string('idea-labels')
            .split(',').map(s => s.trim()).filter(s => s.length > 0);

        this._githubClient.fileIssue(repo, token, title, body, labels, (status, data) => {
            if (status === 'invalid_repo') {
                Main.notify(_('Hive Monitor'), _('“%s” is not a valid owner/name.').format(data.repo));
                return;
            }
            if (status === 'network_error') {
                Main.notify(_('Hive Monitor'), _('Could not file the idea: %s').format(data.error));
                return;
            }
            if (status === 'ok') {
                if (data.htmlUrl)
                    this._lastIssueUrl = data.htmlUrl;
                Main.notify(_('Hive Monitor'), _('Filed %s on %s.').format(data.num, data.repo));
                // Ideas change the queue depth, so reflect it immediately
                // instead of waiting out the poll interval.
                this._refresh();
                return;
            }
            if (status === 'error') {
                Main.notify(_('Hive Monitor'), _('GitHub refused the idea: %s').format(data.why));
            }
        });
    }

    destroy() {
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = null;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        // Cancel in-flight requests, then drop the session: a reply arriving
        // after destroy() would touch freed actors.
        this._cancel.cancel();
        this._session?.abort();
        this._session = null;
        super.destroy();
    }
});

export default class HiveMonitorExtension extends Extension {
    enable() {
        this._indicator = new HiveIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

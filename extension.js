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
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {
    Extension,
    gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import {StatusPoller} from './statusPoller.js';
import {renderStatus} from './statusRenderer.js';
import {fileIssue} from './githubClient.js';

const AGENT_URL = 'gnome-shell-hive-monitor/1';

/* A single Soup session for the extension. Created once and cancelled on
 * disable(), so no request outlives the extension (the "no lingering async
 * work after disable" rule extensions get unlisted for breaking). */
function newSession() {
    const s = new Soup.Session({timeout: 15});
    s.user_agent = AGENT_URL;
    return s;
}

/* ── Idea entry dialog ────────────────────────────────────────────────── */
const IdeaDialog = GObject.registerClass(
class IdeaDialog extends ModalDialog.ModalDialog {
    _init(onSubmit) {
        super._init({styleClass: 'hive-idea-dialog'});
        this._onSubmit = onSubmit;

        const box = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 12px; min-width: 420px;',
        });
        this.contentLayout.add_child(box);

        box.add_child(new St.Label({
            text: _('New idea'),
            style: 'font-weight: 800; font-size: 1.1em;',
        }));
        box.add_child(new St.Label({
            text: _('Becomes a labelled issue the hive can pick up.'),
            style: 'color: rgba(255,255,255,0.7);',
        }));

        this._title = new St.Entry({
            hint_text: _('Title'),
            can_focus: true,
            style: 'margin-top: 6px;',
        });
        box.add_child(this._title);

        this._body = new St.Entry({
            hint_text: _('Detail (optional)'),
            can_focus: true,
        });
        // St.Entry is single-line; keep the body one line rather than pretend
        // otherwise. Anything longer belongs in the issue itself on the web.
        box.add_child(this._body);

        this._status = new St.Label({text: '', style: 'color: #f66;'});
        box.add_child(this._status);

        this.setButtons([
            {
                label: _('Cancel'),
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: _('File Idea'),
                action: () => this._submit(),
                default: true,
            },
        ]);
        this.setInitialKeyFocus(this._title.clutter_text);
    }

    _submit() {
        const title = this._title.get_text().trim();
        if (!title) {
            this._status.set_text(_('A title is required.'));
            return;
        }
        this.close();
        this._onSubmit(title, this._body.get_text().trim());
    }
});

/* ── Panel indicator ──────────────────────────────────────────────────── */
const HiveIndicator = GObject.registerClass(
class HiveIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Hive Monitor');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._session = newSession();
        this._ideaCancel = new Gio.Cancellable();
        this._poller = new StatusPoller(this._settings, this._session,
            state => this._applyDisplay(renderStatus(state, _)));

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

        this._poller.start();
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
            const url = this._poller.url;
            if (url)
                Gio.AppInfo.launch_default_for_uri(url, null);
        });
        this.menu.addMenuItem(open);

        const refresh = new PopupMenu.PopupMenuItem(_('Refresh Now'));
        refresh.connect('activate', () => this._poller.refresh());
        this.menu.addMenuItem(refresh);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefs = new PopupMenu.PopupMenuItem(_('Settings'));
        prefs.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    _applyDisplay(display) {
        this._label.set_text(display.label);
        this._icon.icon_name = display.icon;
        this._statusItem.label.set_text(display.status);
        this._detailItem.label.set_text(display.detail);
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

        fileIssue(this._session, this._ideaCancel, repo, token, labels, title, body, {
            onFiled: num => {
                Main.notify(_('Hive Monitor'),
                    _('Filed %s on %s.').format(num, repo));
                // Ideas change the queue depth, so reflect it immediately
                // instead of waiting out the poll interval.
                this._poller.refresh();
            },
            onError: message => Main.notify(_('Hive Monitor'), message),
        });
    }

    destroy() {
        this._poller.destroy();
        this._ideaCancel.cancel();
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

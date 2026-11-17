/* Preferences for Hive Monitor.
 *
 * Two credentials, deliberately kept in separate groups: the hive token reads
 * status from YOUR hive, the GitHub token files the issue. They are different
 * secrets for different services and conflating them in one "token" field is
 * how people end up pasting a GitHub PAT into a hive header.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/* The host and port a hive address names, or '' when it names none.
 *
 * The hive token belongs to the server it was entered for, and this is what
 * identifies that server. A path is not part of it: "/hive" on the same host
 * is the same server. */
function hiveHost(raw) {
    try {
        const uri = GLib.Uri.parse(raw.trim(), GLib.UriFlags.NONE);
        const host = uri.get_host();
        return host ? `${host.toLowerCase()}:${uri.get_port()}` : '';
    } catch {
        return '';
    }
}

export default class HiveMonitorPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Hive'),
            icon_name: 'network-server-symbolic',
        });
        window.add(page);

        // ── Connection ────────────────────────────────────────────────
        const conn = new Adw.PreferencesGroup({
            title: _('Connection'),
            description: _('Which hive to watch. Nothing is polled until both fields are set.'),
        });
        page.add(conn);

        // Saved on apply (Enter or the row's apply button), not on every
        // keystroke. The extension polls as soon as the address changes, so
        // a half-typed one would be sent the token: "https://hive.example.co"
        // is a real host on the way to "https://hive.example.com".
        const url = new Adw.EntryRow({
            title: _('Hive URL'),
            show_apply_button: true,
        });
        url.set_text(settings.get_string('hive-url'));
        conn.add(url);

        const token = new Adw.PasswordEntryRow({title: _('Hive Token')});
        token.set_text(settings.get_string('hive-token'));
        token.connect('changed', () => settings.set_string('hive-token', token.get_text()));
        conn.add(token);

        url.connect('apply', () => {
            const next = url.get_text();
            // The saved token was entered for the old host. The extension
            // polls the new address as soon as it is saved, so a token still
            // set then would be sent to a server it was never meant for.
            // Forget it first; the user enters the one for the new host.
            const was = hiveHost(settings.get_string('hive-url'));
            if (was && hiveHost(next) !== was && settings.get_string('hive-token')) {
                settings.set_string('hive-token', '');
                token.set_text('');
                window.add_toast(new Adw.Toast({
                    title: _('Enter the token for the new hive address.'),
                }));
            }
            settings.set_string('hive-url', next);
        });

        const hint = new Adw.ActionRow({
            title: _('Where the token comes from'),
            subtitle: _('The hive’s HIVE_DASHBOARD_TOKEN, sent as the X-Hive-Internal header. It is read-only: the hive rejects mutations made with it.'),
            activatable: false,
        });
        hint.add_css_class('dim-label');
        conn.add(hint);

        const poll = new Adw.SpinRow({
            title: _('Refresh Interval'),
            subtitle: _('Seconds between status checks.'),
            adjustment: new Gtk.Adjustment({
                lower: 15, upper: 3600, step_increment: 15, page_increment: 60,
            }),
            numeric: true,
        });
        settings.bind('poll-seconds', poll, 'value', Gio.SettingsBindFlags.DEFAULT);
        conn.add(poll);

        // ── Appearance ────────────────────────────────────────────────
        const look = new Adw.PreferencesGroup({title: _('Appearance')});
        page.add(look);

        const counts = new Adw.SwitchRow({
            title: _('Show Queue Counts'),
            subtitle: _('Display open issues and PRs next to the governor mode.'),
        });
        settings.bind('show-counts', counts, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(counts);

        // ── Ideas ─────────────────────────────────────────────────────
        const ideas = new Adw.PreferencesGroup({
            title: _('Ideas'),
            description: _('An idea becomes a GitHub issue. Use one of the hive’s managed repositories, or its governor will never see it.'),
        });
        page.add(ideas);

        const repo = new Adw.EntryRow({title: _('Repository')});
        repo.set_text(settings.get_string('github-repo'));
        repo.connect('changed', () => settings.set_string('github-repo', repo.get_text()));
        ideas.add(repo);

        const ghTok = new Adw.PasswordEntryRow({title: _('GitHub Token')});
        ghTok.set_text(settings.get_string('github-token'));
        ghTok.connect('changed', () => settings.set_string('github-token', ghTok.get_text()));
        ideas.add(ghTok);

        const labels = new Adw.EntryRow({title: _('Labels')});
        labels.set_text(settings.get_string('idea-labels'));
        labels.connect('changed', () => settings.set_string('idea-labels', labels.get_text()));
        ideas.add(labels);

        const labelHint = new Adw.ActionRow({
            title: _('About the default label'),
            subtitle: _('ai-fix-requested is the label hive’s own issue creator applies to mean “an agent should pick this up”. Comma-separated.'),
            activatable: false,
        });
        labelHint.add_css_class('dim-label');
        ideas.add(labelHint);
    }
}

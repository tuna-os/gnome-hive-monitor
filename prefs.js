/* Preferences for Hive Monitor.
 *
 * Two credentials, deliberately kept in separate groups: the hive token reads
 * status from YOUR hive, the GitHub token files the issue. They are different
 * secrets for different services and conflating them in one "token" field is
 * how people end up pasting a GitHub PAT into a hive header.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {validateSetting, POLL_MIN, POLL_MAX} from './settingsValidation.js';

// Keep incomplete edits visible, but never replace a saved value with invalid
// input. Clearing a field is allowed so users can disable either feature.
function connectValidatedEntry(settings, row, field, group) {
    const feedback = new Adw.ActionRow({visible: false, activatable: false});
    group.add(row);
    group.add(feedback);
    row.connect('changed', () => {
        const value = row.get_text();
        const error = validateSetting(field, value, {required: false});
        feedback.set_title(error ? `${error} ${_('Changes were not saved.')}` : '');
        feedback.set_visible(Boolean(error));
        if (error) {
            row.add_css_class('error');
        } else {
            row.remove_css_class('error');
            settings.set_string(field, value);
        }
    });
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

        const url = new Adw.EntryRow({title: _('Hive URL')});
        url.set_placeholder_text(_('https://example.com'));
        url.set_text(settings.get_string('hive-url'));
        connectValidatedEntry(settings, url, 'hive-url', conn);

        const token = new Adw.PasswordEntryRow({title: _('Hive Token')});
        token.set_text(settings.get_string('hive-token'));
        connectValidatedEntry(settings, token, 'hive-token', conn);

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
                lower: POLL_MIN, upper: POLL_MAX, step_increment: 15, page_increment: 60,
            }),
            numeric: true,
        });
        poll.set_value(settings.get_int('poll-seconds'));
        poll.connect('notify::value', () => {
            const value = poll.get_value();
            if (!validateSetting('poll-seconds', value))
                settings.set_int('poll-seconds', value);
        });
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
        connectValidatedEntry(settings, repo, 'github-repo', ideas);

        const ghTok = new Adw.PasswordEntryRow({title: _('GitHub Token')});
        ghTok.set_text(settings.get_string('github-token'));
        connectValidatedEntry(settings, ghTok, 'github-token', ideas);

        const labels = new Adw.EntryRow({title: _('Labels')});
        labels.set_text(settings.get_string('idea-labels'));
        connectValidatedEntry(settings, labels, 'idea-labels', ideas);

        const labelHint = new Adw.ActionRow({
            title: _('About the default label'),
            subtitle: _('ai-fix-requested is the label hive’s own issue creator applies to mean “an agent should pick this up”. Comma-separated.'),
            activatable: false,
        });
        labelHint.add_css_class('dim-label');
        ideas.add(labelHint);
    }
}

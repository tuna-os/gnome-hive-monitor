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

import { validateHiveUrl, validateGithubRepo, validateLabels } from './config.js';

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
        url.set_text(settings.get_string('hive-url'));
        url.connect('changed', () => {
            const text = url.get_text();
            const result = validateHiveUrl(text);
            settings.set_string('hive-url', text);
            
            // Visual feedback for validation
            if (text && !result.valid) {
                url.add_css_class('error');
                if (url._errorLabel) url._errorLabel.destroy();
                const errorLabel = new Gtk.Label({label: result.error, css_classes: ['error', 'caption']});
                errorLabel._errorLabel = true;
                url.get_parent().insert_child_after(errorLabel, url);
                url._errorLabel = errorLabel;
            } else if (url._errorLabel) {
                url.remove_css_class('error');
                url._errorLabel.destroy();
                url._errorLabel = null;
            }
        });
        conn.add(url);

        const token = new Adw.PasswordEntryRow({title: _('Hive Token')});
        token.set_text(settings.get_string('hive-token'));
        token.connect('changed', () => settings.set_string('hive-token', token.get_text()));
        conn.add(token);

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
        repo.connect('changed', () => {
            const text = repo.get_text();
            const result = validateGithubRepo(text);
            settings.set_string('github-repo', text);
            
            // Visual feedback for validation
            if (text && !result.valid) {
                repo.add_css_class('error');
                if (repo._errorLabel) repo._errorLabel.destroy();
                const errorLabel = new Gtk.Label({label: result.error, css_classes: ['error', 'caption']});
                errorLabel._errorLabel = true;
                repo.get_parent().insert_child_after(errorLabel, repo);
                repo._errorLabel = errorLabel;
            } else if (repo._errorLabel) {
                repo.remove_css_class('error');
                repo._errorLabel.destroy();
                repo._errorLabel = null;
            }
        });
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

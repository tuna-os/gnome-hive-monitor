/* githubClient.js — HTTP transport for filing an idea as a GitHub issue.
 *
 * Split out of extension.js (tuna-os/gnome-hive-monitor#30): this is the
 * only place that knows about the GitHub issues REST endpoint, its auth
 * headers, and its request/response payload shape. HiveIndicator calls
 * fileIssue and reacts to whichever outcome it gets; it does not itself
 * touch Soup or the GitHub API's JSON shapes.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const AGENT_URL = 'gnome-shell-hive-monitor/1';

/**
 * File a new issue on a GitHub repo.
 *
 * @param {Soup.Session} session - the extension's shared Soup session.
 * @param {Gio.Cancellable} cancellable - cancelled on extension disable().
 * @param {string} repo - "owner/name", already validated non-empty by the
 *   caller.
 * @param {string} token - the GitHub token, already validated non-empty by
 *   the caller.
 * @param {string[]} labels - labels to apply to the created issue.
 * @param {string} title
 * @param {string} body
 * @param {object} callbacks
 * @param {(number: string, htmlUrl: string|null) => void} callbacks.onFiled -
 *   called on HTTP 201 with the issue number formatted as "#123" (or '' if
 *   the response didn't include one) and the issue's html_url (or null).
 * @param {(message: string) => void} callbacks.onError - called on an
 *   invalid repo, a network error, or a non-201 response. Not called on
 *   cancellation.
 */
export function fileIssue(session, cancellable, repo, token, labels, title, body, {onFiled, onError}) {
    const msg = Soup.Message.new('POST', `https://api.github.com/repos/${repo}/issues`);
    if (!msg) {
        onError(_('“%s” is not a valid owner/name.').format(repo));
        return;
    }
    msg.request_headers.append('Authorization', `Bearer ${token}`);
    msg.request_headers.append('Accept', 'application/vnd.github+json');
    // GitHub 403s a request with no User-Agent, which reads as a bad token
    // rather than a missing header. Always send one.
    msg.request_headers.append('User-Agent', AGENT_URL);

    const payload = JSON.stringify({
        title,
        body: `${body ? body + '\n\n' : ''}— filed from the GNOME Hive Monitor`,
        labels,
    });
    msg.set_request_body_from_bytes(
        'application/json',
        new GLib.Bytes(new TextEncoder().encode(payload)));

    session.send_and_read_async(
        msg, GLib.PRIORITY_DEFAULT, cancellable, (session_, res) => {
            let bytes;
            try {
                bytes = session_.send_and_read_finish(res);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    console.error(`[HiveMonitor] Network error filing idea to GitHub: ${e.message ?? e}`);
                    onError(_('Could not file the idea: %s').format(String(e.message ?? e)));
                }
                return;
            }
            const code = msg.get_status();
            if (code === 201) {
                let num = '';
                let htmlUrl = null;
                try {
                    const j = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    num = j.number ? `#${j.number}` : '';
                    if (j.html_url)
                        htmlUrl = j.html_url;
                } catch { /* the issue exists either way */ }
                console.info(`[HiveMonitor] Successfully filed idea issue ${num} on repo ${repo}`);
                onFiled(num, htmlUrl);
                return;
            }
            let why = `HTTP ${code}`;
            try {
                const j = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (j.message)
                    why = j.message;
            } catch { /* keep the status code */ }
            console.error(`[HiveMonitor] GitHub API error filing idea on ${repo}: ${why}`);
            onError(_('GitHub refused the idea: %s').format(why));
        });
}

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

/* A GitHub "owner/name" and nothing else.
 *
 * This value is pasted into the request path, so it decides which endpoint
 * the token is sent to -- it is not just a label. GitHub's own rules for
 * both halves are alphanumerics plus the separators below, so anything
 * outside that set is rejected rather than escaped: "o/n#x" and "o/n?x"
 * truncate the path at the fragment/query and POST somewhere else, and
 * "a/b/../.." climbs out of /repos/ entirely.
 *
 * Kept deliberately strict: a stray character here is a typo to report, not
 * input to repair. */
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/**
 * Whether a string is a GitHub "owner/name" safe to place in a request path.
 *
 * Exported for the test suite; callers use fileIssue, which enforces it.
 *
 * @param {string} repo - the candidate "owner/name".
 * @returns {boolean} true if repo is well formed.
 */
export function isValidRepo(repo) {
    // '.' and '..' are legal against the regex but are path segments, not
    // repository names.
    if (typeof repo !== 'string' || repo.length > 512)
        return false;
    const name = repo.slice(repo.indexOf('/') + 1);
    if (name === '.' || name === '..')
        return false;
    return REPO_RE.test(repo);
}

/**
 * File a new issue on a GitHub repo.
 *
 * @param {Soup.Session} session - the extension's shared Soup session.
 * @param {Gio.Cancellable} cancellable - cancelled on extension disable().
 * @param {string} repo - "owner/name", already validated non-empty by the
 *   caller. Rejected here unless it is a well-formed owner/name.
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
    // Before building the URL: Soup.Message.new() parses "o/n#x" and
    // "a/b/../.." happily, so a null check here would not catch them. The
    // token must not be sent to a path the repo field redirected.
    if (!isValidRepo(repo)) {
        onError(_('“%s” is not a valid owner/name.').format(repo));
        return;
    }

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

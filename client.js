/* Network & API clients for Hive Monitor.
 * Handles HTTP requests to the Hive status endpoint and GitHub REST API.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export const AGENT_URL = 'gnome-shell-hive-monitor/1';

/**
 * Creates a configured Soup.Session for extension networking.
 *
 * @returns {Soup.Session}
 */
export function newSession() {
    const s = new Soup.Session({timeout: 15});
    s.user_agent = AGENT_URL;
    return s;
}

/**
 * Client for communicating with the Hive widget API.
 */
export class HiveClient {
    /**
     * @param {Soup.Session} session
     * @param {Gio.Cancellable} cancellable
     */
    constructor(session, cancellable) {
        this._session = session;
        this._cancel = cancellable;
    }

    /**
     * Fetch the widget status from the hive.
     *
     * @param {string} url - Hive base URL
     * @param {string} token - Hive auth token
     * @param {Function} callback - Callback (status, data, errorMessage)
     */
    fetchWidget(url, token, callback) {
        const msg = Soup.Message.new('GET', `${url}/api/widget`);
        if (!msg) {
            callback('invalid_url', null, 'That hive URL is not valid.');
            return;
        }
        msg.request_headers.append('X-Hive-Internal', token);

        this._session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, this._cancel, (session, res) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        callback('network_error', null, String(e.message ?? e));
                    return;
                }
                const code = msg.get_status();
                if (code === 401 || code === 403) {
                    callback('auth_error', null, code);
                    return;
                }
                if (code !== 200) {
                    callback('http_error', null, code);
                    return;
                }
                try {
                    const txt = new TextDecoder().decode(bytes.get_data());
                    callback('ok', JSON.parse(txt), null);
                } catch (e) {
                    callback('parse_error', null, String(e.message ?? e));
                }
            });
    }
}

/**
 * Client for filing issues on GitHub.
 */
export class GitHubClient {
    /**
     * @param {Soup.Session} session
     * @param {Gio.Cancellable} cancellable
     */
    constructor(session, cancellable) {
        this._session = session;
        this._cancel = cancellable;
    }

    /**
     * File an issue on GitHub.
     *
     * @param {string} repo - "owner/repo"
     * @param {string} token - GitHub personal/app token
     * @param {string} title - Issue title
     * @param {string} body - Issue body
     * @param {string[]} labels - List of label strings
     * @param {Function} callback - Callback (result, data)
     */
    fileIssue(repo, token, title, body, labels, callback) {
        const msg = Soup.Message.new('POST', `https://api.github.com/repos/${repo}/issues`);
        if (!msg) {
            callback('invalid_repo', {repo});
            return;
        }
        msg.request_headers.append('Authorization', `Bearer ${token}`);
        msg.request_headers.append('Accept', 'application/vnd.github+json');
        msg.request_headers.append('User-Agent', AGENT_URL);

        const payload = JSON.stringify({
            title,
            body: `${body ? body + '\n\n' : ''}— filed from the GNOME Hive Monitor`,
            labels,
        });
        msg.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(payload)));

        this._session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, this._cancel, (session, res) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        callback('network_error', {error: String(e.message ?? e)});
                    return;
                }
                const code = msg.get_status();
                if (code === 201) {
                    let num = '';
                    let htmlUrl = '';
                    try {
                        const j = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        num = j.number ? `#${j.number}` : '';
                        if (j.html_url)
                            htmlUrl = j.html_url;
                    } catch { /* the issue exists either way */ }
                    callback('ok', {num, repo, htmlUrl});
                    return;
                }
                let why = `HTTP ${code}`;
                try {
                    const j = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    if (j.message)
                        why = j.message;
                } catch { /* keep the status code */ }
                callback('error', {why});
            });
    }
}

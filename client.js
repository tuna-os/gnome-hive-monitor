/* Network and API client for Hive Monitor.
 *
 * Encapsulates Soup.Session management and asynchronous communication
 * with the Hive status endpoint and GitHub REST API.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export const AGENT_URL = 'gnome-shell-hive-monitor/1';

export class HiveClient {
    constructor() {
        this._session = new Soup.Session({timeout: 15});
        this._session.user_agent = AGENT_URL;
    }

    /* Fetch widget status from a Hive instance.
     * Calls callback(err, data, httpStatus) on completion. */
    fetchWidget(url, token, cancellable, callback) {
        const msg = Soup.Message.new('GET', `${url}/api/widget`);
        if (!msg) {
            callback(new Error('INVALID_URL'), null, 0);
            return;
        }
        msg.request_headers.append('X-Hive-Internal', token);

        this._session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, cancellable, (session, res) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(res);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    callback(e, null, 0);
                    return;
                }
                const code = msg.get_status();
                if (code !== 200) {
                    callback(null, null, code);
                    return;
                }
                try {
                    const txt = new TextDecoder().decode(bytes.get_data());
                    const data = JSON.parse(txt);
                    callback(null, data, code);
                } catch (e) {
                    callback(e, null, code);
                }
            });
    }

    /* File an idea as a GitHub issue on the specified repository.
     * Calls callback(err, issueInfo, httpStatus) on completion. */
    fileIdea(repo, token, labels, title, body, cancellable, callback) {
        const msg = Soup.Message.new('POST', `https://api.github.com/repos/${repo}/issues`);
        if (!msg) {
            callback(new Error('INVALID_REPO'), null, 0);
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
            msg, GLib.PRIORITY_DEFAULT, cancellable, (session, res) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(res);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    callback(e, null, 0);
                    return;
                }
                const code = msg.get_status();
                let parsed = null;
                try {
                    parsed = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                } catch {
                    /* ignore parsing error on non-json error responses */
                }

                if (code === 201) {
                    callback(null, parsed, code);
                } else {
                    const errorMsg = parsed?.message || `HTTP ${code}`;
                    callback(new Error(errorMsg), parsed, code);
                }
            });
    }

    abort() {
        this._session?.abort();
        this._session = null;
    }
}

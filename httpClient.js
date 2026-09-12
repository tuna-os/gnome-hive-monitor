import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export const AGENT_URL = 'gnome-shell-hive-monitor/1';

export class HttpClient {
    constructor() {
        this._session = new Soup.Session({timeout: 15});
        this._session.user_agent = AGENT_URL;
    }

    fetchWidgetStatus(url, token, cancellable, callback) {
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
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
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
                    callback(null, JSON.parse(txt), code);
                } catch (e) {
                    callback(e, null, code);
                }
            });
    }

    fileGitHubIssue(repo, token, title, body, labels, cancellable, callback) {
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
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        callback(e, null, 0);
                    return;
                }
                const code = msg.get_status();
                const txt = new TextDecoder().decode(bytes.get_data());
                let parsed = null;
                try {
                    parsed = JSON.parse(txt);
                } catch { /* ignore parse error */ }

                callback(null, parsed, code);
            });
    }

    abort() {
        this._session?.abort();
        this._session = null;
    }
}

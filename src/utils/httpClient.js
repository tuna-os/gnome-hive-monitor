/* Shared Soup transport. Endpoint policy and translated messages stay in clients. */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export function isAuthError(status) {
    return status === 401 || status === 403;
}

export function isSuccessful(status) {
    return status >= 200 && status < 300;
}

/**
 * Send a JSON request using Soup 3's callback API (no global promisification).
 * body is a serialized JSON string; options.cancellable belongs to the caller.
 * Resolve transport, cancellation, invalid-URL and parse failures as distinct
 * outcomes so callers can preserve their endpoint-specific UI behavior.
 */
export async function makeRequest(session, method, url, headers = {}, body = null, options = {}) {
    const result = {status: 0, ok: false, data: null, error: null,
        parseError: null, cancelled: false, invalidUrl: false};
    try {
        const msg = Soup.Message.new(method, url);
        if (!msg)
            return {...result, invalidUrl: true, error: 'Invalid URL'};
        for (const [name, value] of Object.entries(headers))
            msg.request_headers.append(name, value);
        if (body !== null) {
            msg.set_request_body_from_bytes('application/json',
                new GLib.Bytes(new TextEncoder().encode(body)));
        }
        const bytes = await new Promise((resolve, reject) => {
            session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT,
                options.cancellable ?? null, (session_, res) => {
                    try {
                        resolve(session_.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
        result.status = msg.get_status();
        result.ok = isSuccessful(result.status);
        try {
            result.data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        } catch (e) {
            result.parseError = String(e.message ?? e);
        }
        if (!result.ok)
            result.error = result.data?.message || `HTTP ${result.status}`;
        return result;
    } catch (e) {
        return {...result, cancelled: Boolean(e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)),
            error: String(e.message ?? e)};
    }
}

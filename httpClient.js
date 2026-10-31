/* Shared Soup completion and JSON response classification.
 * Endpoint policy, request construction, and user-facing text stay in clients.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** Send a prepared message and report one structured outcome.
 * Cancellation is silent. successStatus is exact (200 for widget, 201 for issue).
 * JSON errors are retained separately: a successful POST may have an empty body.
 * Callback exceptions deliberately propagate rather than becoming parse errors.
 */
export function sendJsonRequest(session, cancellable, message, successStatus, onResult) {
    session.send_and_read_async(
        message, GLib.PRIORITY_DEFAULT, cancellable, (session_, res) => {
            let bytes;
            try {
                bytes = session_.send_and_read_finish(res);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    onResult({kind: 'network-error', error: String(e.message ?? e)});
                return;
            }

            const status = message.get_status();
            const kind = status === successStatus ? 'success'
                : status === 401 || status === 403 ? 'auth-error' : 'http-error';
            let data = null;
            let parseError = null;
            try {
                data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            } catch (e) {
                parseError = String(e.message ?? e);
            }
            const error = typeof data?.message === 'string' && data.message
                ? data.message : `HTTP ${status}`;
            onResult({kind, status, data, error, parseError});
        });
}

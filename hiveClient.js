/* hiveClient.js — HTTP transport for the hive's own status endpoint.
 *
 * Split out of extension.js (tuna-os/gnome-hive-monitor#30): this is the
 * only place that knows about `GET /api/widget`, the `X-Hive-Internal`
 * auth header, and how a hive's response maps onto success/auth/HTTP-error/
 * parse-error outcomes. HiveIndicator calls fetchWidgetStatus and reacts to
 * whichever outcome it gets; it does not itself touch Soup.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Fetch the hive's compact status widget.
 *
 * @param {Soup.Session} session - the extension's shared Soup session.
 * @param {Gio.Cancellable} cancellable - cancelled on extension disable().
 * @param {string} url - the hive base URL (no trailing slash), already
 *   validated non-empty by the caller.
 * @param {string} token - the X-Hive-Internal token, already validated
 *   non-empty by the caller.
 * @param {object} callbacks
 * @param {(data: object) => void} callbacks.onSuccess - called with the
 *   parsed {issues, prs, mode, running, paused, last_eval} JSON body on
 *   HTTP 200.
 * @param {(message: string) => void} callbacks.onInvalidUrl - called when
 *   Soup.Message.new() rejects url as unparsable. Kept distinct from
 *   onError because an invalid URL is an unconfigured-state, not a
 *   transient-error-state, in the caller's rendering.
 * @param {(short: string, detail: string) => void} callbacks.onError -
 *   called on a network error, an HTTP error status other than 401/403, or
 *   an unparsable body. Not called on cancellation.
 * @param {(short: string, detail: string) => void} callbacks.onAuthError -
 *   called specifically on HTTP 401/403, distinguished from onError because
 *   "unreachable" and "your token is wrong" need different fixes.
 */
export function fetchWidgetStatus(session, cancellable, url, token, {onSuccess, onInvalidUrl, onError, onAuthError}) {
    const msg = Soup.Message.new('GET', `${url}/api/widget`);
    if (!msg) {
        onInvalidUrl(_('That hive URL is not valid.'));
        return;
    }
    msg.request_headers.append('X-Hive-Internal', token);

    session.send_and_read_async(
        msg, GLib.PRIORITY_DEFAULT, cancellable, (session_, res) => {
            let bytes;
            try {
                bytes = session_.send_and_read_finish(res);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    console.error(`[HiveMonitor] Network error fetching widget status: ${e.message ?? e}`);
                    onError(_('Cannot reach the hive.'), String(e.message ?? e));
                }
                return;
            }
            const code = msg.get_status();
            if (code === 401 || code === 403) {
                // Distinguished on purpose: "unreachable" and "your token is
                // wrong" need different fixes, and a single generic error
                // sends people to debug the network for an auth problem.
                console.error(`[HiveMonitor] Authentication rejected by hive (HTTP ${code})`);
                onAuthError(_('Hive rejected the token.'),
                    _('Check the hive token in Settings (HTTP %d).').format(code));
                return;
            }
            if (code !== 200) {
                console.error(`[HiveMonitor] HTTP error from hive (HTTP ${code})`);
                onError(_('Hive returned HTTP %d.').format(code), '');
                return;
            }
            try {
                const txt = new TextDecoder().decode(bytes.get_data());
                const data = JSON.parse(txt);
                console.debug(`[HiveMonitor] Successfully updated status (mode: ${data.mode ?? 'unknown'}, issues: ${data.issues ?? 0}, prs: ${data.prs ?? 0})`);
                onSuccess(data);
            } catch (e) {
                console.error(`[HiveMonitor] Failed to parse hive JSON response: ${e.message ?? e}`);
                onError(_('Unreadable response.'), String(e.message ?? e));
            }
        });
}

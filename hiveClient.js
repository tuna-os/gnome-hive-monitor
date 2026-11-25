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

/* The largest status reply that is read.
 *
 * A status reply is a few short fields, well under 1 KiB. The extension runs
 * inside GNOME Shell, so every byte of a reply that is held in memory is held
 * in the memory of the Shell, and a reply that does not fit ends the session.
 * The limit applies twice: to the bytes that arrive, and to the bytes Soup
 * hands over after it has decoded a compressed reply. A few megabytes of
 * gzip unpack to gigabytes. */
const MAX_REPLY_BYTES = 64 * 1024;

/* Read a reply body, but never more than `limit` bytes of it.
 *
 * Calls done(error, body) once. `body` is a Uint8Array, or null when the body
 * is longer than `limit`; the rest of such a body is not read. `error` is set
 * when a read fails or is cancelled, and `body` is then null. */
function readLimited(stream, cancellable, limit, done) {
    const chunks = [];
    let size = 0;
    const readNext = () => {
        // One byte more than the limit is enough to know the body is too long.
        stream.read_bytes_async(limit + 1 - size, GLib.PRIORITY_DEFAULT, cancellable, (stream_, res) => {
            let chunk;
            try {
                chunk = stream_.read_bytes_finish(res);
            } catch (e) {
                done(e, null);
                return;
            }
            const length = chunk.get_size();
            if (length === 0) {
                const body = new Uint8Array(size);
                let offset = 0;
                for (const part of chunks) {
                    body.set(part, offset);
                    offset += part.length;
                }
                done(null, body);
                return;
            }
            size += length;
            if (size > limit) {
                done(null, null);
                return;
            }
            chunks.push(chunk.get_data());
            readNext();
        });
    };
    readNext();
}

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
 *   called on a network error, a redirect (never followed), an HTTP error
 *   status other than 401/403, or an unparsable body. Not called on
 *   cancellation.
 * @param {(short: string, detail: string) => void} callbacks.onAuthError -
 *   called specifically on HTTP 401/403, distinguished from onError because
 *   "unreachable" and "your token is wrong" need different fixes.
 */
export function fetchWidgetStatus(session, cancellable, url, token, {onSuccess, onInvalidUrl, onError, onAuthError}) {
    // Enforce HTTPS for token security (CWE-295 / tuna-os/gnome-hive-monitor#60)
    if (!url.startsWith('https://')) {
        onInvalidUrl(_('Hive URL must use HTTPS (https://...), not HTTP.'));
        return;
    }
    
    const msg = Soup.Message.new('GET', `${url}/api/widget`);
    if (!msg) {
        onInvalidUrl(_('That hive URL is not valid.'));
        return;
    }
    msg.request_headers.append('X-Hive-Internal', token);
    // Soup follows a redirected GET to any http(s) address and sends the
    // same request headers again, so a redirect would carry the token to an
    // address the HTTPS check above never saw. Stop at the first reply.
    msg.add_flags(Soup.MessageFlags.NO_REDIRECT);

    // HTTP/1.1, where Soup takes a body from the socket only when it is
    // read, so a sender cannot deliver faster than the limit below lets it.
    // On HTTP/2 Soup stores all that arrives, read or not. Soup before 3.4
    // has no such switch.
    msg.set_force_http1?.(true);

    // A cancellable for this request alone: a reply that is too long is
    // ended here, and the caller's cancellable still ends it from outside.
    const own = new Gio.Cancellable();
    const link = cancellable.connect(() => own.cancel());
    let tooLong = false;
    let arrived = 0;
    // Soup itself collects the whole body of some replies (401, 407, 421)
    // before it reports them. This count is the only limit on those.
    msg.connect('got-body-data', (msg_, length) => {
        arrived += length;
        if (arrived > MAX_REPLY_BYTES) {
            tooLong = true;
            own.cancel();
        }
    });

    // Every outcome ends here. Closing the stream ends a transfer whose body
    // was not read to its end.
    const finish = stream => {
        if (link)
            cancellable.disconnect(link);
        stream?.close_async(GLib.PRIORITY_DEFAULT, null, null);
    };
    const replyTooLong = () => {
        console.error(`[HiveMonitor] Hive status reply is longer than ${MAX_REPLY_BYTES} bytes; not read`);
        onError(_('Unreadable response.'),
            _('The reply is longer than %d bytes.').format(MAX_REPLY_BYTES));
    };
    const failed = e => {
        if (tooLong) {
            replyTooLong();
            return;
        }
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            console.error(`[HiveMonitor] Network error fetching widget status: ${e.message ?? e}`);
            onError(_('Cannot reach the hive.'), String(e.message ?? e));
        }
    };

    // send_async, not send_and_read_async: the second one collects the whole
    // body, of any size and of any status, before it calls back.
    session.send_async(
        msg, GLib.PRIORITY_DEFAULT, own, (session_, res) => {
            let stream;
            try {
                stream = session_.send_finish(res);
            } catch (e) {
                finish(null);
                failed(e);
                return;
            }
            const code = msg.get_status();
            if (code !== 200) {
                // The status says it all. The body is not read.
                finish(stream);
            }
            if (code === 401 || code === 403) {
                // Distinguished on purpose: "unreachable" and "your token is
                // wrong" need different fixes, and a single generic error
                // sends people to debug the network for an auth problem.
                console.error(`[HiveMonitor] Authentication rejected by hive (HTTP ${code})`);
                onAuthError(_('Hive rejected the token.'),
                    _('Check the hive token in Settings (HTTP %d).').format(code));
                return;
            }
            if (code >= 300 && code < 400) {
                // Named on purpose: the fix is a different address in
                // Settings, which a bare status code does not suggest.
                console.error(`[HiveMonitor] Hive redirected the status request (HTTP ${code}); not followed`);
                onError(_('Hive redirected the request (HTTP %d).').format(code),
                    _('Set the final HTTPS address of the hive in Settings.'));
                return;
            }
            if (code !== 200) {
                console.error(`[HiveMonitor] HTTP error from hive (HTTP ${code})`);
                onError(_('Hive returned HTTP %d.').format(code), '');
                return;
            }
            readLimited(stream, own, MAX_REPLY_BYTES, (error, body) => {
                finish(stream);
                if (error) {
                    failed(error);
                    return;
                }
                if (body === null) {
                    replyTooLong();
                    return;
                }
                try {
                    const txt = new TextDecoder().decode(body);
                    const data = JSON.parse(txt);
                    console.debug(`[HiveMonitor] Successfully updated status (mode: ${data.mode ?? 'unknown'}, issues: ${data.issues ?? 0}, prs: ${data.prs ?? 0})`);
                    onSuccess(data);
                } catch (e) {
                    console.error(`[HiveMonitor] Failed to parse hive JSON response: ${e.message ?? e}`);
                    onError(_('Unreadable response.'), String(e.message ?? e));
                }
            });
        });
}

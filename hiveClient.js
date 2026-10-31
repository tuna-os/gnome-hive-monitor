/* hiveClient.js — HTTP transport for the hive's own status endpoint.
 *
 * Split out of extension.js (tuna-os/gnome-hive-monitor#30): this is the
 * only place that knows about `GET /api/widget`, the `X-Hive-Internal`
 * auth header, and how a hive's response maps onto success/auth/HTTP-error/
 * parse-error outcomes. HiveIndicator calls fetchWidgetStatus and reacts to
 * whichever outcome it gets; it does not itself touch Soup.
 */

import Soup from 'gi://Soup?version=3.0';

import {sendJsonRequest} from './httpClient.js';

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

    sendJsonRequest(session, cancellable, msg, 200, result => {
        if (result.kind === 'network-error') {
            console.error(`[HiveMonitor] Network error fetching widget status: ${result.error}`);
            onError(_('Cannot reach the hive.'), result.error);
        } else if (result.kind === 'auth-error') {
            console.error(`[HiveMonitor] Authentication rejected by hive (HTTP ${result.status})`);
            onAuthError(_('Hive rejected the token.'),
                _('Check the hive token in Settings (HTTP %d).').format(result.status));
        } else if (result.kind === 'http-error') {
            console.error(`[HiveMonitor] HTTP error from hive (HTTP ${result.status})`);
            onError(_('Hive returned HTTP %d.').format(result.status), '');
        } else if (result.parseError) {
            console.error(`[HiveMonitor] Failed to parse hive JSON response: ${result.parseError}`);
            onError(_('Unreadable response.'), result.parseError);
        } else {
            const data = result.data;
            console.debug(`[HiveMonitor] Successfully updated status (mode: ${data?.mode ?? 'unknown'}, issues: ${data?.issues ?? 0}, prs: ${data?.prs ?? 0})`);
            onSuccess(data);
        }
    });
}

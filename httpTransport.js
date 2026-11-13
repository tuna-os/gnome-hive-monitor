/* httpTransport.js — Shared HTTP transport and error handling.
 *
 * Encapsulates Soup async request dispatch, cancellation checks, bytes
 * decoding, JSON parsing, and response/error classification across API
 * clients (tuna-os/gnome-hive-monitor#68).
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Check whether an HTTP status code represents an authentication rejection (401 or 403).
 *
 * @param {number} status - HTTP status code.
 * @returns {boolean} true if status is 401 or 403.
 */
export function isAuthStatus(status) {
    return status === 401 || status === 403;
}

/**
 * Check whether an HTTP status code represents a successful response (2xx).
 *
 * @param {number} status - HTTP status code.
 * @returns {boolean} true if status is between 200 and 299 inclusive.
 */
export function isSuccessStatus(status) {
    return status >= 200 && status < 300;
}

/**
 * Safely decode response body bytes into a UTF-8 string.
 *
 * @param {GLib.Bytes|null} bytes - GLib.Bytes from Soup.
 * @returns {string} decoded UTF-8 string.
 */
export function decodeBytes(bytes) {
    if (!bytes)
        return '';
    try {
        return new TextDecoder().decode(bytes.get_data());
    } catch {
        return '';
    }
}

/**
 * Parse JSON from response bytes, returning null on empty or parse failure.
 *
 * @param {GLib.Bytes|null} bytes - GLib.Bytes from Soup.
 * @returns {object|null} parsed JSON object or null.
 */
export function parseJson(bytes) {
    const text = decodeBytes(bytes);
    if (!text)
        return null;
    return JSON.parse(text);
}

/**
 * Dispatch an HTTP request using Soup, handling cancellation, network errors,
 * status code classification, and body decoding.
 *
 * @param {Soup.Session} session - the Soup session.
 * @param {Soup.Message} msg - the prepared Soup.Message.
 * @param {Gio.Cancellable|null} cancellable - cancellable to abort the request.
 * @param {object} [callbacks]
 * @param {number} [callbacks.expectedStatus] - status code for success (defaults to 2xx).
 * @param {(data: object|null, response: object) => void} [callbacks.onSuccess] - called on successful response.
 * @param {(status: number, response: object) => void} [callbacks.onAuthError] - called on 401/403 if provided.
 * @param {(status: number, response: object) => void} [callbacks.onHttpError] - called on non-success HTTP status.
 * @param {(error: Error, response: object) => void} [callbacks.onNetworkError] - called on transport/network error.
 * @param {(error: Error, response: object) => void} [callbacks.onParseError] - called when JSON parse fails on success.
 * @param {(response: object) => void} [callbacks.onError] - fallback for unhandled error conditions.
 * @param {() => void} [callbacks.onCancelled] - called if request was cancelled (silenced if omitted).
 * @returns {Promise<object>} response classification object.
 */
export function sendRequest(session, msg, cancellable, callbacks = {}) {
    return new Promise(resolve => {
        session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, cancellable, (session_, res) => {
                let bytes;
                try {
                    bytes = session_.send_and_read_finish(res);
                } catch (e) {
                    const isCancelled = Boolean(e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
                    if (isCancelled) {
                        callbacks.onCancelled?.();
                        resolve({
                            status: 0,
                            ok: false,
                            isAuth: false,
                            cancelled: true,
                            data: null,
                            text: '',
                            bytes: null,
                            error: e,
                            parseError: null,
                        });
                        return;
                    }

                    const outcome = {
                        type: 'network',
                        status: 0,
                        ok: false,
                        isAuth: false,
                        cancelled: false,
                        data: null,
                        text: '',
                        bytes: null,
                        error: e,
                        parseError: null,
                    };
                    if (callbacks.onNetworkError)
                        callbacks.onNetworkError(e, outcome);
                    else if (callbacks.onError)
                        callbacks.onError(outcome);

                    resolve(outcome);
                    return;
                }

                const status = msg.get_status();
                const isAuth = isAuthStatus(status);
                let text = '';
                let data = null;
                let parseError = null;

                if (bytes) {
                    text = decodeBytes(bytes);
                    if (text) {
                        try {
                            data = JSON.parse(text);
                        } catch (e) {
                            parseError = e;
                        }
                    }
                }

                const expectedStatus = callbacks.expectedStatus;
                const isSuccess = expectedStatus !== undefined
                    ? status === expectedStatus
                    : isSuccessStatus(status);

                const outcome = {
                    status,
                    ok: isSuccess,
                    isAuth,
                    cancelled: false,
                    data,
                    text,
                    bytes,
                    error: null,
                    parseError,
                };

                // 1. Auth error (HTTP 401 or 403)
                if (isAuth && callbacks.onAuthError) {
                    callbacks.onAuthError(status, outcome);
                    resolve(outcome);
                    return;
                }

                // 2. Success case
                if (isSuccess) {
                    if (parseError && callbacks.onParseError) {
                        callbacks.onParseError(parseError, outcome);
                        resolve(outcome);
                        return;
                    }
                    callbacks.onSuccess?.(data, outcome);
                    resolve(outcome);
                    return;
                }

                // 3. HTTP error (or auth error when onAuthError is not provided)
                if (callbacks.onHttpError)
                    callbacks.onHttpError(status, outcome);
                else if (callbacks.onError)
                    callbacks.onError(outcome);

                resolve(outcome);
            }
        );
    });
}

/* httpUtils.js — Shared HTTP error handling for Soup clients.
 *
 * Extracted to eliminate duplication between githubClient and hiveClient
 * (tuna-os/gnome-hive-monitor#54): both modules repeat identical patterns for
 * network error detection, JSON parsing, and console logging.
 *
 * This module provides a single place to fix error-handling bugs and to add
 * consistent error classification across all HTTP clients.
 */

import Gio from 'gi://Gio';

/**
 * Error classification for HTTP operations.
 *
 * Allows callers to distinguish recoverable network errors (retry-able)
 * from auth errors (needs config) from parse errors (data bug).
 */
export class HttpError extends Error {
    /**
     * Create an HttpError.
     *
     * @param {string} type - 'cancelled'|'network'|'http'|'parse'.
     * @param {string} message - User-facing error message.
     * @param {string} [detail] - Technical detail (HTTP status, exception message, etc).
     */
    constructor(type, message, detail = '') {
        super(message);
        this.name = 'HttpError';
        this.type = type;
        this.detail = detail;
    }
}

/**
 * Handle a Soup send_and_read_finish() error or success.
 *
 * @param {*} session_ - the Soup.Session from the async callback.
 * @param {*} res - the Gio.AsyncResult from the async callback.
 * @returns {GLib.Bytes} the response body bytes.
 * @throws {HttpError} on cancellation, network error, or Soup failure.
 */
export function handleSoupFinish(session_, res) {
    try {
        return session_.send_and_read_finish(res);
    } catch (e) {
        // Cancellation is not an error; the caller can silence it if needed.
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            throw new HttpError('cancelled', 'Request cancelled');
        }
        // Any other exception from Soup is a network or transport layer failure.
        throw new HttpError('network', e.message ?? String(e), e.message);
    }
}

/**
 * Parse JSON from response bytes.
 *
 * @param {GLib.Bytes} bytes - the response body.
 * @returns {object} the parsed JSON.
 * @throws {HttpError} on parse failure.
 */
export function parseJson(bytes) {
    try {
        const txt = new TextDecoder().decode(bytes.get_data());
        return JSON.parse(txt);
    } catch (e) {
        throw new HttpError('parse', e.message ?? String(e), e.message);
    }
}

/**
 * Check an HTTP status code and throw if it indicates an error.
 *
 * @param {number} code - the HTTP status code.
 * @param {string} [details] - the response body (for error messages).
 * @throws {HttpError} on non-2xx status.
 */
export function checkHttpStatus(code, details = '') {
    if (code >= 200 && code < 300)
        return; // Success; do nothing.

    throw new HttpError('http', `HTTP ${code}`, details);
}

// Run with node --test tests/test_http_client.mjs; no GNOME session required.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = (await readFile(new URL('../httpClient.js', import.meta.url), 'utf8'))
    .replace("import Gio from 'gi://Gio';", 'const Gio = {IOErrorEnum: {CANCELLED: 1}};')
    .replace("import GLib from 'gi://GLib';", 'const GLib = {PRIORITY_DEFAULT: 0};');
const {sendJsonRequest} = await import(`data:text/javascript,${encodeURIComponent(source)}`);

function request(status, body, successStatus = 200, failure = null) {
    const results = [];
    const cancellable = {};
    const message = {get_status: () => status};
    const session = {
        send_and_read_async(msg, priority, cancel, callback) {
            assert.equal(msg, message);
            assert.equal(cancel, cancellable);
            callback(this, {});
        },
        send_and_read_finish() {
            if (failure) throw failure;
            return {get_data: () => new TextEncoder().encode(body)};
        },
    };
    sendJsonRequest(session, cancellable, message, successStatus, result => results.push(result));
    return results;
}

test('endpoint-specific success status and JSON data', () => {
    assert.deepEqual(request(200, '{"issues":3}')[0].data, {issues: 3});
    assert.equal(request(201, '{}', 201)[0].kind, 'success');
    assert.equal(request(200, '{}', 201)[0].kind, 'http-error');
});
test('auth and other HTTP errors retain API message or status fallback', () => {
    for (const status of [401, 403])
        assert.equal(request(status, '{}')[0].kind, 'auth-error');
    assert.equal(request(422, '{"message":"Validation failed"}')[0].error, 'Validation failed');
    for (const body of ['bad JSON', '{}', 'null', '{"message":42}'])
        assert.equal(request(503, body)[0].error, 'HTTP 503');
});
test('malformed success body remains distinguishable from failed HTTP request', () => {
    const result = request(201, '', 201)[0];
    assert.equal(result.kind, 'success');
    assert.ok(result.parseError);
    assert.equal(result.data, null);
});
test('network failures report once and cancellation stays silent', () => {
    assert.deepEqual(request(0, '', 200, new Error('offline')),
        [{kind: 'network-error', error: 'offline'}]);
    assert.deepEqual(request(0, '', 200, {matches: (_, code) => code === 1}), []);
});

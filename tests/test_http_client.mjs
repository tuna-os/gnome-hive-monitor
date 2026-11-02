import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let message;
const cancelled = {matches: () => true, message: 'cancelled'};
globalThis.httpMocks = {
    Gio: {IOErrorEnum: {CANCELLED: 1}},
    GLib: {PRIORITY_DEFAULT: 0, Bytes: class {constructor(data) {this.data = data;}}},
    Soup: {Message: {new(method, url) {
        if (url === 'invalid')
            return null;
        message = {method, url, headers: {}, status: 200,
            request_headers: {append(name, value) {message.headers[name] = value;}},
            set_request_body_from_bytes(type, bytes) {this.body = bytes.data; this.type = type;},
            get_status() {return this.status;}};
        return message;
    }}},
};
const source = (await readFile(new URL('../src/utils/httpClient.js', import.meta.url), 'utf8'))
    .replace(/^import (\w+) from 'gi:[^']+';$/gm, 'const $1 = globalThis.httpMocks.$1;');
const {makeRequest, isAuthError, isSuccessful} = await import(`data:text/javascript,${encodeURIComponent(source)}`);
function session(status, body, failure) {
    return {
        send_and_read_async(msg, priority, cancellable, callback) {
            this.cancellable = cancellable;
            msg.status = status;
            callback(this, {});
        },
        send_and_read_finish() {
            if (failure)
                throw failure;
            return {get_data: () => new TextEncoder().encode(body)};
        },
    };
}
const token = {};
const transport = session(201, '{"number":42}');
let result = await makeRequest(transport, 'POST', 'https://example.test',
    {Authorization: 'Bearer test'}, '{"title":"idea"}', {cancellable: token});
assert.equal(result.ok, true);
assert.equal(result.data.number, 42);
assert.equal(message.method, 'POST');
assert.equal(message.headers.Authorization, 'Bearer test');
assert.equal(message.type, 'application/json');
assert.equal(new TextDecoder().decode(message.body), '{"title":"idea"}');
assert.equal(transport.cancellable, token);
for (const status of [401, 403, 500]) {
    result = await makeRequest(session(status, '{"message":"refused"}'), 'GET', 'https://example.test');
    assert.equal(result.status, status);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'refused');
}
result = await makeRequest(session(502, '<html>'), 'GET', 'https://example.test');
assert.equal(result.error, 'HTTP 502');
assert.ok(result.parseError);
result = await makeRequest(session(201, 'broken'), 'POST', 'https://example.test');
assert.equal(result.ok, true); // POST succeeded even if its response cannot be parsed.
assert.ok(result.parseError);
result = await makeRequest(session(0, '', new Error('offline')), 'GET', 'https://example.test');
assert.equal(result.status, 0);
assert.equal(result.error, 'offline');
result = await makeRequest(session(0, '', cancelled), 'GET', 'https://example.test');
assert.equal(result.cancelled, true);
result = await makeRequest(session(200, '{}'), 'GET', 'invalid');
assert.equal(result.invalidUrl, true);
assert.equal(isAuthError(401), true);
assert.equal(isAuthError(403), true);
assert.equal(isAuthError(500), false);
for (const status of [199, 300, 500])
    assert.equal(isSuccessful(status), false);
for (const status of [200, 201, 299])
    assert.equal(isSuccessful(status), true);
console.log('HTTP client tests passed');

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const cancelledError = {
    matches(enumType, enumVal) {
        return enumVal === 1;
    },
    message: 'Operation was cancelled',
};

globalThis.httpMocks = {
    Gio: {
        IOErrorEnum: {
            CANCELLED: 1,
        },
    },
    GLib: {
        PRIORITY_DEFAULT: 0,
        Bytes: class {
            constructor(data) {
                this._data = data;
            }
            get_data() {
                return this._data;
            }
        },
    },
};

const rawSource = await readFile(new URL('../httpTransport.js', import.meta.url), 'utf8');
const transformedSource = rawSource.replace(
    /^import (\w+) from 'gi:[^']+';$/gm,
    'const $1 = globalThis.httpMocks.$1;'
);
const {
    isAuthStatus,
    isSuccessStatus,
    decodeBytes,
    parseJson,
    sendRequest,
} = await import(`data:text/javascript,${encodeURIComponent(transformedSource)}`);

function createMockSession({status = 200, body = '', finishError = null} = {}) {
    return {
        send_and_read_async(msg, priority, cancellable, callback) {
            this.msg = msg;
            this.priority = priority;
            this.cancellable = cancellable;
            callback(this, {});
        },
        send_and_read_finish() {
            if (finishError)
                throw finishError;
            return new globalThis.httpMocks.GLib.Bytes(new TextEncoder().encode(body));
        },
    };
}

function createMockMessage(status = 200) {
    return {
        get_status() {
            return status;
        },
    };
}

// 1. Test helper functions: isAuthStatus
assert.equal(isAuthStatus(401), true);
assert.equal(isAuthStatus(403), true);
assert.equal(isAuthStatus(200), false);
assert.equal(isAuthStatus(404), false);
assert.equal(isAuthStatus(500), false);

// 2. Test helper functions: isSuccessStatus
assert.equal(isSuccessStatus(200), true);
assert.equal(isSuccessStatus(201), true);
assert.equal(isSuccessStatus(204), true);
assert.equal(isSuccessStatus(299), true);
assert.equal(isSuccessStatus(199), false);
assert.equal(isSuccessStatus(301), false);
assert.equal(isSuccessStatus(400), false);
assert.equal(isSuccessStatus(500), false);

// 3. Test decodeBytes and parseJson
const testBytes = new globalThis.httpMocks.GLib.Bytes(new TextEncoder().encode('{"hello":"world"}'));
assert.equal(decodeBytes(testBytes), '{"hello":"world"}');
assert.equal(decodeBytes(null), '');
assert.deepEqual(parseJson(testBytes), {hello: 'world'});
assert.equal(parseJson(null), null);
assert.throws(() => parseJson(new globalThis.httpMocks.GLib.Bytes(new TextEncoder().encode('bad json'))), SyntaxError);

// 4. Test sendRequest: 200 Success with JSON
{
    const session = createMockSession({status: 200, body: '{"mode":"active","issues":5}'});
    const msg = createMockMessage(200);
    const cancellable = {};
    let successCalled = false;
    let receivedData = null;

    const res = await sendRequest(session, msg, cancellable, {
        onSuccess: (data) => {
            successCalled = true;
            receivedData = data;
        },
    });

    assert.equal(successCalled, true);
    assert.deepEqual(receivedData, {mode: 'active', issues: 5});
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.cancelled, false);
}

// 5. Test sendRequest: expectedStatus (e.g. 201 for GitHub issue creation)
{
    const session = createMockSession({status: 201, body: '{"number":42,"html_url":"https://github.com/test/42"}'});
    const msg = createMockMessage(201);
    let successCalled = false;
    let dataReceived = null;

    const res = await sendRequest(session, msg, null, {
        expectedStatus: 201,
        onSuccess: (data) => {
            successCalled = true;
            dataReceived = data;
        },
    });

    assert.equal(successCalled, true);
    assert.equal(dataReceived.number, 42);
    assert.equal(res.ok, true);
    assert.equal(res.status, 201);
}

// 6. Test sendRequest: 201 with malformed JSON body (GitHub: issue created regardless)
{
    const session = createMockSession({status: 201, body: 'not-json'});
    const msg = createMockMessage(201);
    let successCalled = false;
    let dataReceived = 'not-called';

    const res = await sendRequest(session, msg, null, {
        expectedStatus: 201,
        onSuccess: (data) => {
            successCalled = true;
            dataReceived = data;
        },
    });

    assert.equal(successCalled, true);
    assert.equal(dataReceived, null);
    assert.equal(res.ok, true);
    assert.ok(res.parseError);
}

// 7. Test sendRequest: 200 with malformed JSON body when onParseError is provided (Hive: unreadable response)
{
    const session = createMockSession({status: 200, body: '<html>error</html>'});
    const msg = createMockMessage(200);
    let parseErrorCalled = false;
    let successCalled = false;

    const res = await sendRequest(session, msg, null, {
        expectedStatus: 200,
        onSuccess: () => {
            successCalled = true;
        },
        onParseError: () => {
            parseErrorCalled = true;
        },
    });

    assert.equal(successCalled, false);
    assert.equal(parseErrorCalled, true);
    assert.ok(res.parseError);
}

// 8. Test sendRequest: Auth Error (401 and 403) with onAuthError
{
    for (const code of [401, 403]) {
        const session = createMockSession({status: code, body: 'Unauthorized'});
        const msg = createMockMessage(code);
        let authErrorCalled = false;
        let httpErrorCalled = false;
        let authStatusCode = 0;

        const res = await sendRequest(session, msg, null, {
            onAuthError: (status) => {
                authErrorCalled = true;
                authStatusCode = status;
            },
            onHttpError: () => {
                httpErrorCalled = true;
            },
        });

        assert.equal(authErrorCalled, true);
        assert.equal(httpErrorCalled, false);
        assert.equal(authStatusCode, code);
        assert.equal(res.isAuth, true);
        assert.equal(res.ok, false);
    }
}

// 9. Test sendRequest: Auth Error (401/403) without onAuthError falls back to onHttpError
{
    const session = createMockSession({status: 403, body: '{"message":"Bad credentials"}'});
    const msg = createMockMessage(403);
    let httpErrorCalled = false;
    let httpStatus = 0;
    let httpData = null;

    const res = await sendRequest(session, msg, null, {
        onHttpError: (status, {data}) => {
            httpErrorCalled = true;
            httpStatus = status;
            httpData = data;
        },
    });

    assert.equal(httpErrorCalled, true);
    assert.equal(httpStatus, 403);
    assert.deepEqual(httpData, {message: 'Bad credentials'});
}

// 10. Test sendRequest: Non-Auth HTTP Error (e.g. 500)
{
    const session = createMockSession({status: 500, body: 'Server Error'});
    const msg = createMockMessage(500);
    let httpErrorCalled = false;
    let httpStatus = 0;

    const res = await sendRequest(session, msg, null, {
        onHttpError: (status) => {
            httpErrorCalled = true;
            httpStatus = status;
        },
    });

    assert.equal(httpErrorCalled, true);
    assert.equal(httpStatus, 500);
    assert.equal(res.ok, false);
    assert.equal(res.isAuth, false);
}

// 11. Test sendRequest: Network Error (exception thrown during send_and_read_finish)
{
    const session = createMockSession({finishError: new Error('Network unreachable')});
    const msg = createMockMessage(0);
    let networkErrorCalled = false;
    let caughtError = null;

    const res = await sendRequest(session, msg, null, {
        onNetworkError: (err) => {
            networkErrorCalled = true;
            caughtError = err;
        },
    });

    assert.equal(networkErrorCalled, true);
    assert.equal(caughtError.message, 'Network unreachable');
    assert.equal(res.cancelled, false);
    assert.equal(res.type, 'network');
}

// 12. Test sendRequest: Cancellation (Gio.IOErrorEnum.CANCELLED)
{
    const session = createMockSession({finishError: cancelledError});
    const msg = createMockMessage(0);
    let networkErrorCalled = false;
    let successCalled = false;
    let cancelledCalled = false;

    const res = await sendRequest(session, msg, null, {
        onSuccess: () => {
            successCalled = true;
        },
        onNetworkError: () => {
            networkErrorCalled = true;
        },
        onCancelled: () => {
            cancelledCalled = true;
        },
    });

    assert.equal(networkErrorCalled, false, 'Cancellation must not trigger network error');
    assert.equal(successCalled, false, 'Cancellation must not trigger success');
    assert.equal(cancelledCalled, true);
    assert.equal(res.cancelled, true);
}

// 13. Test sendRequest: Cancellation without onCancelled silently completes
{
    const session = createMockSession({finishError: cancelledError});
    const msg = createMockMessage(0);
    let anyCallbackCalled = false;

    const res = await sendRequest(session, msg, null, {
        onSuccess: () => { anyCallbackCalled = true; },
        onError: () => { anyCallbackCalled = true; },
        onNetworkError: () => { anyCallbackCalled = true; },
        onHttpError: () => { anyCallbackCalled = true; },
        onAuthError: () => { anyCallbackCalled = true; },
    });

    assert.equal(anyCallbackCalled, false, 'Cancellation without onCancelled must be completely silent');
    assert.equal(res.cancelled, true);
}

console.log('All httpTransport tests passed successfully!');

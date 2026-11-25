// What the GitHub issue request carries and what the user is told about each
// reply. behavior.cjs checks which callback runs; this file checks the
// request's headers and body and the text passed to onFiled and onError.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runtime} = require('./gnome-runtime.cjs');

const SIGNATURE = '— filed from the GNOME Hive Monitor';

async function file(r, {body = 'Body', reply}) {
    const calls = [];
    r.github.fileIssue(r.indicator._session, r.indicator._ideaCancel,
        'o/n', 'token', ['idea'], 'Title', body, {
            onFiled: (...args) => calls.push(['filed', ...args]),
            onError: (...args) => calls.push(['error', ...args]),
        });
    const request = r.requests.at(-1);
    reply?.(request);
    return {calls, request};
}

test('the issue request names the API version, a User-Agent and the token', async () => {
    const r = await runtime();
    const {request} = await file(r, {});
    assert.equal(request.msg.headers.Authorization, 'Bearer token');
    assert.equal(request.msg.headers.Accept, 'application/vnd.github+json');
    // GitHub 403s a request with no User-Agent, which reads as a bad token.
    assert.match(request.msg.headers['User-Agent'], /\S/);
});

test('the issue body keeps the idea text and ends with the signature', async () => {
    const r = await runtime();
    const body = request => JSON.parse(new TextDecoder().decode(request.msg.body.data)).body;
    assert.equal(body((await file(r, {body: 'Idea text'})).request), `Idea text\n\n${SIGNATURE}`);
    // No idea text: the signature stands alone, with no leading blank lines.
    assert.equal(body((await file(r, {body: ''})).request), SIGNATURE);
});

test('a filed idea reports its number and address, or neither when the reply omits them', async () => {
    const r = await runtime();
    for (const [reply, number, url] of [
        ['{"number":7,"html_url":"https://github.com/o/n/issues/7"}', '#7', 'https://github.com/o/n/issues/7'],
        ['{"html_url":"https://github.com/o/n/issues/7"}', '', 'https://github.com/o/n/issues/7'],
        ['{"number":7}', '#7', null],
        ['{}', '', null],
    ]) {
        const {calls} = await file(r, {reply: request => request.reply(201, reply)});
        assert.deepEqual(calls, [['filed', number, url]], reply);
    }
});

test('a refused idea reports GitHub’s message, else the HTTP status', async () => {
    const r = await runtime();
    for (const [code, reply, expected] of [
        [422, '{"message":"Validation Failed"}', 'GitHub refused the idea: Validation Failed'],
        [401, '{"message":"Bad credentials"}', 'GitHub refused the idea: Bad credentials'],
        [404, '{"documentation_url":"x"}', 'GitHub refused the idea: HTTP 404'],
        [500, 'not json', 'GitHub refused the idea: HTTP 500'],
    ]) {
        const {calls} = await file(r, {reply: request => request.reply(code, reply)});
        assert.deepEqual(calls, [['error', expected]], `${code} ${reply}`);
    }
});

test('a network failure reports its message, and a missing message reports the error itself', async () => {
    const r = await runtime();
    for (const [error, expected] of [
        [new Error('offline'), 'Could not file the idea: offline'],
        ['reset by peer', 'Could not file the idea: reset by peer'],
    ]) {
        const {calls} = await file(r, {reply: request => request.reply(0, '', error)});
        assert.deepEqual(calls, [['error', expected]]);
    }
});

test('an unparsable owner/name reports the value it refused', async () => {
    const r = await runtime();
    const calls = [];
    r.github.fileIssue(r.indicator._session, r.indicator._ideaCancel,
        'o/n#x', 'token', [], 'Title', '', {
            onFiled: () => calls.push('filed'),
            onError: message => calls.push(message),
        });
    assert.deepEqual(calls, ['“o/n#x” is not a valid owner/name.']);
});

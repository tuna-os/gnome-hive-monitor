// Execute the production ESM graph; only GNOME platform imports are doubles.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {runtime} = require('./gnome-runtime.cjs');

test('repository validation executes the guard before sending credentials', async () => {
    const r = await runtime();
    for (const repo of ['owner/name', 'a/b', 'x-y/a_b-c.d', 'A0/z9'])
        assert.equal(r.github.isValidRepo(repo), true, repo);
    for (const repo of ['', null, 4, 'o/..', 'o/.', 'o/n/issues', 'o/n?x',
        'o/n#x', 'o/n\n', '-o/n', 'a'.repeat(600) + '/b']) {
        assert.equal(r.github.isValidRepo(repo), false, String(repo));
        const before = r.requests.length;
        let errors = 0;
        r.github.fileIssue(r.indicator._session, r.indicator._ideaCancel,
            repo, 'secret', [], 'title', '', {onError() { errors++; }});
        assert.equal(errors, 1);
        assert.equal(r.requests.length, before);
    }
});

test('settings replace status ownership, preserve idea POST, and gate late replies', async () => {
    const r = await runtime();
    const old = r.requests[0];
    r.indicator._fileIdea('o/n', 'github', 'title', 'body');
    const idea = r.requests[1];
    assert.notEqual(old.cancel, idea.cancel);
    r.change('hive-token', 'new-token');
    assert.equal(old.cancel.cancelled, true);
    assert.equal(idea.cancel.cancelled, undefined);
    const fresh = r.requests[2];
    assert.equal(fresh.msg.headers['X-Hive-Internal'], 'new-token');
    fresh.reply(200, '{"mode":"busy","issues":3,"prs":2}');
    assert.equal(r.indicator._label.text, 'BUSY 3/2');
    for (const [code, body, error] of [[200, '{"mode":"old"}'], [401, ''],
        [500, ''], [200, 'bad'], [0, '', new Error('offline')]]) {
        old.reply(code, body, error);
        assert.equal(r.indicator._label.text, 'BUSY 3/2');
    }
    r.ext.disable();
    assert.equal(fresh.cancel.cancelled, true);
    assert.equal(idea.cancel.cancelled, true);
});

test('relative time uses production JavaScript rounding and invalid-date behavior', async () => {
    const {indicator} = await runtime();
    // Freeze the module realm clock, including half-second rounding boundaries.
    const now = 1700000000000;
    for (const [seconds, expected] of [[-10, '0s ago'], [0, '0s ago'],
        [45, '45s ago'], [0.5, '1s ago'], [59.5, '1m ago'], [60, '1m ago'], [90, '2m ago'],
        [3599, '60m ago'], [3600, '1h ago'], [86400, '24h ago']]) {
        assert.equal(indicator._ago(new Date(now - seconds * 1000).toISOString()), expected);
    }
    assert.equal(indicator._ago('invalid'), 'invalid');
});

test('HTTP status callback contract: success, auth, HTTP, JSON, network, cancellation', async () => {
    const r = await runtime();
    for (const [code, body, error, expected] of [
        [200, '{"issues":7}', null, 'onSuccess'],
        [401, '', null, 'onAuthError'], [403, '', null, 'onAuthError'],
        [500, '', null, 'onError'], [200, 'bad', null, 'onError'],
        [0, '', new Error('offline'), 'onError'],
        [0, '', {matches: () => true}, null]]) {
        const calls = [];
        const callbacks = Object.fromEntries(['onSuccess', 'onAuthError', 'onError', 'onInvalidUrl']
            .map(name => [name, (...args) => calls.push([name, ...args])]));
        r.hive.fetchWidgetStatus(r.indicator._session, r.indicator._statusCancel,
            'https://hive.example', 'token', callbacks);
        r.requests.at(-1).reply(code, body, error);
        assert.deepEqual(calls.map(call => call[0]), expected ? [expected] : []);
        if (expected === 'onSuccess') assert.equal(calls[0][1].issues, 7);
    }
});

test('GitHub POST serializes payload and maps filed, malformed, refused and cancelled replies', async () => {
    const r = await runtime();
    for (const [code, body, error, expected] of [
        [201, '{"number":42,"html_url":"https://github.com/o/n/issues/42"}', null, 'filed'],
        [201, 'bad', null, 'filed'], [422, '{"message":"denied"}', null, 'error'],
        [500, 'bad', null, 'error'], [0, '', new Error('offline'), 'error'],
        [0, '', {matches: () => true}, null]]) {
        const calls = [];
        r.github.fileIssue(r.indicator._session, r.indicator._ideaCancel,
            'o/n', 'token', ['idea'], 'Title', 'Body', {
                onFiled: (...args) => calls.push(['filed', ...args]),
                onError: (...args) => calls.push(['error', ...args]),
            });
        const request = r.requests.at(-1);
        assert.equal(request.msg.method, 'POST');
        assert.equal(request.msg.url, 'https://api.github.com/repos/o/n/issues');
        assert.equal(request.msg.headers.Authorization, 'Bearer token');
        const payload = JSON.parse(new TextDecoder().decode(request.msg.body.data));
        assert.equal(payload.title, 'Title');
        assert.deepEqual(payload.labels, ['idea']);
        request.reply(code, body, error);
        assert.deepEqual(calls.map(call => call[0]), expected ? [expected] : []);
        if (code === 201 && body !== 'bad') assert.equal(calls[0][1], '#42');
    }
});


test('overlapping polls render only the newest generation', async () => {
    const r = await runtime();
    r.indicator._refresh();
    r.indicator._refresh();
    r.requests[1].reply(200, '{"mode":"second"}');
    assert.equal(r.indicator._label.text, '…');
    r.requests[2].reply(200, '{"mode":"third"}');
    r.requests[0].reply(200, '{"mode":"first"}');
    assert.equal(r.indicator._label.text, 'THIRD 0/0');
});

test('invalid transport URLs call only onInvalidUrl without sending a request', async () => {
    const r = await runtime();
    for (const url of ['http://hive.example', 'https://invalid']) {
        const before = r.requests.length;
        const calls = [];
        const callbacks = Object.fromEntries(['onSuccess', 'onAuthError', 'onError', 'onInvalidUrl']
            .map(name => [name, () => calls.push(name)]));
        r.hive.fetchWidgetStatus(r.indicator._session, r.indicator._statusCancel,
            url, 'token', callbacks);
        assert.deepEqual(calls, ['onInvalidUrl']);
        assert.equal(r.requests.length, before);
    }
});

test('status request refuses redirects, so the token stays on the configured address', async () => {
    const r = await runtime();
    const noRedirect = r.Soup.MessageFlags.NO_REDIRECT;
    // The poll the indicator sent on enable carries the token and the flag.
    assert.equal(r.requests[0].msg.headers['X-Hive-Internal'], 'secret');
    assert.equal(r.requests[0].msg.flags & noRedirect, noRedirect);
    for (const code of [301, 302, 303, 307, 308]) {
        const calls = [];
        const callbacks = Object.fromEntries(['onSuccess', 'onAuthError', 'onError', 'onInvalidUrl']
            .map(name => [name, (...args) => calls.push([name, ...args])]));
        r.hive.fetchWidgetStatus(r.indicator._session, r.indicator._statusCancel,
            'https://hive.example', 'token', callbacks);
        const request = r.requests.at(-1);
        assert.equal(request.msg.flags & noRedirect, noRedirect);
        // A redirect is reported as itself, with the fix, not as a bare status.
        request.reply(code, '{"mode":"elsewhere"}');
        assert.deepEqual(calls, [['onError', `Hive redirected the request (HTTP ${code}).`,
            'Set the final HTTPS address of the hive in Settings.']]);
    }
});

test('the hive URL saves on apply, so a half-typed address is never sent the token', async () => {
    const r = await runtime();
    // "hive.example.co" is a registrable host on the way to "hive.example.com",
    // and port 443 of that host is not the hive on 8443.
    const final = 'https://hive.example.com:8443';
    // The saved address is on the same host, so the token stays with it.
    r.change('hive-url', `${final}/old`);
    const rows = await r.openPrefs();
    const before = r.requests.length;
    for (let i = 1; i <= final.length; i++)
        rows['Hive URL'].type(final.slice(0, i));
    assert.equal(r.values['hive-url'], `${final}/old`);
    assert.equal(r.requests.length, before);
    rows['Hive URL'].apply();
    assert.equal(r.values['hive-url'], final);
    assert.deepEqual(r.requests.slice(before).map(q => q.msg.url), [`${final}/api/widget`]);
    assert.equal(r.requests.at(-1).msg.headers['X-Hive-Internal'], 'secret');
});

test('a new hive host is not sent the token saved for the old one', async () => {
    const r = await runtime();
    const rows = await r.openPrefs();
    const sent = () => r.requests.map(q => [q.msg.url, q.msg.headers['X-Hive-Internal']]);
    const before = r.requests.length;
    // Another host, and the same host on another port: both are a different
    // server, and "secret" was entered for https://hive.example.
    for (const next of ['https://other.example', 'https://hive.example:8443', '']) {
        r.change('hive-token', 'secret');
        r.change('hive-url', 'https://hive.example');
        rows['Hive Token'].set_text('secret');
        const from = r.requests.length;
        const shown = r.toasts.length;
        rows['Hive URL'].type(next);
        rows['Hive URL'].apply();
        assert.equal(r.values['hive-url'], next);
        assert.equal(r.values['hive-token'], '', next);
        assert.equal(rows['Hive Token'].get_text(), '', next);
        assert.equal(r.toasts.length, shown + 1, next);
        assert.deepEqual(sent().slice(from), [], next);
    }
    // The token typed after the address goes to that address.
    rows['Hive URL'].type('https://other.example');
    rows['Hive URL'].apply();
    rows['Hive Token'].type('other-secret');
    rows['Hive Token'].apply();
    assert.deepEqual(sent().at(-1), ['https://other.example/api/widget', 'other-secret']);
    // A new path on the same host, and a first address, keep the token.
    const shown = r.toasts.length;
    rows['Hive URL'].type('https://other.example/base');
    rows['Hive URL'].apply();
    assert.deepEqual(sent().at(-1), ['https://other.example/base/api/widget', 'other-secret']);
    r.change('hive-url', '');
    rows['Hive URL'].type('https://first.example');
    rows['Hive URL'].apply();
    assert.deepEqual(sent().at(-1), ['https://first.example/api/widget', 'other-secret']);
    assert.equal(r.toasts.length, shown);
    assert.ok(before > 0);
});

test('no order of edits sends a token to a hive it was not confirmed for', async () => {
    // The saved hive and its token, and the hive the user moves to.
    const old = ['https://hive.example', 'secret'];
    const next = ['https://other.example', 'other-secret'];
    const steps = {
        'type address': rows => rows['Hive URL'].type(next[0]),
        'apply address': rows => rows['Hive URL'].apply(),
        // One character at a time, as a keyboard does.
        'type token': rows => {
            for (let i = 1; i <= next[1].length; i++)
                rows['Hive Token'].type(next[1].slice(0, i));
        },
        'apply token': rows => rows['Hive Token'].apply(),
    };
    const names = Object.keys(steps);
    const length = 4;
    let requests = 0;
    // Every sequence of four steps, repeats included.
    for (let n = 0; n < names.length ** length; n++) {
        const order = Array.from({length},
            (_, i) => names[Math.floor(n / names.length ** i) % names.length]);
        const r = await runtime();
        const rows = await r.openPrefs();
        const from = r.requests.length;
        // A pair may go out after an apply showed its two halves together.
        const confirmed = [old.join(' ')];
        for (const name of order) {
            if (name.startsWith('apply'))
                confirmed.push(`${rows['Hive URL'].get_text()} ${rows['Hive Token'].get_text()}`);
            steps[name](rows);
        }
        for (const request of r.requests.slice(from)) {
            const pair = `${request.msg.url.replace(/\/api\/widget$/, '')} ` +
                request.msg.headers['X-Hive-Internal'];
            assert.ok(confirmed.includes(pair), `${order.join(', ')}: sent ${pair}`);
            // Nobody typed the old token for the new hive, whatever was applied.
            assert.notEqual(pair, `${next[0]} ${old[1]}`, order.join(', '));
            requests++;
        }
    }
    // The orders that end with both halves applied do reach the new hive.
    assert.ok(requests > 0);
});

test('a filed idea is announced and refreshes the queue at once; a refused one only reports', async () => {
    const r = await runtime();
    const before = r.requests.length;
    r.indicator._fileIdea('o/n', 'github', 'Title', 'Body');
    const post = r.requests.at(-1);
    assert.equal(post.msg.method, 'POST');
    post.reply(201, '{"number":42,"html_url":"https://github.com/o/n/issues/42"}');
    assert.deepEqual(r.notices, [['Hive Monitor', 'Filed #42 on o/n.']]);
    // The POST plus one immediate status poll, not a wait for the next interval.
    assert.equal(r.requests.length, before + 2);
    assert.equal(r.requests.at(-1).msg.method, 'GET');

    r.indicator._fileIdea('o/n', 'github', 'Title', 'Body');
    const refused = r.requests.at(-1);
    const polls = r.requests.length;
    refused.reply(422, '{"message":"denied"}');
    assert.equal(r.notices.length, 2);
    assert.equal(r.notices[1][0], 'Hive Monitor');
    assert.notEqual(r.notices[1][1], '');
    assert.equal(r.requests.length, polls, 'a refusal must not trigger a poll');
});

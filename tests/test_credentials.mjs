import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let secrets = new Map();
let fail = false;
globalThis.testSecret = {
    Schema: class {}, SchemaFlags: {NONE: 0},
    SchemaAttributeType: {STRING: 0}, COLLECTION_DEFAULT: 'default',
};
for (const method of ['lookup', 'store', 'clear']) {
    testSecret[`password_${method}`] = (...args) => {
        const callback = args.pop();
        const type = args[1]['token-type'];
        let value = null;
        if (!fail) {
            if (method === 'lookup') value = secrets.get(type) ?? null;
            if (method === 'store') { secrets.set(type, args[4]); value = true; }
            if (method === 'clear') { value = secrets.delete(type); }
        }
        callback(null, {value, fail});
    };
    testSecret[`password_${method}_finish`] = result => {
        if (result.fail) throw new Error('locked keyring');
        return result.value;
    };
}
const source = (await readFile(new URL('../credentials.js', import.meta.url), 'utf8'))
    .replace("import Secret from 'gi://Secret';", 'const Secret = globalThis.testSecret;');
const {loadToken, saveToken} = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const values = new Map([['hive-token', 'old-hive'], ['github-token', 'old-github']]);
const settings = {
    get_string: key => values.get(key) ?? '',
    reset: key => values.delete(key),
    get_uint: key => values.get(key) ?? 0,
    set_uint: (key, value) => values.set(key, value),
};
fail = true;
await assert.rejects(loadToken(settings, 'hive'));
assert.equal(values.get('hive-token'), 'old-hive');
fail = false;
assert.equal(await loadToken(settings, 'hive'), 'old-hive');
assert.equal(values.has('hive-token'), false);
assert.equal(await loadToken(settings, 'github'), 'old-github');
await saveToken(settings, 'hive', 'new-hive');
assert.equal(await loadToken(settings, 'hive'), 'new-hive');
assert.equal(await loadToken(settings, 'github'), 'old-github');
fail = true;
await assert.rejects(saveToken(settings, 'hive', 'replacement'));
assert.equal(secrets.get('hive'), 'new-hive');
fail = false;
await saveToken(settings, 'hive', '');
assert.equal(await loadToken(settings, 'hive'), '');
assert.equal(await loadToken(settings, 'github'), 'old-github');
console.log('Credential migration, isolation, failure, update and deletion checks passed.');

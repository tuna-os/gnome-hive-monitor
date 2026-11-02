// Run with: gjs -m tests/test_settings_url.js
import {normalizeHiveUrl, validateSetting} from '../settingsValidation.js';
function equal(actual, expected) {
    if (actual !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
equal(normalizeHiveUrl(' https://example.com/base/// '), 'https://example.com/base');
for (const url of ['', 'http://example.com', 'https://user:pass@example.com',
    'https://', 'not a URL', 'file:///tmp/test']) {
    equal(normalizeHiveUrl(url), '');
    equal(Boolean(validateSetting('hive-url', url)), true);
}
equal(validateSetting('hive-url', 'https://example.com'), null);
equal(validateSetting('hive-url', '', {required: false}), null);
print('GLib URL validation tests passed.');

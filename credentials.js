/* Shared Secret Service storage. Legacy keys exist only for migration. */
import Secret from 'gi://Secret';

const schema = new Secret.Schema('org.gnome.shell.extensions.hive-monitor.Token',
    Secret.SchemaFlags.NONE, {'token-type': Secret.SchemaAttributeType.STRING});

function call(method, ...args) {
    return new Promise((resolve, reject) => {
        Secret[`password_${method}`](...args, (_source, result) => {
            try {
                resolve(Secret[`password_${method}_finish`](result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export async function saveToken(settings, type, value, cancellable = null) {
    const attributes = {'token-type': type};
    if (value) {
        const stored = await call('store', schema, attributes,
            Secret.COLLECTION_DEFAULT, `Hive Monitor ${type} token`, value, cancellable);
        if (!stored)
            throw new Error('Secret Service did not store the token');
    } else {
        await call('clear', schema, attributes, cancellable);
    }
    // Never erase the old value before the secure write succeeds.
    settings.reset(`${type}-token`);
    settings.set_uint('credentials-generation',
        (settings.get_uint('credentials-generation') + 1) >>> 0);
}

export async function loadToken(settings, type, cancellable = null) {
    const stored = await call('lookup', schema, {'token-type': type}, cancellable);
    const legacy = settings.get_string(`${type}-token`);
    if (legacy) {
        if (stored === null)
            await saveToken(settings, type, legacy, cancellable);
        else
            settings.reset(`${type}-token`);
    }
    return stored ?? legacy;
}

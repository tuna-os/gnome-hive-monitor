/* Shared settings contract for the Shell and preferences processes.
 * Tokens are opaque: only header-unsafe whitespace/control characters are
 * rejected, without assuming a provider-specific prefix or length.
 */
import GLib from 'gi://GLib';

export const POLL_MIN = 15;
export const POLL_MAX = 3600;
export const STATUS_FIELDS = ['hive-url', 'hive-token', 'poll-seconds'];
export const IDEA_FIELDS = ['github-repo', 'github-token', 'idea-labels'];

export function normalizeHiveUrl(raw) {
    try {
        const parsed = GLib.Uri.parse(raw.trim(), GLib.UriFlags.NONE);
        if (parsed.get_scheme()?.toLowerCase() !== 'https' ||
            !parsed.get_host() || parsed.get_userinfo())
            return '';
        return parsed.to_string().replace(/\/+$/, '');
    } catch {
        return '';
    }
}

/* A GitHub "owner/name" and nothing else.
 *
 * This value is pasted into the request path, so it decides which endpoint
 * the token is sent to -- it is not just a label. GitHub's own rules for
 * both halves are alphanumerics plus the separators below, so anything
 * outside that set is rejected rather than escaped: "o/n#x" and "o/n?x"
 * truncate the path at the fragment/query and POST somewhere else, and
 * "a/b/../.." climbs out of /repos/ entirely.
 *
 * Kept deliberately strict: a stray character here is a typo to report, not
 * input to repair. */
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/**
 * Whether a string is a GitHub "owner/name" safe to place in a request path.
 *
 * Exported for the test suite; callers use fileIssue, which enforces it.
 *
 * @param {string} repo - the candidate "owner/name".
 * @returns {boolean} true if repo is well formed.
 */
export function isValidRepo(repo) {
    // '.' and '..' are legal against the regex but are path segments, not
    // repository names.
    if (typeof repo !== 'string' || repo.length > 512)
        return false;
    const name = repo.slice(repo.indexOf('/') + 1);
    if (name === '.' || name === '..')
        return false;
    return REPO_RE.test(repo);
}

// Empty labels mean no labels; empty comma-separated entries are ignored.
export function parseLabels(raw) {
    return raw.split(',').map(label => label.trim()).filter(Boolean);
}

/** Return an error message, or null. Empty optional configuration can be
 * saved to disable a feature; runtime validation requires its credentials.
 * Messages contain no setting values, especially credentials.
 */
export function validateSetting(field, value, {required = true} = {}) {
    if (field === 'poll-seconds')
        return Number.isInteger(value) && value >= POLL_MIN && value <= POLL_MAX
            ? null : 'Refresh interval must be an integer from 15 to 3600 seconds.';
    if (field === 'show-counts')
        return typeof value === 'boolean' ? null : 'Show queue counts must be a boolean.';
    if (typeof value !== 'string')
        return 'Setting must be text.';
    const text = value.trim();
    if (field === 'idea-labels')
        return parseLabels(value).some(label => label.length > 50 || /[\x00-\x1f\x7f]/.test(label))
            ? 'Labels must be at most 50 characters and contain no control characters.' : null;
    if (!text)
        return required ? ({
            'hive-url': 'Set a hive URL in Settings.',
            'hive-token': 'Set a hive token in Settings.',
            'github-repo': 'Set a repository in Settings.',
            'github-token': 'Set a GitHub token in Settings.',
        }[field] ?? 'This setting is required.') : null;
    switch (field) {
    case 'hive-url':
        return normalizeHiveUrl(text) ? null : 'Use an HTTPS URL with a host and no embedded credentials.';
    case 'github-repo':
        return isValidRepo(text) ? null : 'Use a repository in owner/name format.';
    case 'hive-token':
    case 'github-token':
        return /[\s\x00-\x1f\x7f]/.test(text) ? 'Tokens must not contain whitespace or control characters.' : null;
    default:
        return 'Unknown setting.';
    }
}

/** Validate a Gio.Settings object. A field subset keeps status polling and
 * idea submission independent. Errors are keyed by the GSettings field.
 */
export function validateSettings(settings, fields = [...STATUS_FIELDS, ...IDEA_FIELDS, 'show-counts']) {
    const errors = [];
    for (const field of fields) {
        const value = field === 'poll-seconds' ? settings.get_int(field)
            : field === 'show-counts' ? settings.get_boolean(field) : settings.get_string(field);
        const message = validateSetting(field, value);
        if (message)
            errors.push({field, message});
    }
    return {valid: errors.length === 0, errors};
}

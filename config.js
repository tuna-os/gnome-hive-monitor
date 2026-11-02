/* Configuration validation for gnome-hive-monitor.
 *
 * Provides centralized validation functions for hive configuration settings.
 * These are used by both prefs.js (at configuration time) and extension.js
 * (at runtime) to ensure consistent, early feedback about invalid config.
 */

/**
 * Validates a hive URL format.
 * @param {string} url - The URL to validate
 * @returns {object} {valid: boolean, error?: string}
 */
export function validateHiveUrl(url) {
    if (!url || typeof url !== 'string') {
        return { valid: false, error: 'URL is required' };
    }

    url = url.trim();
    if (url.length === 0) {
        return { valid: false, error: 'URL cannot be empty' };
    }

    // Must be HTTPS
    if (!url.startsWith('https://')) {
        return { valid: false, error: 'URL must use HTTPS' };
    }

    // Try to parse as URL
    try {
        new URL(url);
    } catch (e) {
        return { valid: false, error: 'Invalid URL format' };
    }

    return { valid: true };
}

/**
 * Validates a GitHub repository format (owner/name).
 * @param {string} repo - The repository in owner/name format
 * @returns {object} {valid: boolean, error?: string}
 */
export function validateGithubRepo(repo) {
    if (!repo || typeof repo !== 'string') {
        return { valid: false, error: 'Repository is required' };
    }

    repo = repo.trim();
    if (repo.length === 0) {
        return { valid: false, error: 'Repository cannot be empty' };
    }

    const parts = repo.split('/');
    if (parts.length !== 2) {
        return { valid: false, error: 'Repository must be in owner/name format' };
    }

    const [owner, name] = parts;

    // Validate owner
    if (!owner || owner.length === 0) {
        return { valid: false, error: 'Owner cannot be empty' };
    }
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(owner)) {
        return { valid: false, error: 'Owner contains invalid characters' };
    }

    // Validate name
    if (!name || name.length === 0) {
        return { valid: false, error: 'Repository name cannot be empty' };
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        return { valid: false, error: 'Repository name contains invalid characters' };
    }

    return { valid: true };
}

/**
 * Validates and normalizes labels (comma-separated).
 * @param {string} labels - Comma-separated label names
 * @returns {object} {valid: boolean, normalized?: string[], error?: string}
 */
export function validateLabels(labels) {
    if (!labels || typeof labels !== 'string') {
        return { valid: true, normalized: [] };
    }

    const normalized = labels
        .split(',')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    // Basic validation: labels should be alphanumeric with hyphens/underscores
    for (const label of normalized) {
        if (!/^[a-zA-Z0-9_-]+$/.test(label)) {
            return { valid: false, error: `Invalid label: "${label}"` };
        }
    }

    return { valid: true, normalized };
}

/**
 * Validates all configuratngs.
 * @param {object} config - Configuration object with hiveUrl, githubRepo, labels, hiveToken
 * @returns {object} {valid: boolean, errors: {[key]: string}}
 */
export function validateConfig(config) {
    const errors = {};

    if (config.hiveUrl !== undefined) {
        const result = validateHiveUrl(config.hiveUrl);
        if (!result.valid) {
            errors.hiveUrl = result.error;
        }
    }

    if (config.githubRepo !== undefined) {
        const result = validateGithubRepo(config.githubRepo);
        if (!result.valid) {
            errors.githubRepo = result.error;
        }
    }

    if (config.labels !== undefined) {
        const result = validateLabels(config.labels);
        if (!result.valid) {
            errors.labels = result.error;
        }
    }

    if (config.hiveToken !== undefined && (!config.hiveToken || config.hiveToken.trim().length === 0)) {
        errors.hiveToken = 'Token is required';
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors
    };
}

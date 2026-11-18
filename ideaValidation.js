/* Idea validation has no GNOME dependencies. Error codes let callers choose
 * how to present and translate failures without coupling rules to the UI. */
export function validateIdea(title, body) {
    const errors = [];
    if (!title.trim())
        errors.push('title-required');
    // The body is optional and currently has no validation constraints.
    return {valid: errors.length === 0, errors};
}

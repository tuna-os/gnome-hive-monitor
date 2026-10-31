/* dialogState.js — Dialog state machine and validation for IdeaDialog.
 *
 * Separates UI presentation, state machine transitions, and input validation
 * concerns (tuna-os/gnome-hive-monitor#49).
 */

/**
 * Validate an idea's title and body.
 * Pure validation function independent of UI framework or GNOME Shell.
 *
 * @param {string} title
 * @param {string} [body]
 * @param {(s: string) => string} [gettextFn]
 * @returns {{valid: boolean, title?: string, body?: string, error?: string}}
 */
export function validateIdea(title, body, gettextFn = s => s) {
    const trimmedTitle = (title ?? '').trim();
    if (!trimmedTitle) {
        return {
            valid: false,
            error: gettextFn('A title is required.'),
        };
    }
    return {
        valid: true,
        title: trimmedTitle,
        body: (body ?? '').trim(),
    };
}

/**
 * State machine managing IdeaDialog state transitions:
 * - 'input': initial/ready state, awaiting user input.
 * - 'filing': submission in progress, submit action disabled.
 * - 'error': validation or submission failed, error message displayed, form retained.
 * - 'filed': submission succeeded, dialog ready to dismiss.
 */
export class IdeaDialogState {
    constructor(gettextFn = s => s) {
        this._ = gettextFn;
        this.state = 'input';
        this.errorMsg = '';
    }

    /**
     * Transition to filing state. When called with title/body, validates input first.
     * Returns true if transition succeeded, or false if validation failed.
     *
     * @param {string} [title]
     * @param {string} [body]
     * @returns {boolean}
     */
    submit(title, body) {
        if (title !== undefined) {
            const res = validateIdea(title, body, this._);
            if (!res.valid) {
                this.error(res.error);
                return false;
            }
        }
        this.state = 'filing';
        this.errorMsg = '';
        return true;
    }

    /**
     * Mark submission successful, transitioning to 'filed'.
     */
    success() {
        this.state = 'filed';
        this.errorMsg = '';
    }

    /**
     * Record an error and transition to 'error'.
     *
     * @param {string} msg
     */
    error(msg) {
        this.state = 'error';
        this.errorMsg = msg ?? '';
    }

    /**
     * Reset state back to 'input'.
     */
    reset() {
        this.state = 'input';
        this.errorMsg = '';
    }
}

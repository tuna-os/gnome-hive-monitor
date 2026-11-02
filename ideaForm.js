/* UI-independent idea validation and submission. No GNOME imports. */
export class IdeaFormValidator {
    static validate(title, body = '') {
        const value = {title: title.trim(), body: body.trim()};
        const errors = value.title ? [] : [{field: 'title', code: 'required'}];
        return {value, errors};
    }
}

export class IdeaValidationError extends Error {
    constructor(errors) {
        super('Invalid idea form');
        this.name = 'IdeaValidationError';
        this.errors = errors;
    }
}

export class IdeaSubmitter {
    /** send receives normalized input and onFiled/onError callbacks. */
    constructor(send) {
        this._send = send;
    }

    async submit(title, body = '') {
        const {value, errors} = IdeaFormValidator.validate(title, body);
        if (errors.length)
            throw new IdeaValidationError(errors);

        return new Promise((resolve, reject) => {
            this._send(value, {
                onFiled: (number, htmlUrl) => resolve({number, htmlUrl}),
                onError: message => reject(new Error(message)),
            });
        });
    }
}

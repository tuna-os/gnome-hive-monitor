import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Load the actual ESM source without changing the extension's package type.
const source = await readFile(new URL('../ideaValidation.js', import.meta.url), 'utf8');
const {validateIdea} = await import(`data:text/javascript,${encodeURIComponent(source)}`);

for (const title of ['', ' ', '\t\n']) {
    assert.deepEqual(validateIdea(title, 'detail'), {
        valid: false, errors: ['title-required'],
    });
}
for (const body of ['', ' ', 'Some detail', 'Multiple\nlines']) {
    assert.deepEqual(validateIdea('  An idea  ', body), {valid: true, errors: []});
}
// Results must not share mutable error state between submissions.
validateIdea('', '').errors.push('extra');
assert.deepEqual(validateIdea('Next idea', ''), {valid: true, errors: []});
console.log('Idea validation tests passed');

// Exercise the real controller method with presentation and filing doubles.
const extension = await readFile(new URL('../extension.js', import.meta.url), 'utf8');
const start = extension.indexOf('    _openIdeaDialog() {');
const end = extension.indexOf('\n    _fileIdea(', start);
let dialog;
class Dialog {
    constructor(submit) { this.submit = submit; dialog = this; }
    open() { this.opened = true; }
    close() { this.closed = true; }
    setErrors(errors) { this.errors = errors; }
}
const open = new Function('IdeaDialog', 'validateIdea', '_',
    `return ({${extension.slice(start, end)}})._openIdeaDialog;`)(
    Dialog, validateIdea, text => text);
const filed = [];
const indicator = {
    _settings: {get_string: key => key === 'github-repo' ? 'owner/repo' : 'token'},
    _fileIdea: (...args) => {
        assert.equal(dialog.closed, true, 'close before filing');
        filed.push(args);
    },
};
open.call(indicator);
assert.equal(dialog.opened, true);
dialog.submit('  ', 'detail');
assert.deepEqual(dialog.errors, ['A title is required.']);
assert.equal(dialog.closed, undefined, 'invalid input keeps the dialog open');
assert.deepEqual(filed, []);
dialog.submit('  An idea  ', '  detail  ');
assert.deepEqual(filed, [['owner/repo', 'token', 'An idea', 'detail']]);
console.log('Idea submission controller tests passed');

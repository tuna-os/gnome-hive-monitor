import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

// Load the GJS ES module without requiring Node package metadata in the extension.
const source = await readFile(new URL('../ideaForm.js', import.meta.url), 'utf8');
const {IdeaFormValidator, IdeaSubmitter, IdeaValidationError} =
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('validation returns structured errors and normalized input without UI', () => {
    assert.deepEqual(IdeaFormValidator.validate(' \n ', ' detail '), {
        value: {title: '', body: 'detail'},
        errors: [{field: 'title', code: 'required'}],
    });
    assert.deepEqual(IdeaFormValidator.validate(' idea '), {
        value: {title: 'idea', body: ''}, errors: [],
    });
});

test('invalid input rejects before invoking the transport', async () => {
    const submitter = new IdeaSubmitter(() => assert.fail('must not send'));
    await assert.rejects(submitter.submit('  '), error => {
        assert.ok(error instanceof IdeaValidationError);
        assert.deepEqual(error.errors, [{field: 'title', code: 'required'}]);
        return true;
    });
});

test('submission waits for the transport and returns its result', async () => {
    let callbacks;
    const submitter = new IdeaSubmitter((value, handlers) => {
        assert.deepEqual(value, {title: 'Idea', body: 'Detail'});
        callbacks = handlers;
    });
    let settled = false;
    const result = submitter.submit(' Idea ', ' Detail ');
    result.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    callbacks.onFiled('#42', 'https://github.com/o/r/issues/42');
    assert.deepEqual(await result, {
        number: '#42', htmlUrl: 'https://github.com/o/r/issues/42',
    });
});

test('submission propagates asynchronous failures and synchronous exceptions', async () => {
    let callbacks;
    const submitter = new IdeaSubmitter((_value, handlers) => { callbacks = handlers; });
    const result = submitter.submit('Idea');
    callbacks.onError('GitHub refused the idea');
    await assert.rejects(result, {message: 'GitHub refused the idea'});
    const failure = new Error('transport failed');
    await assert.rejects(new IdeaSubmitter(() => { throw failure; }).submit('Idea'),
        error => error === failure);
});

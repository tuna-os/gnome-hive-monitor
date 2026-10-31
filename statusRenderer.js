/* Pure display formatting. Translation and time are supplied by the caller. */
function format(template, ...values) {
    let index = 0;
    return template.replace(/%[sd]/g, () => String(values[index++]));
}

export function ago(iso, translate = s => s, now = Date.now()) {
    const then = Date.parse(iso);
    if (Number.isNaN(then))
        return iso;
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 60)
        return format(translate('%ds ago'), seconds);
    if (seconds < 3600)
        return format(translate('%dm ago'), Math.round(seconds / 60));
    return format(translate('%dh ago'), Math.round(seconds / 3600));
}

export function renderStatus(state, translate = s => s, now = Date.now()) {
    if (state.kind === 'unconfigured') {
        return {label: translate('hive?'), icon: 'dialog-question-symbolic',
            status: state.message, detail: translate('Open Settings to configure.')};
    }
    if (state.kind === 'error') {
        return {label: translate('hive!'), icon: 'dialog-warning-symbolic',
            status: state.short, detail: state.detail || ''};
    }
    const d = state.data;
    const mode = String(d.mode ?? '?').toUpperCase();
    const issues = Number(d.issues ?? 0);
    const prs = Number(d.prs ?? 0);
    const running = Number(d.running ?? 0);
    const paused = Number(d.paused ?? 0);
    const agents = paused > 0
        ? format(translate('%d agents running, %d paused'), running, paused)
        : format(translate('%d agents running'), running);
    return {
        label: state.showCounts ? `${mode} ${issues}/${prs}` : mode,
        icon: paused > 0 ? 'dialog-warning-symbolic' : 'system-run-symbolic',
        status: format(translate('%s — %d issues, %d PRs'), mode, issues, prs),
        detail: d.last_eval
            ? `${agents} · ${format(translate('last eval %s'), ago(d.last_eval, translate, now))}`
            : agents,
    };
}

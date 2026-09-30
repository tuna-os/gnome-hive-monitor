/* Idea submission dialog for Hive Monitor. */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export const IdeaDialog = GObject.registerClass(
class IdeaDialog extends ModalDialog.ModalDialog {
    _init(onSubmit) {
        super._init({styleClass: 'hive-idea-dialog'});
        this._onSubmit = onSubmit;

        const box = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 12px; min-width: 420px;',
        });
        this.contentLayout.add_child(box);

        box.add_child(new St.Label({
            text: _('New idea'),
            style: 'font-weight: 800; font-size: 1.1em;',
        }));
        box.add_child(new St.Label({
            text: _('Becomes a labelled issue the hive can pick up.'),
            style: 'color: rgba(255,255,255,0.7);',
        }));

        this._title = new St.Entry({
            hint_text: _('Title'),
            can_focus: true,
            style: 'margin-top: 6px;',
        });
        box.add_child(this._title);

        this._body = new St.Entry({
            hint_text: _('Detail (optional)'),
            can_focus: true,
        });
        // St.Entry is single-line; keep the body one line rather than pretend
        // otherwise. Anything longer belongs in the issue itself on the web.
        box.add_child(this._body);

        this._status = new St.Label({text: '', style: 'color: #f66;'});
        box.add_child(this._status);

        this.setButtons([
            {
                label: _('Cancel'),
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: _('File Idea'),
                action: () => this._submit(),
                default: true,
            },
        ]);
        this.setInitialKeyFocus(this._title.clutter_text);
    }

    _submit() {
        const title = this._title.get_text().trim();
        if (!title) {
            this._status.set_text(_('A title is required.'));
            return;
        }
        this.close();
        this._onSubmit(title, this._body.get_text().trim());
    }
});

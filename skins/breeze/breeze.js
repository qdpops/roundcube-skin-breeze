/**
 * Timeweb-like skin behaviour, layered on Elastic's ui.js (popups, dialogs, phone panel switching).
 * Entry points are per screen: mailbox, message (preview frame), compose (panel frame), login, settings.
 */
(function($) {
    var COLORS = ['#317bff', '#f0445b', '#ff8a00', '#20b26c', '#8b5cf6', '#0bb4c9', '#e5484d', '#6b7280'];

    var TW = window.TW = {};

    // user pref through utils/save-pref, sent the way rcmail.http_post sends ajax requests (whitelisted by the tw_folders plugin)
    function save_pref(name, value) {
        return $.ajax({
            type: 'POST',
            url: rcmail.url('utils/save-pref'),
            data: {_name: name, _value: value, _remote: 1},
            headers: {'X-Roundcube-Request': rcmail.env.request_token}
        });
    }

    // the skin's own window when we're inside one of its frames (compose doesn't set env.framed)
    function host() {
        try { return window.parent !== window && window.parent.TW || null; } catch (e) { return null; }
    }

    function wide() {
        var mode = window.UI && UI.get_screen_mode ? UI.get_screen_mode() : 'large';
        return mode == 'large' || mode == 'normal';
    }

    // texts live in plugins/tw_folders/localization (the plugin sends them to every page)
    function t(key) { return rcmail.gettext(key, 'tw_folders'); }
    function locale() { return (rcmail.env.locale || 'en_US').replace('_', '-'); }

    // free mail: people, not companies; their provider's logo would say nothing about the sender
    var FREEMAIL = /^(gmail|googlemail|yandex|ya|mail|bk|inbox|list|internet|rambler|lenta|autorambler|myrambler|ro|outlook|hotmail|live|msn|icloud|me|mac|yahoo|aol|proton|protonmail|pm|gmx|zoho|tutanota|tuta|ukr|i)\.[a-z]{2,3}$/;

    // a letter in a coloured circle; with an address, the sender's logo (tw_folders, plugin.tw-logo) covers it once loaded
    function avatar(name, email) {
        var h = 0, domain = (String(email || '').split('@')[1] || '').toLowerCase(), el;
        name = $.trim(name || '') || '?';
        for (var i = 0; i < name.length; i++)
            h = (h * 31 + name.charCodeAt(i)) | 0;
        el = $('<span class="tw-avatar skip-on-drag" aria-hidden="true">').text(name.charAt(0).toUpperCase())
            .css('background-color', COLORS[Math.abs(h) % COLORS.length]);

        if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !FREEMAIL.test(domain))
            $('<img alt="" loading="lazy" decoding="async">')
                .on('load', function() { el.addClass('tw-has-logo'); })
                .on('error', function() { $(this).remove(); })
                .attr('src', rcmail.url('mail/plugin.tw-logo', {_domain: domain}))
                .appendTo(el);
        return el;
    }

    // every compose route (new, reply, forward, draft, mailto) ends in open_compose_step
    function compose_into_panel(rc) {
        var orig = rc.open_compose_step;
        rc.open_compose_step = function(p) {
            var target = host() || TW;
            if (target.openCompose && !rc.env.compose_extwin && !rc.env.extwin && target.openCompose(p))
                return true; // false: no panel on this page (a message opened on its own)
            return orig.apply(rc, arguments);
        };
    }

    // compact editor toolbar, the rest goes to the "..." overflow.
    // Registered at load: the editor is created inside rcmail.init(), before the 'init' event.
    rcmail.addEventListener('editor-init', function(o) {
        o.config.toolbar = 'undo redo | bold italic underline strikethrough | alignleft aligncenter alignright | removeformat'
            + ' | bullist numlist outdent indent | link image | forecolor backcolor | fontselect fontsizeselect | code';
        o.config.toolbar_mode = 'floating';
        // the editor fills the panel instead of growing with the text (ui.js adds autoresize)
        o.config.plugins = String(o.config.plugins || '').replace(/\bautoresize\b/, '');
        o.config.content_style = (o.config.content_style || '')
            + ' body { font-family: Inter, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 14px; color: #0a1b39; }'
            + ' pre, .pre { font-family: inherit; white-space: pre-wrap; }';
        o.config.menubar = false;
        o.config.statusbar = false;
        // inline reply: the quote folds under "•••" after its intro line; a click on the line folds / unfolds it
        o.config.content_style += ' body.tw-qr-fold [id$=reply-intro] ~ blockquote { display: none; }'
            + ' body.tw-qr [id$=reply-intro] { cursor: pointer; }'
            + ' body.tw-qr [id$=reply-intro]::after { content: "\\2022\\2022\\2022"; display: table; margin-top: 10px;'
            + ' padding: 0 6px; border-radius: 6px; background: #e3e7ee; color: #6b7280; font-size: 12px;'
            + ' letter-spacing: 1px; line-height: 18px; }';
        try { // the reply block under a message has no frame around the text: line it up with the recipient chip
            if (window.frameElement && window.frameElement.classList.contains('tw-qr-frame'))
                o.config.content_style += ' body { margin: 10px 2px; }';
        } catch (e) { /* another origin */ }
    });

    rcmail.addEventListener('init', function() {
        var task = rcmail.env.task, action = rcmail.env.action;

        if (task == 'login')
            return login();
        if (task == 'settings' && !rcmail.is_framed())
            settings();
        if (task == 'settings' && action == 'edit-prefs' && $('input[name="_section"]').val() == 'general')
            layout_cards();
        if (task == 'settings' && /-identity$/.test(action))
            account_form();
        if (task == 'settings' && host() && $('.formbuttons').length)
            autosave();
        if (task == 'settings' && action == 'plugin.tw-filters')
            filters_page();
        if (task == 'addressbook' && rcmail.contact_list)
            addressbook();
        if (task != 'mail')
            return;

        if (action == 'compose')
            return compose();

        compose_into_panel(rcmail);

        if (action == 'preview' || action == 'show')
            message();
        else if (rcmail.message_list) {
            mailbox();
            contacts_panel();
        }
    });

    /* ----------------------------------------------------------------- mailbox (list screen) */
    function mailbox() {
        var list = rcmail.message_list,
            preview = rcmail.env.tw_preview || 'none',
            split = preview != 'none', // message shown next to / under the list (Settings > interface)
            body = $(document.body).addClass('tw-mailbox tw-preview-' + preview).toggleClass('tw-split', split),
            clicked = false, by_checkbox = false, timer;

        function reading(on) { body.toggleClass('tw-reading', !!on); }

        // open a message by click/Enter only; arrows and checkboxes just select (as in Timeweb)
        document.getElementById('messagelist').addEventListener('mousedown', function(e) {
            by_checkbox = !!$(e.target).closest('td.selection').length;
            clicked = !!$(e.target).closest('tbody tr').length
                && !$(e.target).closest('td.selection, td.flags, input, .tw-chips').length
                && !e.ctrlKey && !e.shiftKey && !e.metaKey;
        }, true); // capture: list.js stops propagation

        // while messages are checked, a click anywhere on a row ticks / unticks it instead of opening it and
        // dropping the checked set (a near miss of a checkbox); the flag and attachment chips keep their clicks
        // the avatar is the row's checkbox (there is no checkbox column)
        function row_toggle(e) {
            var t = $(e.target), cb = t.closest('tbody tr').find('td.selection input');
            if (!cb.length || t.closest('td.selection, td.flags, .tw-chips').length
                || (!t.closest('.tw-avatar').length && !$('#messagelist td.selection input:checked').length))
                return;
            e.stopPropagation();
            e.preventDefault();
            by_checkbox = true; // set by the listener above for this press: treat it as a checkbox click
            clicked = false;
            if (e.type == 'click')
                cb.prop('checked', !cb.prop('checked')).change(); // list.js: select_row with CONTROL_KEY
        }
        $.each(['mousedown', 'mouseup', 'click', 'dblclick'], function(i, type) {
            document.getElementById('messagelist').addEventListener(type, row_toggle, true);
        });

        var get_preview = rcmail.msglist_get_preview;
        rcmail.msglist_get_preview = function() {
            if (TW.no_preview) { // a right click selected the row (message_menu)
                TW.no_preview = false;
                return;
            }
            // with the list in view (split layouts, phones) arrows preview as usual; full-width list opens by click only
            if (!split && wide() && !clicked && !body.hasClass('tw-reading'))
                return;
            clicked = false;
            reading(true);
            get_preview.apply(rcmail, arguments);
        };

        var dbl_click = rcmail.msglist_dbl_click;
        rcmail.msglist_dbl_click = function(l) {
            var uid = l.get_single_selection();
            if (uid && rcmail.get_message_mailbox(uid) != rcmail.env.drafts_mailbox) {
                clicked = true;
                return rcmail.msglist_get_preview();
            }
            return dbl_click.apply(rcmail, arguments);
        };

        var show_frame = rcmail.show_contentframe;
        rcmail.show_contentframe = function(show) {
            if (!show)
                reading(false);
            return show_frame.apply(rcmail, arguments);
        };

        $('#mailtoolbar .tw-back').on('click', function() {
            list.clear_selection();
            reading(false);
            return false;
        });
        // list.js 1.7 has no select_prev (and select_next falls back to the row above): step with get_*_row
        $('#mailtoolbar .tw-nav-prev, #mailtoolbar .tw-nav-next').on('click', function() {
            var row = list[$(this).is('.tw-nav-prev') ? 'get_prev_row' : 'get_next_row']();
            if (row)
                list.select_row(row.uid, false, false);
            return false;
        });

        // checkboxes always on, like Timeweb
        list.enable_checkbox_selection();
        $(list.list).addClass('withselection');

        var all = $('#tw-select-all').on('change', function() {
            rcmail.command(this.checked ? 'select-all' : 'select-none', 'page');
        });
        var opened = null; // the message opened by click: selected, but not "checked"
        list.addEventListener('select', function() {
            var n = list.get_selection().length, uid;

            // ticking a checkbox starts a checked set: the opened message leaves the selection,
            // so bulk actions apply to the ticked messages only
            if (by_checkbox && opened && n > 1 && $.inArray(opened, list.get_selection()) >= 0) {
                uid = opened;
                opened = null;
                list.clear_selection(uid, true); // that row only, no event: the state is recomputed below
                n = list.get_selection().length;
            }

            var checked = n > 1 || (n == 1 && by_checkbox); // opening one message by click is not "checking" it (Timeweb)
            opened = n == 1 && !by_checkbox ? list.get_single_selection() : null;
            if (opened && list.rows[opened])
                $(list.rows[opened].obj).find('td.selection input').prop('checked', false);

            // one bar: the opened message's actions show there too (no message bar of its own)
            body.toggleClass('tw-has-selection', checked || (n > 0 && body.hasClass('tw-unibar')));
            all.prop('checked', checked && n == list.rowcount).prop('indeterminate', checked && n < list.rowcount);
            fit_listbar(); // other buttons now
        });

        /* the read mark of the chosen messages turns into "Пометить непрочитанным"
           while the opened / ticked messages are all read. Roundcube rewrites the buttons' classes on every
           enable_command, so the mode is a class on the bar (CSS swaps the icon) and the click is caught before theirs. */
        var bar = $('.tw-listbar'),
            unread_btns = bar.find('.tw-when-none .ti-mail-open, .tw-when-selected .ti-mail-open'),
            words = unread_btns.map(function() { return [[$(this).find('.inner').text(), this.title]]; }).get(),
            // the bookmark likewise: "Снять флаг" (filled) while every chosen message is flagged
            flag_btns = $('.tw-listbar .tw-when-selected .ti-bookmark, #mailtoolbar .ti-bookmark'),
            flag_words = flag_btns.map(function() { return [[$(this).find('.inner').text(), this.title]]; }).get(),
            read_timer;

        function all_rows(sel, test) {
            var on = sel.length > 0;
            $.each(sel, function(i, uid) { return (on = !!list.rows[uid] && test($(list.rows[uid].obj))); });
            return on;
        }

        function read_mode() {
            var sel = list.get_selection(),
                on = all_rows(sel, function(r) { return !r.hasClass('unread'); }),
                flagged = all_rows(sel, function(r) { return r.hasClass('flagged'); });
            bar.toggleClass('tw-unread-mode', on);
            unread_btns.each(function(i) {
                $(this).attr('title', on ? t('mark_unread') : words[i][1]).find('.inner').text(on ? t('mark_unread') : words[i][0]);
            });
            body.toggleClass('tw-flag-mode', flagged);
            flag_btns.each(function(i) {
                var label = flagged ? rcmail.gettext('markunflagged') : flag_words[i][0];
                $(this).attr('title', flagged ? label : flag_words[i][1]).find('.inner').text(label);
            });
            fit_listbar();
        }

        // capture: before Roundcube's own onclick on these buttons
        document.addEventListener('click', function(e) {
            if (bar.hasClass('tw-unread-mode') && $(e.target).closest(unread_btns).length) {
                e.preventDefault();
                e.stopPropagation();
                rcmail.command('mark', 'unread');
            }
            else if (body.hasClass('tw-flag-mode') && $(e.target).closest(flag_btns).length) {
                e.preventDefault();
                e.stopPropagation();
                rcmail.command('mark', 'unflagged');
            }
        }, true);

        list.addEventListener('select', read_mode);
        // rows change read state from many places (preview marks read, the server, other buttons): watch their classes
        new MutationObserver(function() { clearTimeout(read_timer); read_timer = setTimeout(read_mode, 50); })
            .observe(list.list, {subtree: true, attributes: true, attributeFilter: ['class']});

        // "наверх": shown once the list is scrolled down a screen
        var scroller = $('#messagelist-content'), to_top = $('.tw-to-top');
        scroller.on('scroll', function() { to_top.prop('hidden', this.scrollTop < this.clientHeight); });
        to_top.on('click', function() { scroller[0].scrollTo({top: 0, behavior: 'smooth'}); });

        // the bar is measured again whenever the list pane changes width (split border, window)
        // (kept in TW: an observer nothing refers to can be garbage-collected and stop reporting)
        if (window.ResizeObserver) {
            TW.listbar_observer = new ResizeObserver(function() { fit_listbar(); });
            TW.listbar_observer.observe(document.getElementById('layout-list'));
            TW.listbar_observer.observe($('#layout-list > .header')[0]); // it moves out in the one-bar layout
        }

        /* "Письмо справа" on wide screens: one bar over the list and the message (Timeweb). The list's header
           moves out of the list into a grid row of its own, the message bar's "more" menu joins its
           message actions, the message bar itself is hidden (CSS, body.tw-unibar). Back as it was otherwise. */
        var list_header = $('#layout-list > .header'), more_menu = $('#messagemenulink');
        function unibar() {
            var on = preview == 'right' && wide(), out = list_header.parent().is('#layout');
            body.toggleClass('tw-unibar', on);
            if (on && !out) {
                list_header.addClass('tw-unibar-host').insertBefore('#layout-list');
                var move = list_header.find('.tw-when-selected .ti-folder');
                more_menu.insertAfter(move);
            }
            else if (!on && out) {
                list_header.removeClass('tw-unibar-host').prependTo('#layout-list');
                var back = $('#mailtoolbar .ti-folder');
                more_menu.insertAfter(back);
            }
            fit_listbar();
        }
        unibar();
        rcmail.addEventListener('skin-resize', unibar);

        rcmail.addEventListener('listupdate', function() { decorate(); chips(); pager(); snippets(); });
        rcmail.addEventListener('insertrow', function() { clearTimeout(timer); timer = setTimeout(function() { decorate(); chips(); }, 0); });

        if (split)
            splitter(preview);

        $('#mailsearchform').attr('placeholder', t('search_mail'));
        sidebar();
        search_slot();
        rcmail.addEventListener('skin-resize', search_slot);
        decorate();
        pager();
        snippets();
    }

    /* draggable border between list and message in split layouts; size kept in the tw_split user pref */
    function splitter(mode) {
        var layout = $('#layout'), list = $('#layout-list'), horizontal = mode == 'right',
            prop = horizontal ? '--tw-list-w' : '--tw-list-h',
            saved = (rcmail.env.tw_split || {})[mode],
            bar = $('<div class="tw-splitter" role="separator" tabindex="0">')
                .attr({'aria-orientation': horizontal ? 'vertical' : 'horizontal', 'aria-label': t('list_size'), 'aria-controls': 'layout-list'})
                .addClass(horizontal ? 'tw-splitter-v' : 'tw-splitter-h')
                .appendTo(document.body),
            store_timer;

        function limits() {
            var box = layout[0].getBoundingClientRect(), l = list[0].getBoundingClientRect();
            return horizontal
                ? [300, box.right - l.left - 380]     // list >= 300px, message >= ~380px
                : [140, box.bottom - l.top - 220];
        }
        function apply(px) {
            var lim = limits();
            px = Math.round(Math.max(lim[0], Math.min(lim[1], px)));
            layout[0].style.setProperty(prop, px + 'px');
            place();
            return px;
        }
        function place() {
            if (!wide()) return bar.prop('hidden', true);
            var r = list[0].getBoundingClientRect();
            bar.prop('hidden', false).css(horizontal
                ? {left: r.right, top: r.top, height: r.height, width: ''}
                : {left: r.left, top: r.bottom, width: r.width, height: ''});
        }
        function store(px) {
            var all = $.extend({}, rcmail.env.tw_split || {});
            all[mode] = px;
            rcmail.env.tw_split = all;
            clearTimeout(store_timer);
            store_timer = setTimeout(function() { save_pref('tw_split', all); }, 300);
        }

        bar.on('mousedown', function(e) {
            if (e.button) return;
            var l = list[0].getBoundingClientRect();
            body_class(true);
            $(document).on('mousemove.twsplit', function(ev) {
                apply(horizontal ? ev.clientX - l.left : ev.clientY - l.top);
            }).on('mouseup.twsplit', function() {
                $(document).off('.twsplit');
                body_class(false);
                store(horizontal ? list.outerWidth() : list.outerHeight());
            });
            return false;
        });
        bar.on('keydown', function(e) {
            var d = {ArrowLeft: -20, ArrowUp: -20, ArrowRight: 20, ArrowDown: 20}[e.key];
            if (!d) return;
            store(apply((horizontal ? list.outerWidth() : list.outerHeight()) + d));
            return false;
        });
        // iframes would swallow mousemove while dragging
        function body_class(on) { $(document.body).toggleClass('tw-resizing', on).toggleClass('tw-resizing-v', on && horizontal); }

        if (saved)
            apply(saved);
        place();
        $(window).on('resize', function() { if (saved || layout[0].style.getPropertyValue(prop)) apply(horizontal ? list.outerWidth() : list.outerHeight()); else place(); });
        rcmail.addEventListener('skin-resize', place);
    }

    /* attachment chips under list rows (data from the tw_folders plugin: plugin.tw_attachments) */
    var attachments = {};
    // a folder rule moved new mail out of the Inbox (tw_folders plugin, on refresh)
    rcmail.addEventListener('plugin.tw_rules_moved', function(n) {
        if (rcmail.message_list && rcmail.env.mailbox == 'INBOX')
            rcmail.list_mailbox();
        rcmail.display_message(t('rules_moved') + ' ' + n, 'confirmation');
    });

    rcmail.addEventListener('plugin.tw_attachments', function(map) {
        $.extend(attachments, map);
        if (rcmail.message_list)
            setTimeout(chips, 0); // may arrive after the rows and 'listupdate'
    });

    function human_size(b) {
        return b < 1024 ? b + ' ' + t('size_b') : b < 1048576 ? Math.round(b / 1024) + ' ' + t('size_kb')
            : (b / 1048576).toLocaleString(locale(), {maximumFractionDigits: b < 10485760 ? 1 : 0}) + ' ' + t('size_mb');
    }

    function file_kind(name, type) {
        var ext = (/\.([a-z0-9]+)$/i.exec(name) || [0, ''])[1].toLowerCase();
        if (ext == 'pdf' || type == 'application/pdf') return 'pdf';
        if (/^image\//.test(type) || /^(jpe?g|png|gif|webp|heic|bmp|svg)$/.test(ext)) return 'image';
        if (/^(zip|rar|7z|gz|tgz|tar)$/.test(ext) || /zip|rar|compressed/.test(type)) return 'archive';
        if (/^(docx?|odt|rtf|txt|xlsx?|ods|csv|pptx?)$/.test(ext)) return 'doc';
        return 'file';
    }

    function chips() {
        var list = rcmail.message_list;
        $.each(list.rows, function(uid, row) {
            // server keys are "uid-folder"; rows of multi-folder searches already use that form
            var info = attachments[uid] || attachments[uid + '-' + rcmail.get_message_mailbox(uid)], td;
            if (!info || !row.obj || $(row.obj).find('.tw-chips').length)
                return;
            td = $(row.obj).children('td.subject');
            var box = $('<span class="tw-chips skip-on-drag">'),
                mbox = rcmail.get_message_mailbox(uid), id = String(uid).split('-')[0];
            $.each(info.files, function(i, f) {
                $('<a class="tw-chip" download>').attr({href: rcmail.url('get', {_mbox: mbox, _uid: id, _part: f[2], _download: 1, _token: rcmail.env.request_token}), title: f[0]}) // downloads need the CSRF token
                    .append($('<span class="tw-chip-ico">').addClass('tw-chip-' + file_kind(f[0], f[3])))
                    .append($('<span class="tw-chip-name">').text(f[0]))
                    .append($('<span class="tw-chip-size">').text(human_size(f[1])))
                    .appendTo(box);
            });
            if (info.n > info.files.length)
                $('<span class="tw-chip tw-chip-more">').text('+' + (info.n - info.files.length)).appendTo(box);
            // a chip downloads, it must not select/open the message
            box.on('mousedown dblclick', function(e) { e.stopPropagation(); });
            box.find('.tw-chip-more').on('click', function(e) { e.stopPropagation(); });
            td.append(box);
        });
    }

    /* the start of each message's text, under the subject in three-line rows (tw_folders, plugin.tw-snippets);
       asked after the list is drawn so it doesn't slow the list down, kept for this page load */
    var snippet_text = {}, snippet_asked = {};

    function snippet_key(uid) { return /-/.test(uid) ? uid : uid + '-' + rcmail.env.mailbox; }

    function snippets() {
        var list = rcmail.message_list, ask = [];
        if (!list)
            return;

        $.each(list.rows, function(uid, row) {
            var key = snippet_key(uid), td = $(row.obj).children('td.subject');
            if (key in snippet_text) {
                var span = td.children('.tw-snippet');
                if (snippet_text[key] && !span.text())
                    (span.length ? span : $('<span class="tw-snippet skip-on-drag">').appendTo(td)).text(snippet_text[key]);
            }
            else if (!snippet_asked[key])
                ask.push(uid);
        });

        // one-line rows show no text: ask only when the rows are three-line (grid)
        if (ask.length && $('#messagelist > tbody > tr').first().css('display') == 'grid') {
            $.each(ask, function(i, uid) { snippet_asked[snippet_key(uid)] = true; });
            rcmail.http_post('plugin.tw-snippets', {_uids: ask.join(','), _mbox: rcmail.env.mailbox});
        }
    }

    rcmail.addEventListener('plugin.tw_snippets', function(r) {
        $.each(r.asked || [], function(i, uid) { snippet_text[snippet_key(uid)] = (r.text || {})[uid] || ''; });
        snippets();
    });

    /* list bar, right side: "[page] of N  < >  | filter | list options"; threads and the page size are in the
       list options panel, the message count is shown nowhere (the folder's unread count is in the sidebar) */
    function pager() {
        var page = rcmail.env.current_page || 1, pages = rcmail.env.pagecount || 1;

        $(document.body).toggleClass('tw-in-trash', !!rcmail.env.trash_mailbox && rcmail.env.mailbox == rcmail.env.trash_mailbox);
        $('#tw-pagenum').prop('hidden', pages < 2);
        $('#tw-page-input').val(page);
        $('#tw-page-of').text(t('of') + ' ' + pages);
        $('#tw-filter-btn').toggleClass('tw-active', period_filter() != 'ALL');
        period_panel();
        listopts_panel();
        years_prefetch();
        fit_listbar();
    }

    /* "Период" (the funnel): sort order and messages per year, counts from tw_folders (plugin.tw-years) */
    var years = {}; // per folder, for this page load

    // Roundcube keeps the last filter in env after the search is gone (a folder clicked): only a live search counts
    function period_filter() { return (rcmail.env.search_request && rcmail.env.search_filter) || 'ALL'; }
    function year_filter(y) { return 'SENTSINCE 1-Jan-' + y + ' SENTBEFORE 1-Jan-' + (y + 1); }

    function period_panel() {
        var box = $('#tw-filter-menu'), data = years[rcmail.env.mailbox], current = period_filter(),
            desc = (rcmail.env.sort_order || 'DESC') == 'DESC', list = $('<ul class="tw-period-years" role="menu">');

        function year_row(filter, label, n) {
            var on = current == filter;
            $('<li role="none">').append($('<a href="#" role="menuitemradio">').attr('aria-checked', String(on))
                .append($('<span>').text(label), $('<span class="tw-period-n">').text(n == null ? '' : n))
                .on('click', function() {
                    close_menus();
                    if (!on) {
                        rcmail.env.search_scope = 'base';
                        rcmail.filter_mailbox(filter);
                    }
                    return false;
                })).appendTo(list);
        }

        if (data) {
            year_row('ALL', t('period_all'), data.total);
            $.each(data.years, function(i, y) { year_row(year_filter(y[0]), t('period_year').replace('$y', y[0]), y[1]); });
        }
        else
            $('<li class="tw-period-wait">').text(t('loading')).appendTo(list);

        box.empty().append(
            $('<div class="tw-period-head">').append($('<span>').text(t('period')),
                $('<a href="#" class="tw-btn tw-icon-only tw-round ti ti-close">').attr('title', t('close'))
                    .on('click', function() { close_menus(); return false; })),
            $('<div class="tw-period-label">').text(t('sorting')),
            $.map([['DESC', t('newest_first'), desc], ['ASC', t('oldest_first'), !desc]], function(o) {
                return $('<label class="tw-radio">').append(
                    $('<input type="radio" name="tw_order">').val(o[0]).prop('checked', o[2]).on('change', function() {
                        rcmail.set_list_options([], rcmail.env.sort_col || 'date', o[0]);
                    }), $('<span>').text(o[1]))[0];
            }),
            $('<div class="tw-period-label">').text(t('messages_label')),
            list
        );
    }

    // the sliders button: sort column and threads, next to the button (Roundcube's own dialog opens mid-screen;
    // the sort order is in "Период")
    function listopts_panel() {
        var box = $('#tw-listopts-menu'),
            col = $('<select>').append($('#listoptions-sortcol option').clone()).val(rcmail.env.sort_col || '')
                .on('change', function() {
                    rcmail.set_list_options([], this.value, rcmail.env.sort_order, rcmail.env.threading ? 1 : 0);
                });

        // page sizes up to Roundcube's default max_pagesize (200); mail_pagesize is in tw_folders' allowed_prefs
        var size = $('<select>').append($.map([25, 50, 100, 200], function(n) { return $('<option>').val(n).text(n)[0]; }))
            .val(String(+rcmail.env.pagesize || 50))
            .on('change', function() {
                var v = +this.value;
                rcmail.addEventListener('responseaftersave-pref', function once() { // list again once it is stored
                    rcmail.removeEventListener('responseaftersave-pref', once);
                    rcmail.env.pagesize = v;
                    rcmail.list_mailbox(rcmail.env.mailbox, 1);
                });
                rcmail.http_post('utils/save-pref', {_name: 'mail_pagesize', _value: v});
            });

        box.empty().append($('<label class="tw-opt tw-opt-select">').append($('<span>').text(t('sort_by')), col),
            $('<label class="tw-opt tw-opt-select">').append($('<span>').text(t('page_size')), size));
        if (rcmail.env.threads) // the IMAP server can thread
            box.append($('<label class="tw-opt">').append($('<span>').text(t('threads_group')),
                $('<input type="checkbox" class="tw-switch">').prop('checked', !!rcmail.env.threading).on('change', function() {
                    rcmail.set_list_options([], rcmail.env.sort_col, rcmail.env.sort_order, this.checked ? 1 : 0);
                })));
    }

    // counts are asked for as soon as a folder is listed (once per folder), so the panel opens ready
    var years_asked = {};
    function years_prefetch() {
        var mbox = rcmail.env.mailbox;
        if (mbox && !years_asked[mbox]) {
            years_asked[mbox] = true;
            rcmail.http_request('plugin.tw-years', {_mbox: mbox});
        }
    }
    rcmail.addEventListener('plugin.tw_years', function(r) {
        years[r.mbox] = r;
        period_panel();
    });

    // one line always: only when the bar doesn't fit, drop the button words, then the page field
    var TIGHT = ['tw-tight', 'tw-tighter'];
    function fit_listbar() {
        var bar = document.querySelector('.tw-listbar');
        if (!bar)
            return;
        bar.classList.remove.apply(bar.classList, TIGHT);
        for (var i = 0; i < TIGHT.length && bar.scrollWidth > bar.clientWidth; i++)
            bar.classList.add(TIGHT[i]);
    }

    // the page field: Enter (or leaving it) opens that page
    $(document).on('keydown change', '#tw-page-input', function(e) {
        if (e.type == 'keydown' && e.key != 'Enter')
            return;
        var n = Math.min(Math.max(parseInt(this.value, 10) || 1, 1), rcmail.env.pagecount || 1);
        if (n != rcmail.env.current_page)
            rcmail.list_page(n);
        else
            this.value = n;
        return e.type != 'keydown';
    });

    // date groups + avatars + Timeweb dates. Group labels sit in data attributes:
    // list.js treats every <tr> of the table as a message, extra rows would break keyboard navigation.
    function decorate() {
        var now = new Date(),
            today = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            yesterday = new Date(today - 864e5),
            week = new Date(today - ((today.getDay() + 6) % 7) * 864e5),
            prev_week = new Date(week - 7 * 864e5),
            month = new Date(now.getFullYear(), now.getMonth(), 1),
            prev_month = new Date(now.getFullYear(), now.getMonth() - 1, 1),
            by_date = !rcmail.env.sort_col || rcmail.env.sort_col == 'date' || rcmail.env.sort_col == 'arrival',
            last;

        $('#messagelist > tbody > tr.message').each(function() {
            var row = $(this), td = row.children('td.subject'), el = td.children('span.date'), d = el.data('tw-date'), m, label;

            if (!td.children('.tw-avatar').length)
                avatar(td.find('span.fromto').text(), td.find('span.fromto [title]').attr('title')).prependTo(td);
            // the third line exists from the start (empty, full height); snippets() fills it in, the row keeps its size
            if (!td.children('.tw-snippet').length)
                $('<span class="tw-snippet skip-on-drag">').appendTo(td);

            if (!d) {
                if (!(m = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)$/.exec($.trim(el.text()))))
                    return;
                d = new Date(m[1], m[2] - 1, m[3]);
                el.data('tw-date', d).text(d >= today ? m[4]
                    : d.toLocaleDateString(locale(), d.getFullYear() != now.getFullYear() ? {day: 'numeric', month: 'long', year: 'numeric'} : {day: 'numeric', month: 'long'}) + ' ' + m[4]);
            }

            label = d >= today ? t('today') : d >= yesterday ? t('yesterday') : d >= week ? t('this_week')
                : d >= prev_week ? t('last_week') : d >= month ? t('this_month') : d >= prev_month ? t('last_month')
                : d.toLocaleDateString(locale(), d.getFullYear() != now.getFullYear() ? {month: 'long', year: 'numeric'} : {month: 'long'});
            label = label.charAt(0).toUpperCase() + label.slice(1); // ru: "ноябрь"

            row.add(td).attr('data-tw-group', by_date && label != last ? label : null);
            last = label;
        });
    }

    function sidebar() {
        var quick = $('.tw-quick');

        // quick filters search all folders, like the Timeweb sidebar
        quick.on('click', 'a[data-filter]', function() {
            rcmail.env.search_scope = 'all';
            rcmail.filter_mailbox($(this).data('filter'));
            $('#mailboxlist li.selected').removeClass('selected');
            quick.children().removeClass('selected');
            $(this).parent().addClass('selected');
            return false;
        });
        $('#mailboxlist').on('click', 'a', function() {
            quick.children().removeClass('selected');
            rcmail.env.search_scope = 'base';
        });

        $('#mailboxlist li.junk > a').contents().first().replaceWith(t('junk')); // ru_RU says "СПАМ"

        folders_block(quick.children('.tw-q-heading'));
        folder_menu();
        message_menu();

        // accounts (ident_switch plugin): list in the sidebar, the plugin's <select> does the switching
        var select = $('#plugin-ident_switch-account'), box = $('#tw-accounts');
        if (select.find('option').length > 1) {
            select.find('option').each(function() {
                var opt = this, m = /^(.*?)\s*\((\d+)\)$/.exec(opt.text) || [0, opt.text, ''];
                $('<li>').toggleClass('selected', opt.selected)
                    .append($('<a href="#">').attr('title', m[1])
                        .append($('<span class="tw-name">').text(m[1]))
                        .append(m[2] ? $('<span class="unreadcount">').text(m[2]) : null)
                        .on('click', function() {
                            if (!opt.selected)
                                select.val(opt.value).trigger('change');
                            return false;
                        }))
                    .appendTo(box);
            });
            box.prop('hidden', false);
        }
    }

    // "Папки" block: collapsible list of user folders, "+" creates a folder at the top level
    function folders_block(heading) {
        var wrap = $('#folderlist-content'), toggle = heading.find('.tw-q-toggle'), key = 'tw-folders-collapsed';

        function collapse(on) {
            wrap.toggleClass('tw-collapsed', on);
            toggle.attr('aria-expanded', String(!on));
            try { localStorage.setItem(key, on ? '1' : ''); } catch (e) { /* storage blocked */ }
        }
        try { collapse(localStorage.getItem(key) == '1'); } catch (e) { /* storage blocked */ }

        toggle.on('click', function() { collapse(!wrap.hasClass('tw-collapsed')); return false; });

        heading.find('.tw-new-folder').on('click', function() { folder_dialog(); return false; });
        folder_styles();
    }

    /* ----------------------------------------------------------------- folder icons and colours */
    var FOLDER_ICONS = [
            ['folder', 'icon_folder'], ['bookmark', 'icon_bookmark'], ['tag', 'icon_tag'], ['flag', 'icon_flag'], ['archive', 'icon_archive'],
            ['mail', 'icon_mail'], ['message', 'icon_message'], ['user', 'icon_user'], ['calendar', 'icon_calendar'],
            ['paperclip', 'icon_paperclip'], ['cloud', 'icon_cloud'], ['lock', 'icon_lock']
        ],
        FOLDER_COLORS = [
            ['#4b5563', 'color_gray'], ['#317bff', 'color_blue'], ['#0bb4c9', 'color_teal'], ['#20b26c', 'color_green'],
            ['#f5b800', 'color_yellow'], ['#ff8a00', 'color_orange'], ['#f0445b', 'color_red'], ['#ec4899', 'color_pink'], ['#8b5cf6', 'color_purple']
        ];

    function icon_url(name) {
        // absolute: a url() inside a custom property resolves against the stylesheet that uses var(), not the page
        var href = new URL($('link[href*="styles/breeze.css"]').attr('href') || '', location.href).href;
        return 'url(' + href.replace(/styles\/breeze\.css.*$/, 'images/icons/' + name + '.svg') + ')';
    }

    // icon/colour saved per folder (user pref tw_folder_style, exported by the tw_folders plugin)
    function folder_styles() {
        $.each(rcmail.env.tw_folder_style || {}, function(id, s) {
            var a = $('#mailboxlist a').filter(function() { return $(this).attr('rel') === id; });
            if (s.icon && /^[a-z-]+$/.test(s.icon))
                a.css('--ti', icon_url(s.icon));
            if (s.color && /^#[0-9a-f]{6}$/i.test(s.color))
                a.css('--tw-ico-color', s.color);
        });
    }

    // dropdown with an icon in every option: button + list of buttons
    function picker(label, options, render, value) {
        var box = $('<div class="tw-field tw-pick">').append($('<label>').text(label)),
            current = $('<button type="button" class="tw-pick-btn" aria-haspopup="listbox" aria-expanded="false">'),
            list = $('<div class="tw-pick-list" role="listbox" hidden>');

        function set(v) {
            value = v;
            var o = $.grep(options, function(o) { return o[0] == v; })[0];
            current.empty().append(render(o)).append('<span class="tw-pick-caret ti ti-chevron-down"></span>');
            box.trigger('change', [v]);
        }
        function open(on) {
            list.prop('hidden', !on);
            current.attr('aria-expanded', String(on));
        }

        $.each(options, function(i, o) {
            $('<button type="button" role="option" class="tw-pick-item">').append(render(o))
                .on('click', function() { set(o[0]); open(false); current.focus(); })
                .appendTo(list);
        });
        current.on('click', function() { open(list.prop('hidden')); });
        box.on('keydown', function(e) { if (e.key == 'Escape' && !list.prop('hidden')) { open(false); current.focus(); return false; } });
        $(document).on('mousedown.twpick', function(e) { if (!$(e.target).closest(box).length) open(false); });

        box.append(current, list);
        box.val = function() { return value; };
        set(value);
        return box;
    }

    /* ----------------------------------------------------------------- folder rules (filters) */
    var RULE_FIELDS = ['from', 'to', 'subject'];

    function today() {
        var d = new Date();
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    function decode_js_string(s) { return JSON.parse('"' + s + '"'); }

    // editable list of conditions "<field> contains <text>"; onchange fires on every edit
    function rules_editor(rules, onchange) {
        var box = $('<div class="tw-rules">'), list = $('<div class="tw-rules-list">').appendTo(box);

        function row(r) {
            var field = $('<select class="tw-text-input tw-rule-field">').attr('aria-label', t('rule_field')),
                value = $('<input type="text" class="tw-text-input tw-rule-value" maxlength="200">').attr({placeholder: t('contains_ph'), 'aria-label': t('contains')});
            $.each(RULE_FIELDS, function(i, f) { $('<option>').val(f).text(t('rule_' + f)).appendTo(field); });
            field.val(r.field || 'from');
            value.val(r.value || '');
            return $('<div class="tw-rule">').data('created', r.created || '')
                .append(field, value, // "содержит" lives in the placeholder: the row must fit the 440px dialog
                    $('<button type="button" class="tw-btn tw-icon-only ti ti-close tw-rule-del"><span class="inner"></span></button>').attr('title', t('rule_del'))
                        .on('click', function() { $(this).closest('.tw-rule').remove(); onchange && onchange(); }))
                .appendTo(list);
        }

        $.each(rules || [], function(i, r) { row(r); });
        $('<button type="button" class="tw-link-btn ti ti-plus">').text(t('rule_add'))
            .on('click', function() { row({}).find('.tw-rule-value').focus(); onchange && onchange(); })
            .appendTo(box);
        box.on('input change', 'select, input', function() { onchange && onchange(); });

        // current conditions; created date kept for unchanged ones (rules only act on mail since that day)
        box.val = function(folder, old) {
            var out = [];
            list.children('.tw-rule').each(function() {
                var field = $(this).find('.tw-rule-field').val(), value = $.trim($(this).find('.tw-rule-value').val()), prev;
                if (!value)
                    return;
                prev = $.grep(old || [], function(o) { return o.field == field && o.value == value; })[0];
                out.push({folder: folder, field: field, value: value, created: (prev && prev.created) || today()});
            });
            return out;
        };
        return box;
    }

    // rules of all folders except `folder`, plus `mine` for it
    function merge_rules(folder, mine, rename_from) {
        var rest = $.grep(rcmail.env.tw_rules || [], function(r) { return r.folder != folder && r.folder != rename_from; });
        return rest.concat(mine);
    }

    function save_folder_request(data) {
        // the same request the Settings > Folders form sends (create: _mbox empty; edit: _mbox = current name)
        return $.post(rcmail.url('settings/save-folder'), $.extend({_token: rcmail.env.request_token}, data));
    }

    /* ----------------------------------------------------------------- "Создать папку" / "Редактировать папку" */
    function folder_dialog(edit_id) {
        var editing = !!edit_id,
            delim = rcmail.env.delimiter || '.',
            style = (editing && (rcmail.env.tw_folder_style || {})[edit_id]) || {},
            color = style.color || FOLDER_COLORS[0][0], icon = style.icon || 'folder',
            old_rules = editing ? $.grep(rcmail.env.tw_rules || [], function(r) { return r.folder == edit_id; }) : [],
            old_parent = editing && edit_id.lastIndexOf(delim) > 0 ? edit_id.slice(0, edit_id.lastIndexOf(delim)) : '',
            old_name = editing ? ((rcmail.env.mailboxes || {})[edit_id] || {}).name || edit_id.split(delim).pop() : '',
            overlay = $('<div class="tw-modal-overlay">'),
            modal = $('<div class="tw-modal" role="dialog" aria-modal="true" aria-labelledby="tw-folder-title">').appendTo(overlay),
            art = $('<div class="tw-folder-art" aria-hidden="true">').html(
                '<svg viewBox="0 0 96 80" width="72" height="60"><path class="tw-art-back" d="M6 14a6 6 0 0 1 6-6h22l8 8h42a6 6 0 0 1 6 6v46a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6z"/>'
                + '<rect class="tw-art-tab" x="54" y="4" width="22" height="16" rx="4"/>'
                + '<rect class="tw-art-paper" x="14" y="20" width="68" height="40" rx="3"/>'
                + '<path class="tw-art-front" d="M4 30a6 6 0 0 1 6-6h76a6 6 0 0 1 6 6l-3 38a6 6 0 0 1-6 6H13a6 6 0 0 1-6-6z"/></svg>'),
            name = $('<input type="text" class="tw-text-input" maxlength="128" autocomplete="off">').attr('id', 'tw-folder-name').val(old_name),
            parent_sel = $('<select class="tw-text-input" id="tw-folder-parent">').append($('<option value="">').text(t('not_selected'))),
            submit = $('<button type="button" class="tw-primary-btn" disabled>').text(t(editing ? 'save_changes' : 'create_folder')),
            rules = rules_editor(old_rules, update),
            icons = picker(t('icon'), FOLDER_ICONS, function(o) {
                return [$('<span class="tw-pick-ico">').css('--ti', icon_url(o[0])), $('<span>').text(t(o[1]))];
            }, icon),
            colors = picker(t('color'), FOLDER_COLORS, function(o) {
                return [$('<span class="tw-pick-dot">').css('background', o[0]), $('<span>').text(t(o[1]))];
            }, color),
            initial;

        // possible parents: every folder of the account (ids are IMAP names), not the folder itself or its subfolders
        $.each(rcmail.env.mailboxes || {}, function(id, f) {
            if (f.virtual || (editing && (id == edit_id || id.indexOf(edit_id + delim) === 0)))
                return;
            $('<option>').val(id).text(new Array((id.split(delim).length - 1) * 2 + 1).join(' ') + f.name).appendTo(parent_sel);
        });
        parent_sel.val(old_parent);

        function state() {
            return JSON.stringify([$.trim(name.val()), parent_sel.val(), icon, color, rules.val('', old_rules)]);
        }
        // "Создать папку" needs a name; "Сохранить изменения" needs a change
        function update() {
            submit.prop('disabled', !$.trim(name.val()) || (editing && state() === initial));
        }
        function paint() {
            art.css('--tw-art', color);
            icons.find('.tw-pick-ico').css('--tw-ico-color', color);
        }
        icons.on('change', function(e, v) { icon = v; update(); });
        colors.on('change', function(e, v) { color = v; paint(); update(); });
        name.on('input', update).on('keydown', function(e) { if (e.key == 'Enter' && !submit.prop('disabled')) submit.click(); });
        parent_sel.on('change', update);

        function close() {
            $(document).off('mousedown.twpick keydown.twmodal');
            overlay.remove();
        }
        function fail(msg) {
            submit.prop('disabled', false);
            rcmail.display_message(msg || rcmail.gettext('servererror'), 'error');
        }
        // store icon/colour and rules under the folder's (new) id, then reload: the folder list comes from the server
        function finish(id) {
            var styles = $.extend({}, rcmail.env.tw_folder_style || {});
            if (editing)
                delete styles[edit_id];
            styles[id] = {icon: icon, color: color};
            $.when(save_pref('tw_folder_style', styles),
                save_pref('tw_rules', merge_rules(id, rules.val(id, old_rules), edit_id)))
                .always(function() { location.reload(); });
        }

        submit.on('click', function() {
            var new_name = $.trim(name.val()), new_parent = parent_sel.val();
            submit.prop('disabled', true);

            if (editing && new_name === old_name && new_parent === old_parent)
                return finish(edit_id); // only icon/colour/rules changed

            save_folder_request({_name: new_name, _parent: new_parent, _mbox: editing ? edit_id : ''})
                .done(function(html) {
                    var err = /display_message\("((?:[^"\\]|\\.)*)","error"/.exec(html),
                        added = /add_folder_row\("((?:[^"\\]|\\.)*)"/.exec(html),
                        renamed = /replace_folder_row\("(?:[^"\\]|\\.)*","((?:[^"\\]|\\.)*)"/.exec(html);
                    if (err)
                        return fail(decode_js_string(err[1]));
                    if (editing ? !renamed : !added)
                        return fail(rcmail.gettext('errorsaving'));
                    finish(decode_js_string((editing ? renamed : added)[1]));
                })
                .fail(function() { fail(); });
        });

        modal.append(
            $('<button type="button" class="tw-modal-close ti ti-close">').attr('aria-label', t('close')).on('click', close),
            art,
            $('<h2 id="tw-folder-title" class="tw-modal-title">').text(t(editing ? 'edit_folder' : 'create_folder')),
            $('<div class="tw-modal-row">').append(icons, colors),
            $('<div class="tw-field">').append($('<label for="tw-folder-name">').text(t('folder_name')), name),
            $('<div class="tw-field">').append($('<label for="tw-folder-parent">').text(t('parent_folder')), parent_sel),
            $('<div class="tw-field tw-rules-field">').append(
                $('<label>').text(t('filter')),
                $('<p class="tw-hint">').text(t('filter_hint')),
                rules),
            submit
        );
        overlay.on('mousedown', function(e) { if (e.target === this) close(); }).appendTo(document.body);
        $(document).on('keydown.twmodal', function(e) { if (e.key == 'Escape' && !modal.find('.tw-pick-list:not([hidden])').length) close(); });
        paint();
        initial = state();
        update();
        name.focus();
    }

    /* ----------------------------------------------------------------- folder "⋮" menu: edit, delete */
    var menu_folder = null;

    // folder actions: the "⋮" button of user folders and a right click on any folder
    function folder_menu() {
        var special = '.inbox,.drafts,.sent,.junk,.trash,.archive',
            menu = $('<div id="tw-folder-menu" class="tw-menu tw-ctx" hidden><ul role="menu"></ul></div>').appendTo(document.body);

        function fill(li) {
            var id = li.children('a').attr('rel'), env = rcmail.env, items = [];
            menu_folder = id;
            if ((env.unread_counts || {})[id])
                items.push([rcmail.gettext('markallread'), 'mail-open', function() { rcmail.mark_all_read(id); }]);
            if (id == env.trash_mailbox || id == env.junk_mailbox)
                items.push([rcmail.gettext('empty'), 'trash', function() { rcmail.purge_mailbox(id); }, 'tw-danger']);
            if (!li.is(special)) {
                items.push(null, [t('edit'), 'settings', function() { folder_dialog(id); }]);
                items.push([t('delete_folder'), 'trash', function() { delete_folder(id); }, 'tw-danger']);
            }
            return ctx_fill(menu, items);
        }

        $('#mailboxlist li.mailbox').not(special).each(function() {
            var li = $(this);
            $('<button type="button" class="tw-folder-more ti ti-more-vertical" data-tw-menu="tw-folder-menu" aria-haspopup="true">')
                .attr('title', t('folder_actions'))
                .append($('<span class="inner">').text(t('folder_actions')))
                .on('click', function() { fill(li); return open_menu.call(this); }) // the folder list stops clicks from bubbling
                .appendTo(li);
        });

        // to the right of the folder, not under the pointer on top of it
        $('#mailboxlist').on('contextmenu', 'li.mailbox > a', function() {
            var r = this.getBoundingClientRect();
            if (fill($(this).parent()))
                ctx_open(menu, {clientX: r.right + 8, clientY: r.top});
            return false;
        });
    }

    /* ----------------------------------------------------------------- right-click menus (messages, folders)
       items: [label, icon, action, extra class] or null for a separator; false when there is nothing to show */
    function ctx_fill(menu, items) {
        var ul = menu.children('ul').empty();
        $.each(items, function(i, it) {
            if (!it) {
                if (ul.children().length && !ul.children().last().is('.tw-ctx-sep'))
                    $('<li class="tw-ctx-sep" role="separator">').appendTo(ul);
                return;
            }
            $('<li role="none">').append($('<a href="#" role="menuitem">').addClass(it[3] || '')
                .append($('<span class="ti" aria-hidden="true">').addClass('ti-' + it[1]), $('<span>').text(it[0]))
                .on('click', function(e) {
                    if (it[2](this, e) !== true) // true: the action refilled the menu ("Переместить в…")
                        menu.prop('hidden', true);
                    return false;
                })).appendTo(ul);
        });
        ul.children('.tw-ctx-sep').last().filter(':last-child').remove();
        return ul.children().length > 0;
    }

    // at the pointer, kept inside the window
    function ctx_open(menu, e) {
        close_menus();
        menu.prop('hidden', false);
        var w = menu.outerWidth(), h = menu.outerHeight();
        menu.css({
            left: Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)),
            top: e.clientY + h > window.innerHeight - 8 ? Math.max(8, e.clientY - h) : e.clientY
        });
    }

    // right click on a message: the ticked set if the row is in it, otherwise that message alone (not opened)
    function message_menu() {
        var menu = $('<div id="tw-msg-menu" class="tw-menu tw-ctx" hidden><ul role="menu"></ul></div>').appendTo(document.body),
            list = rcmail.message_list, last_event;

        $('#messagelist').on('contextmenu', 'tbody tr', function(e) {
            var uid = this.uid, sel, rows, read, flagged, items;
            last_event = e;
            if (!list || uid === undefined)
                return;

            if ($.inArray(String(uid), $.map(list.get_selection(), String)) < 0) {
                TW.no_preview = true; // see msglist_get_preview: a right click selects without opening
                setTimeout(function() { TW.no_preview = false; }, 1000);
                list.select_row(uid, false, false);
            }

            sel = list.get_selection();
            rows = $.map(sel, function(u) { return list.rows[u] ? $(list.rows[u].obj) : null; });
            read = !rows.some(function(r) { return r.hasClass('unread'); });
            flagged = rows.length && rows.every(function(r) { return r.hasClass('flagged'); });

            var one = sel.length == 1,
                sender = one ? (rows[0].find('span.fromto [title]').attr('title') || '') : '';

            // in the order of Timeweb's menu: open / answer, sort out, find, delete
            items = one ? [
                [t('open_in_tab'), 'external', function() {
                    window.open(rcmail.url('show', rcmail.params_from_uid(sel[0])), '_blank');
                }],
                [rcmail.gettext('reply'), 'reply', function() { rcmail.command('reply'); }],
                [rcmail.gettext('replyall'), 'reply-all', function() { rcmail.command('reply-all'); }],
                [rcmail.gettext('forward'), 'forward', function() { rcmail.command('forward'); }],
                [rcmail.gettext('editasnew'), 'drafts', function() { rcmail.command('edit', 'new'); }],
                null
            ] : [];
            // the plugins' own labels, when they are enabled here
            if (rcmail.commands['plugin.archive'] !== undefined && rcmail.env.archive_folder)
                items.push([rcmail.gettext('buttontext', 'archive'), 'archive', function() { rcmail.command('plugin.archive'); }]);
            if (rcmail.commands['plugin.markasjunk.junk'] !== undefined)
                items.push([rcmail.gettext('asjunk', 'markasjunk'), 'ban', function() { rcmail.command('plugin.markasjunk.junk'); }]);
            if (sender)
                items.push([t('create_filter'), 'filter', function() {
                    location.href = rcmail.url('settings/plugin.tw-filters', {_tw_from: sender});
                }]);
            items.push(
                [rcmail.gettext(read ? 'markunread' : 'markread'), read ? 'mail' : 'mail-open',
                    function() { rcmail.command('mark', read ? 'unread' : 'read'); }],
                [rcmail.gettext(flagged ? 'markunflagged' : 'markflagged'), 'bookmark',
                    function() { rcmail.command('mark', flagged ? 'unflagged' : 'flagged'); }],
                null,
                // the folders replace the items in this menu (Roundcube's own selector is a toggling popover
                // placed next to an element that this menu hides)
                [rcmail.gettext('moveto'), 'folder', function() {
                    var env = rcmail.env, folders = [];
                    $.each(env.mailboxes_list || [], function(i, id) {
                        var f = env.mailboxes[id] || {}, depth = env.delimiter ? id.split(env.delimiter).length - 1 : 0;
                        if (id != env.mailbox && !f.virtual)
                            folders.push([f.name || id, 'folder', function() { rcmail.move_messages(id); }, 'tw-ctx-depth' + Math.min(depth, 3)]);
                    });
                    ctx_fill(menu, folders);
                    ctx_open(menu, last_event);
                    return true; // keep the menu open
                }]
            );
            // everything from this sender: the quick search on the address (Roundcube searches From by default)
            if (sender)
                items.push([t('sender_mail'), 'user', function() {
                    $('#mailsearchform').val(sender);
                    rcmail.command('search');
                }]);
            items.push(null, [rcmail.gettext('delete'), 'trash', function() { rcmail.command('delete'); }, 'tw-danger']);

            ctx_fill(menu, items);
            ctx_open(menu, e);
            return false;
        });
    }

    function delete_folder(id) {
        var name = ((rcmail.env.mailboxes || {})[id] || {}).name || id;
        rcmail.confirm_dialog(t('delete_folder_confirm').replace('$name', name), 'delete', function() {
            $.ajax({type: 'POST', url: rcmail.url('settings/delete-folder'), data: {_mbox: id, _remote: 1},
                headers: {'X-Roundcube-Request': rcmail.env.request_token}})
                .done(function(r) {
                    // the response is 200 even when the server refused: only a removed row means it's gone
                    if (!r || !/remove_folder_row/.test(r.exec || ''))
                        return rcmail.display_message(rcmail.gettext('errorsaving'), 'error');
                    var styles = $.extend({}, rcmail.env.tw_folder_style || {});
                    delete styles[id];
                    $.when(save_pref('tw_folder_style', styles), save_pref('tw_rules', merge_rules(id, [])))
                        .always(function() {
                            if (rcmail.env.mailbox == id)
                                location.href = './?_task=mail&_mbox=INBOX'; // the open folder is gone; rcmail.url('mail/') would give _action=mail
                            else
                                location.reload();
                        });
                })
                .fail(function() { rcmail.display_message(rcmail.gettext('servererror'), 'error'); });
        });
    }

    /* ----------------------------------------------------------------- contacts panel (top bar "Контакты", mail screen)
       Address book entries plus recent correspondents (plugin.tw-contacts). A click writes to the contact. */
    function contacts_panel() {
        var link = $('#taskmenu a.contacts'), panel, list, count, search, sort = 'recent', data = null;

        function build() {
            panel = $('<aside id="tw-contacts" class="tw-contacts" aria-labelledby="tw-contacts-title" hidden>').appendTo(document.body);
            var head = $('<div class="tw-contacts-head">').appendTo(panel),
                tools = $('<div class="tw-contacts-tools">').appendTo(panel),
                meta = $('<div class="tw-contacts-meta">').appendTo(panel);
            head.append($('<h2 id="tw-contacts-title">').text(t('contacts')),
                $('<button type="button" class="tw-round-btn ti ti-close">').attr('aria-label', t('close')).on('click', toggle));

            search = $('<input type="search" class="tw-text-input" hidden>').attr({placeholder: t('search_contacts'), 'aria-label': t('search_contacts')})
                .on('input', render);
            tools.append(
                $('<button type="button" class="tw-square-btn ti ti-search">').attr({title: t('search'), 'aria-label': t('search')}).on('click', function() {
                    var show = search.prop('hidden');
                    search.prop('hidden', !show).val('');
                    render();
                    show && search.focus();
                }),
                $('<a class="tw-square-btn tw-accent ti ti-plus">').attr({title: t('new_contact'), 'aria-label': t('new_contact')})
                    .attr('href', './?_task=addressbook')
                    .on('click', function() { try { sessionStorage.setItem('tw_new_contact', '1'); } catch (e) {} }),
                $('<a class="tw-pill-btn ti ti-contacts">').attr('href', './?_task=addressbook').text(t('all_contacts')),
                search);

            count = $('<span class="tw-contacts-count">').appendTo(meta);
            $('<button type="button" class="tw-link-btn tw-icon-after ti ti-chevron-down" data-tw-menu="tw-contacts-sort" aria-haspopup="true">')
                .text(t('recent')).appendTo(meta);
            var menu = $('<div id="tw-contacts-sort" class="tw-menu" hidden><ul role="menu"></ul></div>').appendTo(document.body);
            $.each([['recent', t('recent')], ['name', t('by_name')]], function(i, o) {
                $('<li role="menuitem">').append($('<a href="#">').text(o[1]).on('click', function() {
                    sort = o[0];
                    meta.find('[data-tw-menu]').text(o[1]);
                    menu.prop('hidden', true);
                    render();
                    return false;
                })).appendTo(menu.children('ul'));
            });

            list = $('<ul class="tw-contacts-list" role="list">').appendTo(panel)
                .on('click', 'li', function() {
                    var c = $(this).data('c');
                    TW.openCompose({_to: c[0] ? '"' + c[0].replace(/"/g, '') + '" <' + c[1] + '>' : c[1]});
                })
                .on('keydown', 'li', function(e) { e.key == 'Enter' && $(this).click(); })
                .on('click', '.tw-contact-add', function(e) {
                    var c = $(this).closest('li').data('c');
                    $(this).prop('disabled', true);
                    rcmail.http_post('plugin.tw-contact-add', {_email: c[1], _name: c[0]}, rcmail.set_busy(true, 'loading'));
                    e.stopPropagation();
                });
        }

        function render() {
            if (!data)
                return;
            var q = $.trim(search.val()).toLowerCase(),
                items = $.grep(data, function(c) { return !q || (c[0] + ' ' + c[1]).toLowerCase().indexOf(q) >= 0; });
            items.sort(sort == 'name'
                ? function(a, b) { return (a[0] || a[1]).localeCompare(b[0] || b[1], locale()); }
                : function(a, b) { return b[2] - a[2] || (a[0] || a[1]).localeCompare(b[0] || b[1], locale()); });

            count.text(data.length + ' ' + t('total'));
            list.empty();
            $.each(items.slice(0, 500), function(i, c) {
                $('<li tabindex="0">').data('c', c).attr('title', t('write_to') + ' ' + c[1])
                    .append(avatar(c[0] || c[1], c[1]).addClass('tw-avatar-lg'),
                        $('<span class="tw-contact-text">').append(
                            $('<span class="tw-contact-name">').toggleClass('tw-muted', !c[0]).text(c[0] || t('no_name')),
                            $('<span class="tw-contact-email">').text(c[1])),
                        c[3] ? null : $('<button type="button" class="tw-btn tw-icon-only ti ti-user-plus tw-contact-add">')
                            .attr({title: t('add_to_contacts'), 'aria-label': t('add_to_contacts')}))
                    .appendTo(list);
            });
            if (!items.length)
                $('<li class="tw-contacts-empty">').text(t(q ? 'nothing_found' : 'no_contacts')).appendTo(list);
        }

        function toggle() {
            panel || build();
            var open = panel.prop('hidden');
            panel.prop('hidden', !open);
            link.toggleClass('selected', open);
            if (open && !data) {
                list.html($('<li class="tw-contacts-empty">').text(t('loading')));
                rcmail.http_get('plugin.tw-contacts', {}, rcmail.set_busy(true, 'loading'));
            }
            return false;
        }

        rcmail.addEventListener('plugin.tw_contact_added', function(r) {
            if (r.ok)
                $.each(data || [], function(i, c) { if (c[1] == r.email) c[3] = 1; });
            rcmail.display_message(t(r.ok ? 'contact_saved' : 'save_failed'), r.ok ? 'confirmation' : 'error');
            render(); // also re-enables the button after a failure
        });
        rcmail.addEventListener('plugin.tw_contacts', function(r) {
            data = r.contacts || [];
            render();
        });
        $(document).on('keydown', function(e) {
            if (e.key == 'Escape' && panel && !panel.prop('hidden') && !$('.tw-menu:not([hidden])').length)
                toggle();
        });
        link.prop('onclick', null).on('click', function(e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button)
                return true; // new tab: the address book page
            return toggle();
        });
    }

    /* ----------------------------------------------------------------- address book page: avatar + name + e-mail rows */
    function addressbook() {
        var list = rcmail.contact_list, counts = rcmail.env.tw_ab_counts || {}, pending = [], timer;

        // Timeweb columns: checkbox | avatar + name | e-mail | phone
        list.enable_checkbox_selection();
        $(list.list).addClass('withselection');

        function decorate_row(uid, tr) {
            var d = list.data[uid] || {}, td = $(tr).children('td.name');
            if (!td.length || td.find('.tw-avatar').length)
                return;
            var name = $.trim(td.text()), email = d.email || '', noname = !name || name == email;
            td.empty().append(
                $('<span class="tw-c-name">').append(avatar(noname ? email : name, email).addClass('tw-avatar-md'),
                    $('<span class="tw-contact-name">').toggleClass('tw-muted', noname).text(noname ? t('no_name') : name)),
                $('<span class="tw-c-email">').text(email),
                $('<span class="tw-c-phone tw-muted">').text(t('not_filled')));
            if (!$(tr).hasClass('group'))
                pending.push(uid);
            clearTimeout(timer);
            timer = setTimeout(phones, 100);
        }

        // phones come separately: Roundcube's list sends only name and e-mail
        function phones() {
            if (!pending.length)
                return;
            rcmail.http_get('plugin.tw-ab-phones', {_source: rcmail.env.source, _cids: pending.join(',')});
            pending = [];
        }
        rcmail.addEventListener('plugin.tw_ab_phones', function(map) {
            $.each(map || {}, function(uid, phone) {
                var row = list.rows[uid];
                row && $(row.obj).find('.tw-c-phone').removeClass('tw-muted').text(phone);
            });
        });

        rcmail.addEventListener('insertrow', function(o) { o.cid && o.row && decorate_row(o.cid, o.row.obj); });
        $.each(list.rows, function(uid, row) { decorate_row(uid, row.obj); }); // rows added before 'init'

        // header: count badge (whole book only) and the select-all checkbox
        function header() {
            var n = counts[rcmail.env.source],
                group = (rcmail.env.contactgroups || {})['G' + rcmail.env.source + rcmail.env.group],
                book = $('#directorylist > li > a[rel="' + rcmail.env.source + '"] .tw-name').text();
            if (!rcmail.env.search_request && (group || book))
                $('#rcmabooklisttitle').text(group ? group.name : book);
            $('.tw-ab-count').text(n).prop('hidden', n === undefined || !!rcmail.env.group || !!rcmail.env.search_request);
            $('#tw-labels li').removeClass('selected')
                .filter(function() { return $(this).data('gid') == rcmail.env.group && $(this).data('source') == rcmail.env.source; })
                .addClass('selected');
        }
        var all = $('#tw-ab-all').on('change', function() {
            rcmail.command(this.checked ? 'select-all' : 'select-none', this.checked ? 'page' : '');
        });
        list.addEventListener('select', function() {
            var n = list.get_selection().length;
            all.prop({checked: n > 0 && n == list.rowcount, indeterminate: n > 0 && n < list.rowcount});
        });
        rcmail.addEventListener('listupdate', header);
        rcmail.addEventListener('responseafterlist', header);

        // sidebar: Timeweb names and counts
        $('#directorylist > li').each(function() {
            // Timeweb's name for the personal book; full Roundcube name in the tooltip
            var a = $(this).children('a'), id = a.attr('rel'), full = $.trim(a.text()),
                name = $('<span class="tw-name">').text(id == '0' ? t('my_contacts') : full); // span: ellipsis
            a.empty().append(name).attr('title', full);
            if (counts[id] !== undefined)
                a.append($('<span class="tw-book-count">').text(counts[id]));
        });

        // "Мои метки": contact groups as one flat list (Roundcube nests them under their address book)
        function labels() {
            var ul = $('#tw-labels').empty();
            $.each(rcmail.env.contactgroups || {}, function(key, g) {
                $('<li>').data({gid: g.id, source: g.source}).append(
                    $('<a href="#">').text(g.name).on('click', function() {
                        rcmail.list_contacts(g.source, g.id);
                        return false;
                    })).appendTo(ul);
            });
            header();
        }
        $.each(['group_insert', 'group_update', 'group_delete'], function(i, e) {
            rcmail.addEventListener(e, function() { setTimeout(labels, 0); });
        });
        labels();

        // sort select (address book preference; the list is sorted on the server)
        $('#tw-ab-sort').val(rcmail.env.tw_ab_sort || 'surname').on('change', function() {
            save_pref('addressbook_sort_col', this.value).always(function() {
                rcmail.list_contacts(rcmail.env.source, rcmail.env.group, null, true);
            });
        });

        // right panel: shown while the frame has a contact or a form
        var frame = $('#contact-frame').on('load', function() {
            var href = '';
            try { href = this.contentWindow.location.href; } catch (e) {}
            $(document.body).toggleClass('tw-ab-open', /_action=/.test(href));
        });
        $('.tw-ab-close').on('click', function() {
            list.clear_selection();
            rcmail.show_contentframe(false);
            $(document.body).removeClass('tw-ab-open');
            return false;
        });
        frame.length && $(document.body).removeClass('tw-ab-open');
        // "+" in the contacts panel opens the new contact form here
        // (a flag, not a URL parameter: Roundcube rewrites the address bar on load)
        var add = false;
        try { add = sessionStorage.getItem('tw_new_contact') == '1'; sessionStorage.removeItem('tw_new_contact'); } catch (e) {}
        // "add" is enabled once the selected address book has loaded
        for (var n = 1; add && n <= 20; n++)
            setTimeout(function() {
                if (add && rcmail.commands.add) {
                    add = false;
                    rcmail.command('add');
                }
            }, n * 150);
    }

    /* ----------------------------------------------------------------- Settings > Фильтры */
    function filters_page() {
        var page = $('#tw-filters'), folders = rcmail.env.tw_rule_folders || {}, timer;
        if (!page.length)
            return;

        $('#layout-content > .header .header-title').text(t('filters')); // the plugin template leaves it empty
        var table = $('<div class="tw-filters">').appendTo(page);
        $('<p class="tw-hint">').text(t('filters_hint')).prependTo(page);

        function row(r) {
            var sel = $('<select class="tw-text-input tw-rule-folder">').attr('aria-label', t('folder'));
            $.each(folders, function(id, label) { $('<option>').val(id).text(label).appendTo(sel); });
            sel.val(r.folder || Object.keys(folders)[0]);
            var editor = rules_editor([r], save), rule = editor.find('.tw-rule');
            editor.find('.tw-link-btn').remove(); // one condition per row here
            // "<folder>  если  <field>  содержит  <text>  ×"
            rule.prepend(sel.on('change', save), $('<span class="tw-rule-op">').text(t('if')));
            return $('<div class="tw-filter-row">').append(rule).appendTo(table);
        }
        function collect() {
            var out = [];
            table.find('.tw-rule').each(function() {
                var r = $(this), value = $.trim(r.find('.tw-rule-value').val()), field = r.find('.tw-rule-field').val(),
                    folder = r.find('.tw-rule-folder').val();
                if (value && folder)
                    out.push({folder: folder, field: field, value: value, created: r.data('created') || today()});
            });
            return out;
        }
        function save() {
            clearTimeout(timer);
            timer = setTimeout(function() {
                var rules = collect();
                save_pref('tw_rules', rules)
                    .done(function() { rcmail.env.tw_rules = rules; rcmail.display_message(t('saved'), 'confirmation'); })
                    .fail(function() { rcmail.display_message(t('save_failed'), 'error'); });
            }, 600);
        }

        $.each(rcmail.env.tw_rules || [], function(i, r) { row(r); });
        $('<button type="button" class="tw-link-btn ti ti-plus">').text(t('add_rule'))
            .on('click', function() { row({}).find('.tw-rule-value').focus(); })
            .appendTo(page);

        // "Создать фильтр" in a message's right-click menu: a new "От содержит <address>" row, saved once the
        // folder is chosen (a rule must not move mail to whatever folder happens to be first)
        var from = new URLSearchParams(location.search).get('_tw_from');
        if (from && Object.keys(folders).length)
            row({field: 'from', value: from}).addClass('tw-filter-new').find('.tw-rule-folder').focus();
        if (!Object.keys(folders).length)
            page.append($('<p class="tw-hint">').text(t('create_folder_first')));
    }

    // search box lives in the top bar on wide screens, under the list header on phones
    function search_slot() {
        var bar = $('#mailsearchform').closest('.searchbar'), options = $('#searchmenu');
        if (wide())
            bar.add(options).appendTo('#tw-search-slot'); // options drop down under the box
        else
            options.insertAfter(bar.insertAfter('#messagelist-header'));
    }

    /* ----------------------------------------------------------------- compose panel (list screen side) */
    var panel, frame, pending_close;

    TW.openCompose = function(p) {
        panel = panel || $('#tw-compose');
        frame = frame || $('#tw-compose-frame');
        if (!panel.length)
            return false;

        var rc = frame[0].contentWindow && frame[0].contentWindow.rcmail;
        if (!panel.prop('hidden') && dirty(rc) && !confirm(t('compose_replace_confirm')))
            return true; // handled: keep the open one
        if (rc)
            rc.compose_skip_unsavedcheck = true;

        p = p || {};
        $('#tw-compose-title').text(t(p._reply_uid || p._tw_qr ? 'reply' : p._forward_uid ? 'forward' : p._draft_uid ? 'draft' : 'compose'));
        frame.attr('src', rcmail.url('mail/compose', $.extend({_framed: 1}, p)));
        panel.prop('hidden', false).removeClass('tw-min').toggleClass('tw-max', !!p._tw_qr || panel.hasClass('tw-max')); // a reply from the message opens big
        return true;
    };

    TW.closeCompose = function(force) {
        var rc = frame && frame[0].contentWindow && frame[0].contentWindow.rcmail;
        if (!force && dirty(rc)) {
            if (confirm(t('save_draft_confirm'))) {
                pending_close = true;
                rc.command('savedraft');
                return;
            }
        }
        if (rc)
            rc.compose_skip_unsavedcheck = true;
        pending_close = false;
        panel.prop('hidden', true).removeClass('tw-min tw-max tw-moved tw-max-moved');
        frame.attr('src', 'about:blank');
    };

    TW.draftSaved = function() {
        if (pending_close)
            TW.closeCompose(true);
    };

    TW.composeSent = function(msg, type, folders) {
        rcmail.display_message(msg, type);
        TW.closeCompose(true);
        if (!folders || $.inArray(rcmail.env.mailbox, folders) >= 0 || rcmail.env.mailbox == rcmail.env.drafts_mailbox)
            rcmail.command('checkmail');
    };

    function dirty(rc) {
        return rc && rc.env && rc.env.action == 'compose' && !rc.env.is_sent && rc.cmp_hash != rc.compose_field_hash();
    }

    /* ----------------------------------------------------------------- own dropdowns ([data-tw-menu])
       Elastic's popovers become full-height sheets inside the narrow compose panel (ui.js sees a phone there) */
    function close_menus() {
        $('.tw-menu').prop('hidden', true);
        $('[data-tw-menu]').attr('aria-expanded', 'false');
    }

    $(document).on('click', '[data-tw-menu]', open_menu);

    function open_menu() {
        var btn = $(this), menu = $('#' + btn.data('tw-menu')), was_closed = menu.prop('hidden');
        close_menus();
        if (!was_closed)
            return false;

        menu.prop('hidden', false);
        var r = this.getBoundingClientRect(), mh = menu.outerHeight(), mw = menu.outerWidth(),
            left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8),
            top = r.bottom + 6 + mh > window.innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6; // opens upwards near the bottom
        menu.css({left: left, top: top});
        btn.attr('aria-expanded', 'true');
        return false;
    }
    // a press anywhere else closes them: capture phase, the message list stops mousedown from bubbling;
    // a press inside a frame (the opened message) only blurs this window
    document.addEventListener('mousedown', function(e) {
        if (!$(e.target).closest('.tw-menu, [data-tw-menu]').length)
            close_menus();
    }, true);
    $(window).on('blur', function() { setTimeout(function() {
        if (document.activeElement && document.activeElement.tagName == 'IFRAME')
            close_menus();
    }, 0); });
    $(document).on('keydown', function(e) {
        if (e.key == 'Escape' && $('.tw-menu:not([hidden])').length) {
            close_menus();
            return false;
        }
    });
    // dialogs showing a page in a frame (About, ...): height follows the page, so there is no inner scrollbar
    // eating the right padding; long pages stop at 70% of the screen and scroll
    $(document).on('dialogopen', function(e) {
        $(e.target).children('iframe').on('load', function() {
            try {
                var h = this.contentDocument.documentElement.scrollHeight;
                $(this).css('height', Math.min(h, Math.round(window.innerHeight * .7)));
                $(e.target).dialog('option', 'position', {my: 'center', at: 'center', of: window});
            } catch (err) { /* frame from another origin */ }
        });
    });

    // "Настройки списка": applied as soon as a value changes, no Save/Cancel (like every other setting)
    $(document).on('dialogopen', function(e) {
        var box = $(e.target), col = box.find('select[name="sort_col"]');
        if (!col.length)
            return;
        box.closest('.ui-dialog').addClass('tw-instant').find('.ui-dialog-buttonpane').hide();
        box.on('change', 'select', function() {
            var ord = box.find('select[name="sort_ord"]').val() || rcmail.env.sort_order,
                mode = box.find('select[name="mode"]').val();
            rcmail.set_list_options([], col.val(), ord, mode == 'threads' ? 1 : 0);
        });
    });

    // a menu item was chosen (forms inside a menu, like compose options, stay open)
    $(document).on('click', '.tw-menu a', function() { setTimeout(close_menus, 0); });

    // compose "…" menu: show the Cc / Bcc / Reply-To / Followup-To row
    $(document).on('click', '#headers-menu a[data-target]', function() {
        var row = $('#compose_' + $(this).data('target')).removeClass('hidden');
        setTimeout(function() { row.find('input:visible, textarea:visible').first().focus(); }, 0);
        return false;
    });

    $(document).on('click', '[data-tw-compose]', function() {
        var what = $(this).data('tw-compose');
        if (what == 'close')
            TW.closeCompose();
        else if (what == 'min')
            panel.toggleClass('tw-min').removeClass('tw-max');
        else
            panel.toggleClass('tw-max').removeClass('tw-min');
        return false;
    });
    $(document).on('click', '#tw-compose.tw-min .tw-compose-head', function() { panel.removeClass('tw-min'); });

    // drag the panel by its header (wide screens, normal and maximized sizes, each keeps its own place
    // until the panel closes)
    $(document).on('mousedown', '#tw-compose:not(.tw-min) .tw-compose-head', function(e) {
        if (e.button || !wide() || $(e.target).closest('[data-tw-compose], a, button').length)
            return;
        var box = panel[0].getBoundingClientRect(), dx = e.clientX - box.left, dy = e.clientY - box.top,
            max = panel.hasClass('tw-max'), css = {};
        panel.addClass('tw-dragging'); // the frame would swallow mousemove while the pointer is over it
        $(document).on('mousemove.twdrag', function(ev) {
            css[max ? '--tw-mx' : '--tw-x'] = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - box.width)) + 'px';
            css[max ? '--tw-my' : '--tw-y'] = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - box.height)) + 'px';
            panel.addClass(max ? 'tw-max-moved' : 'tw-moved').css(css);
        }).on('mouseup.twdrag', function() {
            $(document).off('.twdrag');
            panel.removeClass('tw-dragging');
        });
        return false;
    });

    /* ----------------------------------------------------------------- compose (inside the panel frame) */
    function compose() {
        var panel_host = host();

        // the reply block under a message: recipient, text and the send bar only (its frame says so; the compose
        // redirect drops the URL parameters)
        try {
            if (window.frameElement && window.frameElement.classList.contains('tw-qr-frame'))
                $(document.body).addClass('tw-inline-reply');
        } catch (e) { /* another origin */ }

        // single identity: no "From" row, as in Timeweb
        if ($('#_from option').length < 2)
            $('#compose_from').addClass('hidden');

        // ui.js replaces the recipient textareas with its own inputs; hints inside the field, as in Timeweb
        $.each(['to', 'cc', 'bcc', 'replyto'], function(i, id) {
            $('#compose_' + id + ' .recipient-input input').attr('placeholder', t(id));
        });
        $('#compose-subject').attr('placeholder', t('subject'));

        // TinyMCE rewrites the empty body after loading, so the "unchanged" snapshot taken at init
        // no longer matches and closing an untouched draft would ask to save it. Re-take it once loaded.
        rcmail.addEventListener('editor-load', function() {
            setTimeout(function() { rcmail.cmp_hash = rcmail.compose_field_hash(); }, 0);
            var ed = window.tinymce && tinymce.activeEditor, body = ed && ed.getBody();
            if (body && rcmail.env.tw_qr && $(body).find('[id$=reply-intro]').length) {
                $(body).addClass('tw-qr tw-qr-fold').on('click', '[id$=reply-intro]', function() { $(body).toggleClass('tw-qr-fold'); });
            }
        });

        if (!panel_host)
            return;

        // inline reply → the big window: save the draft, the message window opens it in the compose panel
        var expand;
        $('.tw-qr-expand').on('click', function() {
            expand = true;
            rcmail.command('savedraft');
            return false;
        });

        // stay in the panel after sending: close it and refresh the list in the parent window
        rcmail.sent_successfully = function(type, msg, folders, save_error) {
            rcmail.compose_skip_unsavedcheck = true;
            if (save_error) {
                rcmail.display_message(msg, type);
                rcmail.env.is_sent = true;
                return;
            }
            panel_host.composeSent(msg, type, folders);
        };

        var set_draft_id = rcmail.set_draft_id;
        rcmail.set_draft_id = function() {
            set_draft_id.apply(rcmail, arguments);
            if (expand && arguments[0] && panel_host.expandReply) {
                rcmail.compose_skip_unsavedcheck = true;
                return panel_host.expandReply(arguments[0]);
            }
            var d = new Date();
            $('#tw-c-saved').text(t('saved_at') + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2));
            panel_host.draftSaved();
        };
    }

    /* ----------------------------------------------------------------- message (preview frame) */
    function message() {
        var from = $('.header-summary .rcmContactAddress, .header-summary a').first();
        // the address is in href="mailto:…" (no title here), the text is "Name <address>"
        var email = decodeURIComponent((from.attr('href') || '').replace(/^mailto:/i, '').split('?')[0])
            || from.attr('title') || (/<([^>]+)>/.exec(from.text()) || [])[1] || '';
        $('.tw-msg-avatar').replaceWith(avatar(from.text() || from.attr('title'), email).addClass('tw-msg-avatar'));
        quick_reply();
    }

    /* "Ответить на письмо…" under a message (Timeweb): opens the reply right there, the compose page in a frame
       (body.tw-inline-reply there: no subject / From rows). This window plays the panel host for it (composeSent, draftSaved). */
    function quick_reply() {
        if (!rcmail.env.uid || rcmail.env.mailbox == rcmail.env.drafts_mailbox || !$('#message-content').length)
            return;

        var box = $('<div class="tw-quick-reply">').appendTo('#message-content');
        function collapsed() {
            box.removeClass('tw-qr-open').empty().append(
                $('<button type="button" class="tw-qr-btn">').append(
                    $('<span class="ti ti-reply" aria-hidden="true">'), $('<span>').text(t('quick_reply')))
                    .on('click', function() {
                        box.addClass('tw-qr-open').empty().append($('<iframe class="tw-qr-frame">').attr({
                            title: t('quick_reply'),
                            src: rcmail.url('mail/compose', {_reply_uid: rcmail.env.uid, _mbox: rcmail.env.mailbox, _framed: 1, _tw_qr: 1})
                        }));
                        box[0].scrollIntoView({block: 'nearest', behavior: 'smooth'});
                    }));
        }
        collapsed();

        TW.draftSaved = function() {};
        // open_compose_step goes to the list window's compose panel, or to the compose page without one
        TW.expandReply = function(draft_uid) {
            collapsed();
            rcmail.open_compose_step({_draft_uid: draft_uid, _mbox: rcmail.env.drafts_mailbox, _tw_qr: 1});
        };
        TW.composeSent = function(msg, type, folders) {
            var top = host();
            collapsed();
            if (top && top.composeSent)
                top.composeSent(msg, type, folders); // the list window: message, refresh
            else
                rcmail.display_message(msg, type);
        };
    }

    /* ----------------------------------------------------------------- login */
    function login() {
        var form = $('#login-form');
        // after ui.js has rebuilt the form
        setTimeout(function() {
            var user = $('#rcmloginuser'), pass = $('#rcmloginpwd'), btn = $('#rcmloginsubmit'),
                fields = $('<div class="tw-login-fields">');

            $.each([[user, t('email'), t('email_ph')], [pass, t('password'), t('password_ph')]], function(i, f) {
                $('<div class="tw-field">')
                    .append($('<label>').attr('for', f[0].attr('id')).text(f[1]))
                    .append($('<div class="tw-input">').append(f[0].attr('placeholder', f[2])))
                    .appendTo(fields);
            });

            $('<button type="button" class="tw-eye ti ti-eye">').attr('aria-label', t('show_password'))
                .on('click', function() {
                    var show = pass.attr('type') == 'password';
                    pass.attr('type', show ? 'text' : 'password');
                    $(this).toggleClass('ti-eye', !show).toggleClass('ti-eye-off', show)
                        .attr('aria-label', t(show ? 'hide_password' : 'show_password'));
                })
                .insertAfter(pass);

            form.find('table').first().replaceWith(fields);
            form.prepend('<div class="tw-logo">roundcube<span>›mail</span></div>', $('<h1 class="tw-login-title">').text(t('login_title')));
            btn.text(t('login_btn')).removeClass('text-uppercase');

            // look only: real disabling would block browser autofill, which JS can't see before a click
            function check() { btn.toggleClass('tw-inactive', !$.trim(user.val()) || !pass.val()); }
            user.add(pass).on('input change', check);
            check();
        }, 0);
    }

    /* ----------------------------------------------------------------- settings: save on change, no "Save" button (Timeweb)
       Runs inside the settings content frame. Forms that create something (new identity, response, folder) keep
       an explicit "Создать" button: saving them field by field would create half-filled records. */
    function autosave() {
        var form = $('.formbuttons').first().closest('form'),
            creating = /^add-/.test(rcmail.env.action) || new_identity()
                || (rcmail.env.action == 'edit-folder' && !$('input[name="_mbox"]').val()),
            timer, busy = false, again = false;

        if (!form.length)
            form = $('input[name="_token"]').first().closest('form');
        if (!form.length)
            return;
        if (creating) {
            window.tw_create = true; // the parent shows "Создать" instead of "Сохранить"
            return;
        }
        window.tw_autosave = true;    // the parent hides its "Сохранить"

        function schedule(delay) {
            clearTimeout(timer);
            timer = setTimeout(save, delay || 250);
        }

        // the same POST the Save button sends; Roundcube's own validation and messages apply
        function save() {
            if (busy) {
                again = true;
                return;
            }
            busy = true;
            if (window.tinymce)
                tinymce.triggerSave();
            if (window.tw_before_save)
                tw_before_save();

            // beforeSend: no X-Roundcube-Request header (Roundcube's ajaxSetup adds it), or Roundcube runs this as
            // an ajax call, which the save actions ignore (MODE_HTTP): nothing saved and no error
            $.ajax({type: 'POST', url: form.attr('action') || location.href, data: form.serialize(), beforeSend: $.noop})
                .done(function(html) {
                    var err = /display_message\("((?:[^"\\]|\\.)*)","(?:error|warning)"/.exec(html),
                        re = /(update_identity_row|update_response_row|replace_folder_row)\((.*?)\);/g, m, prc = parent.rcmail;

                    if (err)
                        return prc.display_message(JSON.parse('"' + err[1] + '"'), 'error');

                    // replay what the response would have done to the parent window (list rows)
                    while ((m = re.exec(html))) {
                        try {
                            var args = JSON.parse('[' + m[2] + ']');
                            if (typeof prc[m[1]] == 'function')
                                prc[m[1]].apply(prc, args);
                            if (m[1] == 'replace_folder_row')
                                $('input[name="_mbox"]').val(args[1]); // renamed: next save must use the new name
                        } catch (e) { /* not JSON: skip */ }
                    }

                    if (/\.reload\(/.test(html)) // e.g. interface language changed
                        return setTimeout(function() { parent.location.reload(); }, 300);
                    prc.display_message(t('saved'), 'confirmation');
                })
                .fail(function() { parent.rcmail.display_message(t('save_failed'), 'error'); })
                .always(function() {
                    busy = false;
                    if (again) {
                        again = false;
                        save();
                    }
                });
        }

        // switches and lists at once, typed text after a pause or when the field is left
        form.on('change', 'input, select, textarea', function() { schedule(); });
        form.on('input', 'input[type="text"], input[type="email"], input:not([type]), textarea', function() { schedule(1200); });
        form.on('submit', function() { schedule(0); return false; }); // Enter in a field
        if (window.tinymce) {
            var watch = function(ed) { ed.on('change input undo redo', function() { schedule(1200); }); };
            $.each(tinymce.get() || [], function(i, ed) { watch(ed); });
            tinymce.on('AddEditor', function(e) { watch(e.editor); });
        }
    }

    // a failed "Create" comes back as edit-identity without an id: it is still a creation, not an edit to autosave
    function new_identity() {
        return rcmail.env.action == 'edit-identity' && !(+$('input[name="_iid"]').val());
    }

    /* ----------------------------------------------------------------- settings: extra mailbox form (ident_switch plugin)
       A new identity is always a separate mailbox: name, address, password and the IMAP/SMTP sections,
       pre-filled from the plugin's preconfig. */
    function account_form() {
        var mode = $('select[name="_ident_switch.form.common.mode"]');
        if (!mode.length)
            return;

        function field(name) { return $('[name="_ident_switch.form.' + name + '"]'); }
        function row(el) { return el.closest('tr'); }

        // the plugin blanks ports equal to the default, then sends mail via port 587 when the SMTP port is empty
        window.tw_before_save = function() {
            // the sidebar shows the plugin's label (or the address); keep it equal to the display name,
            // as the plugin already does for the primary account (it allows 32 characters)
            if (mode.val() == 'separate')
                field('common.label').val($.trim($('input[name="_name"]').val()).slice(0, 32));
            $.each(['imap', 'smtp'], function(i, p) {
                var port = field(p + '.port');
                if (!$.trim(port.val()))
                    port.val(port.attr('placeholder'));
            });
        };

        if (!/^add-/.test(rcmail.env.action) && !new_identity()) {
            if (mode.val() == 'separate') // switching a mailbox to "Primary" would just disable it; the label follows the name
                setTimeout(function() { // after the plugin's docready init, which shows every section
                    mode.closest('fieldset').add(field('common.label').closest('fieldset')).hide();
                }, 0);
            return;
        }

        var email = $('input[name="_email"]'), pass = field('imap.password').attr('autocomplete', 'new-password'),
            extra = mode.closest('fieldset').add(field('common.label').closest('fieldset'))
            .add(field('notify.check').closest('fieldset')).add($('[name="_signature"]').closest('fieldset'));

        $('h1.voice').first().text(t('new_account'));
        $.each(['_organization', '_reply-to', '_bcc', '_standard'], function(i, name) { row($('[name="' + name + '"]')).hide(); });

        row(pass).insertAfter(row(email));
        row(email).add(row(pass)).addClass('tw-required');
        email.add(pass).attr('required', true).on('input', function() { row($(this)).removeClass('tw-invalid'); });
        if (new_identity()) // back from a failed connection test: most often the password
            setTimeout(function() { row(pass).addClass('tw-invalid'); pass.focus().select(); }, 0);

        function apply_mode() {
            mode.prop('disabled', false).val('separate');
            plugin_switchIdent_mode_onChange('separate'); // shows every section of a separate account
            extra.hide();
        }
        // after the plugin's own docready init, which picks "Primary" and disables the select without an address
        setTimeout(apply_mode, 0);
        email.on('change', function() { setTimeout(apply_mode, 0); });

        rcmail.addEventListener('beforesave', function() {
            var empty = email.add(pass).filter(function() { return !$.trim(this.value); });
            row(empty).addClass('tw-invalid');
            if (empty.length) {
                empty.first().focus();
                parent.rcmail.display_message(t('fill_required'), 'warning');
                return false;
            }
            mode.prop('disabled', false).val('separate'); // a disabled select is not sent: the plugin would save a plain identity
            tw_before_save();
        });
    }

    /* ----------------------------------------------------------------- settings: message layout cards (Timeweb's three cards) */
    function layout_cards() {
        var current = rcmail.env.tw_preview || 'none',
            box = $('<div class="tw-layouts" role="radiogroup">').attr('aria-label', t('layout'));

        $.each([['none', t('layout_none')], ['right', t('layout_right')], ['bottom', t('layout_bottom')]], function(i, o) {
            $('<button type="button" role="radio" class="tw-layout">').attr('aria-checked', String(o[0] == current))
                .append($('<span class="tw-layout-pic" aria-hidden="true">').addClass('tw-layout-' + o[0])
                    .append('<i></i><i></i><i></i><b></b>'))
                .append($('<span class="tw-layout-name">').text(o[1]))
                .on('click', function() {
                    if ($(this).attr('aria-checked') == 'true')
                        return;
                    box.children().attr('aria-checked', 'false');
                    $(this).attr('aria-checked', 'true');
                    // saved right away, like Timeweb; the mailbox picks it up on next load
                    save_pref('tw_preview', o[0])
                        .done(function() { rcmail.display_message(t('saved'), 'confirmation'); })
                        .fail(function() { rcmail.display_message(t('save_failed'), 'error'); });
                })
                .appendTo(box);
        });

        box.prependTo($('.formcontent').first());
    }

    /* ----------------------------------------------------------------- settings */
    function settings() {
        // "Save" lives at the right of the content header, the form's own button row is hidden (CSS, wide screens);
        // it clicks the form's button, so Roundcube's validation and messages stay as they are
        var save = $('<button type="button" class="btn btn-primary tw-save" hidden>').text(rcmail.gettext('save'))
            .appendTo('#layout-content > .header');

        // on the next tick: ui.js resets the title to the page title on frame load
        $('#layout-content iframe').on('load', function() {
            var frame = this;
            setTimeout(function() {
                var title = '', button = $(), win = {};
                try {
                    win = frame.contentWindow;
                    title = $('h1.voice', frame.contentDocument).first().text();
                    button = $('.formbuttons button.mainaction, .formbuttons button.submit', frame.contentDocument).first();
                } catch (e) { /* frame from another origin */ }
                if (title)
                    $('#layout-content > .header > .header-title').text(title);
                // forms that save themselves on change show no button; creation forms show "Создать"
                save.text(win.tw_create ? t('create') : rcmail.gettext('save'))
                    .prop('hidden', !button.length || !!win.tw_autosave)
                    .off('click').on('click', function() { button.click(); });
            }, 0);
        });

        // open the first section right away instead of the empty placeholder (wide screens only)
        if (rcmail.sections_list && !rcmail.sections_list.get_single_selection() && wide())
            rcmail.sections_list.select('general');

        // same names as the mail sidebar (ru_RU says "СПАМ", Archive has no translation)
        $('#subscription-table li.junk > a').text(t('junk'));
        $('#subscription-table li.archive > a').text(t('archive'));

        if ($('#settings-menu').length && !$('.tw-back-mail').length)
            $('<a class="tw-back-mail ti ti-arrow-left" href="./?_task=mail">').text(t('back_to_mail'))
                .on('click', function(e) {
                    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button)
                        return true; // new tab / window: plain link
                    return rcmail.command('switch-task', 'mail', this, e);
                })
                .insertBefore('#settings-menu');
    }
})(jQuery);

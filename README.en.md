<div align="center">

# 🌬️ Breeze — a light, modern Roundcube skin

**A clean webmail UI: date-grouped messages, avatars, attachment chips, a floating compose window and a phone layout.**

[![Release](https://img.shields.io/github/v/release/qdpops/roundcube-skin-breeze?style=for-the-badge&color=2F7CF6)](https://github.com/qdpops/roundcube-skin-breeze/releases)
[![Stars](https://img.shields.io/github/stars/qdpops/roundcube-skin-breeze?style=for-the-badge&color=F59E0B)](https://github.com/qdpops/roundcube-skin-breeze/stargazers)
[![License](https://img.shields.io/badge/license-GPLv3-22C55E?style=for-the-badge)](LICENSE)

![Roundcube](https://img.shields.io/badge/Roundcube_1.6_|_1.7-37BEFF?style=flat-square&logo=roundcube&logoColor=white)
![PHP](https://img.shields.io/badge/PHP_8-777BB4?style=flat-square&logo=php&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![CSS](https://img.shields.io/badge/CSS-663399?style=flat-square&logo=css&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Mobile](https://img.shields.io/badge/Mobile_ready-0F172A?style=flat-square&logo=android&logoColor=white)

[🇷🇺 Русский](README.md) · 🇬🇧 English

<img src="docs/demo-en.gif" alt="Breeze demo: message list, selection, reading and compose" width="900">

</div>

---

## 📦 Install into an existing Roundcube (1.6 or 1.7)

With Composer, from the Roundcube folder (installs the skin and the `tw_folders` plugin):

```bash
composer require qdpops/breeze
```

Then do step 2 below. Or by hand, if you already run Roundcube 1.6 or 1.7 without Docker:

1. From the release zip, copy `breeze/skins/breeze` to `<roundcube>/skins/breeze` and `breeze/plugins/tw_folders` to `<roundcube>/plugins/tw_folders`.
2. In `config/config.inc.php` (or `config/custom.inc.php`):

   ```php
   $config['skin'] = 'breeze';
   $config['plugins'][] = 'tw_folders';
   // The skin formats dates itself.
   $config['prettydate'] = false;
   ```

3. Clear `<roundcube>/temp` and reload. The folder icon/color dialog, rules and the contacts panel come from `tw_folders`; without it the skin still renders, but those actions are missing.
4. Language follows the user's Roundcube setting. 44 languages ship in `plugins/tw_folders/localization`; copy `en_US.inc` for another locale.

## ✨ Features

| | | |
|:-:|---|---|
| <img src="docs/icons/inbox.svg" width="22"> | **Message list** | "Today / Yesterday / Last week…" groups, avatars, bookmarks, attachment chips under the row (click to download), checkboxes and an action bar on selection |
| <img src="docs/icons/mail-open.svg" width="22"> | **Reading** | Open a message in place of the list, on the right or below (drag the divider, it is remembered), Previous / Next |
| <img src="docs/icons/send.svg" width="22"> | **Compose** | Floating panel: minimize, maximize, close with a save-draft prompt. Replies, forwards and drafts open there too |
| <img src="docs/icons/folder.svg" width="22"> | **Folders** | Custom icons and colors, a "Create folder" dialog, "⋮ → Edit / Delete", quick filters Flagged, With attachments, Unread |
| <img src="docs/icons/filter.svg" width="22"> | **Rules** | "From / To / Subject contains → move to folder". No ManageSieve needed: Roundcube runs the rules when it checks mail |
| <img src="docs/icons/contacts.svg" width="22"> | **Contacts** | Contacts panel in the header, a read-only "From mail" book (people from recent mail), one-click "Add to contacts", a table with your own labels |
| <img src="docs/icons/layers.svg" width="22"> | **Multi-account** | Several mailboxes in one session via [ident_switch](https://packagist.org/packages/gecka/ident-switch) |
| <img src="docs/icons/globe.svg" width="22"> | **Languages** | 44 languages, from English and Russian to Japanese and Arabic; the login page remembers the browser's language |
| <img src="docs/icons/phone.svg" width="22"> | **Phone** | Panels switch, two-line messages, a floating Compose button, full-screen compose |

## 📸 Screenshots

<p align="center"><img src="docs/screenshots/inbox.png" alt="Message list" width="900"></p>


<table>
<tr>
<td width="50%"><img src="docs/screenshots/message.png" alt="Reading a message"><br><sub>📖 Reading a message</sub></td>
<td width="50%"><img src="docs/screenshots/compose.png" alt="Compose"><br><sub>✍️ Compose in a floating panel</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/contacts.png" alt="Contacts"><br><sub>👥 Contacts: the "From mail" book and a contact card</sub></td>
<td><img src="docs/screenshots/login-en.png" alt="Sign in"><br><sub>🔐 Sign-in page</sub></td>
</tr>
</table>

<p align="center"><img src="docs/screenshots/phone.png" alt="Phone" width="300"><br><sub>📱 On a phone</sub></p>

> Screenshots were taken on a GreenMail test server with made-up mail from [`seed.py`](seed.py). The UI language follows the user's Roundcube setting.

## 🚀 Quick start

You need Docker and Docker Compose (Docker in WSL works on Windows).

```bash
git clone https://github.com/qdpops/roundcube-skin-breeze.git
cd roundcube-skin-breeze

# 1. Session encryption key: 24 random characters
cp config/des_key.inc.php.dist config/des_key.inc.php
sed -i "s|change-me-24-characters!|$(openssl rand -base64 18)|" config/des_key.inc.php

# 2. Put your mail provider's IMAP and SMTP into docker-compose.yml
#    (ROUNDCUBEMAIL_DEFAULT_HOST / _PORT, ROUNDCUBEMAIL_SMTP_SERVER / _PORT)
#    and into plugin-config/ident_switch.inc.php for extra mailboxes.
#    For English by default set $config['language'] = 'en_US' in config/custom.inc.php

# 3. Run
docker compose up -d
```

Open **http://localhost:8090** and sign in with your mailbox address and password.

<details>
<summary>🧪 Try it without a real mailbox</summary>

1. In `docker-compose.yml` set `greenmail` / `3143` (IMAP) and `greenmail` / `3025` (SMTP) in `ROUNDCUBEMAIL_*`.
2. `docker compose --profile test up -d`
3. Fill the mailbox: `python3 seed.py`
4. Sign in as `demo@local.test` with any password.

</details>

<details>
<summary>🪟 Windows + WSL notes</summary>

- Docker in WSL is often root-only: `wsl -d Ubuntu -u root -- bash -lc "cd /mnt/c/path/to/project && docker compose up -d"`.
- WSL shuts the distro down when no session is open, which stops the containers. Keep a WSL window open while you work (or run `wsl -d Ubuntu -- sleep infinity`).
- opcache does not notice PHP edits on `/mnt/c`: after changing configs or PHP run `docker restart <roundcube container>`. CSS, JS and templates reload right away.

</details>

## 🧩 How it works

```
skins/breeze/            the skin: templates, styles/breeze.css, breeze.js, icons
  styles/elastic-palette.css   Elastic colors mapped to the Breeze palette (tools/make_palette.py)
  tools/make_icons.py          icon generator (Lucide paths)
plugins/tw_folders/      companion plugin: folder icons and colors, rules, attachments in the list,
                         contacts from mail, localization (ru_RU, en_US)
config/custom.inc.php    language, skin, folders, date format
plugin-config/           servers for extra ident_switch accounts
docker-compose.yml       Roundcube 1.7.7 + GreenMail test server (profile "test")
```

- The skin extends **Elastic** only for its scripts: popups, dialogs and phone panel switching. The look is entirely its own.
- All skin labels live in `plugins/tw_folders/localization`. Other languages fall back to English; add one by copying `en_US.inc`.
- After a Roundcube upgrade, regenerate the palette: `python3 skins/breeze/tools/make_palette.py`.

## 🛠️ Compatibility

- Roundcube **1.6.x and 1.7.x** (tested on 1.6.11 and 1.7.7), PHP 8, SQLite, MySQL or PostgreSQL.
- Plugins used with the Docker image: `archive`, `markasjunk`, `zipdownload`, `newmail_notifier`, `ident_switch`.
- No dark mode yet.

## 🤝 Contributing

Issues and pull requests are welcome: bugs, translations, new languages, a dark theme.

## 📄 License

[GPL-3.0](LICENSE), same as Roundcube. Icons use [Lucide](https://lucide.dev) paths (ISC).

<div align="center"><sub>Made with ☕ and Roundcube</sub></div>

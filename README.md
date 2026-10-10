# fb Bablushr F — Website + Chrome Extension

**Version:** 16.5.22  
**Live site:** https://faset.xo.je  
**Stack:** PHP 8 (InfinityFree) + Chrome Manifest V3

## Structure

| Path | Description |
|------|-------------|
| `website/` | Full PHP site — upload to hosting root |
| `extension/` | MV3 extension source (Kiwi / Quetta / Chrome) |
| `docs/` | Arabic install notes |

## Deploy website

1. Upload **everything inside `website/`** to `htdocs/` (include `.htaccess`).
2. If site already runs: **do not overwrite** live `data/users.json` or `data/app-config.json`.
3. Fresh install: open `/install.php` once.
4. Ensure `data/.htaccess` contains `Deny from all`.

## Install extension

- Load unpacked from `extension/`, or zip the folder for distribution.
- Version must show **16.5.22**.

## Notable fixes in 16.5.22

- Concurrent-safe JSON locks for `users.json`
- Soft handling of temporary storage / `user_not_found` (no forced logout)
- Expired trial stays in-app (no landing kick)
- Admin plan activation keeps user devices

## Security

This repo ships **empty** data templates only. Put OAuth / Telegram / Turnstile secrets only on the live server `app-config.json`.

## License

Private — all rights reserved by the project owner.

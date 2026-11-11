# Renaming the product

Everything people see takes the name from **`src/config/brand.ts`**. To rename:

1. Edit `src/config/brand.ts`: `name`, `nameHe` (Hebrew), `fileSlug` (lowercase, used in downloaded
   file names), `domain`, `appId`, `logoLetter`, and the `tagline` / `description` if they change.
2. `npm run brand:emails` — rewrites the five sign-in emails in `supabase/templates/`; paste them into
   Supabase → Authentication → Emails → Templates again.
3. Open a pull request. `src/tests/brand-name.test.ts` fails if any screen text, message, file name,
   page title or email source still spells out a name instead of using `BRAND`.

What follows the change automatically: every screen and message, help text, downloaded file names,
the browser tab title, link previews (Open Graph / Twitter), the installed app's name, server PDFs and
emails, and the tests.

Outside the code (the owner does these):
- **Vercel**: add the new domain to the project (Settings → Domains).
- **Supabase**: Authentication → URL Configuration → Site URL and Redirect URLs with the new domain;
  Authentication → Emails: sender name; the templates from step 2.
- **Google / Microsoft sign-in**: the app name shown on their consent screens.
- **Stripe** (when billing is live): business name on receipts.
- **GitHub repository name** (optional; GitHub redirects the old address).
- **The icon images** in `public/` (`pwa-*.png/svg`, `apple-touch-icon.png`) if the logo changes.

Kept on purpose, never shown to users: internal storage keys and event names such as
`ledgerflow_current_workspace` and `ledgerflow:feedback`, the backup file format id
`ledgerflow-backup-archive-v1` (older backups must still restore), code names like
`LedgerFlowClient` in `sdk/`, and the history in `docs/`. Renaming the storage keys would sign
everyone out and forget their saved settings.

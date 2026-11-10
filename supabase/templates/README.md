# Sign-in emails (Supabase Auth templates)

Branded versions of the five emails Supabase sends. They are not deployed automatically:
paste each one into **Supabase → Authentication → Emails → Templates** (choose the template,
set the subject, paste the HTML into the message body, save).

| Template in Supabase | File | Subject |
|---|---|---|
| Confirm sign up | `confirm-signup.html` | Confirm your email for LedgerFlow |
| Reset password | `reset-password.html` | Reset your LedgerFlow password |
| Magic link | `magic-link.html` | Your LedgerFlow sign-in link |
| Invite user | `invite-user.html` | You've been invited to LedgerFlow |
| Change email address | `change-email.html` | Confirm your new email for LedgerFlow |

Keep the `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}` parts exactly as they are:
Supabase fills them in.

When the product name changes, replace "LedgerFlow" in every file (and the "L" in the logo box).
The "powered by Supabase" line under the email only goes away with a custom SMTP sender
(TRACKER L-84).

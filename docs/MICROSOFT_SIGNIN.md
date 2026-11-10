# Turning on "Continue with Microsoft"

The button is built and hidden. It appears on the sign-in screen once these three steps are done
(about 15 minutes). Do them in this order: with the setting on and no provider behind it, the
button would lead to an error page.

## 1. Register the app with Microsoft

1. Go to https://portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. **Name:** the product name (it is shown on Microsoft's sign-in screen; it can be changed later under
   *Branding & properties*).
3. **Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts"
   (work, school, Outlook and Hotmail accounts can all sign in).
4. **Redirect URI:** type **Web**, value `https://<your-project>.supabase.co/auth/v1/callback`
   (copy the exact address from Supabase: Authentication → Sign In / Providers → Azure → "Callback URL").
   This is the Supabase address, not the site's domain, so it stays the same when the domain changes.
5. Register. On the **Overview** page copy the **Application (client) ID**.
6. **Certificates & secrets** → **New client secret** → copy its **Value** (shown once). Note its expiry date:
   Microsoft sign-in stops when the secret expires, until a new one is pasted into Supabase.

## 2. Turn on the provider in Supabase

Supabase dashboard → **Authentication** → **Sign In / Providers** → **Azure**: enable it, paste the client ID
and the secret value, leave **Azure Tenant URL** empty (any Microsoft account), save.

Paste the secret only into Supabase. Do not put it in the repository, in Vercel, or in a chat.

## 3. Show the button

Vercel → the project → **Settings** → **Environment Variables**: add `VITE_MICROSOFT_SIGNIN` = `true`
(Production, and Preview if wanted), then redeploy. The button appears under "Continue with Google".

To hide it again, remove the variable (or set it to anything other than `true`) and redeploy.

## How it behaves

- Same flow as Google: the browser goes to Microsoft and comes back signed in.
- A person who signs in with Microsoft using the same email address as an existing account gets that
  account (Supabase links identities by verified email).
- Workspaces, roles and invitations work the same whichever way a person signs in.
- Code: `signInWithMicrosoft` and `microsoftSignInEnabled` in `src/lib/db/auth.ts`; the button in
  `src/core/auth/AuthScreen.tsx`; tests in `src/tests/microsoft-signin.test.tsx`.

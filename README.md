# Fortune Wheel

A raffle wheel with an audience display and an authenticated operator console. Supabase stores shared event state and broadcasts changes between devices; GitHub Pages hosts the static frontend.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` to the Supabase Project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable key.
3. In the Supabase SQL Editor, run `supabase/schema.sql`.
4. Install and start the app:

   ```sh
   npm ci
   npm run dev
   ```

5. Open `/` for the local audience screen. Open `/?view=operator` for operator sign-in.

Do not put the database password, a Supabase `service_role` key, or any secret key in `.env.local`, GitHub, or frontend code. The frontend only needs the Project URL and publishable key; Row Level Security protects event ownership and writes.

## GitHub Pages deployment

In the GitHub repository, add these under **Settings → Secrets and variables → Actions → New repository secret**:

- `VITE_SUPABASE_URL`: the Supabase Project URL (`https://<project-id>.supabase.co`).
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key.

The GitHub Actions workflow runs tests, builds the site for the repository path, and deploys to Pages on pushes to `main` or `master`. If the secrets are missing, the workflow stops with an explicit error.

In Supabase **Authentication → URL Configuration**, set the Site URL to the published audience URL and allow the published site URL with `/**` as a redirect URL. Add `http://localhost:5173/**` for local testing.

## Create and share an event

1. Open the published site with `?view=operator`, such as `https://OWNER.github.io/REPOSITORY/?view=operator`.
2. Sign in with an email magic link. The first sign-in can create the operator account if Supabase email sign-ups are enabled.
3. Click **Create event**. The account that creates it owns the event.
4. Use **Copy audience link** for the display device and **Copy operator link** for the phone/operator.
5. The audience page can spin; operator changes and completed draws update the event across connected devices.

Anyone with the audience event link can view its participant names, settings, and winner history and can request a spin. Only the authenticated event owner can change participants, settings, or the one-time operator selection. Operator-selected winners are disclosed in the audience results. Use **Copy operator link** only for the trusted operator.

Supabase free-plan limits and email delivery restrictions may apply. Configure an SMTP provider in Supabase if the default email delivery limits are insufficient.

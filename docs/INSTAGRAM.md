# Daily Instagram reel

Every day at about 11:00 a.m. Central, the **Daily Instagram reel** GitHub Action:

1. Picks a medium question from **yesterday's** Daily (so it never spoils today's game).
2. Renders a 16-second 1080x1920 reel in the current seasonal look: a hook, the question, a 5-second
   countdown, the answer reveal with the explanation, then "Today's Daily Gauntlet #N is live. Link in bio".
3. Writes the caption (question, options, today's theme, hashtags).
4. Uploads and publishes it to Instagram through Meta's official API.

Until the two secrets below are added, it runs in **render-only** mode: the reel, cover image and
caption are saved on the workflow run (Actions tab → the run → **Artifacts**) so you can post by hand.

## One-time setup

Meta's screens change often; if a label differs, look for the closest match.

### 1. Instagram account

1. Create the account (for example `@gridirongauntlet`).
2. Settings → **Account type and tools** → **Switch to professional account** → Creator (or Business).
3. Put `https://gridiron-gauntlet.onrender.com` in the bio link.

### 2. Facebook Page

Meta's publishing API needs the Instagram account linked to a Facebook Page.

1. Create a Page named Gridiron Gauntlet (it can stay bare).
2. Link it: in the Page's settings → **Linked accounts** → Instagram → connect, or from Instagram via
   **Accounts Center**.

### 3. Meta developer app

1. Go to <https://developers.facebook.com> → **My Apps** → **Create app**.
2. Choose the business type / the use case for managing Instagram content, and connect it to your
   business portfolio if asked.
3. Add the Instagram product set up **with Facebook Login for Business**.
4. You'll need these permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   `pages_read_engagement` (and `business_management` if offered).

Because you own the account and have a role on the app, you can use these on your own account
without sending the app for review.

### 4. Access token

Best option, a token that doesn't expire:

1. **Meta Business Suite** → **Settings** → **Users** → **System users** → add an admin system user.
2. **Assign assets**: the Page, the Instagram account and the app (full control).
3. **Generate token** for the app, expiry **Never**, with the permissions above.

Fallback: in the **Graph API Explorer**, generate a user token with those permissions and exchange it for
a long-lived token. That one lasts about 60 days, so set a reminder to replace the secret.

### 5. Instagram user ID

In the Graph API Explorer, with your token, run:

```
GET me/accounts?fields=instagram_business_account{id,username}
```

The `instagram_business_account.id` (a long number) is your `IG_USER_ID`.

### 6. Add the secrets to GitHub

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Value |
| --- | --- |
| `IG_USER_ID` | the Instagram business account ID from step 5 |
| `IG_ACCESS_TOKEN` | the token from step 4 |

### 7. Test it

Repo → **Actions** → **Daily Instagram reel** → **Run workflow**:

- First with **Render only** checked: check the reel in the run's Artifacts.
- Then unchecked: it posts for real. The run summary shows the post link.

Re-running on the same day is safe: it skips if today's reel is already on the account.

## Running it yourself

```bash
npm run social:render                 # today's reel -> out/social/<date>/reel.mp4, cover.jpg, caption.txt
npm run social:render -- 2026-10-31   # a specific day
npm run social:post                   # render + post (needs IG_USER_ID and IG_ACCESS_TOKEN)
npm run og                            # rebuild the link-preview image (client/public/og.png)
```

Needs `ffmpeg` and Chromium (`npx playwright-core install chromium`).

## Changing things

- Posting time: the `cron` lines and the hour check in `.github/workflows/instagram.yml`.
- Hooks, caption and hashtags: `scripts/social/pick.ts`.
- Look and timing: `scripts/social/template.ts`.
- API version: defaults to `v26.0`; override with a repo **variable** `IG_GRAPH_VERSION`.

# Focus Tracker

A small web app that tracks how well you focus while you study or work, so you can find the times of day, days of the week and session lengths that work best for you.

## How it works

1. Once a day, press **Check in** and note what time you woke up, what you did first thing, what you've eaten and what else is on today. You can edit it later in the day, for example to add meals.
2. Choose **Studying** or **Working**, say where you are, and press **Start session**. Places you've used before show up as quick picks.
3. Each time your mind wanders or you pick up your phone, press **I got distracted**. Time you spend away from the browser tab is counted automatically.
4. Press **Finish session** and rate your focus from 1 (barely) to 5 (locked in). You can add a short note, like "tired" or "noisy library".

After a few sessions, the **When you focus best** section shows:

- the time of day and day of the week you focus best and worst
- a day × time-of-day heatmap of your average focus
- how your focus changes with session length
- how your focus compares between studying and working
- your focus at each place
- your focus by wake-up time, by what you did first thing, and by how busy your day was

Once you have both kinds of session, you can filter the insights to just studying or just working. Your best hours for one may not be your best hours for the other.

Sessions between midnight and 4am count toward the day before, so a late-night session uses that day's check-in.

What you ate is shown in the session log and the CSV export, but it isn't charted, since free-text meals can't be averaged.

Use **Preview with sample data** to see what the insights look like before you have your own sessions. Sample data is removed when you save your first real session.

## Your data

Everything you log is saved in your browser straight away, so the app works offline.

If Supabase is set up (see below), you can sign in with your email. Your sessions and check-ins are then also saved to your account and show up on any device you sign in on. Changes you make while offline are saved to your account when you're back online. The first time you sign in on a browser that already has data, the app asks whether to add it to your account.

Without Supabase, data stays in that one browser, and clearing your browser's site data deletes it. Use **Back up data** to download a backup file and **Restore backup** to load it elsewhere. **Export CSV** gives you a spreadsheet of every session.

## Setting up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it. This creates the `sessions` and `days` tables and makes sure each person can only see their own rows.
3. Under **Authentication → URL Configuration**, set **Site URL** to where the app lives (for example `https://camryndunseath.github.io/focus-tracker/`) and add the same address under **Redirect URLs**. Sign-in links send you back there.
4. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key (or **publishable** key) into [`config.js`](config.js), then commit it. This key is meant to be public; the table rules keep your data private.

## Running it

There's nothing to install. Open `index.html` in a browser, or publish it with GitHub Pages. Signing in needs the GitHub Pages address (or another web address), because sign-in links can't open a file on your computer.

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
3. After a minute, the app is live at `https://camryndunseath.github.io/focus-tracker/`.

## Files

- `index.html` — page structure
- `style.css` — styles, including dark mode
- `app.js` — timer, distraction tracking, storage, Supabase sync and analysis
- `config.js` — your Supabase project URL and public key
- `supabase/schema.sql` — database tables and access rules

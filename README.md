# Focus Tracker

A small web app that tracks how well you focus while you study or work, so you can find the times of day, days of the week and session lengths that work best for you.

## How it works

1. Choose **Studying** or **Working** and press **Start session**.
2. Each time your mind wanders or you pick up your phone, press **I got distracted**. Time you spend away from the browser tab is counted automatically.
3. Press **Finish session** and rate your focus from 1 (barely) to 5 (locked in). You can add a short note, like "tired" or "noisy library".

After a few sessions, the **When you focus best** section shows:

- the time of day and day of the week you focus best and worst
- a day × time-of-day heatmap of your average focus
- how your focus changes with session length
- how your focus compares between studying and working

Once you have both kinds of session, you can filter the insights to just studying or just working. Your best hours for one may not be your best hours for the other.

Use **Preview with sample data** to see what the insights look like before you have your own sessions. Sample data is removed when you save your first real session.

## Your data

Sessions are saved in your browser's local storage. Nothing is sent anywhere. Because of that:

- data doesn't sync between devices or browsers
- clearing your browser's site data deletes it

Use **Back up data** to download a backup file, and **Restore backup** to load it on another device. **Export CSV** gives you a spreadsheet of every session.

## Running it

There's nothing to install. Open `index.html` in a browser, or publish it with GitHub Pages:

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
3. After a minute, the app is live at `https://camryndunseath.github.io/focus-tracker/`.

## Files

- `index.html` — page structure
- `style.css` — styles, including dark mode
- `app.js` — timer, distraction tracking, storage and analysis

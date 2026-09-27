# Budget Keeper

A simple weekly expense budget tracker for iPhone, built as an installable web app (PWA).
No App Store and no Mac are needed. It runs full-screen from your home screen, works offline, and keeps all data on your phone.

## Features

- A gas-gauge view of how much of the week's budget is left (F = untouched, E = spent)
- Log expenses with a category, amount, date (defaults to today), and notes
- Category autocomplete from past entries, ranked by how often you use them
- Arrow (or swipe) between weeks; tap the date range to jump back to this week
- Settings for the weekly budget amount and which weekday the week starts on
- Budgets are saved per week: changing the budget in Settings applies to this week and later weeks only, so past weeks keep theirs. Tap **Budget** on the main screen to give just the week you're viewing a different amount.
- Tap any expense to edit or delete it
- Export/import a JSON backup

## Put it on your iPhone

The app has to be served over HTTPS. GitHub Pages is free and works well:

1. Push this repo to GitHub.
2. On GitHub, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and pick `main` / `/ (root)`.
3. After a minute it will be live at `https://<your-username>.github.io/BudgetKeeper/`.
4. On your iPhone, open that URL in **Safari**, tap **Share**, then **Add to Home Screen**.

Launch it from the home screen icon from then on.

## Your data

Expenses are saved in the app's local storage on your phone. Nothing is sent anywhere.
Deleting the home screen app deletes its data, so use **Settings → Export Data** now and then to save a backup (to Files, iCloud Drive, email, etc.).

## Run locally

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## Updating

After you change the app, bump `CACHE` in `sw.js` (for example `budgetkeeper-v2`) so phones pick up the new version. It appears the second time you open the app after the update.

Icons are generated with `python tools/make_icons.py` (requires Pillow).

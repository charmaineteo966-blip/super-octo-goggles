# Shelfmate

A book recommendation site that works like a dating app: build a reader profile, then swipe through books and see a % match for each one.

## Run it

No build step and no server. Open `index.html` in a browser.

To share it online, host the folder on any static host (for example GitHub Pages: Settings → Pages → deploy from this branch).

## How it works

- **Onboarding:** pick the genres, moods and pace you like.
- **Swipe:** drag right (♥) to like, left (✕) to pass, or up (★) to super like. Buttons and the arrow keys work too. Tap a card to see its match breakdown.
- **Match %:** each book is tagged with genres, moods and a pace. Your profile holds a weight for every tag, and the match % reflects how much your profile favours that book's tags (genre 50%, mood 35%, pace 15%).
- **It learns:** every swipe adjusts your weights, so the deck reorders toward books you'll like.
- **It's a match!** A like on a book above 75%, or any super like, shows the match screen. All likes go to your matches list (♥ in the top right).
- Your progress is saved in your browser's localStorage.

## Files

| File | What it holds |
| --- | --- |
| `index.html` | Page layout |
| `styles.css` | Styling, including dark mode |
| `books.js` | The book catalogue and tag labels. Add books here. |
| `app.js` | Matching, swiping and screens |

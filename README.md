# MacroTracker

A clean, mobile-first calorie and protein tracker built with React. No accounts, no servers — your data stays in your browser.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)
![Deployed on Vercel](https://img.shields.io/badge/Vercel-Deployed-black?logo=vercel&logoColor=white)

---

## Why I Built This

Most calorie trackers are bloated with social feeds, premium upsells, and forced accounts. I wanted something fast and frictionless: open the app, log a meal in seconds, and see where I stand for the day. So I built one.

## Features

**Barcode Scanner** *(currently disabled; the code is commented out in `MacroTracker.jsx`)*
- Tap the scan icon to open a full-screen camera scanner (mobile only)
- Automatically looks up nutrition data via the free Open Food Facts database
- Shows a serving size card — enter servings or grams, see live calorie/protein totals
- Falls back gracefully to manual entry if a product isn't found
- Uses native `BarcodeDetector` API on iOS 17+ and Android; ZXing canvas fallback for older devices

**Daily Tracking**
- Log calories and protein per meal with a quick-entry form
- Circular progress rings show real-time progress toward daily goals
- Frequent foods are remembered for one-tap quick-add
- Backfill or delete entries for previous days

**Log from Claude (JSON patch)**
- Tell Claude what you ate; it replies with a JSON block
- Tap the clipboard icon on Today → **Paste from clipboard**, review, then **Log**
- Entries can target past days, and a patch can also update goals
- Each patch's `id` is applied only once, so pasting twice won't double-log

```json
{
  "macroTracker": "patch",
  "id": "2026-10-25-lunch",
  "entries": [
    { "name": "Chicken wrap", "calories": 520, "protein": 38, "date": "2026-10-25" }
  ],
  "goals": { "calories": 2200, "protein": 160 }
}
```
`date` (defaults to today), `goals`, and `id` are optional. A bare array of entries also works.

**Weight Tracking**
- Log daily weigh-ins in lbs or kg
- One measurement per day; line chart over the last 30 days, 90 days or year

**History & Insights**
- Past days are automatically archived at midnight
- 7-day averages for calories, protein, and goal adherence, with per-day exclusion
- Bar chart visualization of the last 14 days
- Expandable day-by-day breakdown with individual entries

**Settings & Customization**
- Adjustable calorie and protein goals with preset shortcuts
- Dark / light theme toggle
- Download a JSON backup and restore it later or on another device
- Full data reset option

**Privacy-First**
- 100% client-side — all data lives in `localStorage`
- No accounts and no backend; the only network use is anonymous Vercel page-view analytics
- Open the app in several tabs safely: each tab picks up the others' changes

## Tech Stack

| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Framework        | React 18                                        |
| Bundler          | Vite 6                                          |
| Styling          | Tailwind CSS 3                                  |
| Charts           | Hand-rolled SVG                                 |
| Icons            | Lucide React                                    |
| Barcode scanning | Native `BarcodeDetector` API + `@zxing/browser` |
| Nutrition data   | Open Food Facts API (free, no key required)     |
| Hosting          | Vercel                                          |
| Analytics        | Vercel Analytics (anonymous only)               |

## Getting Started

```bash
# Clone the repo
git clone https://github.com/LukeSheely/macro-tracker.git
cd macro-tracker

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

## Project Structure

```
├── MacroTracker.jsx      # All app logic in a single component file
├── index.html            # Entry HTML
├── src/
│   ├── main.jsx          # React root mount
│   └── index.css         # Tailwind imports + base styles
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

The entire app lives in `MacroTracker.jsx` — reducer, components, utilities, and all. This was a deliberate choice to keep the project simple and self-contained.

## License

MIT

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

**Barcode Scanner**
- Tap the scan icon to open a full-screen camera scanner (mobile only)
- Automatically looks up nutrition data via the free Open Food Facts database
- Shows a serving size card — enter servings or grams, see live calorie/protein totals
- Falls back gracefully to manual entry if a product isn't found
- Uses native `BarcodeDetector` API on iOS 17+ and Android; ZXing canvas fallback for older devices

**Daily Tracking**
- Log calories and protein per meal with a quick-entry form
- Circular progress rings show real-time progress toward daily goals
- Frequent foods are remembered for one-tap quick-add

**Weight Tracking**
- Log daily weigh-ins in lbs or kg
- Line chart shows your trend over the last 14 entries

**History & Insights**
- Past days are automatically archived at midnight
- 7-day rolling averages for calories, protein, and goal adherence
- Bar chart visualization of the last 14 days
- Expandable day-by-day breakdown with individual entries

**Settings & Customization**
- Adjustable calorie and protein goals with preset shortcuts
- Dark / light theme toggle
- Full data reset option

**Privacy-First**
- 100% client-side — all data lives in `localStorage`
- No accounts, no tracking, no backend
- Works offline after first load (scanner requires network for nutrition lookup)

## Tech Stack

| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Framework        | React 18                                        |
| Bundler          | Vite 6                                          |
| Styling          | Tailwind CSS 3                                  |
| Charts           | Recharts                                        |
| Icons            | Lucide React                                    |
| Barcode scanning | Native `BarcodeDetector` API + `@zxing/browser` |
| Nutrition data   | Open Food Facts API (free, no key required)     |
| Hosting          | Vercel                                          |
| Analytics        | Vercel Analytics (anonymous only)               |

## Getting Started

```bash
# Clone the repo
git clone https://github.com/your-username/macro-tracker.git
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

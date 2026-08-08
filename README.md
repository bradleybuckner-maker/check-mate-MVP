# CheckMate MVP — Deployable Demo

This project is the working demo build of CheckMate.

## What works

- Take a receipt photo on a phone
- Upload a receipt from the photo library
- Browser-bundled OCR using `tesseract.js`
- Image preprocessing before OCR
- Automatic extraction of likely receipt line items and prices
- Editable receipt review / manual correction
- Tax and service-charge fields
- Create a table and add guests
- Claim individual items
- Split an item equally by assigning it to multiple guests
- Proportional allocation of tax, service charge, and tip
- Per-guest totals
- Simulated Apple Pay / card / cash / covered-by-host methods
- Host settlement dashboard
- Final "Check Mate" completion screen

## Intentionally simulated

This is a demo MVP, not a payment processor. No real money is collected.
Guest activity is demonstrated on one browser session; real-time multi-device syncing would be the next production layer.

## Run locally

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Then open the local address Vite displays.

## Deploy on Render

This project is a static Vite app, so use **Static Site**, not Web Service.

1. Put all project files in the root of your GitHub repository.
2. In Render choose **New > Static Site**.
3. Connect the `checkmate-mvp` repository.
4. Build Command:
   `npm install && npm run build`
5. Publish Directory:
   `dist`
6. Create Static Site.

No API keys or environment variables are required.

## Deploy on Vercel

Import the GitHub repository into Vercel. Vercel should detect Vite automatically.

- Build command: `npm run build`
- Output directory: `dist`

## Receipt scanning notes

OCR quality depends heavily on the photo. Best results:
- receipt fills most of the frame
- good lighting
- minimal shadows
- camera held straight above receipt
- text is not blurry

The review screen is intentionally part of the MVP because restaurant receipt formats vary and OCR should never silently create incorrect charges.

# JLD Combat — storefront prototype

A fast, minimalist online store for pro-line boxing & MMA gear (Everlast + Venum).
**Front-end only** — no backend, no database, no payment processing. Products are
hard-coded. The shopping cart and coupons run entirely in the browser.

## Why it's built this way (the "still works in 50 years" goal)

This is **plain HTML, CSS, and JavaScript with zero dependencies and no build step.**

- No frameworks, no `npm install`, nothing to update or that can rot.
- No external requests — every image is stored locally in `images/`.
- It is just static files. Any web server (or even double-clicking `index.html`)
  will run it. That will still be true decades from now.

If you only remember one thing: **don't add a build tool or a framework.** The
robustness comes from *not* having those.

## Running it

Any of these work:

- **Just open it:** double-click `index.html`. (The cart still works; some browsers
  are slightly stricter about local files, so the option below is more reliable.)
- **Serve the folder** (recommended), then visit the printed URL:
  ```
  python -m http.server 8000
  ```
- **Deploy it:** upload the whole folder to any static host — Netlify, Cloudflare
  Pages, GitHub Pages, S3, or plain shared hosting. No configuration needed.

## File layout

| File / folder   | What it is |
|-----------------|------------|
| `index.html`    | Page structure (header, hero, shop, cart drawer). |
| `styles.css`    | All styling. Colors/spacing live in the `:root` variables at the top. |
| `app.js`        | All behavior: filtering, search, sort, cart, coupons, persistence. |
| `products.js`   | **The catalog.** One array of product objects — edit this to change products. |
| `images/`       | Local product photos (one `.jpg` per product, 800×800). |
| `catalog.json`  | Source manifest: the original image URLs each photo came from (handy if you ever want to refresh/re-download images). Not used by the site at runtime. |

## Common edits

### Change a price / name / description
Open `products.js` and edit the matching object. Each product looks like:

```js
{
  "id": "venum-streamline-boxing-gloves-black-gold",  // unique, lowercase, no spaces
  "brand": "Venum",
  "name": "Streamline Boxing Gloves - Black/Gold",
  "category": "gloves",        // gloves | headgear | cup | boots | wraps | shinguards | mouthguard | mitts
  "price": 89.99,
  "blurb": "Short one-line description.",
  "img": "venum-streamline-boxing-gloves-black-gold.jpg"  // file inside images/
}
```

> Older product objects may still contain a `"pro"` field — it is no longer used
> and is safely ignored. You can delete it or leave it.

### Add a product
1. Drop a square image into `images/` (800×800 JPG on a white background looks best).
2. Add a new object to the array in `products.js` with a unique `id` and the
   `img` filename. Done — it appears automatically and joins the right filters.

### Add or change a category
Categories are driven by the `category` field. To rename how a category is *labeled*
or reorder the filter buttons, edit `CATEGORY_LABELS` and `CATEGORY_ORDER` near the
top of `app.js`.

### Filters (how they work)
- **Max-price slider** — filters to items at or below the chosen price, in $25 steps.
  The top step ("Any price") removes the cap. Change the steps via the `min`/`max`/`step`
  on `#priceRange` in `index.html` (and `PRICE_MAX` in `app.js` if you move the top).
- **Glove type** (Training / Fight / Lace-up / MMA) — this sub-filter only appears when
  **Gloves** is selected. Each glove's types are detected automatically from its name by
  the keyword rules in `GLOVE_TYPES` at the top of `app.js`, so newly added gloves are
  tagged with no extra work. Edit that array to change the labels or matching rules.

### Change coupon codes
Edit the `COUPONS` object near the top of `app.js`:

```js
var COUPONS = {
  PROLINE10:  { type: "percent", value: 10, label: "PROLINE10 — 10% off" },
  VENUM15:    { type: "percent", value: 15, brand: "Venum", label: "..." }, // brand-only
  WELCOME20:  { type: "percent", value: 20, min: 150, label: "..." },       // min spend
  RINGSIDE25: { type: "fixed",   value: 25, min: 100, label: "..." }        // $ off
};
```
- `type`: `"percent"` (value = %) or `"fixed"` (value = $ off)
- `brand` *(optional)*: restrict the discount to that brand's items only
- `min` *(optional)*: minimum subtotal required to use the code

### Rebrand (store name / colors)
- **Name:** edit the `.brand` block in `index.html` ("JLD COMBAT").
- **Colors:** edit the variables in `:root` at the top of `styles.css`
  (`--accent` is the red, `--ink` is the near-black text, `--gold` is the pro badge).

## What this prototype does NOT do

It's a front-end skeleton, so by design there is **no** real checkout, payment,
inventory, accounts, or order storage. The "Checkout" button just confirms the
total. Adding any of those later means introducing a backend — keep that separate
so this fast, static front-end stays simple.

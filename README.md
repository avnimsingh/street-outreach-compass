# Street Outreach Compass

A small web app that helps a bystander connect someone in distress on the street
to the right nearby resource — a shelter, an NGO, or a referral hotline — instead
of guessing. Works worldwide: it looks up real, nearby organizations wherever
you are, using OpenStreetMap's live database.

**[Live demo](#deploying-to-github-pages)** · Built with plain HTML/CSS/JS, no build step, no backend, no API keys.

## Why this app doesn't do photo-based classification

An earlier version of this idea was: upload a photo of someone sleeping outside,
and have an algorithm guess whether they're homeless, then route them to a shelter
or an NGO accordingly.

That approach doesn't hold up, for a couple of concrete reasons:

- **There's no reliable visual signal for "homeless."** A model asked to guess this
  from a photo ends up reading cues like clothing condition or the presence of
  belongings — which are stereotypes, not evidence. Someone could be unhoused,
  between housing, locked out, intoxicated, or having a medical episode, and none
  of that is visible in a photo of someone sleeping.
- **A wrong guess has real consequences.** Misrouting someone means they don't get
  the help they actually need.
- **Photographing a vulnerable, unconscious person to run them through a classifier
  raises consent and dignity concerns**, independent of whether the classifier works.

Instead, this app puts a human's own judgment in the loop (a couple of quick,
answerable questions) and focuses the "smart" part of the app on something it's
actually good at: finding and sorting real nearby resources.

## How it works

1. **Step 1 — a quick read of the situation.** Three yes/no-style questions:
   is the person responsive, is there a medical emergency, and what's your best
   guess at their housing situation. If either of the first two flags urgent, the
   emergency strip at the top leads with a call button before anything else.
2. **Step 2 — geolocation.** The browser's `navigator.geolocation` API gets your
   current coordinates. Two things happen with them:
   - A reverse-geocode lookup (via [Nominatim](https://nominatim.org/)) detects
     your country and updates the emergency-call button to the right local number
     (911, 112, 999, etc. — see `EMERGENCY_NUMBERS` in `app.js`).
   - A live query to the [Overpass API](https://overpass-api.de/) (OpenStreetMap's
     query engine) asks for shelters, homelessness-focused charities, outreach
     centers, and food banks within 20km of you — anywhere in the world.
3. **Step 3 — results.** Results are sorted by straight-line distance (haversine
   formula), with the ordering nudged by your Step 1 answer — e.g. if the person
   may already have housing, NGO/hotline referral options are surfaced first
   instead of an overnight shelter bed. If the live lookup fails (offline, or
   Overpass is temporarily down), the app falls back to a small offline example
   dataset (`data.js`) plus a Google Maps search link, so it's never a dead end.

Nothing is sent to any server besides the two public, no-API-key services above —
this is a static site with no backend of its own.

## Project structure

```
├── index.html   # page structure & questions
├── styles.css   # all styling
├── app.js       # state, live OSM lookup, distance calculation, rendering
├── data.js      # offline fallback dataset (used only if the live lookup fails)
└── README.md
```

## Running locally

No build tools needed. Either:

- Open `index.html` directly in a browser, or
- Serve it locally so geolocation permissions behave normally in all browsers:
  ```bash
  python3 -m http.server 8000
  # then visit http://localhost:8000
  ```

## Deploying to GitHub Pages

1. Push this folder to a new GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, select the `main` branch and `/ (root)` folder.
4. Save — GitHub will give you a live URL (usually
   `https://<username>.github.io/<repo-name>/`) within a minute or two.

## Data source & coverage

Results come from [OpenStreetMap](https://www.openstreetmap.org/), a
volunteer-maintained map of the world. Coverage is excellent in some cities and
sparse in others — it depends entirely on whether local volunteers have mapped
shelters, charities, and food banks in that area. When nothing turns up nearby,
the app shows a "search on Google Maps" link as a backup, plus general
guidance to call the local emergency number or a national helpline.

If you want to help improve coverage for a specific area, anyone can add a
missing shelter directly on [openstreetmap.org](https://www.openstreetmap.org/)
— tag it `social_facility=shelter` and `social_facility:for=homeless`, and it
will show up in this app (and others that use OSM data) automatically.

### Adding a permanent offline example
`data.js` holds a small fallback list (currently a few real Houston-area
organizations) shown only if the live Overpass lookup fails. To extend it,
add entries in the same shape:

```js
{
  name: "Org name",
  type: "Emergency shelter" | "Outreach / day center" | "NGO / charity" | "Food bank",
  audience: "Who it serves",
  address: "Street address",
  phone: "Phone number",
  hours: "Intake hours",
  notes: "Anything a caller should know",
  lat: 00.0000,
  lng: -00.0000,
}
```

## Data & accuracy disclaimer

Hours, intake windows, and contact info for shelters and NGOs change often,
and OpenStreetMap listings are community-maintained, so details can be
incomplete or out of date. This app always tells users to call ahead, and is
not affiliated with any organization it displays.

## License

MIT — see `LICENSE`.

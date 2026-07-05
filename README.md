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

1. **A step-by-step wizard, one question at a time** (not everything shown at once):
   - Two "gate" questions first — is the person responsive, and is there a visible
     medical emergency. Either one triggers a full-screen pause with a call button;
     the rest of the flow is blocked until you confirm the person is safe and stable.
   - Five situational **indicator questions** — things a bystander can actually
     observe (belongings/cart, sleeping in a spot not meant for sleeping, being a
     recurring presence in the area, weather-mismatched clothing, asking passersby
     for help). Each is answered yes/no.
2. **The answers are scored, not just collected.** Counting the "yes" answers
   across the five indicators:
   - **3 or more** → likely homelessness → the app looks for **shelters, outreach
     centers, and NGOs**
   - **exactly 2** → genuinely unclear → the app leads with **NGO/referral-line**
     options, since that's the best way to figure out what's actually needed
   - **0 or 1** → doesn't look like clear homelessness → the app instead finds the
     nearest **convenience store, supermarket, or water fountain**, framed around
     helping the person get water or food right now rather than assuming they need
     a shelter bed
3. **Geolocation + live lookup.** Once the wizard reaches an outcome, clicking
   "Find help near me" does two things with your coordinates:
   - Reverse-geocodes (via [Nominatim](https://nominatim.org/)) to detect your
     country and update the emergency-call button to the right local number
     (911, 112, 999, etc. — see `EMERGENCY_NUMBERS` in `app.js`).
   - Queries the [Overpass API](https://overpass-api.de/) (OpenStreetMap) for
     whichever resource type matches the outcome, worldwide, within 20km.
4. **Results** are sorted by straight-line distance (haversine formula). If the
   live lookup fails (offline, or Overpass is temporarily down), the app falls
   back to a small offline example dataset (`data.js`) plus a Google Maps
   search link, so it's never a dead end.

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

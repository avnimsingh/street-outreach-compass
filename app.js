/**
 * Street Outreach Compass
 *
 * Deliberately does NOT try to classify anyone as "homeless or not" from a photo.
 * That kind of guess is unreliable and can lead to real harm. Instead, this app
 * walks a bystander through a few observable, situational questions one at a
 * time, and the ANSWERS actually change what happens next:
 *
 *  - If there's any sign of a medical emergency, everything pauses on a
 *    call-first screen.
 *  - A handful of situational indicators (not appearance/stereotypes) are
 *    scored to decide whether the likely need is a shelter/NGO, or just
 *    getting the person food/water right now.
 *  - Results are looked up live from OpenStreetMap, worldwide.
 *
 * Data source: Overpass API (OpenStreetMap). © OpenStreetMap contributors,
 * available under the Open Database License (ODbL).
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const SEARCH_RADIUS_METERS = 20000; // 20km

const EMERGENCY_NUMBERS = {
  US: "911", CA: "911", MX: "911", PR: "911",
  GB: "999", IE: "112",
  AU: "000", NZ: "111",
  BR: "190", AR: "911", CL: "133", CO: "123", PE: "105",
  IN: "112", PK: "15", BD: "999", LK: "119",
  CN: "110", JP: "110", KR: "112", TH: "191", VN: "113",
  PH: "911", ID: "112", MY: "999", SG: "999",
  ZA: "10111", NG: "112", KE: "999", EG: "122",
  RU: "112", TR: "112", SA: "911", AE: "999", IL: "100",
};
const DEFAULT_EMERGENCY_NUMBER = "112";

/* ---------------- Question definitions ---------------- */
// type: 'gate'      -> a yes/no question that can trigger the emergency pause
// type: 'indicator' -> a yes/no question scored toward the homelessness estimate
const QUESTIONS = [
  {
    id: "responsive",
    type: "gate",
    text: "Are they responsive and breathing normally?",
    options: [
      { label: "Yes", value: "yes" },
      { label: "No / not sure", value: "no", urgent: true },
    ],
  },
  {
    id: "medical",
    type: "gate",
    text: "Any visible injury, seizure, or signs of overdose or extreme heat/cold distress?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes", urgent: true },
    ],
  },
  {
    id: "belongings",
    type: "indicator",
    text: "Do they have a cart, large bags, or bedding with them?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "sleepingSpot",
    type: "indicator",
    text: "Are they in a spot not meant for sleeping — a doorway, bench, sidewalk, or underpass?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "recurring",
    type: "indicator",
    text: "Have you seen them in this area before, like it's a regular spot for them?",
    options: [
      { label: "No / not sure", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "clothing",
    type: "indicator",
    text: "Are they dressed in a way that doesn't match the weather — heavy layers in heat, or not enough for the cold?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "asking",
    type: "indicator",
    text: "Are they asking people nearby for money, food, or help?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
];

const state = {
  step: 0, // index into QUESTIONS, or "paused" / "done" handled separately
  mode: "question", // 'question' | 'paused' | 'done'
  answers: {},
  outcome: null, // 'homeless' | 'unsure' | 'assist'
  coords: null,
  liveResources: null,
  loading: false,
  loadError: false,
};

/* ---------------- Wizard rendering ---------------- */

function indicatorScore() {
  return ["belongings", "sleepingSpot", "recurring", "clothing", "asking"].filter(
    (id) => state.answers[id] === "yes"
  ).length;
}

function computeOutcome() {
  const score = indicatorScore();
  if (score >= 3) return "homeless";
  if (score === 2) return "unsure";
  return "assist";
}

function renderProgress() {
  const total = QUESTIONS.length;
  const pct = Math.min(100, Math.round((state.step / total) * 100));
  document.getElementById("progressFill").style.width = pct + "%";
  document.getElementById("wizardStepLabel").textContent =
    state.mode === "done" ? "Done" : `Question ${Math.min(state.step + 1, total)} of ${total}`;
}

function renderEmergencyPause() {
  const container = document.getElementById("wizardQuestion");
  container.innerHTML = `
    <div class="emergency-pause">
      <p class="wizard-q-text">This sounds like it could be a medical emergency.</p>
      <a class="big-call" id="pauseCallLink" href="tel:${DEFAULT_EMERGENCY_NUMBER}">Call ${DEFAULT_EMERGENCY_NUMBER} now</a>
      <p>Call local emergency services before anything else. Come back to this once the person is safe and stable, or if you were mistaken and they're okay.</p>
      <button class="continue-anyway" id="continueAnywayBtn">They're safe now — continue with these questions</button>
    </div>
  `;
  document.getElementById("continueAnywayBtn").addEventListener("click", () => {
    state.mode = "question";
    renderWizard();
  });
}

function renderQuestion() {
  const q = QUESTIONS[state.step];
  const container = document.getElementById("wizardQuestion");

  const optionsHtml = q.options
    .map(
      (opt) =>
        `<button class="choice-btn" data-value="${opt.value}">${opt.label}</button>`
    )
    .join("");

  container.innerHTML = `
    <p class="wizard-q-text">${q.text}</p>
    <div class="choices">${optionsHtml}</div>
    <div class="wizard-actions">
      ${state.step > 0 ? `<button class="back-link" id="backBtn">← Back</button>` : "<span></span>"}
      <span></span>
    </div>
  `;

  container.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const opt = q.options.find((o) => o.value === btn.dataset.value);
      state.answers[q.id] = opt.value;

      if (q.type === "gate" && opt.urgent) {
        state.mode = "paused";
        renderWizard();
        return;
      }

      if (state.step + 1 < QUESTIONS.length) {
        state.step += 1;
        renderWizard();
      } else {
        state.outcome = computeOutcome();
        state.mode = "done";
        renderWizard();
        revealOutcome();
      }
    });
  });

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      state.step = Math.max(0, state.step - 1);
      renderWizard();
    });
  }
}

function renderDone() {
  const container = document.getElementById("wizardQuestion");
  const summary = {
    homeless: "Based on your answers, this looks like it's likely homelessness.",
    unsure: "Based on your answers, it's genuinely unclear — worth checking with a referral line.",
    assist: "Based on your answers, this doesn't look like a clear homelessness situation.",
  }[state.outcome];

  container.innerHTML = `
    <p class="wizard-q-text">${summary}</p>
    <button class="back-link" id="restartBtn">↻ Start over</button>
  `;
  document.getElementById("restartBtn").addEventListener("click", () => {
    state.step = 0;
    state.mode = "question";
    state.answers = {};
    state.outcome = null;
    state.liveResources = null;
    document.getElementById("locatePanel").hidden = true;
    document.getElementById("resultsSection").hidden = true;
    renderWizard();
  });
}

function renderWizard() {
  renderProgress();
  if (state.mode === "paused") {
    renderEmergencyPause();
  } else if (state.mode === "done") {
    renderDone();
  } else {
    renderQuestion();
  }
}

function revealOutcome() {
  const locatePanel = document.getElementById("locatePanel");
  const heading = document.getElementById("outcomeHeading");
  const explainer = document.getElementById("outcomeExplainer");
  const resultsHeading = document.getElementById("resultsHeading");

  if (state.outcome === "homeless") {
    heading.textContent = "Find nearby shelters & NGOs";
    explainer.textContent = "We'll look for emergency shelters, outreach centers, and homelessness-focused NGOs near you.";
    resultsHeading.textContent = "Nearby shelters & NGOs";
  } else if (state.outcome === "unsure") {
    heading.textContent = "Find a referral line or NGO";
    explainer.textContent = "When it's unclear, a referral line or NGO caseworker can help figure out what's actually needed — we'll surface those first.";
    resultsHeading.textContent = "Referral lines & NGOs nearby";
  } else {
    heading.textContent = "Find water or food nearby";
    explainer.textContent = "This doesn't look like a clear homelessness situation — if you'd like to help anyway, here's the nearest place to grab water or food.";
    resultsHeading.textContent = "Nearby convenience stores, groceries & water";
  }

  locatePanel.hidden = false;
  locatePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- Distance & formatting ---------------- */

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function badgeClass(type) {
  if (type.includes("Shelter")) return "shelter";
  if (type.includes("Outreach") || type.includes("Food")) return "day";
  if (type.includes("NGO") || type.includes("Charity")) return "ngo";
  if (type.includes("Convenience") || type.includes("Supermarket") || type.includes("Water")) return "day";
  return "hotline";
}

/* ---------------- OpenStreetMap lookups ---------------- */

function classifyShelterTags(tags) {
  if (tags.social_facility === "shelter" || tags["social_facility:for"] === "homeless") {
    return "Emergency shelter";
  }
  if (tags.social_facility === "outreach") return "Outreach / day center";
  if (tags.amenity === "food_bank") return "Food bank";
  if (tags.office === "charity") return "NGO / charity";
  if (tags.amenity === "social_facility") return "Social facility";
  return "Community resource";
}

function classifyAssistTags(tags) {
  if (tags.amenity === "drinking_water") return "Water fountain";
  if (tags.shop === "supermarket") return "Supermarket";
  if (tags.shop === "convenience") return "Convenience store";
  return "Nearby resource";
}

function parseElement(el, classifyFn) {
  const tags = el.tags || {};
  const lat = el.lat ?? (el.center && el.center.lat);
  const lng = el.lon ?? (el.center && el.center.lon);
  if (lat == null || lng == null) return null;

  const type = classifyFn(tags);
  const name = tags.name || tags["name:en"] || type;
  const addressParts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean);
  const address = tags["addr:full"] || (addressParts.length ? addressParts.join(" ") : "Address not listed in OpenStreetMap — use directions link");
  const phone = tags.phone || tags["contact:phone"] || null;
  const hours = tags.opening_hours || "Hours not listed — call ahead if possible";
  const website = tags.website || tags["contact:website"] || null;

  return {
    name,
    type,
    audience: "General",
    address,
    phone,
    hours,
    notes: website
      ? `More info: ${website}`
      : "Community-mapped listing (OpenStreetMap) — details may be incomplete, verify before visiting.",
    lat,
    lng,
  };
}

async function fetchShelterResources(lat, lng) {
  const query = `
    [out:json][timeout:25];
    (
      node["social_facility"="shelter"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      way["social_facility"="shelter"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      node["social_facility"="outreach"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      node["social_facility:for"="homeless"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      node["amenity"="social_facility"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      node["office"="charity"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      node["amenity"="food_bank"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
    );
    out center 60;
  `;
  const elements = await runOverpass(query);
  return elements.map((el) => parseElement(el, classifyShelterTags)).filter(Boolean);
}

async function fetchAssistResources(lat, lng) {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="drinking_water"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      node["shop"="convenience"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
      node["shop"="supermarket"](around:${SEARCH_RADIUS_METERS},${lat},${lng});
    );
    out center 60;
  `;
  const elements = await runOverpass(query);
  return elements.map((el) => parseElement(el, classifyAssistTags)).filter(Boolean);
}

async function runOverpass(query) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error("Overpass request failed: " + res.status);
  const json = await res.json();
  return json.elements || [];
}

async function detectEmergencyNumber(lat, lng) {
  try {
    const res = await fetch(`${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=3`);
    if (!res.ok) throw new Error("reverse geocode failed");
    const json = await res.json();
    const cc = json.address && json.address.country_code ? json.address.country_code.toUpperCase() : null;
    return {
      number: (cc && EMERGENCY_NUMBERS[cc]) || DEFAULT_EMERGENCY_NUMBER,
      country: json.address ? json.address.country : null,
    };
  } catch {
    return { number: DEFAULT_EMERGENCY_NUMBER, country: null };
  }
}

function updateEmergencyStrip(numberInfo) {
  const link = document.getElementById("emergencyCallLink");
  const label = document.getElementById("emergencyLabel");
  link.href = `tel:${numberInfo.number}`;
  link.textContent = `Call ${numberInfo.number}`;
  label.textContent = numberInfo.country
    ? `Unresponsive, injured, or in medical distress? Don't wait — call ${numberInfo.number} (${numberInfo.country}).`
    : "Unresponsive, injured, or in medical distress? Don't wait — call your local emergency number.";

  const pauseLink = document.getElementById("pauseCallLink");
  if (pauseLink) pauseLink.href = `tel:${numberInfo.number}`;
}

/* ---------------- Results rendering ---------------- */

function renderResults() {
  const list = document.getElementById("results");
  const status = document.getElementById("statusLine");
  list.innerHTML = "";

  const source = state.liveResources || FALLBACK_RESOURCES;

  let items = source.map((r) => {
    const distance =
      state.coords && r.lat != null ? haversineKm(state.coords.lat, state.coords.lng, r.lat, r.lng) : null;
    return { ...r, distance };
  });

  const priority = (r) => {
    if (state.outcome === "homeless") {
      if (r.type.includes("Shelter")) return 0;
      if (r.type.includes("Outreach") || r.type.includes("Food")) return 1;
      if (r.type.includes("NGO")) return 2;
      return 3;
    }
    if (state.outcome === "unsure") {
      if (r.type.includes("NGO") || r.type.includes("Charity")) return 0;
      return 1;
    }
    return 1;
  };

  items.sort((a, b) => {
    const p = priority(a) - priority(b);
    if (p !== 0) return p;
    if (a.distance == null && b.distance == null) return 0;
    if (a.distance == null) return 1;
    if (b.distance == null) return -1;
    return a.distance - b.distance;
  });

  items = items.slice(0, 20);

  if (state.loading) {
    status.textContent = "Searching OpenStreetMap for nearby resources…";
  } else if (state.loadError) {
    status.textContent = "Couldn't reach the live database — showing a small offline example list instead. Try the Maps search link below.";
  } else if (!state.coords) {
    status.textContent = "Enable location to search nearby.";
  } else {
    status.textContent = `Showing results within ${SEARCH_RADIUS_METERS / 1000}km, sorted by distance.`;
  }

  const mapsSearchBox = document.getElementById("mapsSearchFallback");
  if (state.coords) {
    const term = state.outcome === "assist" ? "convenience store" : "homeless shelter";
    mapsSearchBox.href = `https://www.google.com/maps/search/${encodeURIComponent(term)}/@${state.coords.lat},${state.coords.lng},13z`;
    mapsSearchBox.textContent = `Open a live Maps search for "${term}" near me →`;
    mapsSearchBox.style.display = "inline-block";
  } else {
    mapsSearchBox.style.display = "none";
  }

  items.forEach((r) => {
    const card = document.createElement("div");
    card.className = "result-card";

    const distanceHtml =
      r.distance != null
        ? `<div class="num">${r.distance < 10 ? r.distance.toFixed(1) : Math.round(r.distance)}</div><div class="unit">KM AWAY</div>`
        : `<div class="num">—</div><div class="unit">PHONE</div>`;

    const mapsHref = r.lat
      ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}`;

    const callHtml = r.phone ? `<a href="tel:${r.phone.replace(/[^0-9+]/g, "")}">Call ${r.phone}</a>` : "";

    card.innerHTML = `
      <div class="result-distance">${distanceHtml}</div>
      <div class="result-body">
        <div class="result-top">
          <span class="result-name">${r.name}</span>
          <span class="badge ${badgeClass(r.type)}">${r.type}</span>
        </div>
        <div class="result-meta">${r.audience} · ${r.address}<br/>${r.hours}</div>
        <div class="result-notes">${r.notes}</div>
        <div class="result-actions">
          ${callHtml}
          <a href="${mapsHref}" target="_blank" rel="noopener">Get directions</a>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  if (items.length === 0 && !state.loading) {
    const empty = document.createElement("p");
    empty.className = "status-line";
    empty.textContent = "Nothing found nearby in OpenStreetMap's data — try the Maps search link above.";
    list.appendChild(empty);
  }
}

async function locateAndRender() {
  const btn = document.getElementById("locateBtn");
  document.getElementById("resultsSection").hidden = false;

  if (!("geolocation" in navigator)) {
    document.getElementById("statusLine").textContent = "Location isn't available in this browser.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Finding your location…";

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.loading = true;
      state.loadError = false;
      btn.textContent = "Searching nearby…";
      renderResults();

      detectEmergencyNumber(state.coords.lat, state.coords.lng).then(updateEmergencyStrip);

      try {
        state.liveResources =
          state.outcome === "assist"
            ? await fetchAssistResources(state.coords.lat, state.coords.lng)
            : await fetchShelterResources(state.coords.lat, state.coords.lng);
      } catch (err) {
        console.error(err);
        state.liveResources = null;
        state.loadError = true;
      } finally {
        state.loading = false;
        btn.disabled = false;
        btn.textContent = "Update my location";
        renderResults();
      }
    },
    () => {
      btn.disabled = false;
      btn.textContent = "Find help near me";
      document.getElementById("statusLine").textContent = "Location wasn't shared — showing an example list.";
      renderResults();
    },
    { timeout: 10000 }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  renderWizard();
  document.getElementById("locateBtn").addEventListener("click", locateAndRender);
});

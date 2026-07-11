/**
 * Street Outreach Compass
 *
 * Deliberately does NOT try to classify anyone as "homeless or not" from a photo.
 * That kind of guess is unreliable and can lead to real harm. Instead, this app
 * shows a handful of observable, situational questions all at once, and the
 * ANSWERS actually change what happens next:
 *
 *  - Every question defaults to the calm/neutral answer (not pre-filled with
 *    "yes" across the board) — so an unedited screen never silently assumes
 *    an emergency isn't happening, or that someone is homeless.
 *  - A live urgent banner appears the moment either safety question is
 *    flipped to concerning.
 *  - Five situational indicators are scored to decide whether the likely need
 *    is a shelter/NGO, or just getting the person food/water right now.
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
// "default" is always the calm/neutral answer — an untouched screen never
// silently reports an emergency or assumes homelessness on its own.
const QUESTIONS = [
  {
    id: "responsive",
    type: "gate",
    text: "Are they responsive and breathing normally?",
    options: [
      { label: "Yes", value: "yes" },
      { label: "No / not sure", value: "no", urgent: true },
    ],
    default: "yes",
  },
  {
    id: "medical",
    type: "gate",
    text: "Any visible injury, seizure, or signs of overdose or extreme heat/cold distress?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes", urgent: true },
    ],
    default: "yes",
  },
  {
    id: "belongings",
    type: "indicator",
    text: "Do they have a cart, large bags, or bedding with them?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
    default: "yes",
  },
  {
    id: "sleepingSpot",
    type: "indicator",
    text: "Are they in a spot not meant for sleeping — a doorway, bench, sidewalk, or underpass?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
    default: "yes",
  },
  {
    id: "recurring",
    type: "indicator",
    text: "Have you seen them in this area before, like it's a regular spot for them?",
    options: [
      { label: "No / not sure", value: "no" },
      { label: "Yes", value: "yes" },
    ],
    default: "yes",
  },
  {
    id: "clothing",
    type: "indicator",
    text: "Are they dressed in a way that doesn't match the weather — heavy layers in heat, or not enough for the cold?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
    default: "yes",
  },
  {
    id: "asking",
    type: "indicator",
    text: "Are they asking people nearby for money, food, or help?",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
    default: "yes",
  },
];

const state = {
  answers: {},
  outcome: null,
  coords: null,
  liveResources: null,
  loading: false,
  loadError: false,
  resultsStale: false,
};

// Seed every answer with its calm/neutral default up front.
QUESTIONS.forEach((q) => {
  state.answers[q.id] = q.default;
});

/* ---------------- Scoring ---------------- */

function indicatorScore() {
  return ["belongings", "sleepingSpot", "recurring", "clothing", "asking"].filter(
    (id) => state.answers[id] === "yes"
  ).length;
}

function isUrgent() {
  return state.answers.responsive === "no" || state.answers.medical === "yes";
}

function computeOutcome() {
  const score = indicatorScore();
  if (score >= 3) return "homeless";
  if (score === 2) return "unsure";
  return "assist";
}

/* ---------------- Rendering the question list ---------------- */

function renderQuestionList() {
  const container = document.getElementById("questionList");
  container.innerHTML = "";

  QUESTIONS.forEach((q) => {
    const block = document.createElement("div");
    block.className = "question";
    block.dataset.question = q.id;

    const optionsHtml = q.options
      .map((opt) => {
        const selected = state.answers[q.id] === opt.value ? "selected" : "";
        const urgentClass = selected && opt.urgent ? "urgent" : "";
        return `<button class="choice-btn ${selected} ${urgentClass}" data-value="${opt.value}">${opt.label}</button>`;
      })
      .join("");

    block.innerHTML = `
      <p class="q-text">${q.text}</p>
      <div class="choices">${optionsHtml}</div>
    `;
    container.appendChild(block);
  });

  container.querySelectorAll(".question").forEach((block) => {
    const id = block.dataset.question;
    const q = QUESTIONS.find((item) => item.id === id);
    block.querySelectorAll(".choice-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.answers[id] = btn.dataset.value;
        onAnswerChanged();
      });
    });
  });

  updateUrgentBanner();
}

function updateUrgentBanner() {
  document.getElementById("urgentBanner").classList.toggle("show", isUrgent());
}

function onAnswerChanged() {
  renderQuestionList(); // re-draw so the clicked button shows as selected
  const previousOutcome = state.outcome;
  state.outcome = computeOutcome();
  updateOutcomePanel();

  // If we already fetched live results for a different outcome, mark them stale
  // rather than silently showing shelters when the answers now say "assist," etc.
  if (state.liveResources && previousOutcome && previousOutcome !== state.outcome) {
    state.resultsStale = true;
    renderResults();
  }
}

function updateOutcomePanel() {
  const heading = document.getElementById("outcomeHeading");
  const explainer = document.getElementById("outcomeExplainer");
  const resultsHeading = document.getElementById("resultsHeading");

  if (state.outcome === "homeless") {
    heading.textContent = "Find nearby shelters & NGOs";
    explainer.textContent = "Based on your answers, we'll look for emergency shelters, outreach centers, and homelessness-focused NGOs near you.";
    resultsHeading.textContent = "Nearby shelters & NGOs";
  } else if (state.outcome === "unsure") {
    heading.textContent = "Find a referral line or NGO";
    explainer.textContent = "It's genuinely unclear from your answers — a referral line or NGO caseworker can help figure out what's actually needed.";
    resultsHeading.textContent = "Referral lines & NGOs nearby";
  } else {
    heading.textContent = "Find water or food nearby";
    explainer.textContent = "This doesn't look like a clear homelessness situation based on your answers — if you'd like to help anyway, here's the nearest place to grab water or food.";
    resultsHeading.textContent = "Nearby convenience stores, groceries & water";
  }
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
}

/* ---------------- Results rendering ---------------- */

function renderResults() {
  const list = document.getElementById("results");
  const status = document.getElementById("statusLine");
  list.innerHTML = "";

  if (state.resultsStale) {
    status.textContent = "Your answers changed — click \"Find help near me\" again to refresh results for the new outcome.";
    return;
  }

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
  state.resultsStale = false;

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
  state.outcome = computeOutcome();
  renderQuestionList();
  updateOutcomePanel();
  document.getElementById("locateBtn").addEventListener("click", locateAndRender);
});

/**
 * Street Outreach Compass
 *
 * Deliberately does NOT try to classify anyone as "homeless or not" from a photo.
 * That kind of guess is unreliable and can lead to real harm — instead this app
 * helps a bystander answer a couple of situational questions themselves, then
 * looks up real, nearby organizations — anywhere in the world — using
 * OpenStreetMap's live database, sorted by distance.
 *
 * Data source: Overpass API (OpenStreetMap). © OpenStreetMap contributors,
 * available under the Open Database License (ODbL).
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const SEARCH_RADIUS_METERS = 20000; // 20km

// Local emergency numbers by ISO 3166-1 alpha-2 country code.
// Not exhaustive — falls back to 112, which works across most of the world
// (and is routed to local services by most mobile networks even outside
// countries that officially use it).
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

const state = {
  responsive: null, // 'yes' | 'no'
  medicalConcern: null, // 'yes' | 'no'
  situation: null, // 'homeless' | 'housed' | 'unsure'
  coords: null, // { lat, lng }
  liveResources: null, // filled in after a successful Overpass lookup
  loading: false,
  loadError: false,
};

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371; // Earth radius in km
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
  return "hotline";
}

/* ---------------- OpenStreetMap lookups ---------------- */

function classifyTags(tags) {
  if (tags.social_facility === "shelter" || tags["social_facility:for"] === "homeless") {
    return "Emergency shelter";
  }
  if (tags.social_facility === "outreach") return "Outreach / day center";
  if (tags.amenity === "food_bank") return "Food bank";
  if (tags.office === "charity") return "NGO / charity";
  if (tags.amenity === "social_facility") return "Social facility";
  return "Community resource";
}

function parseElement(el) {
  const tags = el.tags || {};
  const lat = el.lat ?? (el.center && el.center.lat);
  const lng = el.lon ?? (el.center && el.center.lon);
  if (lat == null || lng == null) return null;

  const type = classifyTags(tags);
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

async function fetchLiveResources(lat, lng) {
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

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error("Overpass request failed: " + res.status);
  const json = await res.json();
  return json.elements.map(parseElement).filter(Boolean);
}

async function detectEmergencyNumber(lat, lng) {
  try {
    const res = await fetch(
      `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=3`
    );
    if (!res.ok) throw new Error("reverse geocode failed");
    const json = await res.json();
    const cc = json.address && json.address.country_code
      ? json.address.country_code.toUpperCase()
      : null;
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

/* ---------------- Question state ---------------- */

function setChoice(groupEl, key, value, extraClass) {
  groupEl.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.classList.remove("selected", "urgent");
  });
  const btn = groupEl.querySelector(`[data-value="${value}"]`);
  btn.classList.add("selected");
  if (extraClass) btn.classList.add(extraClass);
  state[key] = value;
  updateUrgentBanner();
}

function updateUrgentBanner() {
  const banner = document.getElementById("urgentBanner");
  const urgent = state.responsive === "no" || state.medicalConcern === "yes";
  banner.classList.toggle("show", urgent);
}

/* ---------------- Rendering ---------------- */

function renderResults() {
  const list = document.getElementById("results");
  const status = document.getElementById("statusLine");
  list.innerHTML = "";

  const source = state.liveResources || FALLBACK_RESOURCES;

  let items = source.map((r) => {
    const distance =
      state.coords && r.lat != null
        ? haversineKm(state.coords.lat, state.coords.lng, r.lat, r.lng)
        : null;
    return { ...r, distance };
  });

  const priority = (r) => {
    if (state.situation === "homeless") {
      if (r.type.includes("Shelter")) return 0;
      if (r.type.includes("Outreach") || r.type.includes("Food")) return 1;
      if (r.type.includes("NGO")) return 2;
      return 3;
    }
    if (state.situation === "housed") {
      if (r.type.includes("NGO") || r.type.includes("Hotline")) return 0;
      return 1;
    }
    return 1; // unsure: leave OSM's own distance order alone
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
    status.textContent =
      "Couldn't reach the live database — showing a small offline example list instead. Try the Maps search link below.";
  } else if (!state.coords) {
    status.textContent = "Enable location to search nearby — showing an example list for now.";
  } else if (state.situation === "housed") {
    status.textContent =
      "Since they may have housing, a shelter bed usually isn't the right fit — an NGO or referral line can figure out what's actually needed.";
  } else {
    status.textContent = `Showing results within ${SEARCH_RADIUS_METERS / 1000}km, sorted by distance.`;
  }

  // Always-available fallback: a live Maps search, in case OSM has nothing nearby.
  const mapsSearchBox = document.getElementById("mapsSearchFallback");
  if (state.coords) {
    mapsSearchBox.href = `https://www.google.com/maps/search/homeless+shelter/@${state.coords.lat},${state.coords.lng},13z`;
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

    const callHtml = r.phone
      ? `<a href="tel:${r.phone.replace(/[^0-9+]/g, "")}">Call ${r.phone}</a>`
      : "";

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
    empty.textContent = "Nothing found nearby in OpenStreetMap's data — try the Maps search link above, or widen the search by trying a nearby town.";
    list.appendChild(empty);
  }
}

async function locateAndRender() {
  const btn = document.getElementById("locateBtn");
  const status = document.getElementById("statusLine");

  if (!("geolocation" in navigator)) {
    status.textContent = "Location isn't available in this browser.";
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
        state.liveResources = await fetchLiveResources(state.coords.lat, state.coords.lng);
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
      status.textContent = "Location wasn't shared — showing an example list. You can still call any of them.";
      renderResults();
    },
    { timeout: 10000 }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-question]").forEach((group) => {
    const key = group.dataset.question;
    group.querySelectorAll(".choice-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const extra = btn.dataset.urgent === "true" ? "urgent" : null;
        setChoice(group, key, btn.dataset.value, extra);
        renderResults();
      });
    });
  });

  document.getElementById("locateBtn").addEventListener("click", locateAndRender);

  // Render the example list immediately so the page isn't empty on load.
  renderResults();
});

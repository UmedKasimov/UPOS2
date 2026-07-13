(() => {
  const DEFAULT_CENTER = [41.311081, 69.240562];
  const DEFAULT_ZOOM = 12;
  const PICK_ZOOM = 16;
  const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const TILE_ATTRIBUTION = "&copy; OpenStreetMap";
  const overviewGeocodeCache = new Map();

  function csrfToken(source) {
    return source?.dataset?.csrf
      || document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")
      || document.querySelector('input[name="csrf_token"]')?.value
      || "";
  }

  function setStatus(form, text) {
    const status = form.querySelector("[data-client-location-status]");
    if (status) status.textContent = text;
  }

  function isVisible(element) {
    return Boolean(element && element.offsetWidth > 0 && element.offsetHeight > 0);
  }

  function scheduleInvalidate(api) {
    if (!api?.map) return;
    const refresh = () => {
      if (isVisible(api.container)) api.map.invalidateSize();
    };
    requestAnimationFrame(refresh);
    setTimeout(refresh, 80);
    setTimeout(refresh, 240);
    setTimeout(refresh, 520);
  }

  function markerGlyph(type = "") {
    const normalized = String(type || "").trim().toLowerCase();
    if (normalized.includes("продукт") || normalized.includes("grocery")) return "🛒";
    if (normalized.includes("ресторан") || normalized.includes("restaurant")) return "🍽";
    if (normalized.includes("кафе") || normalized.includes("coffee") || normalized.includes("cafe")) return "☕";
    if (normalized.includes("одеж") || normalized.includes("clothes")) return "👕";
    if (normalized.includes("аксес") || normalized.includes("access")) return "◆";
    return "";
  }

  function markerColor(type = "") {
    const normalized = String(type || "").trim().toLowerCase();
    if (normalized.includes("продукт") || normalized.includes("grocery")) return "#16a34a";
    if (normalized.includes("ресторан") || normalized.includes("restaurant")) return "#dc2626";
    if (normalized.includes("кафе") || normalized.includes("coffee") || normalized.includes("cafe")) return "#b45309";
    if (normalized.includes("одеж") || normalized.includes("clothes")) return "#7c3aed";
    if (normalized.includes("аксес") || normalized.includes("access")) return "#0891b2";
    return "#2563eb";
  }

  function markerSvg(type = "") {
    const color = markerColor(type);
    const glyph = markerGlyph(type);
    return `<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="${color}"/>
      <circle cx="16" cy="15" r="7" fill="rgba(255,255,255,0.25)"/>
      ${glyph
        ? `<text x="16" y="19" text-anchor="middle" font-size="13" font-family="Arial, sans-serif" fill="white">${glyph}</text>`
        : `<path d="M12 15.5l-1.5-1.5v5h3v-3h5v3h3v-5l-1.5 1.5L16 12l-4 3.5z" fill="white"/>`}
    </svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function markerIcon(label = "Клиент", type = "") {
    return window.L.divIcon({
      html: `<div class="client-leaflet-marker">${markerSvg(type)}</div><div class="client-leaflet-marker-label">${escapeHtml(label)}</div>`,
      className: "client-leaflet-marker-wrap",
      iconSize: [92, 54],
      iconAnchor: [16, 40],
      popupAnchor: [0, -40],
    });
  }

  function openMapHref(lat, lon) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  }

  function readCoords(form) {
    const lat = Number.parseFloat(form.querySelector("[data-client-latitude]")?.value || "");
    const lon = Number.parseFloat(form.querySelector("[data-client-longitude]")?.value || "");
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  function writeCoords(form, lat, lon) {
    const latInput = form.querySelector("[data-client-latitude]");
    const lonInput = form.querySelector("[data-client-longitude]");
    if (latInput) latInput.value = String(lat);
    if (lonInput) lonInput.value = String(lon);
  }

  function updateLink(form, lat, lon) {
    const link = form.querySelector("[data-client-map-link]");
    if (!link) return;
    link.href = openMapHref(lat, lon);
    link.hidden = false;
  }

  function formMarkerLabel(form) {
    return form.querySelector('input[name="name"]')?.value?.trim() || "Клиент";
  }

  function formMarkerType(form) {
    const selected = form.querySelector("[data-client-map-icon]")?.value || "";
    if (selected && selected !== "default") return selected;
    return form.querySelector('input[name="industry"]')?.value || selected;
  }

  function updateMap(form, lat, lon, options = {}) {
    const api = ensureMap(form);
    writeCoords(form, lat, lon);
    updateLink(form, lat, lon);
    if (!api) return;

    const point = [lat, lon];
    api.container.classList.remove("client-location-map--empty");
    if (!api.marker) {
      api.marker = window.L.marker(point, { icon: markerIcon(formMarkerLabel(form), formMarkerType(form)), draggable: true }).addTo(api.map);
      api.marker.on("dragend", async () => {
        const next = api.marker.getLatLng();
        await selectPoint(form, Number(next.lat.toFixed(6)), Number(next.lng.toFixed(6)), { pan: false });
      });
    } else {
      api.marker.setLatLng(point);
      api.marker.setIcon(markerIcon(formMarkerLabel(form), formMarkerType(form)));
    }
    if (options.pan !== false) {
      api.map.setView(point, Math.max(api.map.getZoom(), PICK_ZOOM), { animate: true });
    }
    setTimeout(() => api.map.invalidateSize(), 60);
  }

  async function reverseAddress(lat, lon) {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("accept-language", "ru");
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("reverse geocode failed");
    const data = await response.json();
    return String(data.display_name || "").trim();
  }

  async function geocodeAddress(address) {
    const key = String(address || "").trim().toLowerCase();
    if (!key) return null;
    if (overviewGeocodeCache.has(key)) return overviewGeocodeCache.get(key);
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "uz,kz,kg,tj,tm");
    url.searchParams.set("q", address);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const [item] = await response.json();
    const point = item ? {
      lat: Number.parseFloat(item.lat),
      lon: Number.parseFloat(item.lon),
    } : null;
    const value = point && Number.isFinite(point.lat) && Number.isFinite(point.lon) ? point : null;
    overviewGeocodeCache.set(key, value);
    return value;
  }

  async function selectPoint(form, lat, lon, options = {}) {
    updateMap(form, lat, lon, options);
    setStatus(form, `Локация выбрана: ${lat}, ${lon}`);
    const addressInput = form.querySelector("[data-client-address]");
    let address = `${lat}, ${lon}`;
    try {
      address = (await reverseAddress(lat, lon)) || address;
    } catch {}
    if (addressInput && (!addressInput.value || options.replaceAddress !== false)) {
      addressInput.value = address;
    }
  }

  async function prepareLocationBeforeSubmit(form) {
    if (!form?.querySelector("[data-client-map]")) return;
    if (readCoords(form)) return;
    const addressInput = form.querySelector("[data-client-address]");
    const address = (addressInput?.value || "").trim();
    if (!address) return;
    setStatus(form, "Ищем координаты по адресу...");
    const point = await geocodeAddress(address);
    if (!point) {
      setStatus(form, "Адрес сохранится без координат");
      return;
    }
    const lat = Number(point.lat.toFixed(6));
    const lon = Number(point.lon.toFixed(6));
    updateMap(form, lat, lon, { pan: false, replaceAddress: false });
    setStatus(form, `Локация выбрана: ${lat}, ${lon}`);
  }

  function ensureMap(form) {
    const container = form.querySelector("[data-client-map]");
    if (!container || !window.L) return null;
    if (container._clientMapApi) return container._clientMapApi;
    if (!isVisible(container)) return null;

    const selected = readCoords(form);
    const center = selected || DEFAULT_CENTER;
    const map = window.L.map(container, {
      center,
      zoom: selected ? PICK_ZOOM : DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: false,
    });
    window.L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    window.L.control.attribution({ prefix: "" }).addTo(map);

    const api = { container, map, marker: null };
    container._clientMapApi = api;
    map.on("click", async (event) => {
      await selectPoint(form, Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6)));
    });
    if (selected) updateMap(form, selected[0], selected[1], { pan: false, replaceAddress: false });
    if (window.ResizeObserver) {
      api.resizeObserver = new ResizeObserver(() => scheduleInvalidate(api));
      api.resizeObserver.observe(container);
    }
    scheduleInvalidate(api);
    return api;
  }

  function initializeMaps(root = document) {
    root.querySelectorAll("form").forEach((form) => {
      if (!form.querySelector("[data-client-map]")) return;
      ensureMap(form);
    });
    root.querySelectorAll("[data-clients-overview-map]").forEach((container) => {
      ensureOverviewMap(container);
    });
    root.querySelectorAll("[data-client-card-map]").forEach((container) => {
      ensureClientCardMap(container);
    });
  }

  function refreshMaps() {
    document.querySelectorAll("[data-client-map]").forEach((container) => {
      if (container._clientMapApi) {
        scheduleInvalidate(container._clientMapApi);
      }
    });
    document.querySelectorAll("[data-clients-overview-map]").forEach((container) => {
      if (container._clientsOverviewApi?.map) {
        scheduleInvalidate(container._clientsOverviewApi);
      } else {
        ensureOverviewMap(container);
      }
    });
    document.querySelectorAll("[data-client-card-map]").forEach((container) => {
      if (container._clientCardMapApi?.map) {
        scheduleInvalidate(container._clientCardMapApi);
      } else {
        ensureClientCardMap(container);
      }
    });
  }

  function selectedMapIds() {
    return new Set(
      [...document.querySelectorAll("[data-client-map-select]:checked")]
        .map((item) => item.value)
        .filter(Boolean)
    );
  }

  function overviewFilters(container) {
    const section = container.closest("#clients-map") || document;
    return {
      q: (section.querySelector("[data-clients-map-search]")?.value || "").trim().toLowerCase(),
      type: section.querySelector("[data-clients-map-type]")?.value || "",
      program: section.querySelector("[data-clients-map-program]")?.value || "",
      category: section.querySelector("[data-clients-map-category]")?.value || "",
      status: section.querySelector("[data-clients-map-status]")?.value || "",
    };
  }

  function matchesOverviewFilters(point, filters, selectedIds) {
    if (selectedIds.size && !selectedIds.has(point.id)) return false;
    if (filters.q && !point.name.toLowerCase().includes(filters.q)) return false;
    if (filters.type && point.type !== filters.type) return false;
    if (filters.program && !point.programs.split(",").map((item) => item.trim()).includes(filters.program)) return false;
    if (filters.category && point.category !== filters.category) return false;
    if (filters.status && point.status !== filters.status) return false;
    return true;
  }

  function readOverviewPoints(container) {
    const layout = container.closest(".clients-map-layout") || document;
    const filters = overviewFilters(container);
    const selectedIds = selectedMapIds();
    return [...layout.querySelectorAll("[data-client-overview-point]")]
      .map((item) => {
        const lat = Number.parseFloat(item.dataset.lat || "");
        const lon = Number.parseFloat(item.dataset.lon || "");
        const point = {
          id: item.dataset.clientId || "",
          lat,
          lon,
          name: item.dataset.name || "Клиент",
          address: item.dataset.address || "",
          type: item.dataset.clientType || "",
          category: item.dataset.category || "",
          icon: item.dataset.icon || "",
          programs: item.dataset.programs || "",
          status: item.dataset.status || "",
          item,
        };
        const matched = matchesOverviewFilters(point, filters, selectedIds);
        item.hidden = !matched;
        return matched ? point : null;
      })
      .filter(Boolean);
  }

  async function overviewPointCoords(point) {
    if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) return point;
    if (!point.address) return null;
    const resolved = await geocodeAddress(point.address);
    if (!resolved) return null;
    point.lat = resolved.lat;
    point.lon = resolved.lon;
    point.item.dataset.lat = String(resolved.lat);
    point.item.dataset.lon = String(resolved.lon);
    return point;
  }

  async function renderOverviewMap(api) {
    const container = api.container;
    const points = readOverviewPoints(container);
    const geocodable = points.filter((point) => (Number.isFinite(point.lat) && Number.isFinite(point.lon)) || point.address);
    const empty = container.querySelector(".clients-map-empty");
    if (empty) {
      empty.textContent = points.length
        ? "У выбранных клиентов нет адреса или координат."
        : "Клиенты по выбранным фильтрам не найдены.";
    }
    if (!geocodable.length || !api.map || !api.layer) {
      container.classList.add("clients-overview-map--empty");
      api.layer?.clearLayers();
      scheduleInvalidate(api);
      return;
    }

    api.layer.clearLayers();
    const bounds = [];
    for (const point of geocodable) {
      const resolved = await overviewPointCoords(point);
      if (!resolved) continue;
      container.classList.remove("clients-overview-map--empty");
      const marker = window.L.marker([resolved.lat, resolved.lon], { icon: markerIcon(resolved.name, resolved.icon) }).addTo(api.layer);
      marker.bindPopup(`
        <strong>${escapeHtml(resolved.name)}</strong>
        ${resolved.address ? `<span>${escapeHtml(resolved.address)}</span>` : ""}
      `);
      bounds.push([resolved.lat, resolved.lon]);
    }

    if (!bounds.length) {
      container.classList.add("clients-overview-map--empty");
      if (empty) empty.textContent = "Не удалось найти адреса выбранных клиентов на карте.";
      return;
    }
    if (bounds.length === 1) {
      api.map.setView(bounds[0], PICK_ZOOM);
    } else {
      api.map.fitBounds(bounds, { padding: [34, 34] });
    }
    scheduleInvalidate(api);
  }

  function ensureOverviewMap(container) {
    if (!container || !window.L) return null;
    if (container._clientsOverviewApi) {
      if (container._clientsOverviewApi.map) {
        renderOverviewMap(container._clientsOverviewApi);
        return container._clientsOverviewApi;
      }
      delete container._clientsOverviewApi;
    }

    const points = readOverviewPoints(container);
    if (!isVisible(container)) return null;

    const defaultLat = Number.parseFloat(container.dataset.defaultLat || "");
    const defaultLon = Number.parseFloat(container.dataset.defaultLon || "");
    const center = Number.isFinite(defaultLat) && Number.isFinite(defaultLon)
      ? [defaultLat, defaultLon]
      : DEFAULT_CENTER;
    const map = window.L.map(container, {
      center,
      zoom: points.length ? DEFAULT_ZOOM : 11,
      zoomControl: true,
      attributionControl: false,
    });
    window.L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    window.L.control.attribution({ prefix: "" }).addTo(map);

    const api = { container, map, layer: window.L.layerGroup().addTo(map) };
    container._clientsOverviewApi = api;
    if (window.ResizeObserver) {
      api.resizeObserver = new ResizeObserver(() => scheduleInvalidate(api));
      api.resizeObserver.observe(container);
    }
    renderOverviewMap(api);
    scheduleInvalidate(api);
    return api;
  }

  async function resolveClientCardMapPoint(container) {
    const lat = Number.parseFloat(container.dataset.lat || "");
    const lon = Number.parseFloat(container.dataset.lon || "");
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return geocodeAddress(container.dataset.address || "");
  }

  async function renderClientCardMap(api) {
    const point = await resolveClientCardMapPoint(api.container);
    const hint = api.container.querySelector(".client-location-map-hint");
    api.layer.clearLayers();
    if (!point) {
      api.container.classList.add("client-location-map--empty");
      if (hint) hint.hidden = false;
      api.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      scheduleInvalidate(api);
      return;
    }

    api.container.dataset.lat = String(point.lat);
    api.container.dataset.lon = String(point.lon);
    api.container.classList.remove("client-location-map--empty");
    if (hint) hint.hidden = true;
    const name = api.container.dataset.name || "Клиент";
    const icon = api.container.dataset.icon || "";
    const address = api.container.dataset.address || "";
    const marker = window.L.marker([point.lat, point.lon], { icon: markerIcon(name, icon) }).addTo(api.layer);
    marker.bindPopup(`
      <strong>${escapeHtml(name)}</strong>
      ${address ? `<span>${escapeHtml(address)}</span>` : ""}
    `);
    api.map.setView([point.lat, point.lon], PICK_ZOOM);
    scheduleInvalidate(api);
  }

  function setClientCardPoint(api, lat, lon, address = "") {
    api.container.dataset.lat = String(lat);
    api.container.dataset.lon = String(lon);
    api.container.classList.remove("client-location-map--empty");
    const hint = api.container.querySelector(".client-location-map-hint");
    if (hint) hint.hidden = true;
    const name = api.container.dataset.name || "РљР»РёРµРЅС‚";
    const icon = api.container.dataset.icon || "";
    const marker = window.L.marker([lat, lon], { icon: markerIcon(name, icon) }).addTo(api.layer);
    marker.bindPopup(`
      <strong>${escapeHtml(name)}</strong>
      ${address ? `<span>${escapeHtml(address)}</span>` : ""}
    `);
    api.map.setView([lat, lon], PICK_ZOOM);
    scheduleInvalidate(api);
  }

  async function saveClientCardLocation(api, lat, lon) {
    const container = api.container;
    const hint = container.querySelector(".client-location-map-hint");
    let address = container.dataset.address || "";
    if (hint) {
      hint.hidden = false;
      hint.textContent = "РЎРѕС…СЂР°РЅСЏРµРј Р»РѕРєР°С†РёСЋ...";
    }
    if (!address) {
      try {
        address = (await reverseAddress(lat, lon)) || "";
      } catch {}
    }
    const saveUrl = container.dataset.saveUrl || `/api/clients/${encodeURIComponent(container.dataset.clientId || "")}/location`;
    const response = await fetch(saveUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken(container),
      },
      body: JSON.stringify({
        latitude: lat,
        longitude: lon,
        address,
        map_icon: container.dataset.icon || "",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "save_failed");
    }
    container.dataset.lat = String(payload.latitude || lat);
    container.dataset.lon = String(payload.longitude || lon);
    if (payload.address || address) {
      container.dataset.address = String(payload.address || address);
    }
    if (hint) {
      hint.hidden = false;
      hint.textContent = `Р›РѕРєР°С†РёСЏ СЃРѕС…СЂР°РЅРµРЅР°: ${lat}, ${lon}`;
    }
  }

  function ensureClientCardMap(container) {
    if (!container || !window.L || !isVisible(container)) return null;
    if (container._clientCardMapApi) {
      renderClientCardMap(container._clientCardMapApi);
      return container._clientCardMapApi;
    }

    const map = window.L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: false,
    });
    window.L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    window.L.control.attribution({ prefix: "" }).addTo(map);

    const api = { container, map, layer: window.L.layerGroup().addTo(map) };
    container._clientCardMapApi = api;
    map.on("click", async (event) => {
      const lat = Number(event.latlng.lat.toFixed(6));
      const lon = Number(event.latlng.lng.toFixed(6));
      api.layer.clearLayers();
      setClientCardPoint(api, lat, lon, api.container.dataset.address || "");
      try {
        await saveClientCardLocation(api, lat, lon);
      } catch {
        const hint = api.container.querySelector(".client-location-map-hint");
        if (hint) {
          hint.hidden = false;
          hint.textContent = "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ Р»РѕРєР°С†РёСЋ. РћР±РЅРѕРІРёС‚Рµ СЃС‚СЂР°РЅРёС†Сѓ Рё РїРѕРІС‚РѕСЂРёС‚Рµ.";
        }
      }
    });
    if (window.ResizeObserver) {
      api.resizeObserver = new ResizeObserver(() => scheduleInvalidate(api));
      api.resizeObserver.observe(container);
    }
    renderClientCardMap(api);
    scheduleInvalidate(api);
    return api;
  }

  const CLIENT_SECTION_ALIASES = new Map([
    ["", "info"],
    ["client-card", "info"],
    ["info", "info"],
    ["act", "act"],
    ["paymentReceivedList", "paymentReceivedList"],
    ["shipment", "shipment"],
    ["outletRoute", "location"],
    ["location", "location"],
    ["tasks", "tasks"],
    ["note", "note"],
    ["sms", "sms"],
    ["history", "history"],
  ]);

  function currentClientSection() {
    const hash = window.location.hash.replace("#", "");
    return CLIENT_SECTION_ALIASES.get(hash) || "info";
  }

  function updateClientSectionContainers(shell) {
    shell.querySelectorAll(".client-profile-main > .client-card-grid").forEach((grid) => {
      const panels = [...grid.querySelectorAll("[data-client-section-panel]")];
      const visible = panels.filter((panel) => !panel.hidden);
      grid.hidden = panels.length > 0 && visible.length === 0;
      grid.classList.toggle("client-card-grid--single", visible.length === 1);
    });
  }

  function showClientSection(section = currentClientSection()) {
    document.querySelectorAll(".client-card-shell").forEach((shell) => {
      shell.querySelectorAll("[data-client-section-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.clientSectionPanel !== section;
      });
      shell.querySelectorAll("[data-client-section-nav]").forEach((link) => {
        const active = link.dataset.clientSectionNav === section;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      updateClientSectionContainers(shell);
      shell.querySelectorAll("[data-client-card-map]").forEach((container) => ensureClientCardMap(container));
    });
  }

  const CLIENT_DIRECTORY_COLUMNS = [
    { key: "select", sortable: false, movable: false },
    { key: "id", kind: "number" },
    { key: "name", kind: "text" },
    { key: "official_name", kind: "text" },
    { key: "balance", kind: "number" },
    { key: "last_date", kind: "date" },
    { key: "telegram", kind: "text" },
    { key: "created_at", kind: "date" },
    { key: "phone", kind: "text" },
    { key: "category", kind: "text" },
    { key: "inn", kind: "text" },
    { key: "pinfl", kind: "text" },
    { key: "address", kind: "text" },
    { key: "code", kind: "text" },
    { key: "actions", sortable: false, movable: false },
  ];

  function clientDirectoryCells(row) {
    return [...(row?.children || [])].filter((cell) => !cell.classList.contains("upos-table-column-control-cell"));
  }

  function clientColumnOrderKey(table) {
    return `upos.clientsColumnOrder:${location.pathname}:${table.id || "directory"}`;
  }

  function readClientColumnOrder(table) {
    const fallback = CLIENT_DIRECTORY_COLUMNS.map((column) => column.key);
    try {
      const saved = JSON.parse(localStorage.getItem(clientColumnOrderKey(table)) || "[]");
      if (!Array.isArray(saved) || saved.length !== fallback.length) return fallback;
      const known = new Set(fallback);
      if (saved.some((key) => !known.has(key)) || new Set(saved).size !== fallback.length) return fallback;
      return saved;
    } catch {
      return fallback;
    }
  }

  function saveClientColumnOrder(table, order) {
    try {
      localStorage.setItem(clientColumnOrderKey(table), JSON.stringify(order));
    } catch {
      /* localStorage may be unavailable. */
    }
  }

  function clientColumnRows(table) {
    return [
      ...Array.from(table.tHead?.rows || []),
      ...Array.from(table.tBodies || []).flatMap((body) => Array.from(body.rows || [])),
    ].filter((row) => clientDirectoryCells(row).length === CLIENT_DIRECTORY_COLUMNS.length);
  }

  function applyClientColumnOrder(table, order) {
    clientColumnRows(table).forEach((row) => {
      const cells = new Map(clientDirectoryCells(row).map((cell) => [cell.dataset.clientColumn, cell]));
      const control = row.querySelector(":scope > .upos-table-column-control-cell");
      order.forEach((key) => {
        const cell = cells.get(key);
        if (cell) row.insertBefore(cell, control || null);
      });
    });
  }

  function clientNumericValue(cell, key) {
    const raw = (cell?.textContent || "").replace(/\u00a0/g, " ").replace(/[^0-9,.-]/g, "").replace(",", ".");
    const value = Number.parseFloat(raw) || 0;
    if (key === "balance" && cell?.querySelector(".client-balance-pill--advance")) return -Math.abs(value);
    return value;
  }

  function clientSortValue(row, key, kind) {
    const cell = row.querySelector(`[data-client-column="${key}"]`);
    if (kind === "number") return clientNumericValue(cell, key);
    const text = (cell?.textContent || "").replace(/\s+/g, " ").trim();
    if (kind === "date") {
      const timestamp = Date.parse(text);
      return Number.isFinite(timestamp) ? timestamp : 0;
    }
    return text.toLocaleLowerCase("ru");
  }

  function updateClientSortButtons(table, activeKey, direction) {
    table.querySelectorAll("[data-clients-sort]").forEach((button) => {
      const active = button.dataset.clientsSort === activeKey;
      button.classList.toggle("is-active", active);
      button.closest("th")?.setAttribute("aria-sort", active ? (direction === "asc" ? "ascending" : "descending") : "none");
      const arrow = button.querySelector(".org-shipments-sort-arrow");
      if (arrow) arrow.textContent = active ? (direction === "asc" ? "↑" : "↓") : "↕";
    });
  }

  function sortClientDirectory(table, key, kind) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const currentKey = table.dataset.clientsSortKey;
    const currentDirection = table.dataset.clientsSortDirection;
    const direction = currentKey === key && currentDirection === "desc" ? "asc" : "desc";
    const rows = [...tbody.rows].filter((row) => clientDirectoryCells(row).length === CLIENT_DIRECTORY_COLUMNS.length);
    rows.forEach((row, index) => {
      if (!row.dataset.clientsOriginalIndex) row.dataset.clientsOriginalIndex = String(index);
    });
    rows.sort((left, right) => {
      const a = clientSortValue(left, key, kind);
      const b = clientSortValue(right, key, kind);
      const result = kind === "text"
        ? String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" })
        : a - b;
      return (result || Number(left.dataset.clientsOriginalIndex) - Number(right.dataset.clientsOriginalIndex)) * (direction === "asc" ? 1 : -1);
    });
    rows.forEach((row) => tbody.append(row));
    table.dataset.clientsSortKey = key;
    table.dataset.clientsSortDirection = direction;
    updateClientSortButtons(table, key, direction);
  }

  function moveClientColumn(table, sourceKey, targetKey, after = false) {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    const order = clientDirectoryCells(table.tHead?.rows?.[0]).map((cell) => cell.dataset.clientColumn);
    const sourceIndex = order.indexOf(sourceKey);
    if (sourceIndex < 0) return;
    order.splice(sourceIndex, 1);
    const targetIndex = order.indexOf(targetKey);
    if (targetIndex < 0) return;
    order.splice(targetIndex + (after ? 1 : 0), 0, sourceKey);
    applyClientColumnOrder(table, order);
    saveClientColumnOrder(table, order);
  }

  function initClientDirectoryTable(table) {
    if (!table || table.dataset.clientsDirectoryReady === "1") return;
    const header = table.tHead?.rows?.[0];
    const headerCells = clientDirectoryCells(header);
    if (headerCells.length !== CLIENT_DIRECTORY_COLUMNS.length) return;

    table.dataset.clientsDirectoryReady = "1";
    headerCells.forEach((cell, index) => {
      const definition = CLIENT_DIRECTORY_COLUMNS[index];
      cell.dataset.clientColumn = definition.key;
      cell.dataset.columnKey = definition.key;
      cell.scope = "col";
      if (definition.movable !== false) {
        cell.draggable = true;
        cell.classList.add("clients-table-movable-column");
        cell.title = "Перетащить столбец";
      }
      if (definition.sortable === false) return;
      const label = cell.textContent.trim();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "org-shipments-sort-btn products-sort-btn clients-table-sort-btn";
      button.dataset.clientsSort = definition.key;
      button.innerHTML = `<span>${label}</span><span class="org-shipments-sort-arrow" aria-hidden="true">↕</span>`;
      button.addEventListener("click", () => {
        if (Date.now() - Number(table.dataset.clientsDraggedAt || 0) < 300) return;
        sortClientDirectory(table, definition.key, definition.kind);
      });
      button.addEventListener("keydown", (event) => {
        if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        const cells = clientDirectoryCells(header);
        const currentIndex = cells.indexOf(cell);
        const target = cells[currentIndex + (event.key === "ArrowLeft" ? -1 : 1)];
        if (!target || !target.classList.contains("clients-table-movable-column")) return;
        event.preventDefault();
        moveClientColumn(table, definition.key, target.dataset.clientColumn, event.key === "ArrowRight");
        button.focus();
      });
      cell.replaceChildren(button);
    });

    Array.from(table.tBodies || []).forEach((tbody) => {
      Array.from(tbody.rows || []).forEach((row) => {
        const cells = clientDirectoryCells(row);
        if (cells.length !== CLIENT_DIRECTORY_COLUMNS.length) return;
        cells.forEach((cell, index) => {
          cell.dataset.clientColumn = CLIENT_DIRECTORY_COLUMNS[index].key;
        });
      });
    });

    applyClientColumnOrder(table, readClientColumnOrder(table));

    header.addEventListener("dragstart", (event) => {
      const cell = event.target.closest("th.clients-table-movable-column");
      if (!cell) return;
      table.dataset.clientsDraggingColumn = cell.dataset.clientColumn;
      cell.classList.add("is-client-column-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", cell.dataset.clientColumn);
    });
    header.addEventListener("dragover", (event) => {
      const cell = event.target.closest("th.clients-table-movable-column");
      if (!cell || !table.dataset.clientsDraggingColumn) return;
      event.preventDefault();
      header.querySelectorAll(".is-client-column-drop-target").forEach((item) => item.classList.remove("is-client-column-drop-target"));
      cell.classList.add("is-client-column-drop-target");
      event.dataTransfer.dropEffect = "move";
    });
    header.addEventListener("drop", (event) => {
      const cell = event.target.closest("th.clients-table-movable-column");
      const sourceKey = table.dataset.clientsDraggingColumn;
      if (!cell || !sourceKey) return;
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      moveClientColumn(table, sourceKey, cell.dataset.clientColumn, event.clientX > rect.left + rect.width / 2);
      table.dataset.clientsDraggedAt = String(Date.now());
    });
    header.addEventListener("dragend", () => {
      delete table.dataset.clientsDraggingColumn;
      header.querySelectorAll(".is-client-column-dragging, .is-client-column-drop-target").forEach((cell) => {
        cell.classList.remove("is-client-column-dragging", "is-client-column-drop-target");
      });
    });
  }

  function initializeClientDirectoryTables(root = document) {
    root.querySelectorAll("[data-clients-directory-table]").forEach(initClientDirectoryTable);
  }

  function locate(form) {
    ensureMap(form);
    if (!navigator.geolocation) {
      setStatus(form, "Геолокация недоступна");
      return;
    }
    setStatus(form, "Идет поиск локации...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lon = Number(position.coords.longitude.toFixed(6));
        await selectPoint(form, lat, lon);
        setStatus(form, `Локация найдена: ${lat}, ${lon}`);
      },
      () => {
        setStatus(form, "Не удалось получить локацию");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  document.addEventListener("click", (event) => {
    const sectionLink = event.target.closest("[data-client-section-nav]");
    if (sectionLink) {
      event.preventDefault();
      const section = sectionLink.dataset.clientSectionNav || "info";
      const url = new URL(window.location.href);
      url.hash = section;
      window.history.replaceState(null, "", url.toString());
      showClientSection(section);
      return;
    }

    const button = event.target.closest("[data-client-geolocate]");
    if (button) {
      const form = button.closest("form");
      if (!form) return;
      event.preventDefault();
      locate(form);
      return;
    }
    if (event.target.closest("[data-workspace-tab], [data-workspace-card], [data-workspace-trigger]")) {
      setTimeout(() => {
        initializeMaps();
        refreshMaps();
      }, 160);
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.closest("[data-clients-map-filter]")) {
      document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
    }
    if (event.target.matches("input[name='industry'], input[name='name']")) {
      const form = event.target.closest("form");
      const api = form?.querySelector("[data-client-map]")?._clientMapApi;
      if (form && api?.marker) {
        api.marker.setIcon(markerIcon(formMarkerLabel(form), formMarkerType(form)));
      }
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-client-map-select]") || event.target.closest("[data-clients-map-filter]")) {
      document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
    }
    if (event.target.matches("[data-client-map-icon], input[name='industry'], input[name='name']")) {
      const form = event.target.closest("form");
      const api = form?.querySelector("[data-client-map]")?._clientMapApi;
      if (form && api?.marker) {
        api.marker.setIcon(markerIcon(formMarkerLabel(form), formMarkerType(form)));
      }
    }
  });

  document.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-clients-map-clear]");
    if (!clear) return;
    const root = clear.closest("[data-clients-map-filter]");
    if (!root) return;
    root.querySelectorAll("input, select").forEach((field) => {
      field.value = "";
    });
    document.querySelectorAll("[data-client-map-select]").forEach((checkbox) => {
      checkbox.checked = false;
    });
    document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
  });

  document.addEventListener("focusin", (event) => {
    const form = event.target.closest?.("form");
    if (form?.querySelector("[data-client-map]")) ensureMap(form);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.querySelector("[data-client-map]")) return;
    if (form.dataset.clientLocationPrepared === "1") {
      delete form.dataset.clientLocationPrepared;
      return;
    }
    if (form.dataset.clientLocationSubmitting === "1" || !form.checkValidity()) return;
    event.preventDefault();
    form.dataset.clientLocationSubmitting = "1";
    prepareLocationBeforeSubmit(form).catch(() => {
      setStatus(form, "Р›РѕРєР°С†РёСЏ СЃРѕС…СЂР°РЅРёС‚СЃСЏ Р±РµР· РєРѕРѕСЂРґРёРЅР°С‚");
    }).finally(() => {
      form.dataset.clientLocationPrepared = "1";
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        HTMLFormElement.prototype.submit.call(form);
      }
    });
  });

  document.addEventListener("DOMContentLoaded", () => {
    initializeClientDirectoryTables();
    showClientSection();
    initializeMaps();
    setTimeout(refreshMaps, 250);
  });

  window.addEventListener("hashchange", () => {
    showClientSection();
    setTimeout(refreshMaps, 160);
  });
})();

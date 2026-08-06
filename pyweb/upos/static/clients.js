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

  function closeClientDocumentMenus(except = null) {
    document.querySelectorAll("[data-client-document-menu]").forEach((menu) => {
      if (menu === except) return;
      const toggle = menu.querySelector("[data-client-document-menu-toggle]");
      const list = menu.querySelector("[data-client-document-menu-list]");
      if (list) list.hidden = true;
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
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
    const raw = String(type || "").trim();
    if (!raw) return "";
    // Иконку сегмента пользователь выбирает сам и может ввести произвольный эмодзи
    // («Своя иконка»), поэтому список допустимых значений здесь не годится: берём
    // первый пиктографический символ, каким бы он ни был.
    const pictographic = raw.match(/\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*/u);
    if (pictographic) return pictographic[0];
    const normalized = raw.toLowerCase();
    if (normalized.includes("продукт") || normalized.includes("grocery")) return "🛒";
    if (normalized.includes("ресторан") || normalized.includes("restaurant")) return "🍽";
    if (normalized.includes("кафе") || normalized.includes("coffee") || normalized.includes("cafe")) return "☕";
    if (normalized.includes("одеж") || normalized.includes("clothes")) return "👕";
    if (normalized.includes("аксес") || normalized.includes("access")) return "◆";
    return "";
  }

  function markerColor(type = "") {
    const raw = String(type || "").trim();
    const normalized = raw.toLowerCase();
    if (/[🍽☕🍔]/u.test(raw)) return "#dc2626";
    if (/[🏪🛒🛍]/u.test(raw)) return "#16a34a";
    if (/[📦🧰]/u.test(raw)) return "#2563eb";
    if (/[🚗]/u.test(raw)) return "#0891b2";
    if (/[👕🧴🥣]/u.test(raw)) return "#7c3aed";
    if (normalized.includes("продукт") || normalized.includes("grocery")) return "#16a34a";
    if (normalized.includes("ресторан") || normalized.includes("restaurant")) return "#dc2626";
    if (normalized.includes("кафе") || normalized.includes("coffee") || normalized.includes("cafe")) return "#b45309";
    if (normalized.includes("одеж") || normalized.includes("clothes")) return "#7c3aed";
    if (normalized.includes("аксес") || normalized.includes("access")) return "#0891b2";
    return "";
  }

  // Категории клиентов заводит сам пользователь (ALIPOS, BILLZ, ОФИС...), поэтому
  // фиксированного списка иконок быть не может: цвет и инициалы выводим из названия,
  // чтобы одна категория всегда выглядела одинаково.
  const CATEGORY_PALETTE = [
    "#2563eb", "#16a34a", "#dc2626", "#b45309", "#7c3aed", "#0891b2",
    "#db2777", "#0f766e", "#c2410c", "#4f46e5", "#65a30d", "#9333ea",
  ];

  function categoryColor(category = "") {
    const text = String(category || "").trim().toLowerCase();
    if (!text) return "";
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
  }

  function categoryInitials(category = "") {
    const text = String(category || "").trim();
    if (!text) return "";
    const words = text.split(/[\s\-_/.,]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return text.slice(0, 2).toUpperCase();
  }

  function markerSvg(type = "", category = "") {
    const color = markerColor(type) || categoryColor(category) || "#2563eb";
    const glyph = markerGlyph(type);
    const initials = glyph ? "" : categoryInitials(category);
    let mark;
    if (glyph) {
      // Сам эмодзи накладывается поверх HTML-слоем (см. markerIcon): в SVG <text>
      // составные эмодзи с variation selector рисуются ненадёжно.
      mark = "";
    } else if (initials) {
      mark = `<text x="16" y="19.5" text-anchor="middle" font-size="${initials.length > 1 ? 10 : 13}" font-weight="700" font-family="Inter, Arial, sans-serif" fill="white">${escapeHtml(initials)}</text>`;
    } else {
      mark = `<path d="M12 15.5l-1.5-1.5v5h3v-3h5v3h3v-5l-1.5 1.5L16 12l-4 3.5z" fill="white"/>`;
    }
    return `<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="${color}"/>
      <circle cx="16" cy="15" r="7" fill="rgba(255,255,255,0.25)"/>
      ${mark}
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

  function markerIcon(label = "Клиент", type = "", category = "", options = {}) {
    const glyph = markerGlyph(type);
    const glyphMarkup = glyph
      ? `<span class="client-leaflet-marker-glyph" aria-hidden="true">${escapeHtml(glyph)}</span>`
      : "";
    const dragHandle = options.draggable
      ? '<span class="client-leaflet-marker-drag-handle" aria-hidden="true">↕</span>'
      : "";
    const removeButton = options.removable
      ? '<button type="button" class="client-leaflet-marker-remove" title="Убрать точку" aria-label="Убрать точку">×</button>'
      : "";
    return window.L.divIcon({
      html: `<div class="client-leaflet-marker">${markerSvg(type, category)}${glyphMarkup}${dragHandle}${removeButton}</div><div class="client-leaflet-marker-label">${escapeHtml(label)}</div>`,
      className: `client-leaflet-marker-wrap${options.draggable ? " is-draggable" : ""}`,
      iconSize: [92, 54],
      iconAnchor: [16, 40],
      popupAnchor: [0, -40],
    });
  }

  // Подписи читаемы только вблизи: на общем плане десятки названий сливаются,
  // поэтому показываем их с этого зума и выше.
  const LABEL_MIN_ZOOM = 14;

  function syncMarkerLabels(api) {
    if (!api?.map || !api.container) return;
    const visible = api.map.getZoom() >= LABEL_MIN_ZOOM;
    api.container.classList.toggle("client-map--labels", visible);
  }

  function bindLabelZoom(api) {
    if (!api?.map || api._labelZoomBound) return;
    api._labelZoomBound = true;
    api.map.on("zoomend", () => syncMarkerLabels(api));
    syncMarkerLabels(api);
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
    const checkedSegment = form.querySelector("[data-client-segment-option]:checked");
    if (checkedSegment) {
      const icon = checkedSegment.dataset.segmentIcon || "";
      const label = checkedSegment.dataset.segmentLabel || checkedSegment.value;
      return `${icon} ${label}`.trim();
    }
    const segment = form.querySelector("[data-client-segment-select]");
    if (segment?.value) {
      return segment.selectedOptions?.[0]?.textContent || segment.value;
    }
    const selected = form.querySelector("[data-client-map-icon]")?.value || "";
    if (selected && selected !== "default") return selected;
    return form.querySelector('input[name="industry"]')?.value || selected;
  }

  function refreshEditableMarker(form) {
    const api = form?.querySelector("[data-client-map]")?._clientMapApi;
    if (!api?.marker) return;
    api.marker.setIcon(markerIcon(formMarkerLabel(form), formMarkerType(form), "", { draggable: true, removable: true }));
    api.marker.dragging?.enable();
  }

  function syncAddPointButton(api) {
    if (!api?.addPointButton) return;
    api.addPointButton.hidden = Boolean(api.marker);
  }

  function clearLocation(form) {
    const api = form?.querySelector("[data-client-map]")?._clientMapApi;
    writeCoords(form, "", "");
    const addressInput = form?.querySelector("[data-client-address]");
    const searchInput = form?.querySelector("[data-client-location-search]");
    const link = form?.querySelector("[data-client-map-link]");
    if (addressInput) addressInput.value = "";
    if (searchInput) searchInput.value = "";
    if (link) {
      link.href = "#";
      link.hidden = true;
    }
    if (api?.marker) {
      api.map.removeLayer(api.marker);
      api.marker = null;
    }
    api?.container.classList.add("client-location-map--empty");
    api?.container.classList.remove("is-picking-point");
    syncAddPointButton(api);
    setStatus(form, "Локация не выбрана");
  }

  function ensureAddPointButton(form, api) {
    if (!api || api.addPointButton) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "client-location-add-point";
    button.title = "Добавить точку";
    button.setAttribute("aria-label", "Добавить точку");
    button.textContent = "+";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      api.container.classList.add("is-picking-point");
      setStatus(form, "Нажмите на карту, чтобы добавить точку");
      api.container.focus({ preventScroll: true });
    });
    api.container.append(button);
    api.addPointButton = button;
    syncAddPointButton(api);
  }

  function updateMap(form, lat, lon, options = {}) {
    const api = ensureMap(form);
    writeCoords(form, lat, lon);
    updateLink(form, lat, lon);
    if (!api) return;

    const point = [lat, lon];
    api.container.classList.remove("client-location-map--empty");
    if (!api.marker) {
      api.marker = window.L.marker(point, {
        icon: markerIcon(formMarkerLabel(form), formMarkerType(form), "", { draggable: true, removable: true }),
        draggable: true,
        title: "Перетащите маркер, чтобы изменить локацию",
      }).addTo(api.map);
      api.marker.on("click", (event) => {
        const removeButton = event.originalEvent?.target?.closest?.(".client-leaflet-marker-remove");
        if (!removeButton) return;
        window.L.DomEvent.stop(event.originalEvent);
        clearLocation(form);
      });
      api.marker.on("dragend", async () => {
        const next = api.marker.getLatLng();
        await selectPoint(form, Number(next.lat.toFixed(6)), Number(next.lng.toFixed(6)), { pan: false });
      });
    } else {
      api.marker.setLatLng(point);
      refreshEditableMarker(form);
    }
    api.container.classList.remove("is-picking-point");
    syncAddPointButton(api);
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
    ensureAddPointButton(form, api);
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

  /* Строки таблицы карты лежат в <template> и раскрываются при первом
     открытии вкладки: почти тысяча строк не должна размечаться, пока
     панель скрыта — из-за этого страница клиентов открывалась секундами. */
  function unpackClientsMapRows(root = document) {
    root.querySelectorAll("[data-clients-map-rows]").forEach((template) => {
      const body = template.closest("[data-clients-map-body]") || template.parentElement;
      if (!body) return;
      // Пока панель карты скрыта, строки не разворачиваем — в этом весь смысл.
      const panel = template.closest("#clients-map") || body.closest("section, article");
      if (panel && !panel.offsetParent) {
        watchClientsMapPanel(panel);
        return;
      }
      body.append(template.content.cloneNode(true));
      template.remove();
      initializeDirectorySegmentPickers(body);
      syncDirectoryClientSelection();
    });
  }

  /* Панель карты открывается по-разному: вкладкой, хешем, кнопкой «Показать
     на карте». Ждём её появления наблюдателем, чтобы не гадать с событиями. */
  function watchClientsMapPanel(panel) {
    if (!panel || panel._clientsMapWatched || typeof ResizeObserver !== "function") return;
    panel._clientsMapWatched = true;
    const observer = new ResizeObserver(() => {
      if (!panel.offsetParent) return;
      observer.disconnect();
      panel._clientsMapWatched = false;
      unpackClientsMapRows(panel);
    });
    observer.observe(panel);
  }

  function initializeMaps(root = document) {
    unpackClientsMapRows(root);
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
      programs: [...section.querySelectorAll("[data-clients-map-program]:checked")]
        .map((input) => input.value)
        .filter(Boolean),
      category: section.querySelector("[data-clients-map-category]")?.value || "",
      status: section.querySelector("[data-clients-map-status]")?.value || "",
      segments: [...section.querySelectorAll("[data-clients-map-segment]:checked")]
        .map((input) => input.value)
        .filter(Boolean),
      location: section.querySelector('[data-clients-map-location-filter][aria-pressed="true"]')?.dataset.clientsMapLocationFilter || "",
      ownership: section.querySelector('[data-clients-map-ownership][aria-pressed="true"]')?.dataset.clientsMapOwnership || "",
    };
  }

  function focusClientLocationPanel(attempt = 0) {
    const panel = document.querySelector("#client-edit [data-client-location-panel]");
    if (!panel || panel.closest("[hidden]")) {
      if (attempt < 6) window.setTimeout(() => focusClientLocationPanel(attempt + 1), 120);
      return;
    }
    panel.scrollIntoView({ block: "start" });
    const search = panel.querySelector("[data-client-location-search]");
    search?.focus();
    if (search && document.activeElement !== search && attempt < 6) {
      window.setTimeout(() => focusClientLocationPanel(attempt + 1), 120);
    }
  }

  function matchesOverviewFilters(point, filters, selectedIds) {
    if (selectedIds.size && !selectedIds.has(point.id)) return false;
    if (filters.q && !point.name.toLowerCase().includes(filters.q)) return false;
    if (filters.type && point.type !== filters.type) return false;
    if (filters.programs.length && !filters.programs.some((program) => point.programList.includes(program))) return false;
    if (filters.category && point.category !== filters.category) return false;
    if (filters.status && point.status !== filters.status) return false;
    if (
      filters.segments?.length
      && !filters.segments.some((name) => point.segments.some((segment) => segment.name === name))
    ) return false;
    if (filters.location === "coords" && !point.hasCoords) return false;
    if (filters.location === "address" && (point.hasCoords || !point.hasAddress)) return false;
    if (filters.location === "missing" && (point.hasCoords || point.hasAddress)) return false;
    // Наш клиент — тот, за кем закреплена хотя бы одна программа: он с нами
    // работает. Остальные — те, кого ещё предстоит привлечь.
    if (filters.ownership === "ours" && !point.isOurs) return false;
    if (filters.ownership === "others" && point.isOurs) return false;
    return true;
  }

  function parseOverviewList(value, fallback = []) {
    try {
      const parsed = JSON.parse(String(value || ""));
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function readOverviewPoints(container) {
    const layout = container.closest(".clients-map-layout") || document;
    const filters = overviewFilters(container);
    const selectedIds = selectedMapIds();
    const noSelection = new Set();
    // Пагинация касается только строк списка: карта показывает все совпадения.
    const mapSection = container.closest("#clients-map") || layout;
    const matchedRows = [];
    const points = [...layout.querySelectorAll("[data-client-overview-point]")]
      .map((item) => {
        const lat = Number.parseFloat(item.dataset.lat || "");
        const lon = Number.parseFloat(item.dataset.lon || "");
        const editLink = item.querySelector("[data-client-map-quick-edit]");
        const segments = parseOverviewList(item.dataset.segments)
          .filter((segment) => segment && typeof segment === "object" && String(segment.name || "").trim())
          .map((segment) => ({
            name: String(segment.name || "").trim(),
            icon: String(segment.icon || "🏷️").trim() || "🏷️",
          }));
        const programList = parseOverviewList(
          item.dataset.programList,
          String(item.dataset.programs || "").split(",").map((value) => value.trim()).filter(Boolean)
        ).map((value) => String(value || "").trim()).filter(Boolean);
        const point = {
          id: item.dataset.clientId || "",
          lat,
          lon,
          name: item.dataset.name || "Клиент",
          address: item.dataset.address || "",
          type: item.dataset.clientType || "",
          category: item.dataset.category || "",
          icon: segments[0]?.icon || "🏷️",
          programs: item.dataset.programs || "",
          programList,
          segments,
          status: item.dataset.status || "",
          isOurs: item.dataset.ours === "1",
          hasCoords: Number.isFinite(lat) && Number.isFinite(lon),
          hasAddress: Boolean(String(item.dataset.address || "").trim()),
          editHref: editLink?.getAttribute("href") || `/clients?client=${encodeURIComponent(item.dataset.clientId || "")}&focus=location#client-edit`,
          editTabId: editLink?.dataset.workspaceTabId || `client-edit-${item.dataset.clientId || ""}`,
          editTabTitle: editLink?.dataset.workspaceTabTitle || `Редактировать ${item.dataset.name || "клиента"}`,
          item,
        };
        const baseMatched = matchesOverviewFilters(point, filters, noSelection);
        const matched = baseMatched && (!selectedIds.size || selectedIds.has(point.id));
        item.hidden = !baseMatched;
        if (baseMatched) matchedRows.push(item);
        return matched ? point : null;
      })
      .filter(Boolean);
    paginateClientsMapRows(mapSection, matchedRows);
    syncClientsMapSelectAll(layout.closest("#clients-map") || layout);
    return points;
  }

  /* Футер списка карты — как в журнале продаж: страницы, «Всего»,
     «Показано» и размер показа. Карту пагинация не трогает. */
  function paginateClientsMapRows(section, rows) {
    const footer = section?.querySelector?.("[data-clients-map-footer]");
    if (!footer) return;
    const pageSize = Number.parseInt(footer.querySelector("[data-clients-map-page-size-select]")?.value || "", 10) || Infinity;
    const total = rows.length;
    const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    let page = Number.parseInt(section.dataset.clientsMapPage || "1", 10) || 1;
    page = Math.min(Math.max(page, 1), totalPages);
    section.dataset.clientsMapPage = String(page);
    const start = Number.isFinite(pageSize) ? (page - 1) * pageSize : 0;
    const end = Number.isFinite(pageSize) ? start + pageSize : total;
    rows.forEach((row, index) => {
      if (index < start || index >= end) row.hidden = true;
    });
    const totalNode = footer.querySelector("[data-clients-map-total]");
    if (totalNode) totalNode.textContent = `Всего: ${total}`;
    const shownNode = footer.querySelector("[data-clients-map-shown]");
    if (shownNode) {
      shownNode.textContent = total
        ? `Показано: ${Math.min(start + 1, total)}-${Math.min(end, total)}`
        : "Показано: 0";
    }
    const pagesNode = footer.querySelector("[data-clients-map-pages]");
    if (!pagesNode) return;
    const pageButton = (label, target, options = {}) =>
      `<button type="button" class="products-page-link${options.active ? " active" : ""}${options.disabled ? " disabled" : ""}"` +
      ` data-clients-map-page="${target}"${options.disabled ? " disabled" : ""}` +
      `${options.aria ? ` aria-label="${options.aria}"` : ""}${options.active ? ' aria-current="page"' : ""}>${label}</button>`;
    const parts = [];
    parts.push(pageButton("‹", Math.max(1, page - 1), { disabled: page <= 1, aria: "Предыдущая страница" }));
    const windowStart = Math.max(1, page - 2);
    const windowEnd = Math.min(totalPages, page + 2);
    if (windowStart > 1) parts.push(pageButton("1", 1, { active: page === 1 }));
    if (windowStart > 2) parts.push('<span class="products-page-count">…</span>');
    for (let index = windowStart; index <= windowEnd; index += 1) {
      parts.push(pageButton(String(index), index, { active: index === page }));
    }
    if (windowEnd < totalPages - 1) parts.push('<span class="products-page-count">…</span>');
    if (windowEnd < totalPages) parts.push(pageButton(String(totalPages), totalPages, { active: page === totalPages }));
    parts.push(pageButton("›", Math.min(totalPages, page + 1), { disabled: page >= totalPages, aria: "Следующая страница" }));
    parts.push(`<span class="products-page-count">Стр. ${page} из ${totalPages}</span>`);
    pagesNode.innerHTML = parts.join("");
  }

  function visibleMapRowCheckboxes(section) {
    return [...section.querySelectorAll("[data-clients-map-row-select]")]
      .filter((checkbox) => !checkbox.closest("[data-client-overview-point]")?.hidden);
  }

  function syncClientsMapSelectAll(section) {
    const selectAll = section?.querySelector("[data-clients-map-select-all]");
    if (!selectAll) return;
    const checkboxes = visibleMapRowCheckboxes(section);
    const checked = checkboxes.filter((checkbox) => checkbox.checked).length;
    selectAll.checked = Boolean(checkboxes.length) && checked === checkboxes.length;
    selectAll.indeterminate = checked > 0 && checked < checkboxes.length;
    selectAll.disabled = checkboxes.length === 0;
  }

  function countOverviewValues(points, valuesForPoint, emptyLabel) {
    const counts = new Map();
    points.forEach((point) => {
      const values = valuesForPoint(point);
      if (!values.length) {
        counts.set(emptyLabel, (counts.get(emptyLabel) || 0) + 1);
        return;
      }
      new Set(values.filter(Boolean)).forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });
    return counts;
  }

  function renderOverviewBreakdown(container, counts) {
    if (!container) return;
    const entries = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"));
    container.innerHTML = entries.length
      ? entries.map(([label, count]) => `
          <article class="clients-map-breakdown-item">
            <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <strong>${count}</strong>
          </article>
        `).join("")
      : '<p class="clients-map-breakdown-empty">Нет данных по выбранным клиентам</p>';
  }

  function overviewFilterLabel(container) {
    const filters = overviewFilters(container);
    const section = container.closest("#clients-map") || document;
    const labels = [];
    if (filters.q) labels.push(`Поиск: ${filters.q}`);
    [
      ["[data-clients-map-type]", filters.type],
      ["[data-clients-map-category]", filters.category],
      ["[data-clients-map-status]", filters.status],
    ].forEach(([selector, value]) => {
      if (!value) return;
      const select = section.querySelector(selector);
      labels.push(select?.selectedOptions?.[0]?.textContent?.trim() || value);
    });
    if (filters.programs.length) {
      labels.push(filters.programs.length <= 2 ? filters.programs.join(", ") : `Выбрано программ: ${filters.programs.length}`);
    }
    if (filters.location) {
      const locationButton = section.querySelector(`[data-clients-map-location-filter="${filters.location}"]`);
      labels.push(locationButton?.textContent?.trim() || filters.location);
    }
    const selectedCount = selectedMapIds().size;
    if (selectedCount) labels.push(`Выбрано вручную: ${selectedCount}`);
    return labels.length ? labels.join(" · ") : "Все клиенты на карте";
  }

  function renderOverviewInsights(container, points) {
    const section = container.closest("#clients-map") || document;
    const insights = section.querySelector("[data-clients-map-insights]");
    if (!insights) return;
    const active = points.filter((point) => point.status === "active").length;
    // Без локации — ни координат, ни адреса: тот же признак, что и у счётчика
    // под таблицей клиентов.
    const withoutLocation = points.filter((point) => !point.hasCoords && !point.hasAddress).length;
    const segmentCounts = countOverviewValues(
      points,
      (point) => point.segments.map((segment) => `${segment.icon} ${segment.name}`.trim()),
      "Без сегмента"
    );
    const programCounts = countOverviewValues(points, (point) => point.programList, "Без программы");
    const assignedSegments = [...segmentCounts.keys()].filter((label) => label !== "Без сегмента").length;
    const assignedPrograms = [...programCounts.keys()].filter((label) => label !== "Без программы").length;
    const setText = (selector, value) => {
      const target = insights.querySelector(selector);
      if (target) target.textContent = String(value);
    };
    setText("[data-clients-map-filter-label]", overviewFilterLabel(container));
    setText("[data-clients-map-total]", points.length);
    setText("[data-clients-map-active]", active);
    setText("[data-clients-map-active-share]", `${points.length ? Math.round((active / points.length) * 100) : 0}% от выбранных`);
    setText("[data-clients-map-no-location]", withoutLocation);
    setText(
      "[data-clients-map-no-location-share]",
      `${points.length ? Math.round((withoutLocation / points.length) * 100) : 0}% от выбранных`
    );
    setText("[data-clients-map-segment-total]", assignedSegments);
    setText("[data-clients-map-program-total]", assignedPrograms);
    renderOverviewBreakdown(insights.querySelector("[data-clients-map-segment-breakdown]"), segmentCounts);
    renderOverviewBreakdown(insights.querySelector("[data-clients-map-program-breakdown]"), programCounts);
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
    renderOverviewInsights(container, points);
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
        ${resolved.segments.length ? `<span>${escapeHtml(resolved.segments.map((segment) => `${segment.icon} ${segment.name}`).join(", "))}</span>` : ""}
        ${resolved.category ? `<span>${escapeHtml(resolved.category)}</span>` : ""}
        ${resolved.address ? `<span>${escapeHtml(resolved.address)}</span>` : ""}
        <a
          class="btn btn-primary clients-map-popup-edit"
          href="${escapeHtml(resolved.editHref)}"
          data-workspace-trigger="${escapeHtml(resolved.editTabId)}"
          data-workspace-tab-id="${escapeHtml(resolved.editTabId)}"
          data-workspace-view-id="client_edit"
          data-workspace-tab-title="${escapeHtml(resolved.editTabTitle)}"
          data-workspace-tab-hash="client-edit"
          data-workspace-tab-href="${escapeHtml(resolved.editHref)}"
        >Изменить местоположение</a>
      `);
      marker.on("dblclick", (event) => {
        if (event.originalEvent) window.L.DomEvent.stop(event.originalEvent);
        marker.openPopup();
      });
      bounds.push([resolved.lat, resolved.lon]);
    }
    bindLabelZoom(api);

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

  function overviewPickerElements(api) {
    const panel = api.container.querySelector("[data-clients-map-point-picker]");
    return {
      panel,
      title: panel?.querySelector("[data-clients-map-point-picker-title]"),
      status: panel?.querySelector("[data-clients-map-point-picker-status]"),
      save: panel?.querySelector("[data-clients-map-point-picker-save]"),
    };
  }

  function setOverviewPickerPoint(api, lat, lon, { focus = false } = {}) {
    if (!api.picker || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    api.picker.lat = Number(lat.toFixed(6));
    api.picker.lon = Number(lon.toFixed(6));
    if (!api.picker.marker) {
      api.picker.marker = window.L.marker([api.picker.lat, api.picker.lon], {
        draggable: true,
        icon: markerIcon(api.picker.name, api.picker.icon),
        zIndexOffset: 2000,
      }).addTo(api.pickerLayer);
      api.picker.marker.on("dragend", () => {
        const point = api.picker?.marker?.getLatLng();
        if (point) setOverviewPickerPoint(api, point.lat, point.lng);
      });
    } else {
      api.picker.marker.setLatLng([api.picker.lat, api.picker.lon]);
    }
    const elements = overviewPickerElements(api);
    if (elements.status) {
      elements.status.textContent = `Точка: ${api.picker.lat}, ${api.picker.lon}. Нажмите «Сохранить».`;
    }
    if (elements.save) elements.save.disabled = false;
    if (focus) api.map.setView([api.picker.lat, api.picker.lon], PICK_ZOOM);
  }

  function stopOverviewLocationPicker(api) {
    if (!api) return;
    api.pickerLayer?.clearLayers();
    api.picker = null;
    api.container.classList.remove("is-picking-location");
    const elements = overviewPickerElements(api);
    if (elements.panel) elements.panel.hidden = true;
    if (elements.save) {
      elements.save.disabled = false;
      elements.save.textContent = "Сохранить";
    }
  }

  async function startOverviewLocationPicker(trigger) {
    const section = trigger.closest("#clients-map");
    const container = section?.querySelector("[data-clients-overview-map]");
    const api = container?._clientsOverviewApi || ensureOverviewMap(container);
    if (!api) return;
    stopOverviewLocationPicker(api);
    const row = trigger.closest("[data-client-overview-point]");
    const lat = Number.parseFloat(row?.dataset.lat || "");
    const lon = Number.parseFloat(row?.dataset.lon || "");
    const client = {
      id: trigger.dataset.clientId || row?.dataset.clientId || "",
      name: trigger.dataset.clientName || row?.dataset.name || "Клиент",
      address: trigger.dataset.clientAddress || row?.dataset.address || "",
      icon: trigger.dataset.clientIcon || row?.dataset.icon || "",
      saveUrl: trigger.dataset.saveUrl || `/api/clients/${encodeURIComponent(trigger.dataset.clientId || "")}/location`,
      csrf: trigger.dataset.csrf || csrfToken(container),
      row,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      marker: null,
    };
    api.picker = client;
    api.container.classList.remove("clients-overview-map--empty");
    api.container.classList.add("is-picking-location");
    const elements = overviewPickerElements(api);
    if (elements.panel) elements.panel.hidden = false;
    if (elements.title) elements.title.textContent = `Местоположение: ${client.name}`;
    if (elements.status) elements.status.textContent = "Поставьте точку кликом по карте или перетащите маркер.";
    const current = api.map.getCenter();
    let startPoint = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    if (!startPoint && client.address) {
      try {
        startPoint = await geocodeAddress(client.address);
      } catch {}
    }
    if (!api.picker || api.picker.id !== client.id) return;
    setOverviewPickerPoint(api, startPoint?.lat ?? current.lat, startPoint?.lon ?? current.lng, { focus: Boolean(startPoint) });
    api.container.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function saveOverviewLocationPicker(api) {
    const picker = api?.picker;
    if (!picker || !Number.isFinite(picker.lat) || !Number.isFinite(picker.lon)) return;
    const elements = overviewPickerElements(api);
    if (elements.save) {
      elements.save.disabled = true;
      elements.save.textContent = "Сохраняем...";
    }
    if (elements.status) elements.status.textContent = "Определяем адрес и сохраняем точку...";
    let address = picker.address || "";
    try {
      address = (await reverseAddress(picker.lat, picker.lon)) || address;
    } catch {}
    try {
      const response = await fetch(picker.saveUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": picker.csrf || csrfToken(api.container),
        },
        body: JSON.stringify({
          latitude: picker.lat,
          longitude: picker.lon,
          address,
          map_icon: picker.icon || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "save_failed");
      const savedAddress = String(payload.address || address || "Адрес не указан");
      if (picker.row) {
        picker.row.dataset.lat = String(payload.latitude || picker.lat);
        picker.row.dataset.lon = String(payload.longitude || picker.lon);
        picker.row.dataset.address = savedAddress === "Адрес не указан" ? "" : savedAddress;
        const addressCell = picker.row.querySelector(".clients-map-address-text");
        if (addressCell) addressCell.textContent = savedAddress;
        const locationCell = picker.row.querySelector(".clients-map-location-cell");
        if (locationCell) {
          locationCell.innerHTML = '<span class="client-location-state client-location-state--yes" role="img" aria-label="Локация указана" title="Локация указана">✓</span>';
        }
      }
      if (elements.status) elements.status.textContent = `Локация ${picker.name} сохранена.`;
      if (elements.save) elements.save.textContent = "Сохранено";
      window.setTimeout(() => {
        stopOverviewLocationPicker(api);
        void renderOverviewMap(api);
      }, 700);
    } catch {
      if (elements.status) elements.status.textContent = "Не удалось сохранить точку. Попробуйте ещё раз.";
      if (elements.save) {
        elements.save.disabled = false;
        elements.save.textContent = "Сохранить";
      }
    }
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

    const api = {
      container,
      map,
      layer: window.L.layerGroup().addTo(map),
      pickerLayer: window.L.layerGroup().addTo(map),
      picker: null,
    };
    container._clientsOverviewApi = api;
    const pickerPanel = container.querySelector("[data-clients-map-point-picker]");
    if (pickerPanel) window.L.DomEvent.disableClickPropagation(pickerPanel);
    map.on("click", (event) => {
      if (!api.picker) return;
      setOverviewPickerPoint(api, event.latlng.lat, event.latlng.lng);
    });
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
    const category = api.container.dataset.category || "";
    const marker = window.L.marker([point.lat, point.lon], { icon: markerIcon(name, icon, category) }).addTo(api.layer);
    marker.bindPopup(`
      <strong>${escapeHtml(name)}</strong>
      ${address ? `<span>${escapeHtml(address)}</span>` : ""}
    `);
    api.map.setView([point.lat, point.lon], PICK_ZOOM);
    bindLabelZoom(api);
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
    const category = api.container.dataset.category || "";
    const marker = window.L.marker([lat, lon], { icon: markerIcon(name, icon, category) }).addTo(api.layer);
    marker.bindPopup(`
      <strong>${escapeHtml(name)}</strong>
      ${address ? `<span>${escapeHtml(address)}</span>` : ""}
    `);
    api.map.setView([lat, lon], PICK_ZOOM);
    bindLabelZoom(api);
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
    { key: "own", kind: "text" },
    { key: "name", kind: "text" },
    { key: "official_name", kind: "text" },
    { key: "balance", kind: "number" },
    { key: "last_date", kind: "date" },
    { key: "segment", kind: "text" },
    { key: "location", sortable: false },
    { key: "created_at", kind: "date" },
    { key: "phone", kind: "text" },
    { key: "category", kind: "text" },
    { key: "actions", sortable: false, movable: false },
  ];

  function clientDirectoryCells(row) {
    return [...(row?.children || [])].filter((cell) => !cell.classList.contains("upos-table-column-control-cell"));
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

  function markClientDirectoryRows(table) {
    Array.from(table.tBodies || []).forEach((tbody) => {
      Array.from(tbody.rows || []).forEach((row) => {
        const cells = clientDirectoryCells(row);
        if (cells.length !== CLIENT_DIRECTORY_COLUMNS.length) return;
        cells.forEach((cell, index) => {
          cell.dataset.clientColumn = CLIENT_DIRECTORY_COLUMNS[index].key;
        });
      });
    });
  }

  function sortClientDirectory(table, key) {
    const currentKey = table.dataset.clientsSortKey;
    const currentDirection = table.dataset.clientsSortDirection;
    const direction = currentKey === key && currentDirection === "desc" ? "asc" : "desc";
    const url = new URL(window.location.href);
    url.searchParams.set("client_sort", key);
    url.searchParams.set("client_sort_dir", direction);
    url.searchParams.delete("page");
    url.hash = "clients";
    // Сортировка без перезагрузки: сервер отдаёт готовый порядок всей базы,
    // а мы меняем только строки и пагинацию — вкладки не мигают.
    table.dataset.clientsSortKey = key;
    table.dataset.clientsSortDirection = direction;
    updateClientSortButtons(table, key, direction);
    table.setAttribute("aria-busy", "true");
    fetch(url.toString(), { headers: { Accept: "text/html" }, credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("sort");
        return response.text();
      })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const fresh = doc.querySelector("[data-clients-directory-table]");
        const freshBody = fresh?.tBodies?.[0];
        const currentBody = table.tBodies[0];
        if (!freshBody || !currentBody) throw new Error("sort");
        currentBody.replaceWith(freshBody);
        markClientDirectoryRows(table);
        const wrap = table.closest(".products-table-wrap");
        const footer = wrap?.parentElement?.querySelector(":scope > footer.products-catalog-footer");
        const freshFooter = fresh.closest(".products-table-wrap")?.parentElement?.querySelector(":scope > footer.products-catalog-footer");
        if (footer && freshFooter) footer.replaceWith(freshFooter);
        history.replaceState(null, "", url.toString());
        highlightClientSearchMatches();
      })
      .catch(() => {
        window.location.assign(url.toString());
      })
      .finally(() => {
        table.removeAttribute("aria-busy");
      });
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
      if (definition.sortable === false) return;
      const label = cell.textContent.trim();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "org-shipments-sort-btn products-sort-btn clients-table-sort-btn";
      button.dataset.clientsSort = definition.key;
      button.innerHTML = `<span>${label}</span><span class="org-shipments-sort-arrow" aria-hidden="true">↕</span>`;
      button.addEventListener("click", () => {
        if (Date.now() - Number(table.dataset.clientsDraggedAt || 0) < 300) return;
        sortClientDirectory(table, definition.key);
      });
      cell.replaceChildren(button);
    });

    markClientDirectoryRows(table);

    updateClientSortButtons(
      table,
      table.dataset.clientsSortKey || "",
      table.dataset.clientsSortDirection === "asc" ? "asc" : "desc"
    );

  }

  function initializeClientDirectoryTables(root = document) {
    root.querySelectorAll("[data-clients-directory-table]").forEach(initClientDirectoryTable);
  }

  function highlightClientSearchMatches() {
    const table = document.querySelector("[data-clients-directory-table]");
    const query = String(table?.dataset.clientsSearchQuery || "").trim();
    if (!table || !query || !table.tBodies[0]) return;
    const terms = [...new Set(query.split(/\s+/).map((term) => term.trim()).filter(Boolean))]
      .sort((left, right) => right.length - left.length);
    if (!terms.length) return;
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const matcher = new RegExp(`(${escaped.join("|")})`, "giu");
    const walker = document.createTreeWalker(table.tBodies[0], NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue || "";
        const parent = node.parentElement;
        if (!text.trim() || !parent || parent.closest("mark, input, select, option, button, script, style")) {
          return NodeFilter.FILTER_REJECT;
        }
        matcher.lastIndex = 0;
        return matcher.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const matches = [];
    while (walker.nextNode()) matches.push(walker.currentNode);
    matches.forEach((node) => {
      const text = node.nodeValue || "";
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      matcher.lastIndex = 0;
      for (const match of text.matchAll(matcher)) {
        const index = match.index || 0;
        if (index > cursor) fragment.append(document.createTextNode(text.slice(cursor, index)));
        const mark = document.createElement("mark");
        mark.className = "client-search-highlight";
        mark.textContent = match[0];
        fragment.append(mark);
        cursor = index + match[0].length;
      }
      if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
      node.replaceWith(fragment);
    });
  }

  function directoryClientCheckboxes(root = document) {
    return [...root.querySelectorAll("[data-client-directory-select]")];
  }

  function selectedDirectoryClientIds(root = document) {
    return directoryClientCheckboxes(root)
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value)
      .filter(Boolean);
  }

  function syncDirectoryClientSelection(root = document) {
    const checkboxes = directoryClientCheckboxes(root);
    const selected = checkboxes.filter((checkbox) => checkbox.checked);
    const selectAll = root.querySelector("[data-client-directory-select-all]");
    if (selectAll) {
      selectAll.checked = Boolean(checkboxes.length) && selected.length === checkboxes.length;
      selectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
      selectAll.disabled = checkboxes.length === 0;
    }
    const count = selected.length;
    const counter = root.querySelector("[data-client-bulk-selection-count]");
    const counterValue = root.querySelector("[data-client-bulk-selection-value]");
    const openButton = root.querySelector("[data-client-bulk-attach-open]");
    if (counterValue) counterValue.textContent = String(count);
    if (counter) counter.hidden = count === 0;
    if (openButton) {
      openButton.hidden = count === 0;
      openButton.disabled = count === 0;
    }
  }

  function setBulkAttachStatus(dialog, text, kind = "") {
    const status = dialog?.querySelector("[data-client-bulk-attach-status]");
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function resetBulkAttachDialog(dialog) {
    if (!dialog) return;
    dialog.querySelectorAll("[data-client-bulk-program], [data-client-bulk-segment]").forEach((input) => {
      input.checked = false;
    });
    dialog.querySelectorAll("[data-client-program-search], [data-client-segment-search]").forEach((input) => {
      input.value = "";
    });
    dialog.querySelectorAll("[data-client-program-option-row], [data-client-segment-option-row]").forEach((row) => {
      row.hidden = false;
    });
    setBulkAttachStatus(dialog, "");
  }

  function openBulkAttachDialog() {
    const dialog = document.querySelector("[data-client-bulk-attach-dialog]");
    const clientIds = selectedDirectoryClientIds();
    if (!dialog || !clientIds.length) return;
    resetBulkAttachDialog(dialog);
    dialog._clientIds = clientIds;
    const count = dialog.querySelector("[data-client-bulk-dialog-count]");
    if (count) count.textContent = String(clientIds.length);
    if (!dialog.open) dialog.showModal();
  }

  function closeBulkAttachDialog(dialog) {
    if (!dialog?.open) return;
    dialog.close();
  }

  async function saveBulkClientAttachments(dialog) {
    const clientIds = Array.isArray(dialog?._clientIds) ? dialog._clientIds : [];
    const programs = [...dialog.querySelectorAll("[data-client-bulk-program]:checked")]
      .map((input) => input.value)
      .filter(Boolean);
    const segmentIds = [...dialog.querySelectorAll("[data-client-bulk-segment]:checked")]
      .map((input) => input.value)
      .filter(Boolean);
    if (!clientIds.length) {
      setBulkAttachStatus(dialog, "Сначала выберите клиентов.", "error");
      return;
    }
    if (!programs.length && !segmentIds.length) {
      setBulkAttachStatus(dialog, "Выберите хотя бы одну программу или сегмент.", "error");
      return;
    }
    const save = dialog.querySelector("[data-client-bulk-attach-save]");
    if (save) {
      save.disabled = true;
      save.textContent = "Прикрепляем...";
    }
    setBulkAttachStatus(dialog, "Сохраняем данные выбранных клиентов...");
    try {
      const response = await fetch(dialog.dataset.saveUrl || "/api/clients/bulk-attach", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": dialog.dataset.csrf || csrfToken(dialog),
        },
        body: JSON.stringify({ client_ids: clientIds, programs, segment_ids: segmentIds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "save_failed");
      setBulkAttachStatus(dialog, `Прикреплено клиентам: ${payload.updated || clientIds.length}`, "success");
      if (save) save.textContent = "Готово";
      window.setTimeout(() => window.location.reload(), 650);
    } catch {
      setBulkAttachStatus(dialog, "Не удалось прикрепить данные. Попробуйте ещё раз.", "error");
      if (save) {
        save.disabled = false;
        save.textContent = "Прикрепить";
      }
    }
  }

  document.addEventListener("click", (event) => {
    const open = event.target.closest?.("[data-client-bulk-attach-open]");
    const close = event.target.closest?.("[data-client-bulk-attach-close]");
    const save = event.target.closest?.("[data-client-bulk-attach-save]");
    if (!open && !close && !save) return;
    event.preventDefault();
    if (open) openBulkAttachDialog();
    const dialog = (close || save)?.closest("[data-client-bulk-attach-dialog]");
    if (close) closeBulkAttachDialog(dialog);
    if (save) void saveBulkClientAttachments(dialog);
  });

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

  const locationSuggestCache = new Map();

  async function geocodeSuggestions(query) {
    const key = String(query || "").trim().toLowerCase();
    if (key.length < 3) return [];
    if (locationSuggestCache.has(key)) return locationSuggestCache.get(key);
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "uz,kz,kg,tj,tm");
    url.searchParams.set("q", query);
    let items = [];
    try {
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (response.ok) items = await response.json();
    } catch {
      items = [];
    }
    const list = (Array.isArray(items) ? items : [])
      .map((item) => ({
        label: String(item.display_name || "").trim(),
        lat: Number.parseFloat(item.lat),
        lon: Number.parseFloat(item.lon),
      }))
      .filter((item) => item.label && Number.isFinite(item.lat) && Number.isFinite(item.lon));
    locationSuggestCache.set(key, list);
    return list;
  }

  function closeLocationSuggest(box) {
    const list = box?.querySelector("[data-client-location-suggest]");
    if (!list) return;
    list.hidden = true;
    list.innerHTML = "";
  }

  function renderLocationSuggest(box, items) {
    const list = box.querySelector("[data-client-location-suggest]");
    if (!list) return;
    if (!items.length) {
      closeLocationSuggest(box);
      return;
    }
    list.innerHTML = items
      .map(
        (item) =>
          `<li><button type="button" data-client-location-pick data-lat="${item.lat}" data-lon="${item.lon}" data-label="${escapeHtml(item.label)}">${escapeHtml(item.label)}</button></li>`
      )
      .join("");
    list.hidden = false;
  }

  async function suggestClientLocation(box) {
    if (!box) return;
    const input = box.querySelector("[data-client-location-search]");
    const query = String(input?.value || "").trim();
    if (query.length < 3) {
      closeLocationSuggest(box);
      return;
    }
    const items = await geocodeSuggestions(query);
    // Пока шёл запрос, текст мог измениться — не перекрываем более свежий ввод.
    if (String(input?.value || "").trim() !== query) return;
    renderLocationSuggest(box, items);
  }

  async function applyClientLocationPoint(box, lat, lon, label) {
    const status = box.querySelector("[data-client-location-search-status]");
    const setSearchStatus = (text) => {
      if (status) status.textContent = text;
    };
    const form = box.closest("form");
    if (form?.querySelector("[data-client-map]")) {
      const addressInput = form.querySelector("[data-client-address]");
      if (addressInput) addressInput.value = label;
      updateMap(form, lat, lon);
      setSearchStatus("Точка выбрана");
      setStatus(form, `Локация выбрана: ${lat}, ${lon}`);
      return;
    }
    const dialog = box.closest("[data-client-location-dialog]");
    if (dialog) {
      dialog.dataset.address = label;
      setDirectoryLocationDialogPoint(dialog, lat, lon);
      setSearchStatus("Адрес найден. Уточните точку и сохраните.");
      return;
    }
    const overviewContainer = box.closest(".clients-map-frame")?.querySelector("[data-clients-overview-map]");
    if (overviewContainer) {
      const overviewApi = overviewContainer._clientsOverviewApi || ensureOverviewMap(overviewContainer);
      if (!overviewApi?.map) {
        setSearchStatus("Карта ещё не готова. Попробуйте ещё раз.");
        return;
      }
      if (overviewApi.searchMarker) overviewApi.map.removeLayer(overviewApi.searchMarker);
      overviewApi.searchMarker = window.L.marker([lat, lon]).addTo(overviewApi.map);
      overviewApi.searchMarker.bindPopup(`<strong>${escapeHtml(label)}</strong>`).openPopup();
      overviewApi.map.setView([lat, lon], PICK_ZOOM);
      setSearchStatus("Место найдено на карте");
      scheduleInvalidate(overviewApi);
      return;
    }
    const container = box.closest(".client-card-location-card")?.querySelector("[data-client-card-map]");
    const api = container ? ensureClientCardMap(container) : null;
    if (!api) {
      setSearchStatus("Карта ещё не готова, откройте раздел «Локация»");
      return;
    }
    // Сохранение подставляет адрес из dataset, поэтому запись обновляем до вызова:
    // иначе у точки остался бы прежний адрес клиента.
    container.dataset.address = label;
    api.layer.clearLayers();
    setClientCardPoint(api, lat, lon, label);
    try {
      await saveClientCardLocation(api, lat, lon);
      setSearchStatus("Локация обновлена");
    } catch {
      setSearchStatus("Точка найдена, но сохранить не удалось");
    }
  }

  async function runClientLocationSearch(box) {
    if (!box) return;
    const input = box.querySelector("[data-client-location-search]");
    const status = box.querySelector("[data-client-location-search-status]");
    const setStatus = (text) => {
      if (status) status.textContent = text;
    };
    const query = String(input?.value || "").trim();
    if (!query) {
      setStatus("Введите адрес или ориентир");
      return;
    }
    setStatus("Ищем...");
    const items = await geocodeSuggestions(query);
    if (!items.length) {
      closeLocationSuggest(box);
      setStatus("Ничего не найдено — уточните запрос");
      return;
    }
    // Один вариант ставим сразу, несколько — показываем списком, чтобы выбрал человек.
    if (items.length === 1) {
      closeLocationSuggest(box);
      await applyClientLocationPoint(box, items[0].lat, items[0].lon, items[0].label);
      return;
    }
    renderLocationSuggest(box, items);
    setStatus("Выберите вариант из списка");
  }

  function syncProgramDropdown(dropdown) {
    if (!dropdown) return;
    const checked = [...dropdown.querySelectorAll('input[name="programs"]:checked, [data-clients-map-program]:checked')]
      .map((input) => input.value)
      .filter(Boolean);
    const summary = dropdown.querySelector("[data-client-program-summary]");
    if (!summary) return;
    summary.textContent = checked.length
      ? (checked.length <= 2 ? checked.join(", ") : `Выбрано: ${checked.length}`)
      : (dropdown.dataset.emptyLabel || "Не выбраны");
    summary.title = checked.join(", ");
  }

  function filterProgramDropdown(search) {
    const dropdown = search?.closest("[data-client-program-dropdown]");
    if (!dropdown) return;
    const query = String(search.value || "").trim().toLocaleLowerCase("ru");
    dropdown.querySelectorAll("[data-client-program-option-row]").forEach((row) => {
      row.hidden = Boolean(query) && !String(row.textContent || "").toLocaleLowerCase("ru").includes(query);
    });
  }

  function initializeProgramDropdowns(root = document) {
    root.querySelectorAll("[data-client-program-dropdown]").forEach(syncProgramDropdown);
  }

  function syncSegmentPicker(picker) {
    if (!picker) return;
    const checked = [...picker.querySelectorAll("[data-client-segment-option]:checked")];
    const labels = checked.map((input) => input.dataset.segmentLabel || input.value).filter(Boolean);
    const displayLabels = checked.map((input) => {
      const icon = input.dataset.segmentIcon || "";
      const label = input.dataset.segmentLabel || input.value;
      return `${icon} ${label}`.trim();
    });
    const summary = picker.querySelector("[data-client-segment-summary]");
    if (!summary) return;
    summary.textContent = checked.length
      ? (checked.length <= 2 ? displayLabels.join(", ") : `Выбрано: ${checked.length}`)
      : "Не выбраны";
    summary.title = labels.join(", ");
  }

  function filterSegmentPicker(search) {
    const picker = search?.closest("[data-client-segment-picker], [data-client-directory-segment-picker]");
    if (!picker) return;
    const query = String(search.value || "").trim().toLocaleLowerCase("ru");
    picker.querySelectorAll("[data-client-segment-option-row]").forEach((row) => {
      row.hidden = Boolean(query) && !String(row.textContent || "").toLocaleLowerCase("ru").includes(query);
    });
  }

  function initializeSegmentPickers(root = document) {
    root.querySelectorAll("[data-client-segment-picker]").forEach(syncSegmentPicker);
  }

  function directorySegmentOptions(picker) {
    return [...(picker?.querySelectorAll("[data-client-directory-segment-option]") || [])];
  }

  function directorySegmentIds(picker) {
    const options = directorySegmentOptions(picker);
    if (options.length) {
      return options.filter((input) => input.checked).map((input) => String(input.value || ""));
    }
    return parseOverviewList(picker?.dataset.selectedSegmentIds).map((value) => String(value || "")).filter(Boolean);
  }

  function hydrateDirectorySegmentPicker(picker) {
    const target = picker?.querySelector("[data-client-map-segment-options]");
    if (!target || target.dataset.hydrated === "1") return;
    const template = document.querySelector("[data-client-map-segment-options-template]");
    if (!template?.content) return;
    const selectedIds = new Set(directorySegmentIds(picker));
    target.append(template.content.cloneNode(true));
    directorySegmentOptions(picker).forEach((input) => {
      input.checked = selectedIds.has(String(input.value || ""));
    });
    target.dataset.hydrated = "1";
    picker._savedSegmentIds = selectedIds;
    syncDirectorySegmentPicker(picker);
  }

  function renderDirectorySegmentSummary(picker, segments) {
    const summary = picker?.querySelector("[data-client-directory-segment-summary]");
    if (!summary) return;
    summary.replaceChildren();
    if (!segments.length) {
      const empty = document.createElement("span");
      empty.className = "client-directory-segment-empty";
      empty.textContent = "Выбрать";
      summary.append(empty);
      summary.title = "Выбрать сегмент";
      return;
    }
    segments.slice(0, 2).forEach((segment) => {
      const chip = document.createElement("span");
      chip.className = "client-segment-chip";
      chip.textContent = `${segment.icon || ""} ${segment.name || segment.id || ""}`.trim();
      summary.append(chip);
    });
    if (segments.length > 2) {
      const more = document.createElement("span");
      more.className = "client-directory-segment-more";
      more.textContent = `+${segments.length - 2}`;
      summary.append(more);
    }
    summary.title = segments.map((segment) => segment.name || segment.id || "").filter(Boolean).join(", ");
  }

  function syncDirectorySegmentPicker(picker) {
    if (!picker) return;
    const checked = directorySegmentOptions(picker).filter((input) => input.checked);
    renderDirectorySegmentSummary(picker, checked.map((input) => ({
      id: String(input.value || ""),
      name: input.dataset.segmentLabel || input.value,
      icon: input.dataset.segmentIcon || "",
    })));
  }

  function applySavedClientSegments(clientId, segments) {
    const normalized = (Array.isArray(segments) ? segments : []).map((segment) => ({
      id: String(segment?.id || ""),
      name: String(segment?.name || "").trim(),
      icon: String(segment?.icon || "").trim(),
    })).filter((segment) => segment.id);
    const savedIds = new Set(normalized.map((segment) => segment.id));
    document.querySelectorAll("[data-client-directory-segment-picker]").forEach((candidate) => {
      if (String(candidate.dataset.clientId || "") !== clientId) return;
      candidate.dataset.selectedSegmentIds = JSON.stringify([...savedIds]);
      candidate._savedSegmentIds = new Set(savedIds);
      directorySegmentOptions(candidate).forEach((input) => {
        input.checked = savedIds.has(String(input.value || ""));
      });
      renderDirectorySegmentSummary(candidate, normalized);
    });
    document.querySelectorAll("[data-client-overview-point]").forEach((row) => {
      if (String(row.dataset.clientId || "") !== clientId) return;
      row.dataset.segments = JSON.stringify(normalized.map(({ name, icon }) => ({ name, icon })));
      row.dataset.icon = normalized[0]?.icon || "";
    });
    document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
  }

  function setDirectorySegmentStatus(picker, text, kind = "") {
    const status = picker?.querySelector("[data-client-directory-segment-status]");
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind;
  }

  async function saveDirectorySegments(picker) {
    if (!picker || picker.dataset.segmentSaving === "1") {
      if (picker) picker.dataset.segmentSaveQueued = "1";
      return;
    }
    const clientId = String(picker.dataset.clientId || "").trim();
    if (!clientId) return;
    const selectedIds = directorySegmentOptions(picker)
      .filter((input) => input.checked)
      .map((input) => input.value);
    picker.dataset.segmentSaving = "1";
    picker.classList.add("is-saving");
    setDirectorySegmentStatus(picker, "Сохраняю...");
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/segments`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken(picker),
        },
        body: JSON.stringify({ segment_ids: selectedIds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "save_failed");
      const savedIds = new Set((payload.segments || []).map((segment) => String(segment.id || "")));
      directorySegmentOptions(picker).forEach((input) => {
        input.checked = savedIds.has(input.value);
      });
      applySavedClientSegments(clientId, payload.segments || []);
      setDirectorySegmentStatus(picker, "Сохранено", "success");
    } catch {
      const savedIds = picker._savedSegmentIds || new Set();
      directorySegmentOptions(picker).forEach((input) => {
        input.checked = savedIds.has(input.value);
      });
      syncDirectorySegmentPicker(picker);
      setDirectorySegmentStatus(picker, "Не удалось сохранить", "error");
    } finally {
      picker.dataset.segmentSaving = "0";
      picker.classList.remove("is-saving");
      if (picker.dataset.segmentSaveQueued === "1") {
        picker.dataset.segmentSaveQueued = "0";
        void saveDirectorySegments(picker);
      }
    }
  }

  function queueDirectorySegmentSave(picker) {
    window.clearTimeout(picker?._segmentSaveTimer);
    if (!picker) return;
    picker._segmentSaveTimer = window.setTimeout(() => void saveDirectorySegments(picker), 220);
  }

  function initializeDirectorySegmentPickers(root = document) {
    root.querySelectorAll("[data-client-directory-segment-picker]").forEach((picker) => {
      picker._savedSegmentIds = new Set(directorySegmentIds(picker));
      if (!picker.matches("[data-client-map-segment-picker]")) syncDirectorySegmentPicker(picker);
    });
  }

  function renderClientPhotoPreview(source, url, objectUrl = false) {
    const form = source?.closest("form");
    const preview = form?.querySelector("[data-client-photo-preview]");
    if (!preview) return;
    const previousObjectUrl = preview.dataset.clientPhotoObjectUrl || "";
    if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
    delete preview.dataset.clientPhotoObjectUrl;
    preview.replaceChildren();
    if (!url) {
      preview.append(document.createElement("span"));
      return;
    }
    const image = document.createElement("img");
    image.alt = "";
    image.src = url;
    image.addEventListener("error", () => {
      if (image.parentElement !== preview) return;
      preview.replaceChildren(document.createElement("span"));
    }, { once: true });
    preview.append(image);
    if (objectUrl) preview.dataset.clientPhotoObjectUrl = url;
  }

  function directoryLocationDialogElements(dialog) {
    return {
      map: dialog?.querySelector("[data-client-location-dialog-map]"),
      title: dialog?.querySelector("[data-client-location-dialog-title]"),
      status: dialog?.querySelector("[data-client-location-dialog-status]"),
      save: dialog?.querySelector("[data-client-location-dialog-save]"),
      searchBox: dialog?.querySelector("[data-client-location-search-box]"),
      searchInput: dialog?.querySelector("[data-client-location-search]"),
      searchStatus: dialog?.querySelector("[data-client-location-search-status]"),
    };
  }

  function setDirectoryLocationDialogStatus(dialog, text, isError = false) {
    const status = directoryLocationDialogElements(dialog).status;
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  }

  function setDirectoryLocationDialogPoint(dialog, lat, lon, { focus = true } = {}) {
    const elements = directoryLocationDialogElements(dialog);
    const api = elements.map?._clientLocationDialogApi;
    if (!api || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const nextLat = Number(lat.toFixed(6));
    const nextLon = Number(lon.toFixed(6));
    dialog.dataset.lat = String(nextLat);
    dialog.dataset.lon = String(nextLon);
    if (!api.marker) {
      api.marker = window.L.marker([nextLat, nextLon], {
        draggable: true,
        icon: markerIcon(dialog.dataset.clientName || "Клиент", dialog.dataset.clientIcon || "", "", { draggable: true }),
        zIndexOffset: 2000,
      }).addTo(api.map);
      api.marker.on("dragend", () => {
        const point = api.marker?.getLatLng();
        if (point) setDirectoryLocationDialogPoint(dialog, point.lat, point.lng, { focus: false });
      });
    } else {
      api.marker.setLatLng([nextLat, nextLon]);
      api.marker.setIcon(markerIcon(dialog.dataset.clientName || "Клиент", dialog.dataset.clientIcon || "", "", { draggable: true }));
    }
    if (focus) api.map.setView([nextLat, nextLon], PICK_ZOOM);
    if (elements.save) elements.save.disabled = false;
    setDirectoryLocationDialogStatus(dialog, `Точка: ${nextLat}, ${nextLon}`);
  }

  function ensureDirectoryLocationDialogMap(dialog) {
    const container = directoryLocationDialogElements(dialog).map;
    if (!container || !window.L) return null;
    if (container._clientLocationDialogApi) {
      scheduleInvalidate(container._clientLocationDialogApi);
      return container._clientLocationDialogApi;
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
    const api = { container, map, marker: null };
    container._clientLocationDialogApi = api;
    map.on("click", (event) => {
      setDirectoryLocationDialogPoint(dialog, event.latlng.lat, event.latlng.lng);
    });
    if (window.ResizeObserver) {
      api.resizeObserver = new ResizeObserver(() => scheduleInvalidate(api));
      api.resizeObserver.observe(container);
    }
    scheduleInvalidate(api);
    return api;
  }

  async function openDirectoryLocationDialog(trigger) {
    const dialog = document.querySelector("[data-client-location-dialog]");
    if (!dialog) return;
    const elements = directoryLocationDialogElements(dialog);
    dialog._locationTrigger = trigger;
    dialog.dataset.clientId = trigger.dataset.clientId || "";
    dialog.dataset.clientName = trigger.dataset.clientName || "Клиент";
    dialog.dataset.clientIcon = trigger.dataset.clientIcon || "";
    dialog.dataset.saveUrl = trigger.dataset.saveUrl || `/api/clients/${encodeURIComponent(dialog.dataset.clientId)}/location`;
    dialog.dataset.csrf = trigger.dataset.csrf || csrfToken(trigger);
    dialog.dataset.address = trigger.dataset.clientAddress || "";
    dialog.dataset.lat = "";
    dialog.dataset.lon = "";
    if (elements.title) elements.title.textContent = `Локация: ${dialog.dataset.clientName}`;
    if (elements.save) {
      elements.save.disabled = true;
      elements.save.textContent = "Сохранить точку";
    }
    if (elements.searchInput) elements.searchInput.value = dialog.dataset.address;
    if (elements.searchStatus) elements.searchStatus.textContent = "";
    closeLocationSuggest(elements.searchBox);
    setDirectoryLocationDialogStatus(dialog, "Нажмите на карту, чтобы поставить точку.");
    if (!dialog.open) dialog.showModal();
    const api = ensureDirectoryLocationDialogMap(dialog);
    if (!api) {
      setDirectoryLocationDialogStatus(dialog, "Карта не загрузилась. Обновите страницу и попробуйте ещё раз.", true);
      return;
    }
    if (api.marker) {
      api.map.removeLayer(api.marker);
      api.marker = null;
    }
    api.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    scheduleInvalidate(api);
    const lat = Number.parseFloat(trigger.dataset.clientLat || "");
    const lon = Number.parseFloat(trigger.dataset.clientLon || "");
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      setDirectoryLocationDialogPoint(dialog, lat, lon);
      return;
    }
    if (!dialog.dataset.address) return;
    setDirectoryLocationDialogStatus(dialog, "Ищем адрес клиента на карте...");
    const clientId = dialog.dataset.clientId;
    let point = null;
    try {
      point = await geocodeAddress(dialog.dataset.address);
    } catch {}
    if (!dialog.open || dialog.dataset.clientId !== clientId) return;
    if (point) {
      setDirectoryLocationDialogPoint(dialog, point.lat, point.lon);
      setDirectoryLocationDialogStatus(dialog, "Адрес найден. Уточните точку и сохраните.");
    } else {
      setDirectoryLocationDialogStatus(dialog, "Адрес не найден. Поставьте точку вручную.");
    }
  }

  function closeDirectoryLocationDialog(dialog) {
    if (!dialog?.open) return;
    dialog.close();
    dialog._locationTrigger = null;
  }

  function updateSavedDirectoryLocation(dialog, payload, address) {
    const trigger = dialog._locationTrigger;
    const clientId = dialog.dataset.clientId || "";
    const latitude = String(payload.latitude || dialog.dataset.lat || "");
    const longitude = String(payload.longitude || dialog.dataset.lon || "");
    if (trigger) {
      trigger.dataset.clientLat = latitude;
      trigger.dataset.clientLon = longitude;
      trigger.dataset.clientAddress = address;
      trigger.innerHTML = '<span class="client-location-state client-location-state--yes" role="img" aria-label="Локация указана" title="Локация указана">✓</span>';
    }
    document.querySelectorAll("[data-client-overview-point]").forEach((row) => {
      if (String(row.dataset.clientId || "") !== clientId) return;
      row.dataset.lat = latitude;
      row.dataset.lon = longitude;
      row.dataset.address = address;
      const addressCell = row.querySelector(".clients-map-address-text");
      if (addressCell) addressCell.textContent = address || "Адрес не указан";
      const locationCell = row.querySelector(".clients-map-location-cell");
      if (locationCell) {
        locationCell.innerHTML = '<span class="client-location-state client-location-state--yes" role="img" aria-label="Локация указана" title="Локация указана">✓</span>';
      }
    });
  }

  async function saveDirectoryLocationDialog(dialog) {
    const elements = directoryLocationDialogElements(dialog);
    const latitude = Number.parseFloat(dialog.dataset.lat || "");
    const longitude = Number.parseFloat(dialog.dataset.lon || "");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setDirectoryLocationDialogStatus(dialog, "Сначала выберите точку на карте.", true);
      return;
    }
    if (elements.save) {
      elements.save.disabled = true;
      elements.save.textContent = "Сохраняем...";
    }
    setDirectoryLocationDialogStatus(dialog, "Определяем адрес и сохраняем точку...");
    let address = dialog.dataset.address || "";
    try {
      address = (await reverseAddress(latitude, longitude)) || address;
    } catch {}
    try {
      const response = await fetch(dialog.dataset.saveUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": dialog.dataset.csrf || csrfToken(dialog),
        },
        body: JSON.stringify({
          latitude,
          longitude,
          address,
          map_icon: dialog.dataset.clientIcon || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "save_failed");
      const savedAddress = String(payload.address || address || "");
      updateSavedDirectoryLocation(dialog, payload, savedAddress);
      setDirectoryLocationDialogStatus(dialog, "Точка сохранена.");
      if (elements.save) elements.save.textContent = "Сохранено";
      document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
      window.setTimeout(() => closeDirectoryLocationDialog(dialog), 550);
    } catch {
      setDirectoryLocationDialogStatus(dialog, "Не удалось сохранить точку. Попробуйте ещё раз.", true);
      if (elements.save) {
        elements.save.disabled = false;
        elements.save.textContent = "Сохранить точку";
      }
    }
  }

  document.addEventListener("dblclick", (event) => {
    const trigger = event.target.closest?.("[data-client-location-dialog-trigger]");
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    void openDirectoryLocationDialog(trigger);
  });

  document.addEventListener("keydown", (event) => {
    const trigger = event.target.closest?.("[data-client-location-dialog-trigger]");
    if (!trigger || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    void openDirectoryLocationDialog(trigger);
  });

  document.addEventListener("click", (event) => {
    const close = event.target.closest?.("[data-client-location-dialog-close]");
    const save = event.target.closest?.("[data-client-location-dialog-save]");
    const dialog = (close || save)?.closest("[data-client-location-dialog]");
    if (!dialog) return;
    event.preventDefault();
    if (close) closeDirectoryLocationDialog(dialog);
    if (save) void saveDirectoryLocationDialog(dialog);
  });

  document.addEventListener("click", (event) => {
    const quickLocationPick = event.target.closest?.("[data-client-map-location-pick]");
    const pickerCancel = event.target.closest?.("[data-clients-map-point-picker-cancel]");
    const pickerSave = event.target.closest?.("[data-clients-map-point-picker-save]");
    if (!quickLocationPick && !pickerCancel && !pickerSave) return;
    event.preventDefault();
    event.stopPropagation();
    if (quickLocationPick) {
      void startOverviewLocationPicker(quickLocationPick);
      return;
    }
    const container = (pickerCancel || pickerSave).closest("[data-clients-overview-map]");
    if (pickerCancel) {
      stopOverviewLocationPicker(container?._clientsOverviewApi);
    } else {
      void saveOverviewLocationPicker(container?._clientsOverviewApi);
    }
  }, true);

  document.addEventListener("click", (event) => {
    const documentMenuToggle = event.target.closest("[data-client-document-menu-toggle]");
    if (documentMenuToggle) {
      event.preventDefault();
      const menu = documentMenuToggle.closest("[data-client-document-menu]");
      const list = menu?.querySelector("[data-client-document-menu-list]");
      if (!menu || !list) return;
      const willOpen = list.hidden;
      closeClientDocumentMenus(menu);
      list.hidden = !willOpen;
      documentMenuToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      return;
    }

    if (!event.target.closest("[data-client-document-menu]")) {
      closeClientDocumentMenus();
    }

    if (!event.target.closest("[data-client-directory-segment-picker]")) {
      document.querySelectorAll("[data-client-directory-segment-picker] details[open]").forEach((details) => {
        details.open = false;
      });
    }

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

    const searchRun = event.target.closest("[data-client-location-search-run]");
    if (searchRun) {
      event.preventDefault();
      void runClientLocationSearch(searchRun.closest("[data-client-location-search-box]"));
      return;
    }

    const suggestPick = event.target.closest("[data-client-location-pick]");
    if (suggestPick) {
      event.preventDefault();
      const box = suggestPick.closest("[data-client-location-search-box]");
      const label = suggestPick.dataset.label || "";
      const input = box?.querySelector("[data-client-location-search]");
      if (input) input.value = label;
      closeLocationSuggest(box);
      void applyClientLocationPoint(
        box,
        Number.parseFloat(suggestPick.dataset.lat),
        Number.parseFloat(suggestPick.dataset.lon),
        label
      );
      return;
    }

    if (!event.target.closest("[data-client-location-search-box]")) {
      document.querySelectorAll("[data-client-location-search-box]").forEach(closeLocationSuggest);
    }

    const button = event.target.closest("[data-client-geolocate]");
    if (button) {
      const form = button.closest("form");
      if (!form) return;
      event.preventDefault();
      locate(form);
      return;
    }
    const quickLocationEdit = event.target.closest("[data-client-map-quick-edit]");
    if (event.target.closest("[data-workspace-tab], [data-workspace-card], [data-workspace-trigger]")) {
      setTimeout(() => {
        initializeMaps();
        refreshMaps();
        if (quickLocationEdit) focusClientLocationPanel();
      }, 160);
    }
  });

  let locationSuggestTimer = 0;

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeClientDocumentMenus();
      document.querySelectorAll("[data-client-directory-segment-picker] details[open]").forEach((details) => {
        details.open = false;
      });
    }
    if (!event.target.matches?.("[data-client-location-search]")) return;
    const box = event.target.closest("[data-client-location-search-box]");
    if (event.key === "Enter") {
      // Поле живёт внутри карточки клиента — без этого Enter отправил бы её форму.
      event.preventDefault();
      window.clearTimeout(locationSuggestTimer);
      void runClientLocationSearch(box);
    } else if (event.key === "Escape") {
      closeLocationSuggest(box);
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-client-photo-url]")) {
      window.clearTimeout(event.target._clientPhotoPreviewTimer);
      event.target._clientPhotoPreviewTimer = window.setTimeout(() => {
        renderClientPhotoPreview(event.target, String(event.target.value || "").trim());
      }, 250);
    }
    if (event.target.matches("[data-client-program-search]")) {
      filterProgramDropdown(event.target);
    }
    if (event.target.matches("[data-client-segment-search]")) {
      filterSegmentPicker(event.target);
    }
    if (event.target.matches("[data-client-location-search]")) {
      const box = event.target.closest("[data-client-location-search-box]");
      // Подсказки тянем из внешнего сервиса, поэтому ждём паузы в наборе,
      // а не дёргаем запрос на каждую букву.
      window.clearTimeout(locationSuggestTimer);
      locationSuggestTimer = window.setTimeout(() => void suggestClientLocation(box), 350);
    }
    if (event.target.matches("[data-clients-map-search]") || event.target.closest("[data-clients-map-filter]")) {
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
    if (event.target.matches("[data-client-directory-select-all]")) {
      directoryClientCheckboxes().forEach((checkbox) => {
        checkbox.checked = event.target.checked;
      });
      syncDirectoryClientSelection();
      return;
    }
    if (event.target.matches("[data-client-directory-select]")) {
      syncDirectoryClientSelection();
    }
    if (event.target.matches("[data-client-photo-file]")) {
      const [file] = event.target.files || [];
      const fallbackUrl = event.target.closest("form")?.querySelector("[data-client-photo-url]")?.value?.trim() || "";
      renderClientPhotoPreview(event.target, file ? URL.createObjectURL(file) : fallbackUrl, Boolean(file));
    }
    const segmentPicker = event.target.closest?.("[data-client-segment-picker]");
    if (segmentPicker && event.target.matches("[data-client-segment-option]")) {
      syncSegmentPicker(segmentPicker);
    }
    const directorySegmentPicker = event.target.closest?.("[data-client-directory-segment-picker]");
    if (directorySegmentPicker && event.target.matches("[data-client-directory-segment-option]")) {
      syncDirectorySegmentPicker(directorySegmentPicker);
      setDirectorySegmentStatus(directorySegmentPicker, "");
      queueDirectorySegmentSave(directorySegmentPicker);
    }
    const programDropdown = event.target.closest?.("[data-client-program-dropdown]");
    if (programDropdown && event.target.matches('input[name="programs"], [data-clients-map-program]')) {
      syncProgramDropdown(programDropdown);
    }
    if (event.target.matches("[data-clients-map-select-all]")) {
      const section = event.target.closest("#clients-map");
      visibleMapRowCheckboxes(section).forEach((checkbox) => {
        checkbox.checked = event.target.checked;
      });
      syncClientsMapSelectAll(section);
      section?.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
      return;
    }
    if (event.target.matches("[data-client-map-select]") || event.target.closest("[data-clients-map-filter]")) {
      syncClientsMapSelectAll(event.target.closest("#clients-map"));
      document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
    }
    if (event.target.matches("[data-client-map-icon], [data-client-segment-select], [data-client-segment-option], input[name='industry'], input[name='name']")) {
      const form = event.target.closest("form");
      refreshEditableMarker(form);
    }
  });

  document.addEventListener("change", (event) => {
    const pageSizeSelect = event.target.closest("[data-clients-map-page-size-select]");
    if (!pageSizeSelect) return;
    const section = pageSizeSelect.closest("#clients-map");
    if (!section) return;
    section.dataset.clientsMapPage = "1";
    section.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
  });

  document.addEventListener("click", (event) => {
    const mapPageButton = event.target.closest("[data-clients-map-page]");
    if (mapPageButton) {
      event.preventDefault();
      if (mapPageButton.disabled) return;
      const section = mapPageButton.closest("#clients-map");
      if (!section) return;
      section.dataset.clientsMapPage = mapPageButton.dataset.clientsMapPage || "1";
      section.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
      return;
    }
    const locationFilter = event.target.closest("[data-clients-map-location-filter]");
    if (locationFilter) {
      event.preventDefault();
      const section = locationFilter.closest("#clients-map");
      if (!section) return;
      section.querySelectorAll("[data-clients-map-location-filter]").forEach((button) => {
        const active = button === locationFilter;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      section.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
      return;
    }
    const clear = event.target.closest("[data-clients-map-clear]");
    if (!clear) return;
    const section = clear.closest("#clients-map");
    if (!section) return;
    section.querySelectorAll("[data-clients-map-search], [data-clients-map-filter] select").forEach((field) => {
      field.value = "";
    });
    section.querySelectorAll("[data-clients-map-program], [data-clients-map-segment]").forEach((checkbox) => {
      checkbox.checked = false;
    });
    section.querySelectorAll("[data-clients-map-program-filter]").forEach(syncProgramDropdown);
    section.querySelectorAll("[data-clients-map-location-filter]").forEach((button) => {
      const active = !button.dataset.clientsMapLocationFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-client-map-select]").forEach((checkbox) => {
      checkbox.checked = false;
    });
    syncClientsMapSelectAll(section);
    document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
  });

  document.addEventListener("focusin", (event) => {
    const form = event.target.closest?.("form");
    if (form?.querySelector("[data-client-map]")) ensureMap(form);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.querySelector("[data-client-map]")) return;
    if (form.dataset.clientLocationNoSubmit === "1") return;
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
    highlightClientSearchMatches();
    syncDirectoryClientSelection();
    initializeProgramDropdowns();
    initializeSegmentPickers();
    initializeDirectorySegmentPickers();
    showClientSection();
    initializeMaps();
    setTimeout(refreshMaps, 250);
    if (new URLSearchParams(window.location.search).get("focus") === "location") {
      setTimeout(focusClientLocationPanel, 320);
    }
  });

  document.addEventListener("toggle", (event) => {
    // Список сегментов подставляется при открытии — и в карте, и в таблице
    // клиентов: держать его копию в каждой строке слишком дорого.
    const details = event.target.closest?.(
      "[data-client-map-segment-picker] details, [data-client-directory-segment-picker] details",
    );
    if (!details?.open) return;
    hydrateDirectorySegmentPicker(
      details.closest("[data-client-map-segment-picker], [data-client-directory-segment-picker]"),
    );
  }, true);

  // ── Попап настройки фильтра карты ───────────────────────────────────────
  // Все фильтры собраны в одном окне, выбранный набор сохраняется как шаблон
  // рабочего пространства и подставляется при следующем открытии.

  function clientsMapSection() {
    return document.querySelector("#clients-map");
  }

  function readClientsMapFilterState(section) {
    if (!section) return null;
    return {
      type: section.querySelector("[data-clients-map-type]")?.value || "",
      category: section.querySelector("[data-clients-map-category]")?.value || "",
      status: section.querySelector("[data-clients-map-status]")?.value || "",
      location: section.querySelector("[data-clients-map-location-select]")?.value || "",
      programs: [...section.querySelectorAll("[data-clients-map-program]:checked")].map((input) => input.value),
      segments: [...section.querySelectorAll("[data-clients-map-segment]:checked")].map((input) => input.value),
    };
  }

  function applyClientsMapLocation(section, value) {
    // Кнопки-счётчики под таблицей остаются источником истины для карты,
    // поэтому выбор в попапе переводим в их состояние.
    section.querySelectorAll("[data-clients-map-location-filter]").forEach((button) => {
      const active = (button.dataset.clientsMapLocationFilter || "") === (value || "");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function applyClientsMapFilterState(section, state) {
    if (!section || !state) return;
    const setValue = (selector, value) => {
      const field = section.querySelector(selector);
      if (field) field.value = value || "";
    };
    setValue("[data-clients-map-type]", state.type);
    setValue("[data-clients-map-category]", state.category);
    setValue("[data-clients-map-status]", state.status);
    setValue("[data-clients-map-location-select]", state.location);
    const programs = new Set(Array.isArray(state.programs) ? state.programs : []);
    section.querySelectorAll("[data-clients-map-program]").forEach((checkbox) => {
      checkbox.checked = programs.has(checkbox.value);
    });
    const segments = new Set(Array.isArray(state.segments) ? state.segments : []);
    section.querySelectorAll("[data-clients-map-segment]").forEach((checkbox) => {
      checkbox.checked = segments.has(checkbox.value);
    });
    applyClientsMapLocation(section, state.location);
  }

  const CLIENTS_MAP_LOCATION_LABELS = {
    coords: "с координатами",
    address: "только адрес",
    missing: "без локации",
  };

  function syncClientsMapFilterBar(section) {
    if (!section) return;
    const state = readClientsMapFilterState(section);
    const parts = [];
    if (state.type) parts.push(state.type === "company" ? "Компании" : "Физлица");
    if (state.category) parts.push(state.category);
    if (state.status) parts.push(state.status === "active" ? "Активные" : "Неактивные");
    if (state.location) parts.push(CLIENTS_MAP_LOCATION_LABELS[state.location] || state.location);
    if (state.programs.length) parts.push(`программы: ${state.programs.length}`);
    if (state.segments.length) parts.push(`сегменты: ${state.segments.length}`);
    const ownership = section.querySelector('[data-clients-map-ownership][aria-pressed="true"]')?.dataset.clientsMapOwnership || "";
    if (ownership === "ours") parts.push("наши клиенты");
    if (ownership === "others") parts.push("не наши");
    const summary = section.querySelector("[data-clients-map-filter-summary]");
    if (summary) summary.textContent = parts.length ? parts.join(" · ") : "Без фильтров";
    const counter = section.querySelector("[data-clients-map-filter-count]");
    if (counter) {
      counter.textContent = String(parts.length);
      counter.hidden = parts.length === 0;
    }
  }

  function setClientsMapFilterStatus(section, message, tone = "") {
    const status = section?.querySelector("[data-clients-map-filter-status]");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.tone = tone;
  }

  async function saveClientsMapFilter(section) {
    const state = readClientsMapFilterState(section);
    setClientsMapFilterStatus(section, "Сохраняю…");
    try {
      const response = await fetch("/api/settings/clients-map-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken(section) },
        body: JSON.stringify({ filter: state }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(payload.error || "Не удалось сохранить");
      section.dataset.clientsMapSavedFilter = JSON.stringify(payload.filter || state);
      setClientsMapFilterStatus(section, "Шаблон сохранён", "ok");
      return true;
    } catch (error) {
      setClientsMapFilterStatus(section, error.message || "Не удалось сохранить", "error");
      return false;
    }
  }

  document.addEventListener("click", (event) => {
    const section = event.target.closest?.("#clients-map");
    if (!section) return;
    const dialog = section.querySelector("[data-clients-map-filter-dialog]");

    if (event.target.closest("[data-clients-map-filter-open]")) {
      event.preventDefault();
      if (dialog && !dialog.open) dialog.showModal();
      syncClientsMapFilterBar(section);
      setClientsMapFilterStatus(section, "");
      return;
    }

    if (event.target.closest("[data-clients-map-filter-close]")) {
      event.preventDefault();
      dialog?.close();
      return;
    }

    if (event.target.closest("[data-clients-map-clear]")) {
      // Сброс меняет поля напрямую, без событий — строку сводки обновляем сами.
      window.setTimeout(() => syncClientsMapFilterBar(section), 0);
      return;
    }

    if (event.target.closest("[data-clients-map-filter-save]")) {
      event.preventDefault();
      saveClientsMapFilter(section).then((ok) => {
        if (ok) window.setTimeout(() => dialog?.close(), 500);
      });
    }
  });

  document.addEventListener("change", (event) => {
    const section = event.target.closest?.("#clients-map");
    if (!section) return;
    if (event.target.matches("[data-clients-map-location-select]")) {
      applyClientsMapLocation(section, event.target.value);
      document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
    }
    if (event.target.closest("[data-clients-map-filter]")) {
      syncClientsMapFilterBar(section);
      syncMapShowAll(section);
    }
  });

  document.addEventListener("click", (event) => {
    // Клик по кнопке-счётчику под таблицей должен отражаться в попапе.
    const button = event.target.closest?.("[data-clients-map-location-filter]");
    if (!button) return;
    const section = button.closest("#clients-map");
    const select = section?.querySelector("[data-clients-map-location-select]");
    if (select) select.value = button.dataset.clientsMapLocationFilter || "";
    syncClientsMapFilterBar(section);
  });

  function syncMapShowAll(section) {
    const button = section?.querySelector("[data-clients-map-show-all]");
    if (!button) return;
    const state = readClientsMapFilterState(section);
    const ownership = section.querySelector('[data-clients-map-ownership][aria-pressed="true"]')?.dataset.clientsMapOwnership || "";
    const anything = Boolean(
      state.type || state.category || state.status || state.location
      || state.programs.length || state.segments.length || ownership
    );
    button.hidden = !anything;
  }

  document.addEventListener("click", (event) => {
    const ownershipButton = event.target.closest?.("[data-clients-map-ownership]");
    if (ownershipButton) {
      event.preventDefault();
      const section = ownershipButton.closest("#clients-map");
      if (!section) return;
      section.querySelectorAll("[data-clients-map-ownership]").forEach((item) => {
        item.setAttribute("aria-pressed", item === ownershipButton ? "true" : "false");
      });
      syncClientsMapFilterBar(section);
      syncMapShowAll(section);
      document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
      return;
    }

    const showAll = event.target.closest?.("[data-clients-map-show-all]");
    if (!showAll) return;
    event.preventDefault();
    const section = showAll.closest("#clients-map");
    if (!section) return;
    // Одной кнопкой снимаем все условия: человек видит всю базу на карте.
    applyClientsMapFilterState(section, {
      type: "", category: "", status: "", location: "", programs: [], segments: [],
    });
    section.querySelectorAll("[data-clients-map-ownership]").forEach((item) => {
      item.setAttribute("aria-pressed", item.dataset.clientsMapOwnership ? "false" : "true");
    });
    const search = section.querySelector("[data-clients-map-search]");
    if (search) search.value = "";
    syncClientsMapFilterBar(section);
    syncMapShowAll(section);
    document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
  });

  function restoreClientsMapFilter() {
    const section = clientsMapSection();
    if (!section || section.dataset.clientsMapFilterRestored === "1") return;
    section.dataset.clientsMapFilterRestored = "1";
    let saved = null;
    try {
      saved = JSON.parse(section.dataset.clientsMapSavedFilter || "null");
    } catch (error) {
      saved = null;
    }
    if (saved && typeof saved === "object") applyClientsMapFilterState(section, saved);
    syncClientsMapFilterBar(section);
    syncMapShowAll(section);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreClientsMapFilter);
  } else {
    restoreClientsMapFilter();
  }

  // ── Определение локаций по адресам ──────────────────────────────────────
  // Адреса разбирает OpenStreetMap, у него не больше одного обращения в
  // секунду. Проход идёт в фоне, поэтому показываем, сколько сделано.

  let locationsPollTimer = 0;

  function setLocationsStatus(section, text) {
    const node = section?.querySelector("[data-clients-locations-status]")
      || document.querySelector("[data-clients-locations-status]");
    if (node) node.textContent = text || "";
  }

  function describeLocationsProgress(payload) {
    const progress = payload?.progress || {};
    if (payload?.running) {
      const done = Number(progress.done || 0);
      const total = Number(progress.total || 0);
      const found = Number(progress.found || 0);
      const left = Math.max(0, total - done);
      const minutes = Math.max(1, Math.round((left * 1.1) / 60));
      return `Определяю локации: ${done} из ${total}, найдено ${found}. Осталось около ${minutes} мин.`;
    }
    if (progress.status === "error") {
      return `Определение локаций прервано: ${progress.error || "неизвестная причина"}`;
    }
    const pending = Number(payload?.pending || 0);
    if (progress.status === "ok" && Number(progress.total || 0)) {
      return `Готово: найдено ${Number(progress.found || 0)} из ${Number(progress.total || 0)}.`
        + (pending ? ` Без локации осталось ${pending} — у них адрес не распознан.` : "");
    }
    if (!pending) return "У всех клиентов с адресом есть локация.";
    return `Без локации: ${pending} клиентов с адресом.`;
  }

  async function pollLocationsStatus(section, { keep = false } = {}) {
    try {
      const payload = await fetch("/api/clients/locations/status", {
        headers: { Accept: "application/json" },
      }).then((response) => response.json());
      setLocationsStatus(section, describeLocationsProgress(payload));
      window.clearTimeout(locationsPollTimer);
      if (payload?.running) {
        locationsPollTimer = window.setTimeout(() => pollLocationsStatus(section, { keep: true }), 5000);
      } else if (keep) {
        // Проход закончился — обновляем карту, чтобы точки появились.
        document.querySelectorAll("[data-clients-overview-map]").forEach((container) => ensureOverviewMap(container));
      }
    } catch (error) {
      setLocationsStatus(section, "Не удалось узнать ход работы");
    }
  }

  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest?.("[data-clients-locations-fill]");
    if (!trigger) return;
    event.preventDefault();
    const section = trigger.closest("#clients-map") || document;
    // Кнопка живёт в шапке списка клиентов, а не только на вкладке карты.
    trigger.disabled = true;
    setLocationsStatus(section, "Запускаю…");
    try {
      const response = await fetch("/api/clients/locations/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken(section) },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        setLocationsStatus(section, payload.error || "Не удалось запустить");
      } else if (!payload.pending) {
        setLocationsStatus(section, payload.message || "Определять нечего");
      } else {
        setLocationsStatus(
          section,
          `Запущено для ${payload.pending} клиентов. Займёт около ${payload.estimated_minutes} мин.`
        );
        pollLocationsStatus(section, { keep: true });
      }
    } catch (error) {
      setLocationsStatus(section, "Не удалось запустить");
    } finally {
      trigger.disabled = false;
    }
  });

  function initClientsLocations() {
    if (!document.querySelector("[data-clients-locations-fill]")) return;
    pollLocationsStatus(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initClientsLocations);
  } else {
    initClientsLocations();
  }

  window.addEventListener("hashchange", () => {
    unpackClientsMapRows();
    showClientSection();
    setTimeout(refreshMaps, 160);
    if (new URLSearchParams(window.location.search).get("focus") === "location") {
      setTimeout(focusClientLocationPanel, 220);
    }
  });
})();

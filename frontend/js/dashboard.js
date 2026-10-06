(function (window, document) {
  "use strict";

  const COLORS = ["#16866b", "#4faf83", "#91c6a2", "#427d72", "#b5c46b", "#558c4c", "#749c94", "#b6d3c4"];
  const CROP_DISPLAY = {
    rice: { label: "ข้าว", color: "#14866d", icon: "assets/dashboard/rice.svg" },
    maize: { label: "ข้าวโพด", color: "#e5a82a", icon: "assets/dashboard/maize.svg" },
  };
  const cropDisplay = (crop) => CROP_DISPLAY[crop] || { label: crop || "ไม่ระบุ", color: null, icon: null };
  const cropColor = (crop, index) => cropDisplay(crop).color || COLORS[index % COLORS.length];
  const thaiDate = (date) => {
    const [year, month, day] = date.split("-").map(Number);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year + 543}`;
  };
  const GEOMETRY_ZOOM = 14;
  const el = (id) => document.getElementById(id);
  const number = (value) => new Intl.NumberFormat("th-TH").format(value);
  const params = new URLSearchParams(window.location.search);
  const initialDays = ["7", "14", "30"].includes(params.get("days")) ? Number(params.get("days")) : 7;
  const state = {
    filters: { tambon: params.get("tambon") || "", crop: params.get("crop") || "", days: initialDays },
    revision: 0, refreshController: null, geometryController: null,
    geometryTimer: null, isRefreshing: false, points: [], cropChart: null, dailyChart: null,
    selectedParcelId: null, selectionRevision: 0, snapshotVersion: null, searchResults: [], searchIndex: -1,
  };
  const markerById = new Map();
  const polygonById = new Map();
  const loadedPhotos = new Map();
  const MAX_LOADED_PHOTOS = 25;
  window.addEventListener("pagehide", () => {
    for (const image of loadedPhotos.values()) URL.revokeObjectURL(image.src);
    loadedPhotos.clear();
  });
  let disposePopupPhotos = null;
  const map = window.L.map("dashboard-map", { zoomControl: true }).setView([19.03, 99.89], 10);
  const selectedPopup = window.L.popup({ autoPan: true, keepInView: true });
  window.L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
    maxZoom: 19, attribution: "Map data © Google",
  }).addTo(map);
  const clusters = window.L.markerClusterGroup({
    showCoverageOnHover: false,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size = count < 10 ? "small" : count < 100 ? "medium" : "large";
      const pixels = size === "small" ? 36 : size === "medium" ? 43 : 50;
      return window.L.divIcon({ html: `<span class="parcel-cluster ${size}">${number(count)}</span>`,
        className: "", iconSize: [pixels, pixels] });
    },
  }).addTo(map);
  const polygons = window.L.geoJSON(null, {
    style: { color: "#0e7458", weight: 2, fillColor: "#46aa7b", fillOpacity: 0.13 },
    onEachFeature(feature, layer) {
      polygonById.set(feature.properties.parcelId, layer);
      layer.on("click", (event) => {
        state.selectionRevision += 1;
        selectParcel(feature.properties.parcelId);
        showSelectedPopup(feature.properties, event.latlng);
      });
      layer.on("mouseover", () => layer.setStyle({ weight: 4, fillOpacity: 0.22 }));
      layer.on("mouseout", () => { polygons.resetStyle(layer); highlightSelected(); });
      if (feature.properties.parcelId === state.selectedParcelId) highlightSelected();
    },
  }).addTo(map);

  function highlightSelected() {
    const selected = polygonById.get(state.selectedParcelId);
    if (selected) selected.setStyle({ color: "#07543f", weight: 4, fillColor: "#46aa7b", fillOpacity: 0.27 });
  }

  function selectParcel(parcelId) {
    if (state.selectedParcelId !== parcelId) {
      const previous = polygonById.get(state.selectedParcelId);
      if (previous) polygons.resetStyle(previous);
    }
    state.selectedParcelId = parcelId;
    highlightSelected();
  }

  function showSelectedPopup(parcel, position) {
    disposePopupPhotos?.();
    const target = position || [parcel.lat, parcel.lng];
    selectedPopup.options.maxHeight = Math.max(180, map.getSize().y - 100);
    selectedPopup.setLatLng(target).setContent(popup(parcel)).openOn(map);
  }

  function focusParcel(parcel) {
    const selectionRevision = ++state.selectionRevision;
    selectParcel(parcel.parcelId);
    const target = window.L.latLng(parcel.lat, parcel.lng);
    const zoom = Math.max(map.getZoom(), 16);
    const open = () => {
      if (selectionRevision === state.selectionRevision) showSelectedPopup(parcel, target);
    };
    if (map.getZoom() === zoom && map.getCenter().distanceTo(target) < 15) {
      open();
      return Promise.resolve();
    } else {
      const finished = new Promise((resolve) => map.once("moveend", () => { open(); resolve(); }));
      map.flyTo(target, zoom, { duration: 0.45 });
      return finished;
    }
  }

  function thaiPlantingDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "-";
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year + 543}` : "-";
  }

  function popup(parcel) {
    const pendingControllers = new Set();
    const popupController = new AbortController();
    let disposed = false;
    disposePopupPhotos = () => {
      disposed = true;
      popupController.abort();
      for (const controller of pendingControllers) controller.abort();
      pendingControllers.clear();
    };
    const root = document.createElement("div");
    root.className = "parcel-popup";
    const gallery = document.createElement("div");
    gallery.className = "parcel-popup-gallery";
    const photo = document.createElement("div");
    photo.className = "parcel-popup-photo";
    gallery.appendChild(photo);
    const photoCount = Number.isInteger(parcel.photoCount) ? parcel.photoCount : 0;
    if (photoCount > 0) {
      const images = new Map();
      let activeIndex = 0;
      let preloadStarted = false;
      let previous;
      let next;
      let counter;
      const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);
      const wait = (ms) => new Promise((resolve, reject) => {
        if (popupController.signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
        const timer = window.setTimeout(() => {
          popupController.signal.removeEventListener("abort", cancel);
          resolve();
        }, ms);
        function cancel() {
          window.clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }
        popupController.signal.addEventListener("abort", cancel, { once: true });
      });
      const imageKey = (index) => JSON.stringify([state.snapshotVersion, parcel.parcelCode, index]);
      async function fetchPhoto(index) {
        const url = new URL(`${window.AppConfig.apiBaseUrl}/public/dashboard/images/${encodeURIComponent(parcel.parcelCode)}/${index}`);
        if (state.snapshotVersion) url.searchParams.set("snapshot", state.snapshotVersion);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (popupController.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const controller = new AbortController();
          pendingControllers.add(controller);
          let timedOut = false;
          const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 35000);
          const cancel = () => controller.abort();
          popupController.signal.addEventListener("abort", cancel, { once: true });
          try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
              const error = new Error("Image read failed");
              error.retryable = retryStatuses.has(response.status);
              throw error;
            }
            return await response.blob();
          } catch (error) {
            if (popupController.signal.aborted) throw error;
            const retryable = error.retryable || timedOut || error.name === "TypeError" ||
              (error.name === "AbortError" && controller.signal.aborted);
            if (!retryable || attempt === 2) throw error;
            await wait(500 * (2 ** attempt));
          } finally {
            window.clearTimeout(timeout);
            popupController.signal.removeEventListener("abort", cancel);
            pendingControllers.delete(controller);
          }
        }
      }
      async function loadImage(index) {
        const key = imageKey(index);
        const cached = loadedPhotos.get(key);
        if (cached) {
          loadedPhotos.delete(key);
          loadedPhotos.set(key, cached);
          return cached;
        }
        const blob = await fetchPhoto(index);
        if (disposed) throw new DOMException("Aborted", "AbortError");
        const objectUrl = URL.createObjectURL(blob);
        const image = document.createElement("img");
        image.alt = `รูปภาพแปลง ${parcel.parcelName || "แปลง"} ${index + 1}`;
        try {
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("Invalid image"));
            image.src = objectUrl;
          });
          if (disposed) throw new DOMException("Aborted", "AbortError");
          loadedPhotos.set(key, image);
          if (loadedPhotos.size > MAX_LOADED_PHOTOS) {
            const oldest = loadedPhotos.keys().next().value;
            URL.revokeObjectURL(loadedPhotos.get(oldest).src);
            loadedPhotos.delete(oldest);
          }
          return image;
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          throw error;
        }
      }
      function ensureImage(index) {
        let entry = images.get(index);
        if (entry) return entry.promise;
        entry = { status: "loading", promise: null, image: null };
        images.set(index, entry);
        entry.promise = loadImage(index).then((image) => {
          entry.status = "loaded";
          entry.image = image;
          return image;
        }, (error) => {
          entry.status = "failed";
          throw error;
        });
        return entry.promise;
      }
      async function preloadRemaining() {
        for (let index = 0; index < photoCount && !disposed; index += 1) {
          if (index === activeIndex) continue;
          try { await ensureImage(index); } catch { /* One failed image does not block the rest. */ }
        }
      }
      function showLoading() {
        const spinner = document.createElement("span");
        spinner.className = "parcel-popup-photo-spinner";
        spinner.setAttribute("role", "status");
        spinner.setAttribute("aria-label", "กำลังโหลดรูปภาพ");
        photo.replaceChildren(spinner);
      }
      function showFailure(index) {
        const message = document.createElement("span");
        message.textContent = "โหลดรูปไม่สำเร็จ";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "ลองอีกครั้ง";
        retry.addEventListener("click", (event) => {
          event.stopPropagation();
          images.delete(index);
          showPhoto(index);
        });
        photo.replaceChildren(message, retry);
      }
      function showPhoto(index) {
        if (disposed || index < 0 || index >= photoCount) return;
        activeIndex = index;
        const entry = images.get(index);
        if (entry?.status === "loaded") photo.replaceChildren(entry.image);
        else if (entry?.status === "failed") showFailure(index);
        else showLoading();
        ensureImage(index).then((image) => {
          if (disposed) return;
          if (activeIndex === index) photo.replaceChildren(image);
          if (!preloadStarted && activeIndex === index) {
            preloadStarted = true;
            window.setTimeout(() => { if (!disposed) void preloadRemaining(); }, 0);
          }
        }).catch(() => {
          if (!disposed && activeIndex === index) showFailure(index);
        });
        if (counter) counter.textContent = `${index + 1} / ${photoCount}`;
        if (previous) previous.disabled = index === 0;
        if (next) next.disabled = index === photoCount - 1;
      }
      if (photoCount > 1) {
        const controls = document.createElement("div");
        controls.className = "parcel-popup-gallery-controls";
        const button = (direction, label, icon) => {
          const control = document.createElement("button");
          control.type = "button";
          control.className = `parcel-popup-gallery-${direction}`;
          control.setAttribute("aria-label", label);
          control.innerHTML = `<i class="fa-solid fa-chevron-${icon}" aria-hidden="true"></i>`;
          return control;
        };
        previous = button("previous", "รูปก่อนหน้า", "left");
        next = button("next", "รูปถัดไป", "right");
        previous.addEventListener("click", () => showPhoto(activeIndex - 1));
        next.addEventListener("click", () => showPhoto(activeIndex + 1));
        controls.append(previous, next);
        counter = document.createElement("span");
        counter.className = "parcel-popup-gallery-counter";
        counter.setAttribute("aria-live", "polite");
        gallery.append(controls, counter);
        let touchStart = null;
        photo.addEventListener("touchstart", (event) => {
          if (event.touches.length === 1) touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
          event.stopPropagation();
        }, { passive: true });
        photo.addEventListener("touchmove", (event) => event.stopPropagation(), { passive: true });
        photo.addEventListener("touchend", (event) => {
          event.stopPropagation();
          if (!touchStart || !event.changedTouches.length) return;
          const dx = event.changedTouches[0].clientX - touchStart.x;
          const dy = event.changedTouches[0].clientY - touchStart.y;
          touchStart = null;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) showPhoto(activeIndex + (dx < 0 ? 1 : -1));
        }, { passive: true });
        photo.addEventListener("touchcancel", () => { touchStart = null; });
      }
      showPhoto(0);
    } else {
      photo.textContent = "ไม่มีรูปภาพ";
    }
    root.appendChild(gallery);
    const title = document.createElement("strong");
    title.textContent = parcel.parcelName || parcel.parcelCode || "แปลง";
    root.appendChild(title);
    const details = document.createElement("dl");
    for (const [label, value] of [
      ["พืช", cropDisplay(parcel.crop).label], ["พันธุ์", parcel.variety],
      ["วันที่ปลูก", thaiPlantingDate(parcel.plantingDate)], ["พื้นที่", `${number(parcel.areaRai)} ไร่`],
      ["ตำบล", parcel.tambonName],
    ]) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value ?? "-";
      details.append(dt, dd);
    }
    const dt = document.createElement("dt");
    dt.textContent = "พิกัด";
    const dd = document.createElement("dd");
    const point = { lat: parcel.lat, lng: parcel.lng };
    const isAndroid = /Android/i.test(window.navigator?.userAgent || "");
    const href = window.MapFormatters.coordinateMapHref(point, { isAndroid });
    if (href) {
      const coordinate = document.createElement("a");
      coordinate.className = "coordinate-link";
      coordinate.textContent = window.MapFormatters.formatRepresentativePoint({
        latitude: parcel.lat, longitude: parcel.lng,
      });
      coordinate.href = href;
      coordinate.setAttribute("aria-label", `เปิดพิกัด ${coordinate.textContent} ในแผนที่`);
      if (!isAndroid) {
        coordinate.target = "_blank";
        coordinate.rel = "noopener noreferrer";
      }
      dd.appendChild(coordinate);
    } else {
      dd.textContent = "-";
    }
    details.append(dt, dd);
    root.appendChild(details);
    return root;
  }

  function apiUrl(path, extra = {}) {
    const url = new URL(`${window.AppConfig.apiBaseUrl}/public/dashboard/${path}`);
    if (state.filters.tambon) url.searchParams.set("tambon", state.filters.tambon);
    if (state.filters.crop) url.searchParams.set("crop", state.filters.crop);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    return url;
  }

  async function fetchData(url, signal) {
    const response = await window.fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.success) throw new Error("Invalid dashboard response");
    return data;
  }

  function setError(message) {
    el("dashboard-error").textContent = message;
    el("dashboard-error").hidden = !message;
  }

  function setMapState(message) {
    el("map-state").textContent = message;
    el("map-state").hidden = !message;
  }

  function setOptions(select, options, selected, label, valueOf, textOf) {
    select.replaceChildren();
    select.add(new Option(label, ""));
    for (const item of options) select.add(new Option(textOf(item), valueOf(item)));
    if (selected && !options.some((item) => valueOf(item) === selected)) {
      select.add(new Option(selected, selected));
    }
    select.value = selected;
  }

  function renderDailyTooltip(model, daily) {
    const tooltip = el("daily-tooltip");
    if (!model || model.opacity === 0 || !model.dataPoints?.length) {
      tooltip.hidden = true;
      return;
    }
    const day = daily[model.dataPoints[0].dataIndex];
    if (!day) return;
    tooltip.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = thaiDate(day.date);
    tooltip.appendChild(heading);
    const counts = new Map((day.crops || []).map((crop) => [crop.name, crop.count]));
    const crops = ["rice", "maize"].map((name) => ({ name, count: counts.get(name) || 0 }))
      .concat((day.crops || []).filter((crop) => crop.name !== "rice" && crop.name !== "maize" && crop.count > 0));
    for (const [index, crop] of crops.entries()) {
      const row = document.createElement("div");
      row.className = "daily-tooltip-row";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.backgroundColor = cropColor(crop.name, index);
      const name = document.createElement("span");
      name.textContent = cropDisplay(crop.name).label;
      const count = document.createElement("b");
      count.textContent = `${number(crop.count)} แปลง`;
      row.append(swatch, name, count);
      tooltip.appendChild(row);
    }
    const total = document.createElement("div");
    total.className = "daily-tooltip-row daily-tooltip-total";
    const label = document.createElement("span");
    label.textContent = "รวม";
    const count = document.createElement("b");
    count.textContent = `${number(day.count)} แปลง`;
    total.append(label, count);
    tooltip.appendChild(total);
    tooltip.hidden = false;
    const area = el("daily-content");
    tooltip.style.left = `${Math.max(8, Math.min(model.caretX + 12, area.clientWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(model.caretY - tooltip.offsetHeight - 12, area.clientHeight - tooltip.offsetHeight - 8))}px`;
  }

  function renderSummary(data) {
    const s = data.summary;
    el("total-value").textContent = `${number(s.total)} แปลง`;
    el("today-value").textContent = `${number(s.today)} แปลง`;
    el("difference-value").textContent = `${s.difference > 0 ? "+" : ""}${number(s.difference)} แปลง`;
    el("difference-detail").textContent = s.percentChange === null
      ? "จากเมื่อวาน" : `${s.percentChange > 0 ? "+" : ""}${number(s.percentChange)}% จากเมื่อวาน`;
    el("crop-loading").hidden = true;
    el("daily-loading").hidden = true;
    el("crop-total").textContent = `${number(s.total)} แปลง`;
    el("crop-legend").replaceChildren();
    if (state.cropChart) state.cropChart.destroy();
    const cropContent = document.querySelector(".crop-content");
    cropContent.hidden = false;
    if (data.crops.length === 0) {
      document.querySelector(".donut-wrap").hidden = true;
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "ยังไม่มีข้อมูลแปลง";
      el("crop-legend").appendChild(empty);
    } else {
      document.querySelector(".donut-wrap").hidden = false;
      for (const [index, crop] of data.crops.entries()) {
        const li = document.createElement("li");
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.backgroundColor = cropColor(crop.name, index);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = cropDisplay(crop.name).label;
        const count = document.createElement("strong");
        count.textContent = number(crop.count);
        li.append(swatch, name, count);
        el("crop-legend").appendChild(li);
      }
      state.cropChart = new window.Chart(el("crop-chart"), {
        type: "doughnut",
        data: { labels: data.crops.map((c) => cropDisplay(c.name).label), datasets: [{ data: data.crops.map((c) => c.count), backgroundColor: data.crops.map((c, i) => cropColor(c.name, i)), borderWidth: 2, borderColor: "#fff" }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "70%", plugins: { legend: { display: false } } },
      });
    }
    el("daily-content").hidden = false;
    el("daily-tooltip").hidden = true;
    if (state.dailyChart) state.dailyChart.destroy();
    state.dailyChart = new window.Chart(el("daily-chart"), {
      type: "bar",
      data: { labels: data.daily.map((d) => d.date.slice(5)), datasets: [{ data: data.daily.map((d) => d.count), backgroundColor: "#4faf83", borderRadius: 3, maxBarThickness: 32 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { enabled: false, external: ({ tooltip }) => renderDailyTooltip(tooltip, data.daily) } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } } },
    });
    for (const button of document.querySelectorAll("[data-days]")) button.setAttribute("aria-pressed", String(Number(button.dataset.days) === state.filters.days));
    setOptions(el("tambon-filter"), data.filters.tambons, state.filters.tambon, "ตำบลทั้งหมด", (x) => x.code, (x) => x.name);
    setOptions(el("crop-filter"), data.filters.crops, state.filters.crop, "พืชทั้งหมด", (x) => x, (x) => cropDisplay(x).label);
  }

  function renderPoints(points) {
    clusters.clearLayers();
    markerById.clear();
    state.points = points;
    for (const parcel of points) {
      const display = cropDisplay(parcel.crop);
      const icon = display.icon
        ? window.L.icon({ iconUrl: display.icon, iconSize: [40, 46], iconAnchor: [20, 44],
          popupAnchor: [0, -36], className: "dashboard-crop-icon" })
        : window.L.divIcon({ html: '<span class="parcel-pin"></span>', className: "", iconSize: [18, 18] });
      const marker = window.L.marker([parcel.lat, parcel.lng], {
        icon, title: `${display.label} · ${parcel.parcelName || parcel.parcelCode}`,
        alt: `${display.label} · ${parcel.parcelName || parcel.parcelCode}`,
      });
      marker.on("click", () => focusParcel(parcel));
      markerById.set(parcel.parcelId, marker);
      clusters.addLayer(marker);
    }
    el("map-count").textContent = `${number(points.length)} แปลง`;
    renderSearchResults();
  }

  function closeSearchResults() {
    window.clearTimeout(searchTimer);
    el("parcel-search-results").hidden = true;
    el("parcel-search").closest(".map-search").classList.remove("is-open");
    el("parcel-search").setAttribute("aria-expanded", "false");
    el("parcel-search").removeAttribute("aria-activedescendant");
    state.searchIndex = -1;
  }

  function renderSearchResults() {
    const input = el("parcel-search");
    const list = el("parcel-search-results");
    const query = input.value.trim().toLocaleLowerCase("th");
    list.replaceChildren();
    state.searchResults = query ? state.points.filter((parcel) => [
      parcel.parcelName, parcel.variety, parcel.crop, cropDisplay(parcel.crop).label, parcel.parcelCode,
    ].some((field) => String(field || "").toLocaleLowerCase("th").includes(query))) : [];
    state.searchIndex = -1;
    if (!query) { closeSearchResults(); return; }
    for (const [index, parcel] of state.searchResults.slice(0, 8).entries()) {
      const option = document.createElement("button");
      option.type = "button";
      option.role = "option";
      option.id = `parcel-search-option-${index}`;
      option.className = "map-search-option";
      const title = document.createElement("strong");
      title.textContent = parcel.parcelName || "แปลง";
      const detail = document.createElement("span");
      detail.textContent = `${cropDisplay(parcel.crop).label} · ${parcel.variety || "-"} · ${number(parcel.areaRai)} ไร่`;
      option.append(title, detail);
      option.addEventListener("click", () => chooseSearchResult(parcel));
      list.appendChild(option);
    }
    if (state.searchResults.length > 8) {
      const more = document.createElement("p");
      more.className = "map-search-more";
      more.textContent = `พบอีก ${number(state.searchResults.length - 8)} แปลง`;
      list.appendChild(more);
    }
    if (!state.searchResults.length) {
      const empty = document.createElement("p");
      empty.className = "map-search-more";
      empty.textContent = "ไม่พบแปลงที่ตรงกับคำค้น";
      list.appendChild(empty);
    }
    list.hidden = false;
    input.closest(".map-search").classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
  }

  async function chooseSearchResult(parcel) {
    el("parcel-search").value = parcel.parcelName;
    closeSearchResults();
    const revision = state.revision;
    const selected = focusParcel(parcel);
    const selectionRevision = state.selectionRevision;
    await selected;
    if (revision === state.revision && selectionRevision === state.selectionRevision) {
      await loadGeometry(revision, parcel.parcelCode);
    }
  }

  function cancelGeometry() {
    window.clearTimeout(state.geometryTimer);
    if (state.geometryController) state.geometryController.abort();
    state.geometryController = null;
  }

  async function loadGeometry(revision, parcelCode) {
    cancelGeometry();
    polygons.clearLayers();
    polygonById.clear();
    if (map.getZoom() < GEOMETRY_ZOOM || state.points.length === 0) {
      setMapState("");
      return true;
    }
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map((v) => v.toFixed(6)).join(",");
    const controller = new AbortController();
    state.geometryController = controller;
    setMapState("กำลังโหลดขอบเขตแปลง...");
    try {
      const result = await fetchData(apiUrl("geometries", { bbox,
        ...(state.snapshotVersion ? { snapshot: state.snapshotVersion } : {}),
        ...(parcelCode ? { parcel: parcelCode } : {}) }), controller.signal);
      if (controller.signal.aborted || revision !== state.revision) return false;
      polygons.addData(result.data);
      setMapState("");
      return true;
    } catch (error) {
      if (controller.signal.aborted || revision !== state.revision) return false;
      setMapState(error.message === "HTTP 413" ? "มีแปลงมากเกินไป กรุณาซูมเข้า" : "โหลดขอบเขตแปลงไม่สำเร็จ");
      return false;
    }
  }

  function scheduleGeometry() {
    cancelGeometry();
    state.geometryTimer = window.setTimeout(() => loadGeometry(state.revision), 300);
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    for (const key of ["tambon", "crop", "days"]) url.searchParams.delete(key);
    if (state.filters.tambon) url.searchParams.set("tambon", state.filters.tambon);
    if (state.filters.crop) url.searchParams.set("crop", state.filters.crop);
    if (state.filters.days !== 7) url.searchParams.set("days", String(state.filters.days));
    window.history.replaceState(null, "", url);
  }

  async function refresh() {
    const revision = ++state.revision;
    if (state.refreshController) state.refreshController.abort();
    cancelGeometry();
    const controller = new AbortController();
    state.refreshController = controller;
    state.isRefreshing = true;
    el("refresh").disabled = true;
    setError("");
    try {
      const summary = await fetchData(apiUrl("summary", { days: state.filters.days }), controller.signal);
      const points = await fetchData(apiUrl("points", summary.snapshotVersion
        ? { snapshot: summary.snapshotVersion } : {}), controller.signal);
      if (revision !== state.revision || controller.signal.aborted) return;
      state.snapshotVersion = summary.snapshotVersion || null;
      renderSummary(summary);
      renderPoints(points.parcels);
      syncUrl();
      const geometryLoaded = await loadGeometry(revision);
      if (geometryLoaded && revision === state.revision && !controller.signal.aborted) {
        el("updated-time").textContent = `${summary.stale ? "ข้อมูลล่าสุดที่บันทึกไว้" : "อัปเดตข้อมูลล่าสุด"} ${new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(summary.updatedAt))} น.`;
      }
    } catch (error) {
      if (revision === state.revision && !controller.signal.aborted) setError("โหลดข้อมูลไม่สำเร็จ กำลังแสดงข้อมูลล่าสุดที่โหลดได้ กรุณากดรีเฟรชอีกครั้ง");
    } finally {
      if (revision === state.revision) {
        state.isRefreshing = false;
        el("refresh").disabled = false;
      }
    }
  }

  map.on("moveend zoomend", scheduleGeometry);
  map.on("popupclose", (event) => {
    if (event.popup === selectedPopup) disposePopupPhotos?.();
  });
  let searchTimer;
  el("parcel-search").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderSearchResults, 150);
  });
  el("parcel-search").addEventListener("keydown", (event) => {
    const visible = Math.min(state.searchResults.length, 8);
    if (event.key === "Escape") { closeSearchResults(); return; }
    if (!visible || el("parcel-search-results").hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      state.searchIndex = (state.searchIndex + (event.key === "ArrowDown" ? 1 : visible - 1) + visible) % visible;
      for (const [index, option] of [...el("parcel-search-results").querySelectorAll("[role=option]")].entries()) {
        option.classList.toggle("is-active", index === state.searchIndex);
      }
      el("parcel-search").setAttribute("aria-activedescendant", `parcel-search-option-${state.searchIndex}`);
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseSearchResult(state.searchResults[Math.max(0, state.searchIndex)]);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".map-search")) closeSearchResults();
  });
  el("refresh").addEventListener("click", () => { if (!state.isRefreshing) refresh(); });
  el("tambon-filter").addEventListener("change", (event) => { state.filters.tambon = event.target.value; refresh(); });
  el("crop-filter").addEventListener("change", (event) => { state.filters.crop = event.target.value; refresh(); });
  for (const button of document.querySelectorAll("[data-days]")) button.addEventListener("click", () => { state.filters.days = Number(button.dataset.days); refresh(); });
  window.addEventListener("pagehide", () => { state.refreshController?.abort(); cancelGeometry(); });
  refresh();
  window.MapDashboard = { refresh, state, map };
})(window, document);

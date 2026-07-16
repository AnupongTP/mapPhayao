(function (window, document) {
  const formatters = window.MapFormatters;
  const TEXT = {
    saveParcel: "บันทึกแปลง",
    myParcels: "แปลงของฉัน",
    parcelName: "ชื่อแปลง",
    cropType: "ชนิดพืช",
    riceVariety: "พันธุ์",
    plantingDate: "วันที่ปลูก",
    cancel: "ยกเลิก",
    saving: "กำลังบันทึก...",
    saved: "บันทึกแปลงเรียบร้อย",
    saveFailed: "ไม่สามารถบันทึกแปลงได้ กรุณาลองใหม่",
    loading: "กำลังโหลดแปลง...",
    empty: "ยังไม่มีแปลงที่บันทึก",
    loadFailed: "ไม่สามารถโหลดข้อมูลแปลงได้",
    partialMapLoad: "บางแปลงไม่สามารถแสดงบนแผนที่ได้",
    analyzing: "กำลังวิเคราะห์...",
    authRequired: "กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง",
    notFound: "ไม่พบแปลงนี้หรือไม่มีสิทธิ์เข้าถึง",
    lineOnly: "ฟังก์ชันบันทึกแปลงใช้งานผ่าน LINE เท่านั้น",
    edit: "แก้ไขข้อมูล",
    editBoundary: "แก้ไขขอบเขต",
    update: "บันทึกแก้ไข",
    updating: "กำลังบันทึก...",
    updated: "บันทึกข้อมูลแปลงเรียบร้อย",
    deleteTitle: "ลบแปลง",
    delete: "ลบแปลง",
    deleting: "กำลังลบ...",
    deleted: "ลบแปลงเรียบร้อย",
    deleteNote: "เมื่อลบแล้วจะไม่สามารถเรียกคืนได้",
    openUnsavedConfirm:
      "มีแปลงที่ยังไม่ได้บันทึก ต้องการเปิดแปลงที่บันทึกไว้หรือไม่",
  };
  const CROP_OPTIONS = [
    { value: "rice", label: "ข้าว" },
    { value: "maize", label: "ข้าวโพด" },
  ];

  let handlers = {};
  let liffReady = false;
  let listRevision = 0;
  let lastFocusedElement = null;
  let cachedParcels = [];
  let expandedSavedParcelId = null;
  let activeListRequest = null;

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function isLiffEnabled() {
    return Boolean(window.MapLiffMode && window.MapLiffMode.isEnabled());
  }

  function setStatus(element, message, tone) {
    if (!element) {
      return;
    }
    element.textContent = message || "";
    element.hidden = !message;
    element.classList.toggle("is-error", tone === "error");
    element.classList.toggle("is-success", tone === "success");
  }

  function getFriendlyError(error) {
    if (error && error.statusCode === 401) {
      return TEXT.authRequired;
    }
    if (error && error.statusCode === 404) {
      return TEXT.notFound;
    }
    return error && error.message ? error.message : TEXT.loadFailed;
  }

  function syncMyParcelsButton() {
    const hasSavedParcels =
      isLiffEnabled() && liffReady && Array.isArray(cachedParcels) && cachedParcels.length > 0;
    handlers.onSavedParcelAvailabilityChange?.(hasSavedParcels);
  }

  function closeSheet(sheet) {
    if (!sheet) {
      return;
    }
    sheet.remove();
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus({ preventScroll: true });
    }
    lastFocusedElement = null;
  }

  function createSheet(id, title) {
    const existing = document.getElementById(id);
    if (existing) {
      existing.remove();
    }

    lastFocusedElement = document.activeElement;
    const backdrop = createElement("div", "parcel-sheet-backdrop");
    backdrop.id = id;
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    const sheet = createElement("section", "parcel-sheet");
    const header = createElement("header", "parcel-sheet-header");
    header.appendChild(createElement("h2", null, title));
    const closeButton = createElement("button", "panel-close panel-close-danger", "ปิด");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "ปิด");
    closeButton.addEventListener("click", () => closeSheet(backdrop));
    header.appendChild(closeButton);
    const body = createElement("div", "parcel-sheet-body");
    sheet.append(header, body);
    backdrop.appendChild(sheet);
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet(backdrop);
      }
    });
    document.body.appendChild(backdrop);
    closeButton.focus({ preventScroll: true });
    return { backdrop, body };
  }

  function showLineOnlyMessage() {
    const { body } = createSheet("parcel-line-only-sheet", TEXT.saveParcel);
    const status = createElement("p", "parcel-sheet-status is-error", TEXT.lineOnly);
    status.setAttribute("aria-live", "polite");
    body.appendChild(status);
  }

  function createField(form, id, labelText, input) {
    const label = createElement("label", "parcel-form-field");
    label.setAttribute("for", id);
    label.appendChild(createElement("span", null, labelText));
    input.id = id;
    label.appendChild(input);
    form.appendChild(label);
    return input;
  }

  function normalizeMetadataFromForm(form) {
    return {
      parcelName: form.elements.parcelName.value.trim(),
      cropType: form.elements.cropType.value.trim(),
      riceVariety: form.elements.riceVariety.value.trim(),
      plantingDate: form.elements.plantingDate.value,
    };
  }

  function createParcelForm({ idPrefix, title, confirmText, parcel, onSubmit }) {
    const { backdrop, body } = createSheet(`${idPrefix}-sheet`, title);
    const form = createElement("form", "parcel-form");
    form.id = `${idPrefix}-form`;
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.name = "parcelName";
    nameInput.required = true;
    nameInput.maxLength = 120;
    nameInput.value = parcel?.parcelName || parcel?.name || "";
    createField(form, `${idPrefix}-name`, TEXT.parcelName, nameInput);

    const cropSelect = document.createElement("select");
    cropSelect.name = "cropType";
    cropSelect.required = true;
    CROP_OPTIONS.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      cropSelect.appendChild(element);
    });
    cropSelect.value = parcel?.cropType || "rice";
    createField(form, `${idPrefix}-crop`, TEXT.cropType, cropSelect);

    const riceInput = document.createElement("input");
    riceInput.type = "text";
    riceInput.name = "riceVariety";
    riceInput.maxLength = 120;
    riceInput.value = parcel?.riceVariety || "";
    createField(form, `${idPrefix}-rice-variety`, TEXT.riceVariety, riceInput);

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.name = "plantingDate";
    dateInput.value = parcel?.plantingDate || "";
    createField(form, `${idPrefix}-planting-date`, TEXT.plantingDate, dateInput);

    const status = createElement("p", "parcel-sheet-status");
    status.id = `${idPrefix}-status`;
    status.hidden = true;
    status.setAttribute("aria-live", "polite");
    status.setAttribute("role", "status");

    const actions = createElement("div", "parcel-sheet-actions");
    const cancelButton = createElement("button", "panel-button secondary", TEXT.cancel);
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => closeSheet(backdrop));
    const submitButton = createElement("button", "panel-button", confirmText);
    submitButton.type = "submit";
    actions.append(cancelButton, submitButton);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const metadata = normalizeMetadataFromForm(form);
      if (!metadata.parcelName) {
        setStatus(status, "กรุณาระบุชื่อแปลง", "error");
        nameInput.focus();
        return;
      }

      submitButton.disabled = true;
      cancelButton.disabled = true;
      setStatus(status, idPrefix === "parcel-save" ? TEXT.saving : TEXT.updating);

      try {
        await onSubmit(metadata);
        setStatus(status, idPrefix === "parcel-save" ? TEXT.saved : TEXT.updated, "success");
        window.setTimeout(() => closeSheet(backdrop), 700);
      } catch (error) {
        submitButton.disabled = false;
        cancelButton.disabled = false;
        setStatus(
          status,
          idPrefix === "parcel-save" ? TEXT.saveFailed : getFriendlyError(error),
          "error",
        );
      }
    });

    form.append(status, actions);
    body.appendChild(form);
    nameInput.focus({ preventScroll: true });
    nameInput.select();
    return backdrop;
  }

  function openSaveSheet(parcel, onSubmit) {
    return createParcelForm({
      idPrefix: "parcel-save",
      title: TEXT.saveParcel,
      confirmText: TEXT.saveParcel,
      parcel,
      onSubmit,
    });
  }

  function openEditSheet(parcel, onSubmit) {
    return createParcelForm({
      idPrefix: "parcel-edit",
      title: TEXT.edit,
      confirmText: TEXT.update,
      parcel,
      onSubmit,
    });
  }

  function renderSaveAction(parcel, options = {}) {
    const existing = document.getElementById("mobile-parcel-save-action");
    if (existing) {
      existing.remove();
    }

    if (!isLiffEnabled() || !liffReady || !parcel) {
      return;
    }

    const content = document.getElementById("result-panel-content");
    if (!content || parcel.analysisStatus !== "success") {
      return;
    }

    const state = window.MapParcelState.ensurePersistenceState(parcel);
    const wrapper = createElement("section", "mobile-parcel-save-action");
    wrapper.id = "mobile-parcel-save-action";
    const status = createElement("p", "parcel-sheet-status");
    status.id = "mobile-parcel-save-status";
    status.hidden = true;
    status.setAttribute("aria-live", "polite");

    if (state.saveState === "saved") {
      setStatus(status, TEXT.saved, "success");
      wrapper.appendChild(status);
      content.appendChild(wrapper);
      return;
    }

    const button = createElement("button", "panel-button mobile-parcel-save-button", TEXT.saveParcel);
    button.id = "mobile-parcel-save-button";
    button.type = "button";
    button.disabled =
      state.saveState === "saving" ||
      !window.MapParcelState.canSaveAnalyzedParcel(parcel);
    button.setAttribute("aria-controls", "parcel-save-sheet");
    button.setAttribute("aria-busy", state.saveState === "saving" ? "true" : "false");
    button.addEventListener("click", () => {
      if (!window.MapParcelState.canSaveAnalyzedParcel(parcel)) {
        return;
      }
      openSaveSheet(parcel, async (metadata) => {
        if (typeof options.onSave === "function") {
          await options.onSave(metadata);
        }
      });
    });

    wrapper.append(button, status);
    content.appendChild(wrapper);
  }

  function createParcelSummary(parcel) {
    const summary = [];
    if (parcel.cropType) {
      summary.push(formatters.getCropTypeLabel(parcel.cropType));
    }
    if (parcel.riceVariety) {
      summary.push(parcel.riceVariety);
    }
    if (parcel.plantingDate) {
      summary.push(formatters.formatThaiDateOnly(parcel.plantingDate));
    }
    if (parcel.areaRai !== null && parcel.areaRai !== undefined) {
      summary.push(formatters.formatAreaRaiCompact(parcel.areaRai));
    }
    return summary.join(" · ");
  }

  function getParcelDisplayName(parcel) {
    return parcel.parcelName || parcel.parcelCode || "แปลง";
  }

  function createSavedParcelHeader(parcel, isExpanded, actionsId, onToggle) {
    const header = createElement("button", "saved-parcel-header saved-parcel-toggle");
    header.type = "button";
    header.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    header.setAttribute("aria-controls", actionsId);
    header.addEventListener("click", onToggle);

    const titleWrap = createElement("span", "saved-parcel-title");
    const title = createElement("span", "saved-parcel-name", getParcelDisplayName(parcel));
    const summary = createElement("span", "saved-parcel-summary", createParcelSummary(parcel));
    const dateValue = parcel.plantingDate
      ? `ปลูก ${formatters.formatThaiDateOnly(parcel.plantingDate)}`
      : formatters.formatThaiDateTime(parcel.updatedAt || parcel.createdAt);
    const date = createElement("span", "saved-parcel-date", dateValue);
    const chevron = createElement("span", "saved-parcel-chevron", isExpanded ? "⌃" : "⌄");

    titleWrap.append(title);
    if (summary.textContent) {
      titleWrap.appendChild(summary);
    }
    if (date.textContent) {
      titleWrap.appendChild(date);
    }
    header.append(titleWrap, chevron);
    return header;
  }

  function renderParcelCards(container, parcels) {
    container.replaceChildren();
    if (!parcels.length) {
      container.appendChild(createElement("p", "parcel-empty", TEXT.empty));
      return;
    }

    if (expandedSavedParcelId && !parcels.some((parcel) => parcel.id === expandedSavedParcelId)) {
      expandedSavedParcelId = null;
    }

    parcels.forEach((parcel) => {
      const isExpanded = parcel.id === expandedSavedParcelId;
      const card = createElement(
        "article",
        `saved-parcel-card${isExpanded ? " is-expanded" : ""}`,
      );
      const actionsId = `saved-parcel-actions-${parcel.id}`;
      const header = createSavedParcelHeader(parcel, isExpanded, actionsId, () => {
        expandedSavedParcelId = isExpanded ? null : parcel.id;
        renderParcelCards(container, parcels);
      });
      const actions = createElement("div", "saved-parcel-actions");
      actions.id = actionsId;
      actions.hidden = !isExpanded;
      const makeButton = (label, onClick, className = "parcel-action") => {
        const button = createElement("button", className, label);
        button.type = "button";
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          onClick();
        });
        return button;
      };

      actions.append(
        makeButton("ดูแปลง", () => handlers.onOpenParcel?.(parcel)),
        makeButton("วิเคราะห์ใหม่", () => handlers.onAnalyzeParcel?.(parcel)),
        makeButton("แก้ไขข้อมูล", () => {
          openEditSheet(parcel, async (metadata) => {
            const patch = {};
            ["parcelName", "cropType", "riceVariety", "plantingDate"].forEach((key) => {
              if ((metadata[key] || "") !== (parcel[key] || "")) {
                patch[key] = metadata[key] || "";
              }
            });
            if (Object.keys(patch).length === 0) {
              return;
            }
            const result = await window.MapApi.updateMyParcel(parcel.id, patch);
            const updatedParcel = result.parcel;
            cachedParcels = cachedParcels.map((item) =>
              item.id === updatedParcel.id ? updatedParcel : item,
            );
            renderParcelCards(container, cachedParcels);
            handlers.onParcelUpdated?.(updatedParcel);
          });
        }),
        makeButton(TEXT.editBoundary, () => handlers.onEditBoundary?.(parcel)),
        makeButton("ลบ", () => openDeleteDialog(parcel, container), "parcel-action danger full-width"),
      );

      card.append(header, actions);
      container.appendChild(card);
    });
  }

  function applyLoadedParcels(result, requestRevision) {
    if (!window.MapParcelState.shouldAcceptListResponse(requestRevision, listRevision)) {
      return { stale: true };
    }

    cachedParcels = Array.isArray(result?.parcels) ? result.parcels : [];
    syncMyParcelsButton();
    let layerResult = null;
    try {
      layerResult = handlers.onParcelsLoaded?.(cachedParcels) || null;
    } catch (error) {
      layerResult = { skipped: cachedParcels.length };
    }
    return { stale: false, parcels: cachedParcels, layerResult };
  }

  function requestMyParcels() {
    if (activeListRequest) {
      return activeListRequest;
    }

    const requestRevision = ++listRevision;
    activeListRequest = window.MapApi.listMyParcels()
      .then((result) => applyLoadedParcels(result, requestRevision))
      .finally(() => {
        activeListRequest = null;
      });
    return activeListRequest;
  }

  async function refreshSavedParcelsState() {
    if (!isLiffEnabled() || !liffReady) {
      syncMyParcelsButton();
      return null;
    }

    try {
      return await requestMyParcels();
    } catch (error) {
      syncMyParcelsButton();
      return null;
    }
  }

  async function loadMyParcels(container, status) {
    setStatus(status, TEXT.loading);
    container.replaceChildren();

    try {
      const result = await requestMyParcels();
      if (!result || result.stale) {
        return;
      }
      setStatus(
        status,
        result.layerResult && result.layerResult.skipped > 0 ? TEXT.partialMapLoad : "",
        result.layerResult && result.layerResult.skipped > 0 ? "error" : undefined,
      );
      renderParcelCards(container, cachedParcels);
    } catch (error) {
      setStatus(status, getFriendlyError(error) || TEXT.loadFailed, "error");
      container.replaceChildren();
      const retry = createElement("button", "panel-button secondary", "ลองใหม่");
      retry.type = "button";
      retry.addEventListener("click", () => loadMyParcels(container, status));
      container.appendChild(retry);
    }
  }

  function openMyParcelsSheet() {
    if (!liffReady) {
      showLineOnlyMessage();
      return;
    }
    if (window.MapUi && typeof window.MapUi.closeTemporaryParcelPanel === "function") {
      window.MapUi.closeTemporaryParcelPanel();
    }
    const { body } = createSheet("my-parcels-sheet", TEXT.myParcels);
    const status = createElement("p", "parcel-sheet-status");
    status.id = "my-parcels-status";
    status.setAttribute("aria-live", "polite");
    status.setAttribute("role", "status");
    const list = createElement("div", "my-parcels-list");
    list.id = "my-parcels-list";
    body.append(status, list);
    loadMyParcels(list, status);
  }

  function openDeleteDialog(parcel, listContainer) {
    const { backdrop, body } = createSheet("parcel-delete-dialog", TEXT.deleteTitle);
    const message = createElement(
      "p",
      "result-message",
      `ต้องการลบแปลง “${parcel.parcelName || parcel.parcelCode || "แปลง"}” หรือไม่`,
    );
    const note = createElement("p", "parcel-note", TEXT.deleteNote);
    const status = createElement("p", "parcel-sheet-status");
    status.hidden = true;
    status.setAttribute("aria-live", "polite");
    const actions = createElement("div", "parcel-sheet-actions");
    const cancelButton = createElement("button", "panel-button secondary", TEXT.cancel);
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => closeSheet(backdrop));
    const deleteButton = createElement("button", "panel-button danger", TEXT.delete);
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async () => {
      cancelButton.disabled = true;
      deleteButton.disabled = true;
      setStatus(status, TEXT.deleting);
      try {
        await window.MapApi.deleteMyParcel(parcel.id);
        cachedParcels = cachedParcels.filter((item) => item.id !== parcel.id);
        syncMyParcelsButton();
        if (expandedSavedParcelId === parcel.id) {
          expandedSavedParcelId = null;
        }
        if (listContainer) {
          renderParcelCards(listContainer, cachedParcels);
        }
        handlers.onParcelDeleted?.(parcel.id);
        setStatus(status, TEXT.deleted, "success");
        window.setTimeout(() => closeSheet(backdrop), 600);
      } catch (error) {
        cancelButton.disabled = false;
        deleteButton.disabled = false;
        setStatus(status, getFriendlyError(error), "error");
      }
    });
    actions.append(cancelButton, deleteButton);
    body.append(message, note, status, actions);
  }

  function refreshMyParcelsIfOpen() {
    const sheet = document.getElementById("my-parcels-sheet");
    if (!sheet) {
      return false;
    }
    const list = document.getElementById("my-parcels-list");
    const status = document.getElementById("my-parcels-status");
    if (list && status) {
      loadMyParcels(list, status);
      return true;
    }
    return false;
  }

  function confirmOpenSavedParcel() {
    return new Promise((resolve) => {
      const { backdrop, body } = createSheet("parcel-open-confirm-dialog", TEXT.myParcels);
      body.appendChild(createElement("p", "result-message", TEXT.openUnsavedConfirm));
      const actions = createElement("div", "parcel-sheet-actions");
      const cancelButton = createElement("button", "panel-button secondary", TEXT.cancel);
      cancelButton.type = "button";
      cancelButton.addEventListener("click", () => {
        closeSheet(backdrop);
        resolve(false);
      });
      const openButton = createElement("button", "panel-button", "เปิดแปลง");
      openButton.type = "button";
      openButton.addEventListener("click", () => {
        closeSheet(backdrop);
        resolve(true);
      });
      actions.append(cancelButton, openButton);
      body.appendChild(actions);
    });
  }

  function closeMyParcelsSheet() {
    const sheet = document.getElementById("my-parcels-sheet");
    if (sheet) {
      closeSheet(sheet);
    }
  }

  function replaceCachedParcel(parcel) {
    if (!parcel || !parcel.id) {
      return;
    }
    cachedParcels = cachedParcels.map((item) => (item.id === parcel.id ? parcel : item));
    syncMyParcelsButton();
    const list = document.getElementById("my-parcels-list");
    if (list) {
      renderParcelCards(list, cachedParcels);
    }
  }

  function upsertCachedParcel(parcel) {
    if (!parcel || !parcel.id) {
      return;
    }
    const existingIndex = cachedParcels.findIndex((item) => item.id === parcel.id);
    if (existingIndex >= 0) {
      cachedParcels = cachedParcels.map((item) => (item.id === parcel.id ? parcel : item));
    } else {
      cachedParcels = [parcel, ...cachedParcels];
    }
    syncMyParcelsButton();
    const list = document.getElementById("my-parcels-list");
    if (list) {
      renderParcelCards(list, cachedParcels);
    }
  }

  function init(options = {}) {
    handlers = options;
    syncMyParcelsButton();
  }

  const api = {
    init,
    setLiffReady(value) {
      liffReady = Boolean(value);
      syncMyParcelsButton();
      if (liffReady) {
        refreshSavedParcelsState();
      }
    },
    renderSaveAction,
    openSaveSheet,
    openEditSheet,
    openMyParcelsSheet,
    closeMyParcelsSheet,
    replaceCachedParcel,
    upsertCachedParcel,
    refreshSavedParcelsState,
    refreshMyParcelsIfOpen,
    confirmOpenSavedParcel,
    getFriendlyError,
    text: TEXT,
  };

  window.MapParcelManagement = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(window, document);

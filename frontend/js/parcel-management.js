(function (window, document) {
  const formatters = window.MapFormatters;
  const uiIcons = window.MapUiIcons || {
    create() {
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      return icon;
    },
    setActionLabel(element, text) {
      element.textContent = text;
      return element;
    },
    setChevron(element, isExpanded) {
      element.textContent = isExpanded ? "⌃" : "⌄";
      return element;
    },
  };
  const TEXT = {
    saveParcel: "บันทึกแปลง",
    myParcels: "แปลงของฉัน",
    parcelName: "ชื่อแปลง",
    cropType: "ชนิดพืช",
    riceVariety: "พันธุ์",
    plantingDate: "วันที่ปลูก",
    note: "หมายเหตุ",
    cancel: "ยกเลิก",
    saving: "กำลังบันทึก...",
    saved: "บันทึกแปลงเรียบร้อย",
    saveFailed: "ไม่สามารถบันทึกแปลงได้ กรุณาลองใหม่",
    loading: "กำลังโหลดแปลง...",
    empty: "ยังไม่มีแปลงที่บันทึก",
    noResults: "ไม่พบแปลงที่ตรงกับคำค้น",
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
  const UPLOAD_STAGES = {
    PARCEL_SAVED: "บันทึกข้อมูลแปลงสำเร็จ",
    IMAGE_PREPARING: "กำลังเตรียมรูปภาพ...",
    IMAGE_PREPARED: "เตรียมรูปภาพสำเร็จ",
    REQUEST_STARTING: "กำลังเชื่อมต่อเซิร์ฟเวอร์...",
    WAITING_FOR_SERVER: "กำลังรอการตอบกลับจากเซิร์ฟเวอร์...",
    UPLOAD_SUCCESS: "อัปโหลดรูปภาพสำเร็จ",
    UPLOAD_FAILED: "อัปโหลดรูปภาพไม่สำเร็จ",
  };
  const FAILURE_BOUNDARIES = {
    NETWORK_NO_RESPONSE: "การเชื่อมต่อ Browser → Server",
    REQUEST_ABORTED: "การเชื่อมต่อ Browser → Server",
    BACKEND_HTTP_ERROR: "เซิร์ฟเวอร์",
    REQUEST_RECEIVED: "เซิร์ฟเวอร์",
    AUTH_VERIFIED: "การยืนยันตัวตน",
    MULTIPART_PARSED: "ข้อมูลรูปภาพ",
    PARCEL_LOOKUP: "ข้อมูลแปลง",
    PARCEL_VERIFIED: "ข้อมูลแปลง",
    IMAGE_VALIDATION: "การตรวจสอบรูปภาพ",
    IMAGE_PROCESSED: "การประมวลผลรูปภาพ",
    SHEET_CHECK: "Google Sheet",
    DRIVE_UPLOAD: "Google Drive / Apps Script",
    SHEET_UPDATE: "Google Sheet",
  };
  const FAILURE_DETAILS = {
    NETWORK_NO_RESPONSE: "ไม่ได้รับการตอบกลับจากเซิร์ฟเวอร์",
    REQUEST_ABORTED: "คำขออัปโหลดถูกยกเลิก",
    APPS_SCRIPT_TIMEOUT: "บริการจัดเก็บรูปภาพไม่ตอบกลับภายในเวลาที่กำหนด",
    APPS_SCRIPT_NETWORK_ERROR: "บริการจัดเก็บรูปภาพขัดข้อง",
    APPS_SCRIPT_REJECTED: "บริการจัดเก็บรูปภาพปฏิเสธคำขอ",
    APPS_SCRIPT_HTTP_ERROR: "บริการจัดเก็บรูปภาพขัดข้อง",
    APPS_SCRIPT_INVALID_RESPONSE: "บริการจัดเก็บรูปภาพส่งข้อมูลไม่ถูกต้อง",
    DRIVE_NOT_CONFIGURED: "บริการจัดเก็บรูปภาพยังไม่พร้อมใช้งาน",
    DRIVE_UPLOAD_ERROR: "บริการจัดเก็บรูปภาพขัดข้อง",
    SHEET_READ_ERROR: "ไม่สามารถตรวจสอบข้อมูลรูปภาพได้",
    SHEET_UPDATE_ERROR: "ไม่สามารถบันทึกข้อมูลรูปภาพได้",
    SHEET_HEADER_MISMATCH: "รูปแบบตารางข้อมูลรูปภาพไม่ตรงตามที่กำหนด",
    IMAGE_CONFLICT: "ข้อมูลรูปภาพแปลงขัดแย้งกัน",
    AUTH_REQUIRED: "กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง",
    PARCEL_NOT_FOUND: "ไม่พบแปลงนี้หรือไม่มีสิทธิ์เข้าถึง",
    IMAGE_TOO_LARGE: "รูปภาพมีขนาดใหญ่เกิน 12 MB",
    IMAGE_UNSUPPORTED: "ไม่รองรับไฟล์รูปภาพนี้",
    INVALID_UPLOAD: "ข้อมูลรูปภาพไม่ถูกต้อง",
    UPLOAD_FAILED: "ไม่สามารถอัปโหลดรูปภาพได้",
    BACKEND_HTTP_ERROR: "เซิร์ฟเวอร์ไม่สามารถดำเนินการได้",
  };

  let handlers = {};
  let liffReady = false;
  let listRevision = 0;
  let lastFocusedElement = null;
  let cachedParcels = [];
  let expandedSavedParcelId = null;
  let focusedSavedParcelId = null;
  let myParcelsSearchTerm = "";
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
    const closeButton = createElement("button", "panel-close panel-icon-action panel-close-icon");
    closeButton.replaceChildren(uiIcons.create("close"));
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "ปิด");
    closeButton.title = "ปิด";
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
      note: form.elements.note.value.trim(),
    };
  }

  function createParcelForm({ idPrefix, title, confirmText, parcel, onSubmit }) {
    const { backdrop, body } = createSheet(`${idPrefix}-sheet`, title);
    body.classList.add("parcel-form-body");
    const form = createElement("form", "parcel-form");
    form.id = `${idPrefix}-form`;
    const fields = createElement("div", "parcel-form-fields");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.name = "parcelName";
    nameInput.required = true;
    nameInput.maxLength = 120;
    nameInput.value = parcel?.parcelName || parcel?.name || "";
    createField(fields, `${idPrefix}-name`, TEXT.parcelName, nameInput);

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
    createField(fields, `${idPrefix}-crop`, TEXT.cropType, cropSelect);

    const riceInput = document.createElement("input");
    riceInput.type = "text";
    riceInput.name = "riceVariety";
    riceInput.maxLength = 120;
    riceInput.value = parcel?.riceVariety || "";
    createField(fields, `${idPrefix}-rice-variety`, TEXT.riceVariety, riceInput);

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.name = "plantingDate";
    dateInput.value = parcel?.plantingDate || "";
    createField(fields, `${idPrefix}-planting-date`, TEXT.plantingDate, dateInput);

    const noteInput = document.createElement("textarea");
    noteInput.name = "note";
    noteInput.maxLength = 5000;
    noteInput.value = parcel?.note || "";
    createField(fields, `${idPrefix}-note`, TEXT.note, noteInput);

    const status = createElement("p", "parcel-sheet-status");
    status.id = `${idPrefix}-status`;
    status.hidden = true;
    status.setAttribute("aria-live", "polite");
    status.setAttribute("role", "status");

    const actions = createElement("div", "parcel-sheet-actions");
    const cancelButton = createElement("button", "panel-button secondary", TEXT.cancel);
    uiIcons.setActionLabel(cancelButton, TEXT.cancel);
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => closeSheet(backdrop));
    const submitButton = createElement("button", "panel-button", confirmText);
    uiIcons.setActionLabel(submitButton, confirmText, "save");
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
        await onSubmit(metadata, (message) => setStatus(status, message));
        setStatus(status, idPrefix === "parcel-save" ? TEXT.saved : TEXT.updated, "success");
        window.setTimeout(() => closeSheet(backdrop), 700);
      } catch (error) {
        submitButton.disabled = false;
        cancelButton.disabled = false;
        setStatus(
          status,
          error.partialSuccess ? error.message : idPrefix === "parcel-save" ? TEXT.saveFailed : getFriendlyError(error),
          "error",
        );
      }
    });

    const footer = createElement("div", "parcel-form-footer");
    footer.append(status, actions);
    form.append(fields, footer);
    body.appendChild(form);
    nameInput.focus({ preventScroll: true });
    nameInput.select();
    return backdrop;
  }

  function openSaveSheet(parcel, onSubmit) {
    const { backdrop, body } = createSheet("parcel-save-sheet", TEXT.saveParcel);
    const summary = createElement("dl", "parcel-save-summary");
    const values = [
      [TEXT.parcelName, parcel.name],
      [TEXT.cropType, CROP_OPTIONS.find((option) => option.value === parcel.cropType)?.label || parcel.cropType],
      [TEXT.riceVariety, parcel.riceVariety],
      [TEXT.plantingDate, parcel.plantingDate],
      ["รูปภาพ", `${parcel.photos?.length || 0}/5 รูป`],
      [TEXT.note, parcel.note],
    ];
    values.forEach(([label, value]) => {
      summary.append(createElement("dt", null, label), createElement("dd", null, value || "-"));
    });
    const status = createElement("p", "parcel-sheet-status");
    status.id = "parcel-save-status";
    status.hidden = true;
    status.setAttribute("aria-live", "polite");
    const diagnostic = createElement("section", "parcel-upload-diagnostic");
    diagnostic.hidden = true;
    diagnostic.setAttribute("aria-live", "polite");
    diagnostic.appendChild(createElement("h3", null, "สถานะระบบ"));
    const steps = createElement("div", "parcel-upload-steps");
    const failure = createElement("p", "parcel-upload-failure");
    failure.hidden = true;
    diagnostic.append(steps, failure);
    const completed = new Set();
    let active = "";
    function renderDiagnostic(event) {
      if (!event || !UPLOAD_STAGES[event.stage]) return;
      diagnostic.hidden = false;
      if (event.stage === "UPLOAD_FAILED") {
        active = event.stage;
        const error = event.error || {};
        const stage = Object.hasOwn(FAILURE_BOUNDARIES, error.diagnosticStage)
          ? error.diagnosticStage : "BACKEND_HTTP_ERROR";
        const code = Object.hasOwn(FAILURE_DETAILS, error.diagnosticCode)
          ? error.diagnosticCode : "UPLOAD_FAILED";
        const requestId = /^[A-F0-9]{8}$/.test(error.requestId || "") ? error.requestId : "ไม่มี";
        failure.textContent = `จุดที่เกิดปัญหา: ${FAILURE_BOUNDARIES[stage]}\n` +
          `รายละเอียด: ${FAILURE_DETAILS[code]}\nรหัสตรวจสอบ: ${requestId}`;
        failure.hidden = false;
      } else if (event.stage === "IMAGE_PREPARING" || event.stage === "REQUEST_STARTING" ||
        event.stage === "WAITING_FOR_SERVER") {
        active = event.stage;
      } else {
        completed.add(event.stage);
        active = "";
        failure.hidden = true;
      }
      steps.replaceChildren();
      for (const stage of completed) {
        steps.appendChild(createElement("p", null, `✓ ${UPLOAD_STAGES[stage]}`));
      }
      if (active) steps.appendChild(createElement("p", null,
        `${active === "UPLOAD_FAILED" ? "✕" : "•"} ${UPLOAD_STAGES[active]}`));
      if (event.stage === "UPLOAD_SUCCESS") {
        steps.appendChild(createElement("p", null, "✓ เซิร์ฟเวอร์ตอบกลับสำเร็จ"));
        steps.appendChild(createElement("p", null, "✓ บันทึกข้อมูลรูปภาพสำเร็จ"));
      }
    }
    const actions = createElement("div", "parcel-sheet-actions");
    const cancel = createElement("button", "panel-button secondary", TEXT.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => closeSheet(backdrop));
    const confirm = createElement("button", "panel-button", TEXT.saveParcel);
    confirm.type = "button";
    confirm.addEventListener("click", async () => {
      cancel.disabled = true;
      confirm.disabled = true;
      setStatus(status, TEXT.saving);
      try {
        await onSubmit((message, event) => {
          setStatus(status, message);
          renderDiagnostic(event);
        });
        setStatus(status, TEXT.saved, "success");
        window.setTimeout(() => closeSheet(backdrop), 700);
      } catch (error) {
        cancel.disabled = false;
        confirm.disabled = false;
        setStatus(status, error.partialSuccess ? error.message : TEXT.saveFailed, "error");
        if (error.diagnostic && failure.hidden) {
          renderDiagnostic({ stage: "UPLOAD_FAILED", error: error.diagnostic });
        }
      }
    });
    actions.append(cancel, confirm);
    body.append(summary, status, diagnostic, actions);
    return backdrop;
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
    document.getElementById("mobile-parcel-save-button")?.remove();

    if (!isLiffEnabled() || !liffReady || !parcel) {
      return;
    }

    const panel = document.getElementById("result-panel");
    const header = panel?.querySelector(".panel-header");
    if (!header || parcel.analysisStatus !== "success") {
      return;
    }

    const state = window.MapParcelState.ensurePersistenceState(parcel);
    const pendingPhotos = parcel.photos?.some((photo) => !photo.image);
    if (state.saveState === "saved" && !pendingPhotos) {
      return;
    }

    const button = createElement("button", "panel-close panel-icon-action result-panel-icon-action mobile-parcel-save-button");
    button.replaceChildren(uiIcons.create("save"));
    button.id = "mobile-parcel-save-button";
    button.type = "button";
    button.title = TEXT.saveParcel;
    button.setAttribute("aria-label", TEXT.saveParcel);
    button.disabled =
      state.saveState === "saving" ||
      !(pendingPhotos && state.savedParcelId) && !window.MapParcelState.canSaveAnalyzedParcel(parcel);
    button.setAttribute("aria-controls", "parcel-save-sheet");
    button.setAttribute("aria-busy", state.saveState === "saving" ? "true" : "false");
    button.addEventListener("click", () => {
      if (!(pendingPhotos && state.savedParcelId) && !window.MapParcelState.canSaveAnalyzedParcel(parcel)) {
        return;
      }
      openSaveSheet(parcel, async (onProgress) => {
        if (typeof options.onSave === "function") {
          await options.onSave(onProgress);
        }
      });
    });

    header.insertBefore(button, header.querySelector(".result-panel-close"));
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
    const chevron = createElement("span", "saved-parcel-chevron");
    uiIcons.setChevron(chevron, isExpanded);

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

  function renderParcelCards(container) {
    const search = myParcelsSearchTerm.trim().toLocaleLowerCase();
    const matches = search
      ? cachedParcels.filter((parcel) => [
        parcel.parcelName,
        parcel.parcelCode,
        parcel.cropType,
        formatters.getCropTypeLabel(parcel.cropType),
        parcel.riceVariety,
      ].some((value) => String(value || "").toLocaleLowerCase().includes(search)))
      : cachedParcels;
    const focus = matches.find((parcel) => parcel.id === focusedSavedParcelId);
    const parcels = focus ? [focus, ...matches.filter((parcel) => parcel.id !== focus.id)] : matches;
    container.replaceChildren();
    if (!parcels.length) {
      container.appendChild(createElement("p", "parcel-empty", search ? TEXT.noResults : TEXT.empty));
      return;
    }

    if (expandedSavedParcelId && !cachedParcels.some((parcel) => parcel.id === expandedSavedParcelId)) {
      expandedSavedParcelId = null;
    }

    parcels.forEach((parcel) => {
      const isFocused = parcel.id === focusedSavedParcelId;
      const isExpanded = parcel.id === expandedSavedParcelId;
      const card = createElement(
        "article",
        `saved-parcel-card${isExpanded ? " is-expanded" : ""}${isFocused ? " is-focused" : ""}`,
      );
      card.dataset.parcelId = parcel.id;
      const actionsId = `saved-parcel-actions-${parcel.id}`;
      const header = createSavedParcelHeader(parcel, isExpanded, actionsId, () => {
        focusedSavedParcelId = null;
        expandedSavedParcelId = isExpanded ? null : parcel.id;
        renderParcelCards(container);
      });
      const actions = createElement("div", "saved-parcel-actions");
      actions.id = actionsId;
      actions.hidden = !isExpanded;
      const makeButton = (label, onClick, className = "parcel-action") => {
        const button = createElement("button", className, label);
        uiIcons.setActionLabel(button, label);
        button.type = "button";
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          onClick();
        });
        return button;
      };

      actions.append(
        makeButton("ดูแปลง", () => handlers.onOpenParcel?.(parcel)),
        makeButton("รายละเอียด", () => handlers.onAnalyzeParcel?.(parcel, { reuseCachedResult: true })),
        makeButton("วิเคราะห์ใหม่", () => handlers.onAnalyzeParcel?.(parcel)),
        makeButton("แก้ไขข้อมูล", () => {
          openEditSheet(parcel, async (metadata) => {
            const patch = {};
            ["parcelName", "cropType", "riceVariety", "plantingDate", "note"].forEach((key) => {
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
            renderParcelCards(container);
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
      renderParcelCards(container);
    } catch (error) {
      setStatus(status, getFriendlyError(error) || TEXT.loadFailed, "error");
      container.replaceChildren();
      const retry = createElement("button", "panel-button secondary", "ลองใหม่");
      uiIcons.setActionLabel(retry, "ลองใหม่");
      retry.type = "button";
      retry.addEventListener("click", () => loadMyParcels(container, status));
      container.appendChild(retry);
    }
  }

  function openMyParcelsSheet(options = {}) {
    if (!liffReady) {
      showLineOnlyMessage();
      return;
    }
    if (window.MapUi && typeof window.MapUi.closeTemporaryParcelPanel === "function") {
      window.MapUi.closeTemporaryParcelPanel();
    }
    const { body } = createSheet("my-parcels-sheet", TEXT.myParcels);
    if (options.focusParcelId) {
      focusedSavedParcelId = options.focusParcelId;
      expandedSavedParcelId = options.focusParcelId;
      myParcelsSearchTerm = "";
    } else {
      focusedSavedParcelId = null;
    }
    const searchRow = createElement("div", "my-parcels-search-row");
    const searchInput = createElement("input", "my-parcels-search");
    searchInput.id = "my-parcels-search";
    searchInput.type = "search";
    searchInput.placeholder = "ค้นหาแปลง";
    searchInput.setAttribute("aria-label", "ค้นหาแปลงตามชื่อ รหัส ชนิดพืช หรือพันธุ์");
    searchInput.value = myParcelsSearchTerm;
    const clearButton = createElement("button", "my-parcels-search-clear");
    clearButton.type = "button";
    clearButton.title = "ล้างคำค้น";
    clearButton.setAttribute("aria-label", "ล้างคำค้น");
    clearButton.replaceChildren(uiIcons.create("close"));
    clearButton.hidden = !myParcelsSearchTerm;
    searchRow.append(searchInput, clearButton);
    const status = createElement("p", "parcel-sheet-status");
    status.id = "my-parcels-status";
    status.setAttribute("aria-live", "polite");
    status.setAttribute("role", "status");
    const list = createElement("div", "my-parcels-list");
    list.id = "my-parcels-list";
    searchInput.addEventListener("input", () => {
      myParcelsSearchTerm = searchInput.value;
      focusedSavedParcelId = null;
      clearButton.hidden = !myParcelsSearchTerm;
      renderParcelCards(list);
      list.scrollTop = 0;
    });
    clearButton.addEventListener("click", () => {
      searchInput.value = "";
      myParcelsSearchTerm = "";
      focusedSavedParcelId = null;
      clearButton.hidden = true;
      renderParcelCards(list);
      list.scrollTop = 0;
      searchInput.focus({ preventScroll: true });
    });
    body.append(status, searchRow, list);
    loadMyParcels(list, status);
  }

  function openDeleteDialog(parcel, listContainer) {
    const { backdrop, body } = createSheet("parcel-delete-dialog", TEXT.deleteTitle);
    let isDeleting = false;
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
    uiIcons.setActionLabel(cancelButton, TEXT.cancel);
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => closeSheet(backdrop));
    const deleteButton = createElement("button", "panel-button danger", TEXT.delete);
    uiIcons.setActionLabel(deleteButton, TEXT.delete);
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async () => {
      if (isDeleting) {
        return;
      }
      isDeleting = true;
      cancelButton.disabled = true;
      deleteButton.disabled = true;
      setStatus(status, TEXT.deleting);
      try {
        await window.MapApi.deleteMyParcel(parcel.id);
      } catch (error) {
        isDeleting = false;
        cancelButton.disabled = false;
        deleteButton.disabled = false;
        setStatus(status, getFriendlyError(error), "error");
        return;
      }
      closeSheet(backdrop);
      listRevision += 1;
      cachedParcels = cachedParcels.filter((item) => item.id !== parcel.id);
      syncMyParcelsButton();
      if (expandedSavedParcelId === parcel.id) {
        expandedSavedParcelId = null;
      }
      if (focusedSavedParcelId === parcel.id) {
        focusedSavedParcelId = null;
      }
      if (listContainer) {
        renderParcelCards(listContainer);
      }
      handlers.onParcelDeleted?.(parcel.id);
      setStatus(document.getElementById("my-parcels-status"), TEXT.deleted, "success");
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
      uiIcons.setActionLabel(cancelButton, TEXT.cancel);
      cancelButton.type = "button";
      cancelButton.addEventListener("click", () => {
        closeSheet(backdrop);
        resolve(false);
      });
      const openButton = createElement("button", "panel-button", "เปิดแปลง");
      uiIcons.setActionLabel(openButton, "เปิดแปลง");
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
      renderParcelCards(list);
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
      renderParcelCards(list);
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

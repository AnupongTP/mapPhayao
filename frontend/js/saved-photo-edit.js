(function (window, document) {
  const MAX_PHOTOS = 5;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function create(parcel, onChange = () => {}) {
    const section = createElement("section", "saved-photo-edit");
    const heading = createElement("div", "saved-photo-edit-heading");
    heading.appendChild(createElement("span", null, "รูปภาพแปลง"));
    const count = createElement("span", "saved-photo-edit-count", "0/5");
    heading.appendChild(count);
    const strip = createElement("div", "saved-photo-edit-strip");
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*,.heic,.heif";
    picker.multiple = true;
    picker.hidden = true;
    picker.setAttribute("aria-label", "เลือกรูปภาพแปลง");
    const addButton = createElement("button", "panel-button secondary");
    window.MapUiIcons.setLabel(addButton, "add", "เพิ่มรูป");
    addButton.type = "button";
    addButton.addEventListener("click", () => picker.click());
    const message = createElement("p", "saved-photo-edit-message");
    message.hidden = true;
    section.append(heading, strip, picker, addButton, message);

    const markedForDelete = new Set();
    const newPhotos = [];
    const imageUrls = new Map();
    const controller = new AbortController();
    let existing = [];
    let detail;
    let operationId;
    let operationMetadata;
    let busy = false;
    let disposed = false;
    let loading = true;

    function finalCount() { return existing.length - markedForDelete.size + newPhotos.length; }
    function note(text) {
      message.textContent = text || "";
      message.hidden = !text;
    }
    function tile(photo, kind) {
      const item = createElement("div", "saved-photo-edit-item");
      const image = document.createElement("img");
      image.alt = kind === "existing" ? "รูปภาพแปลงที่บันทึกไว้" : "รูปภาพใหม่";
      const url = kind === "existing" ? imageUrls.get(photo.id) : photo.previewUrl;
      if (url) image.src = url;
      else item.appendChild(createElement("span", "saved-photo-edit-placeholder", "กำลังโหลด..."));
      item.appendChild(image);
      const badge = createElement("span", "saved-photo-edit-badge",
        kind === "existing" ? markedForDelete.has(photo.id) ? "รอลบ" : "" : "ใหม่");
      if (badge.textContent) item.appendChild(badge);
      const button = createElement("button", "saved-photo-edit-action");
      const actionLabel = kind === "existing"
        ? markedForDelete.has(photo.id) ? "ยกเลิกการลบรูปภาพ" : "ทำเครื่องหมายลบรูปภาพ"
        : "นำรูปภาพใหม่ออก";
      button.appendChild(window.MapUiIcons.create(kind === "existing"
        ? markedForDelete.has(photo.id) ? "undo" : "trash-can" : "close"));
      button.type = "button";
      button.disabled = busy || Boolean(operationId);
      button.setAttribute("aria-label", actionLabel);
      button.title = actionLabel;
      button.addEventListener("click", () => {
        if (kind === "existing") {
          if (markedForDelete.has(photo.id)) markedForDelete.delete(photo.id);
          else markedForDelete.add(photo.id);
        } else {
          const index = newPhotos.indexOf(photo);
          if (index !== -1) newPhotos.splice(index, 1);
          URL.revokeObjectURL(photo.previewUrl);
        }
        note("");
        render();
      });
      item.appendChild(button);
      if (kind === "existing" && markedForDelete.has(photo.id)) item.classList.add("is-marked-for-delete");
      return item;
    }
    function render() {
      if (disposed) return;
      count.textContent = loading ? `.../${MAX_PHOTOS}` : `${finalCount()}/${MAX_PHOTOS}`;
      strip.replaceChildren(...existing.map((photo) => tile(photo, "existing")),
        ...newPhotos.map((photo) => tile(photo, "new")));
      addButton.disabled = loading || busy || Boolean(operationId) || finalCount() >= MAX_PHOTOS;
      onChange({ finalCount: finalCount(), busy, operationId });
    }
    async function loadExistingThumbnail(photo) {
      try {
        const blob = await window.MapApi.getParcelImageBlob(parcel.id, photo.id, { signal: controller.signal });
        if (disposed || controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        imageUrls.set(photo.id, url);
        render();
      } catch (error) {
        if (!controller.signal.aborted) {
          note("บางรูปโหลดไม่สำเร็จ");
        }
      }
    }
    const ready = window.MapApi.getMyParcel(parcel.id).then(({ parcel: loaded }) => {
      if (disposed) return;
      detail = loaded;
      existing = Array.isArray(loaded.images) ? loaded.images : [];
      loading = false;
      render();
      existing.forEach((photo) => { void loadExistingThumbnail(photo); });
    });
    ready.catch(() => note("โหลดข้อมูลรูปภาพไม่สำเร็จ"));
    picker.addEventListener("change", () => {
      if (loading || busy || operationId) { picker.value = ""; return; }
      for (const file of picker.files || []) {
        if (finalCount() >= MAX_PHOTOS) {
          note("เลือกได้สูงสุด 5 รูป");
          break;
        }
        newPhotos.push({ file, previewUrl: URL.createObjectURL(file),
          clientPhotoId: window.crypto.randomUUID() });
      }
      picker.value = "";
      render();
    });

    async function save(metadata) {
      await ready;
      if (!detail || disposed) throw new Error("ไม่สามารถโหลดรูปภาพแปลงได้");
      if (finalCount() > MAX_PHOTOS) throw new Error("เลือกได้สูงสุด 5 รูป");
      const photoChanged = markedForDelete.size > 0 || newPhotos.length > 0;
      if (!photoChanged && !operationId) {
        if (!Object.keys(metadata).length) return detail;
        return (await window.MapApi.updateMyParcel(parcel.id, metadata)).parcel;
      }
      if (operationId && JSON.stringify(metadata) !== operationMetadata) {
        throw new Error("รายการแก้ไขเริ่มแล้ว กรุณาบันทึกข้อมูลเดิมให้เสร็จก่อน");
      }
      busy = true;
      render();
      try {
        if (!operationId) {
          const result = await window.MapApi.beginSavedPhotoEdit(parcel.id, {
            expectedUpdatedAt: detail.updatedAt,
            expectedImageIds: existing.map((photo) => photo.id),
            removedImageIds: [...markedForDelete],
            newPhotoIds: newPhotos.map((photo) => photo.clientPhotoId),
            metadata,
          });
          operationId = result.operation.id;
          operationMetadata = JSON.stringify(metadata);
          render();
        }
        const status = await window.MapApi.getSavedPhotoEdit(parcel.id, operationId);
        if (status.operation.status === "ambiguous") {
          throw new Error("ผลการอัปโหลดรูปภาพยังไม่แน่ชัด กรุณาติดต่อผู้ดูแล ห้ามอัปโหลดรูปเดิมซ้ำ");
        }
        if (status.operation.status === "completed") {
          return (await window.MapApi.getMyParcel(parcel.id)).parcel;
        }
        const uploaded = new Set(status.operation.uploadedPhotoIds);
        for (const [index, photo] of newPhotos.entries()) {
          if (uploaded.has(photo.clientPhotoId)) continue;
          await window.MapParcelPhotoProcessing.uploadWithRetry(photo, parcel.id,
            index + 1, newPhotos.length, (progress) => note(progress),
            { photoEditOperationId: operationId });
        }
        await window.MapApi.finalizeSavedPhotoEdit(parcel.id, operationId);
        return (await window.MapApi.getMyParcel(parcel.id)).parcel;
      } catch (error) {
        if (error.photoSetCommitted) error.partialSuccess = true;
        note(error.photoSetCommitted
          ? "รูปภาพได้รับการบันทึกแล้ว แต่ข้อมูลแปลงยังบันทึกไม่สมบูรณ์ กรุณากดบันทึกอีกครั้ง"
          : error.ambiguous
          ? "ผลการอัปโหลดรูปภาพยังไม่แน่ชัด กรุณาติดต่อผู้ดูแล ห้ามอัปโหลดรูปเดิมซ้ำ"
          : error.statusCode === 409 ? "ข้อมูลแปลงเปลี่ยนแล้ว กรุณาตรวจสอบก่อนบันทึกอีกครั้ง"
            : "บันทึกไม่สำเร็จ ข้อมูลที่เลือกยังอยู่ในหน้านี้");
        throw error;
      } finally {
        busy = false;
        render();
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
      newPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      imageUrls.clear();
    }

    render();
    return { element: section, ready, save, dispose, get busy() { return busy; },
      get operationId() { return operationId; } };
  }

  window.MapSavedPhotoEdit = { create };
})(window, document);

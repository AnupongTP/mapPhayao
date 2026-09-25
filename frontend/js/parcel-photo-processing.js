(function (window, document) {
  const MAX_EDGE = 1600;
  const QUALITY = 0.8;

  function encode(canvas, type) {
    if (typeof canvas.toBlob !== "function") return Promise.resolve(null);
    return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
  }

  async function prepareFile(file) {
    if (!file || (!file.type?.startsWith("image/") && !/\.hei[cf]$/i.test(file.name || ""))) {
      return file;
    }
    let previewUrl;
    try {
      previewUrl = URL.createObjectURL(file);
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Image decoding unavailable"));
        element.src = previewUrl;
      });
      if (!image.naturalWidth || !image.naturalHeight) return file;
      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let blob = await encode(canvas, "image/webp");
      if (blob?.type !== "image/webp" && file.type !== "image/png") {
        blob = await encode(canvas, "image/jpeg");
      }
      if (!blob || !["image/webp", "image/jpeg"].includes(blob.type) || blob.size >= file.size) return file;
      const extension = blob.type === "image/webp" ? "webp" : "jpg";
      const name = `${(file.name || "parcel-photo").replace(/\.[^.]+$/, "")}.${extension}`;
      return new File([blob], name, { type: blob.type });
    } catch {
      return file;
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  }

  async function uploadWithRetry(photo, parcelId, position, total, onProgress, options = {}) {
    if (photo.image) return photo.image;
    if (photo.uploadState === "ambiguous") {
      const error = new Error("Photo upload result is ambiguous");
      error.ambiguous = true;
      throw error;
    }
    const context = { photoIndex: position, totalPhotos: total };
    onProgress(`กำลังเตรียมรูป ${position}/${total}...`, { stage: "IMAGE_PREPARING" });
    window.console?.info?.("[ParcelUpload] IMAGE_PREPARING", context);
    photo.uploadFile ||= await prepareFile(photo.file);
    onProgress(`เตรียมรูป ${position}/${total} สำเร็จ`, { stage: "IMAGE_PREPARED" });
    window.console?.info?.("[ParcelUpload] IMAGE_PREPARED", context);
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      if (attempt) {
        onProgress(`กำลังลองอัปโหลดรูป ${position}/${total} อีกครั้ง... (${attempt}/3)`);
        await wait(500 * (2 ** (attempt - 1)));
      }
      try {
        photo.image = await window.MapApi.uploadParcelImage(parcelId, photo.uploadFile, photo.clientPhotoId,
          { attempt,
            onRequestStart: () => {
              onProgress(`กำลังอัปโหลดรูป ${position}/${total}...`, { stage: "REQUEST_STARTING" });
              window.console?.info?.("[ParcelUpload] REQUEST_STARTING", { ...context, attempt });
            },
            onWaiting: () => {
              onProgress(`กำลังรอการตอบกลับรูป ${position}/${total}...`, { stage: "WAITING_FOR_SERVER" });
              window.console?.info?.("[ParcelUpload] WAITING_FOR_SERVER", { ...context, attempt });
            },
            onDiagnostic: (diagnostic) => { photo.diagnostic = diagnostic; },
          });
        onProgress(`อัปโหลดรูป ${position}/${total} สำเร็จ`,
          { stage: "UPLOAD_SUCCESS", requestId: photo.diagnostic?.requestId });
        window.console?.info?.("[ParcelUpload] UPLOAD_SUCCESS", {
          ...context, stage: photo.diagnostic?.stage || null, requestId: photo.diagnostic?.requestId || null,
        });
        return photo.image;
      } catch (error) {
        if (error.stage === "NETWORK_NO_RESPONSE") {
          window.console?.error?.("[ParcelUpload] NETWORK_NO_RESPONSE", {
            ...context, stage: "NETWORK_NO_RESPONSE", ambiguous: true,
            possibleCause: "CORS_OR_NETWORK", message: "ไม่ได้รับการตอบกลับจากเซิร์ฟเวอร์",
          });
        } else if (error.stage === "REQUEST_ABORTED" || error.name === "AbortError") {
          window.console?.warn?.("[ParcelUpload] REQUEST_ABORTED", { ...context, stage: "REQUEST_ABORTED" });
        } else if (Number.isInteger(error.statusCode)) {
          window.console?.error?.("[ParcelUpload] BACKEND_HTTP_ERROR", {
            ...context, status: error.statusCode, stage: error.stage || "BACKEND_HTTP_ERROR",
            code: error.code || "BACKEND_HTTP_ERROR", requestId: error.requestId || null,
            retryable: error.retryable === true, ambiguous: error.ambiguous === true,
            message: "เซิร์ฟเวอร์ไม่สามารถอัปโหลดรูปภาพได้",
          });
        } else {
          window.console?.error?.("[ParcelUpload] UPLOAD_FAILED", {
            ...context, message: "ไม่สามารถเริ่มคำขออัปโหลดได้",
          });
        }
        if (error.ambiguous) photo.uploadState = "ambiguous";
        if (!error.retryable || attempt === 3) {
          onProgress(`อัปโหลดรูป ${position}/${total} ไม่สำเร็จ`, { stage: "UPLOAD_FAILED", error });
          throw error;
        }
      }
    }
  }

  window.MapParcelPhotoProcessing = { prepareFile, uploadWithRetry };
})(window, document);

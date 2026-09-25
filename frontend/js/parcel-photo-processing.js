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

  window.MapParcelPhotoProcessing = { prepareFile };
})(window, document);

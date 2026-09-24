(function (window, document) {
  const ICON_CLASS = Object.freeze({
    add: "plus",
    cancel: "xmark",
    close: "xmark",
    confirm: "check",
    draw: "draw-polygon",
    finish: "check",
    layers: "layer-group",
    line: "comment-dots",
    locate: "location-crosshairs",
    parcels: "map",
    save: "floppy-disk",
    undo: "rotate-left",
  });
  const TEXT_ICON = Object.freeze({
    "รับสรุปข้อมูลทาง LINE": "line",
    "ดูผลการตรวจสอบตำแหน่ง": "chart-column",
    "ดูรายละเอียด": "circle-info",
    "ดูแปลง": "map-location-dot",
    "บันทึกขอบเขต": "save",
    "บันทึกแปลง": "save",
    "บันทึกแก้ไข": "save",
    "เปิดแปลง": "folder-open",
    "ยกเลิก": "cancel",
    "ยกเลิกการวาด": "cancel",
    "ยกเลิกแก้ไข": "cancel",
    "ยืนยัน": "confirm",
    "ยืนยันตำแหน่ง": "confirm",
    "ลบ": "trash-can",
    "ลบแปลง": "trash-can",
    "ลองใหม่": "rotate-right",
    "วาดพื้นที่แปลง": "draw",
    "วิเคราะห์ใหม่": "rotate-right",
    "หาตำแหน่งปัจจุบัน": "locate",
    "แก้ไขข้อมูล": "pen-to-square",
    "แก้ไขขอบเขต": "draw",
    "แปลงของฉัน": "parcels",
    "แปลงชั่วคราว": "draw",
    "เปลี่ยนชื่อ": "pen",
    "เลือก": "arrow-pointer",
    "เพิ่มจุด": "add",
    "เสร็จสิ้น": "finish",
    "ย้อนจุด": "undo",
    "ซูม": "magnifying-glass-plus",
  });

  function create(name, options = {}) {
    const iconName = ICON_CLASS[name] || name;
    const icon = document.createElement("i");
    icon.className = `fa-solid fa-${iconName}`;
    icon.setAttribute("aria-hidden", "true");
    if (options.className) {
      icon.classList.add(...String(options.className).split(/\s+/).filter(Boolean));
    }
    return icon;
  }

  function setLabel(element, iconName, text) {
    if (!element || typeof element.replaceChildren !== "function") {
      if (element) {
        element.textContent = text;
      }
      return element;
    }
    const label = document.createElement("span");
    label.textContent = text;
    element.replaceChildren(create(iconName), label);
    return element;
  }

  function setActionLabel(element, text, fallbackIcon) {
    const iconName = TEXT_ICON[text] || fallbackIcon;
    if (!iconName) {
      element.textContent = text;
      return element;
    }
    return setLabel(element, iconName, text);
  }

  function setChevron(element, isExpanded) {
    if (!element || typeof element.replaceChildren !== "function") {
      if (element) {
        element.textContent = isExpanded ? "⌃" : "⌄";
      }
      return element;
    }
    element.replaceChildren(create(isExpanded ? "chevron-up" : "chevron-down"));
    return element;
  }

  window.MapUiIcons = Object.freeze({ create, setLabel, setActionLabel, setChevron });
})(window, document);

const { Readable } = require("node:stream");
const createHttpError = require("../utils/httpError");
const { atGoogleStage, tagGoogleError } = require("../utils/googleError");
const { createAppsScriptDriveBridge } = require("./appsScriptDriveBridge");

const SPREADSHEET_TABS = Object.freeze({ users: "users", parcels: "parcels" });
const PARCEL_HEADERS = Object.freeze([
  "user_id", "display_name", "parcel_code", "parcel_name", "crop", "variety",
  "planting_date", "Coordinate", "geometry", "area_m2", "area_rai",
  "Image", "LinkImage", "note", "created_at", "updated_at",
]);

function iso(value) {
  return value ? new Date(value).toISOString() : "";
}

function userCells(user) {
  return [user.id, user.display_name || "", iso(user.created_at), iso(user.updated_at)];
}

function formatCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function parcelCells(parcel, images = []) {
  return [
    parcel.owner_user_id, parcel.display_name || "", parcel.parcel_code, parcel.parcel_name || "",
    parcel.crop_type, parcel.rice_variety || "", parcel.planting_date || "",
    formatCoordinate(parcel.representative_lat, parcel.representative_lng),
    JSON.stringify(parcel.geometry), Number(parcel.area_sqm), Number(parcel.area_rai),
    JSON.stringify(images.map((image) => image.fileName)),
    JSON.stringify(images.map((image) => image.linkImage)),
    "",
    iso(parcel.created_at), iso(parcel.updated_at),
  ];
}

function imageFileId(link) {
  let url;
  try { url = new URL(link); } catch { throw new Error("Invalid parcel image link"); }
  const id = url.searchParams.get("id");
  const oldFormat = url.hostname === "drive.google.com" && url.pathname === "/uc";
  const newFormat = url.hostname === "drive.usercontent.google.com" && url.pathname === "/download";
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
    (!oldFormat && !newFormat) || [...url.searchParams].length !== 2 ||
    url.searchParams.getAll("id").length !== 1 ||
    url.searchParams.getAll("export").length !== 1 ||
    url.searchParams.get("export") !== "view" ||
    !id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid parcel image link");
  }
  return id;
}

function parseParcelImages(cells) {
  let names;
  let links;
  try {
    names = JSON.parse(cells[11] || "[]");
    links = JSON.parse(cells[12] || "[]");
  } catch { throw new Error("Invalid parcel image arrays"); }
  if (!Array.isArray(names) || !Array.isArray(links) || names.length !== links.length ||
    names.some((name) => typeof name !== "string" || !/^[a-zA-Z0-9_-]+\.webp$/.test(name)) ||
    links.some((link) => typeof link !== "string")) {
    throw new Error("Invalid parcel image arrays");
  }
  return names.map((fileName, index) => ({
    id: fileName, fileName, fileId: imageFileId(links[index]),
  })).map((image) => ({ ...image, linkImage: imageLink(image.fileId) }));
}

function imageLink(fileId) {
  if (typeof fileId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    throw new Error("Invalid parcel image file id");
  }
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", fileId);
  url.searchParams.set("export", "view");
  return url.toString();
}

function createGoogleParcelIntegration(env = process.env, google = require("googleapis").google,
  bridgeOptions = {}) {
  if (env.GOOGLE_MIRROR_ENABLED !== "true") {
    return { enabled: false };
  }
  const accountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!accountJson || !spreadsheetId) {
    throw new Error("Google Sheets integration is enabled but configuration is incomplete");
  }
  let credentials;
  try {
    credentials = JSON.parse(accountJson);
  } catch (error) {
    throw new Error("Google service account configuration is invalid");
  }
  const sheetsAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth });
  const provider = env.GOOGLE_DRIVE_PROVIDER;
  const folderId = env.GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID;
  let drive;
  if (provider === "apps-script") {
    try {
      drive = createAppsScriptDriveBridge({
        url: env.GOOGLE_DRIVE_APPS_SCRIPT_URL,
        secret: env.GOOGLE_DRIVE_APPS_SCRIPT_SECRET,
        ...bridgeOptions,
      });
    } catch { /* Sheet mirroring remains available when Drive is misconfigured. */ }
  } else if (provider === "oauth") {
    const clientId = env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
    const clientSecret = env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
    const refreshToken = env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
    if (folderId && clientId && clientSecret && refreshToken) {
      const driveAuth = new google.auth.OAuth2(clientId, clientSecret);
      driveAuth.setCredentials({ refresh_token: refreshToken });
      const oauthDrive = google.drive({ version: "v3", auth: driveAuth });
      drive = {
        async uploadImage(bytes, fileName) {
          const response = await atGoogleStage("drive-upload", () => oauthDrive.files.create({
            requestBody: { name: fileName, parents: [folderId] },
            media: { mimeType: "image/webp", body: Readable.from(bytes) }, fields: "id",
          }));
          if (typeof response.data.id !== "string" || !response.data.id) {
            throw tagGoogleError(new Error("Google Drive did not return a file id"), "drive-upload");
          }
          return response.data.id;
        },
        async deleteImage(fileId) {
          await atGoogleStage("drive-delete", () => oauthDrive.files.delete({ fileId }));
        },
        async getImage(fileId) {
          const response = await atGoogleStage("drive-read", () =>
            oauthDrive.files.get({ fileId, alt: "media" }, { responseType: "stream" }));
          return response.data;
        },
      };
    }
  }
  function requireDrive() {
    if (!drive) {
      throw tagGoogleError(createHttpError(503, "บริการรูปภาพแปลงยังไม่พร้อมใช้งาน"), "drive-config");
    }
    return drive;
  }
  let sheetWrites = Promise.resolve();

  async function assertParcelHeaders() {
    const response = await atGoogleStage("sheets-header-check", () =>
      sheets.spreadsheets.values.get({ spreadsheetId, range: "parcels!A1:P1" }));
    const headers = response.data.values?.[0] || [];
    if (headers.length !== PARCEL_HEADERS.length ||
      headers.some((header, index) => header !== PARCEL_HEADERS[index])) {
      const error = new Error("Google parcels sheet headers do not match the expected A-P contract");
      error.code = "SHEET_HEADER_MISMATCH";
      throw tagGoogleError(error, "sheets-header-check");
    }
  }

  async function findRow(tab, key) {
    const response = await atGoogleStage("sheets-read", () => sheets.spreadsheets.values.get({
      spreadsheetId, range: tab === SPREADSHEET_TABS.users ? "users!A2:D" : "parcels!A2:P",
    }));
    const rows = response.data.values || [];
    const column = tab === SPREADSHEET_TABS.users ? 0 : 2;
    const index = rows.findIndex((row) => row[column] === key);
    return index < 0 ? null : { number: index + 2, cells: rows[index] };
  }

  function serializeWrite(action) {
    const operation = sheetWrites.then(action);
    sheetWrites = operation.catch(() => {});
    return operation;
  }

  async function upsert(tab, key, cells) {
    return atGoogleStage(tab === SPREADSHEET_TABS.users ? "sheets-upsert-user" : "sheets-upsert-parcel", () => serializeWrite(async () => {
      if (tab === SPREADSHEET_TABS.parcels) await assertParcelHeaders();
      const row = await findRow(tab, key);
      if (row) {
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: tab === SPREADSHEET_TABS.users
            ? `users!A${row.number}:D${row.number}` : `parcels!A${row.number}:P${row.number}`,
          valueInputOption: "RAW", requestBody: { values: [cells] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId, range: tab === SPREADSHEET_TABS.users ? "users!A:D" : "parcels!A:P",
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS", requestBody: { values: [cells] },
        });
      }
    }));
  }

  return {
    enabled: true,
    async uploadImage(bytes, fileName) { return requireDrive().uploadImage(bytes, fileName); },
    async deleteImage(fileId) { return requireDrive().deleteImage(fileId); },
    async getImage(fileId) { return requireDrive().getImage(fileId); },
    upsertUser(user) { return upsert(SPREADSHEET_TABS.users, user.id, userCells(user)); },
    upsertParcel(parcel) {
      return atGoogleStage("sheets-upsert-parcel", () => serializeWrite(async () => {
        await assertParcelHeaders();
        const row = await findRow(SPREADSHEET_TABS.parcels, parcel.parcel_code);
        if (row && row.cells[0] !== parcel.owner_user_id) throw new Error("Parcel Sheet owner mismatch");
        const cells = parcelCells(parcel, row ? parseParcelImages(row.cells) : []);
        if (row) {
          await sheets.spreadsheets.values.update({ spreadsheetId,
            range: `parcels!A${row.number}:P${row.number}`, valueInputOption: "RAW",
            requestBody: { values: [cells] } });
        } else {
          await sheets.spreadsheets.values.append({ spreadsheetId, range: "parcels!A:P",
            valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [cells] } });
        }
      }));
    },
    getParcelImages(parcelCode, ownerUserId) {
      return atGoogleStage("sheets-read", () => serializeWrite(async () => {
        await assertParcelHeaders();
        const row = await findRow(SPREADSHEET_TABS.parcels, parcelCode);
        if (!row) throw new Error("Parcel Sheet row is missing");
        if (row.cells[0] !== ownerUserId) throw new Error("Parcel Sheet owner mismatch");
        return parseParcelImages(row.cells);
      }));
    },
    appendParcelImage(parcelCode, ownerUserId, fileName, fileId, parcelRecord) {
      return atGoogleStage("sheets-append-image", () => serializeWrite(async () => {
        await assertParcelHeaders();
        const row = await findRow(SPREADSHEET_TABS.parcels, parcelCode);
        if (row && row.cells[0] !== ownerUserId) throw new Error("Parcel Sheet owner mismatch");
        if (!row && (!parcelRecord || parcelRecord.owner_user_id !== ownerUserId ||
          parcelRecord.parcel_code !== parcelCode)) throw new Error("Parcel Sheet row is missing");
        const images = row ? parseParcelImages(row.cells) : [];
        const existing = images.find((item) => item.fileName === fileName);
        if (existing) {
          if (existing.fileId !== fileId) throw new Error("Duplicate parcel image");
          return existing;
        }
        const image = { id: fileName, fileName, linkImage: imageLink(fileId), fileId };
        images.push(image);
        if (row) {
          await sheets.spreadsheets.values.update({ spreadsheetId,
            range: `parcels!L${row.number}:M${row.number}`, valueInputOption: "RAW",
            requestBody: { values: [[JSON.stringify(images.map((item) => item.fileName)),
              JSON.stringify(images.map((item) => item.linkImage))]] } });
        } else {
          await sheets.spreadsheets.values.append({ spreadsheetId, range: "parcels!A:P",
            valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
            requestBody: { values: [parcelCells(parcelRecord, images)] } });
        }
        return image;
      }));
    },
    deleteParcel(parcelCode) {
      return atGoogleStage("sheets-delete-parcel", () => serializeWrite(async () => {
        await assertParcelHeaders();
        const row = await findRow(SPREADSHEET_TABS.parcels, parcelCode);
        if (!row) return;
        const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
        const sheet = metadata.data.sheets.find((item) => item.properties.title === SPREADSHEET_TABS.parcels);
        if (!sheet) throw new Error("parcels sheet is missing");
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ deleteDimension: {
            range: { sheetId: sheet.properties.sheetId, dimension: "ROWS", startIndex: row.number - 1, endIndex: row.number },
          } }] },
        });
      }));
    },
  };
}

module.exports = { createGoogleParcelIntegration, userCells, parcelCells, formatCoordinate,
  parseParcelImages, imageLink, PARCEL_HEADERS };

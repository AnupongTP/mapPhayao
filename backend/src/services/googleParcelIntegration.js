const { Readable } = require("node:stream");

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
    "",
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
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com" ||
    url.pathname !== "/uc" || url.searchParams.get("export") !== "view" ||
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
    id: fileName, fileName, linkImage: links[index],
    fileId: imageFileId(links[index]),
  }));
}

function imageLink(fileId) {
  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
}

function createGoogleParcelIntegration(env = process.env) {
  if (env.GOOGLE_MIRROR_ENABLED !== "true") {
    return { enabled: false };
  }
  const accountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const folderId = env.GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID;
  if (!accountJson || !spreadsheetId || !folderId) {
    throw new Error("Google parcel integration is enabled but configuration is incomplete");
  }
  let credentials;
  try {
    credentials = JSON.parse(accountJson);
  } catch (error) {
    throw new Error("Google service account configuration is invalid");
  }
  const { google } = require("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/spreadsheets"],
  });
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });
  let sheetWrites = Promise.resolve();

  async function assertParcelHeaders() {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "parcels!A1:P1" });
    const headers = response.data.values?.[0] || [];
    if (headers.length !== PARCEL_HEADERS.length ||
      headers.some((header, index) => header !== PARCEL_HEADERS[index])) {
      const error = new Error("Google parcels sheet headers do not match the expected A-P contract");
      error.code = "SHEET_HEADER_MISMATCH";
      throw error;
    }
  }

  async function findRow(tab, key) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId, range: tab === SPREADSHEET_TABS.users ? "users!A2:D" : "parcels!A2:P",
    });
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
    return serializeWrite(async () => {
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
    });
  }

  return {
    enabled: true,
    async uploadImage(bytes, fileName) {
      const response = await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType: "image/webp", body: Readable.from(bytes) },
        fields: "id",
      });
      if (typeof response.data.id !== "string" || !response.data.id) {
        throw new Error("Google Drive did not return a file id");
      }
      return response.data.id;
    },
    async deleteImage(fileId) {
      await drive.files.delete({ fileId });
    },
    async getImage(fileId) {
      const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
      return response.data;
    },
    upsertUser(user) { return upsert(SPREADSHEET_TABS.users, user.id, userCells(user)); },
    upsertParcel(parcel) {
      return serializeWrite(async () => {
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
      });
    },
    getParcelImages(parcelCode, ownerUserId) {
      return serializeWrite(async () => {
        await assertParcelHeaders();
        const row = await findRow(SPREADSHEET_TABS.parcels, parcelCode);
        if (!row) throw new Error("Parcel Sheet row is missing");
        if (row.cells[0] !== ownerUserId) throw new Error("Parcel Sheet owner mismatch");
        return parseParcelImages(row.cells);
      });
    },
    appendParcelImage(parcelCode, ownerUserId, fileName, fileId) {
      return serializeWrite(async () => {
        await assertParcelHeaders();
        const row = await findRow(SPREADSHEET_TABS.parcels, parcelCode);
        if (!row) throw new Error("Parcel Sheet row is missing");
        if (row.cells[0] !== ownerUserId) throw new Error("Parcel Sheet owner mismatch");
        const images = parseParcelImages(row.cells);
        if (images.some((image) => image.fileName === fileName)) throw new Error("Duplicate parcel image");
        const image = { id: fileName, fileName, linkImage: imageLink(fileId), fileId };
        images.push(image);
        await sheets.spreadsheets.values.update({ spreadsheetId,
          range: `parcels!L${row.number}:M${row.number}`, valueInputOption: "RAW",
          requestBody: { values: [[JSON.stringify(images.map((item) => item.fileName)),
            JSON.stringify(images.map((item) => item.linkImage))]] } });
        return image;
      });
    },
    deleteParcel(parcelCode) {
      return serializeWrite(async () => {
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
      });
    },
  };
}

module.exports = { createGoogleParcelIntegration, userCells, parcelCells, formatCoordinate,
  parseParcelImages, imageLink, PARCEL_HEADERS };

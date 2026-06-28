// helper เล็ก ๆ สำหรับสร้าง error ที่มี HTTP status แนบไปด้วย
function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = createHttpError;

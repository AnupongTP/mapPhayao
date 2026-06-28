// Controller สำหรับ CRUD แปลงเกษตร ใช้ service คุยกับ PostGIS
const parcelService = require("../services/parcelService");

async function createParcel(req, res, next) {
  try {
    const parcel = await parcelService.createParcel(req.body || {});
    return res.status(201).json({
      success: true,
      parcel,
    });
  } catch (error) {
    return next(error);
  }
}

async function getParcel(req, res, next) {
  try {
    const parcel = await parcelService.getParcelById(req.params.id);
    return res.status(200).json({
      success: true,
      parcel,
    });
  } catch (error) {
    return next(error);
  }
}

async function listParcels(req, res, next) {
  try {
    const parcels = await parcelService.listParcels({
      limit: req.query.limit,
    });
    return res.status(200).json({
      success: true,
      parcels,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateParcel(req, res, next) {
  try {
    const parcel = await parcelService.updateParcel(req.params.id, req.body || {});
    return res.status(200).json({
      success: true,
      parcel,
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteParcel(req, res, next) {
  try {
    await parcelService.deleteParcel(req.params.id);
    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createParcel,
  getParcel,
  listParcels,
  updateParcel,
  deleteParcel,
};

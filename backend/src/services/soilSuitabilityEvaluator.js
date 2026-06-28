// Evaluator สำหรับความเหมาะสมด้านดิน: framework เผื่อ rule ที่ verified ในอนาคต
const db = require("../config/database");

const RICE_ECOSYSTEM = "LOWLAND_PADDY";

const classLabels = {
  S1: "เหมาะสมมาก",
  S2: "เหมาะสมปานกลาง",
  S3: "เหมาะสมน้อย",
  N: "ไม่เหมาะสม",
};

const classRank = {
  S1: 1,
  S2: 2,
  S3: 3,
  N: 4,
};

const ACTIVE_RULE_SET_QUERY = `
SELECT
  id,
  rule_version,
  rule_name_th,
  rice_ecosystem,
  source_name,
  source_reference,
  source_year,
  is_verified,
  is_active
FROM ref.rice_soil_rule_sets
WHERE rice_ecosystem = $1
  AND is_verified = true
  AND is_active = true
ORDER BY created_at DESC, id DESC
LIMIT 1;
`;

const RULE_FRAMEWORK_COUNT_QUERY = `
SELECT
  (
    SELECT COUNT(*)::integer
    FROM ref.rice_soil_rule_sets
    WHERE rice_ecosystem = $1
  ) AS rule_set_count,
  (
    SELECT COUNT(*)::integer
    FROM ref.rice_soil_series_rules sr
    JOIN ref.rice_soil_rule_sets rs ON rs.id = sr.rule_set_id
    WHERE rs.rice_ecosystem = $1
  ) AS series_rule_count,
  (
    SELECT COUNT(*)::integer
    FROM ref.rice_soil_factor_rules fr
    JOIN ref.rice_soil_rule_sets rs ON rs.id = fr.rule_set_id
    WHERE rs.rice_ecosystem = $1
  ) AS factor_rule_count;
`;

const DIRECT_SERIES_RULE_QUERY = `
SELECT
  sr.series_no,
  sr.soil_symbol,
  sr.suitability_class,
  sr.limitation_th,
  sr.recommendation_th,
  COALESCE(sr.source_reference, rs.source_reference) AS source_reference,
  rs.rule_version,
  rs.rule_name_th,
  rs.rice_ecosystem,
  rs.source_name,
  rs.source_year
FROM ref.rice_soil_series_rules sr
JOIN ref.rice_soil_rule_sets rs ON rs.id = sr.rule_set_id
WHERE sr.rule_set_id = $1
  AND sr.series_no = $2
  AND sr.is_verified = true
ORDER BY sr.id DESC
LIMIT 1;
`;

const FACTOR_RULES_QUERY = `
SELECT
  factor_code,
  factor_label_th,
  value_type,
  min_value,
  max_value,
  text_value,
  suitability_class,
  limitation_th,
  sort_order
FROM ref.rice_soil_factor_rules
WHERE rule_set_id = $1
ORDER BY sort_order, id;
`;

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMissingFields(value) {
  return Array.isArray(value) ? value : [];
}

function buildBaseResult(overrides = {}) {
  return {
    class: null,
    label: "ยังไม่มีเกณฑ์ประเมินที่ผ่านการตรวจสอบ",
    status: "NO_RULE",
    ruleStatus: "NO_RULE",
    riceEcosystem: RICE_ECOSYSTEM,
    evaluatedFactors: [],
    missingFields: [],
    mainLimitation: null,
    limitation: null,
    recommendation: null,
    ruleVersion: null,
    sourceName: null,
    sourceReference: null,
    sourceYear: null,
    ...overrides,
  };
}

async function evaluateSoilSuitability(soil) {
  // data_status คุมว่าใช้ rule ได้แค่ไหน: AVAILABLE, PARTIAL_DATA, NO_DATA
  if (!soil) {
    return buildBaseResult({
      label: "ไม่พบข้อมูลชุดดินสำหรับตำแหน่งนี้",
      status: "NO_DATA",
      ruleStatus: "NO_DATA",
    });
  }

  const missingFields = normalizeMissingFields(soil.missing_fields);

  if (soil.data_status === "NO_DATA") {
    return buildBaseResult({
      label: "ยังไม่สามารถประเมินความเหมาะสมด้านดินได้",
      status: "NO_DATA",
      ruleStatus: "NO_DATA",
      missingFields,
      mainLimitation: "ไม่พบข้อมูลดินที่เพียงพอสำหรับการประเมิน",
      limitation: "ไม่พบข้อมูลดินที่เพียงพอสำหรับการประเมิน",
      recommendation: "ควรตรวจสอบข้อมูลดินเพิ่มเติมก่อนตัดสินใจปลูกข้าว",
    });
  }

  const activeRuleSet = await getActiveRuleSet();
  if (!activeRuleSet) {
    const frameworkState = await getRuleFrameworkState();
    const hasAnyRuleRecords =
      frameworkState.rule_set_count > 0 ||
      frameworkState.series_rule_count > 0 ||
      frameworkState.factor_rule_count > 0;

    return buildBaseResult({
      label: hasAnyRuleRecords
        ? "มีเกณฑ์ในระบบแต่ยังไม่ได้เปิดใช้งาน"
        : "ยังไม่มีเกณฑ์ประเมินที่ผ่านการตรวจสอบ",
      status: hasAnyRuleRecords ? "RULE_SET_INACTIVE" : "NO_RULE",
      ruleStatus: hasAnyRuleRecords ? "RULE_SET_INACTIVE" : "NO_RULE",
      missingFields,
      mainLimitation:
        soil.data_status === "PARTIAL_DATA"
          ? "ยังขาดข้อมูลดินบางรายการและยังไม่มีเกณฑ์ประเมินที่ผ่านการตรวจสอบ"
          : null,
      limitation:
        soil.data_status === "PARTIAL_DATA"
          ? "ยังขาดข้อมูลดินบางรายการและยังไม่มีเกณฑ์ประเมินที่ผ่านการตรวจสอบ"
          : null,
      recommendation:
        soil.data_status === "PARTIAL_DATA"
          ? "ควรใช้ข้อมูลดินที่มีอยู่เพื่อประกอบการตรวจสอบเบื้องต้น และยังไม่ควรสรุประดับความเหมาะสม"
          : "ต้องเพิ่มเกณฑ์ประเมินที่มีแหล่งอ้างอิงและผ่านการตรวจสอบก่อน",
    });
  }

  const directRule = await getVerifiedDirectSeriesRule({
    ruleSetId: activeRuleSet.id,
    seriesNo: soil.series_no,
  });

  if (directRule) {
    return buildEvaluatedResultFromDirectRule({ rule: directRule, missingFields });
  }

  if (soil.data_status === "PARTIAL_DATA") {
    return buildBaseResult({
      label: "ยังไม่สามารถประเมินความเหมาะสมด้านดินได้",
      status: "PARTIAL_DATA",
      ruleStatus: "PARTIAL_DATA",
      missingFields,
      mainLimitation: "ข้อมูลดินบางรายการยังไม่ครบและไม่มี direct series rule ที่ตรวจสอบแล้ว",
      limitation: "ข้อมูลดินบางรายการยังไม่ครบและไม่มี direct series rule ที่ตรวจสอบแล้ว",
      recommendation: "ต้องเติมข้อมูลดินที่ยังขาด หรือเพิ่ม direct series rule จากแหล่งอ้างอิงที่ตรวจสอบแล้ว",
      ruleVersion: activeRuleSet.rule_version,
      sourceName: activeRuleSet.source_name,
      sourceReference: activeRuleSet.source_reference,
      sourceYear: toNumberOrNull(activeRuleSet.source_year),
    });
  }

  const factorRules = await getFactorRules(activeRuleSet.id);
  const evaluatedFactors = evaluateFactorRules({ soil, factorRules });

  if (!evaluatedFactors.length) {
    return buildBaseResult({
      label: "ยังไม่มีเกณฑ์ประเมินที่ผ่านการตรวจสอบ",
      status: "NO_RULE",
      ruleStatus: "NO_RULE",
      missingFields,
      ruleVersion: activeRuleSet.rule_version,
      sourceName: activeRuleSet.source_name,
      sourceReference: activeRuleSet.source_reference,
      sourceYear: toNumberOrNull(activeRuleSet.source_year),
      recommendation: "ต้องเพิ่ม factor rules ที่ตรงกับข้อมูลดินที่มีอยู่ก่อน",
    });
  }

  return buildEvaluatedResultFromFactors({
    activeRuleSet,
    evaluatedFactors,
    missingFields,
  });
}

async function getActiveRuleSet() {
  const result = await db.query(ACTIVE_RULE_SET_QUERY, [RICE_ECOSYSTEM]);
  return result.rows[0] || null;
}

async function getRuleFrameworkState() {
  const result = await db.query(RULE_FRAMEWORK_COUNT_QUERY, [RICE_ECOSYSTEM]);
  return result.rows[0] || {
    rule_set_count: 0,
    series_rule_count: 0,
    factor_rule_count: 0,
  };
}

async function getVerifiedDirectSeriesRule({ ruleSetId, seriesNo }) {
  const parsedSeriesNo = toNumberOrNull(seriesNo);
  if (!parsedSeriesNo) {
    return null;
  }

  const result = await db.query(DIRECT_SERIES_RULE_QUERY, [ruleSetId, parsedSeriesNo]);
  return result.rows[0] || null;
}

async function getFactorRules(ruleSetId) {
  const result = await db.query(FACTOR_RULES_QUERY, [ruleSetId]);
  return result.rows;
}

function buildEvaluatedResultFromDirectRule({ rule, missingFields }) {
  return buildBaseResult({
    class: rule.suitability_class,
    label: classLabels[rule.suitability_class] || rule.suitability_class,
    status: "EVALUATED",
    ruleStatus: "EVALUATED",
    riceEcosystem: rule.rice_ecosystem,
    missingFields,
    mainLimitation: rule.limitation_th,
    limitation: rule.limitation_th,
    recommendation: rule.recommendation_th,
    ruleVersion: rule.rule_version,
    sourceName: rule.source_name,
    sourceReference: rule.source_reference,
    sourceYear: toNumberOrNull(rule.source_year),
  });
}

function buildEvaluatedResultFromFactors({ activeRuleSet, evaluatedFactors, missingFields }) {
  // ถ้ามีหลาย factor ที่ผ่าน rule ให้ใช้ factor ที่จำกัดมากสุดเป็น class สุดท้าย
  const mostLimitingFactor = evaluatedFactors.reduce((current, next) => {
    if (!current) {
      return next;
    }

    return classRank[next.class] > classRank[current.class] ? next : current;
  }, null);

  return buildBaseResult({
    class: mostLimitingFactor.class,
    label: classLabels[mostLimitingFactor.class] || mostLimitingFactor.class,
    status: "EVALUATED",
    ruleStatus: "EVALUATED",
    evaluatedFactors,
    missingFields,
    mainLimitation: mostLimitingFactor.limitation,
    limitation: mostLimitingFactor.limitation,
    recommendation: "ผลนี้เป็นการประเมินด้านดินเท่านั้น ยังไม่รวมปัจจัยน้ำ ชลประทาน และภูมิประเทศ",
    ruleVersion: activeRuleSet.rule_version,
    sourceName: activeRuleSet.source_name,
    sourceReference: activeRuleSet.source_reference,
    sourceYear: toNumberOrNull(activeRuleSet.source_year),
  });
}

function evaluateFactorRules({ soil, factorRules }) {
  return factorRules
    .map((rule) => evaluateFactorRule({ soil, rule }))
    .filter(Boolean);
}

function evaluateFactorRule({ soil, rule }) {
  // factor หนึ่งตัวจะมีผลก็ต่อเมื่อ input value ของดินตรงกับเงื่อนไขของ rule
  const inputValue = getFactorInputValue({ soil, factorCode: rule.factor_code });

  if (inputValue === null || inputValue === undefined) {
    return null;
  }

  if (!doesRuleMatchValue({ rule, inputValue })) {
    return null;
  }

  return {
    factorCode: rule.factor_code,
    factorLabel: rule.factor_label_th,
    inputValue,
    class: rule.suitability_class,
    limitation: rule.limitation_th,
  };
}

function getFactorInputValue({ soil, factorCode }) {
  const factorMap = {
    SERIES_NO: soil.series_no,
    DRAINAGE: soil.drainage,
    EFFECTIVE_DEPTH: soil.eff_depth,
    SURFACE_TEXTURE: soil.surface_texture_code,
    SURFACE_PH_WATER: soil.surface_ph_water,
    PROFILE_DEPTH_CM: soil.profile_max_depth_cm,
  };

  return factorMap[factorCode] ?? null;
}

function doesRuleMatchValue({ rule, inputValue }) {
  if (rule.value_type === "NUMBER_RANGE") {
    const number = toNumberOrNull(inputValue);
    const min = toNumberOrNull(rule.min_value);
    const max = toNumberOrNull(rule.max_value);

    if (number === null) {
      return false;
    }

    if (min !== null && number < min) {
      return false;
    }

    if (max !== null && number > max) {
      return false;
    }

    return true;
  }

  if (rule.value_type === "TEXT") {
    return String(inputValue).trim() === String(rule.text_value || "").trim();
  }

  if (rule.value_type === "EXACT_NUMBER") {
    return toNumberOrNull(inputValue) === toNumberOrNull(rule.text_value);
  }

  return false;
}

module.exports = {
  RICE_ECOSYSTEM,
  classLabels,
  evaluateSoilSuitability,
  evaluateFactorRules,
  doesRuleMatchValue,
};

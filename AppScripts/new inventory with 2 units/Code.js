/**
 * ═══════════════════════════════════════════════════════════════════
 * STOCK MANAGER — Google Apps Script Backend (Code.gs)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * DATABASE SCHEMA:
 * - MT.* sheets (categories): 7-column item master
 * - All_Transactions: 22-column transaction log
 * - SiteNameList: A:A site names
 * - UOM_Master: Units of measurement
 * - Config: System configuration
 */

// ============================================================================
// CONSTANTS
// ============================================================================
const TRANSACTIONS_SHEET_NAME = 'All_Transactions';
const SITE_LIST_SHEET_NAME = 'SiteNameList';
const UPLOAD_FOLDER_NAME = 'Inventory_Bills_Uploads';
const MT_SHEET_PREFIX = 'MT.';
const HEADER_ROW_COUNT = 1;
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Stock Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================================
// DRIVE FOLDER HELPER
// ============================================================================

function getOrCreateActiveFolder(folderName) {
  if (!folderName || !folderName.toString().trim()) {
    throw new Error('getOrCreateActiveFolder: folderName is empty/null');
  }
  const props = PropertiesService.getScriptProperties();
  const propKey = 'FOLDER_ID_' + folderName.replace(/\s+/g, '_');
  const savedId = props.getProperty(propKey);
  if (savedId) {
    try {
      const existing = DriveApp.getFolderById(savedId);
      if (!existing.isTrashed()) return existing;
    } catch (e) {
      props.deleteProperty(propKey);
    }
  }
  let folder;
  try {
    folder = DriveApp.createFolder(folderName);
  } catch (createErr) {
    throw new Error('Could not create folder "' + folderName + '": ' + createErr.toString());
  }
  props.setProperty(propKey, folder.getId());
  return folder;
}

// ============================================================================
// DRIVE THUMBNAIL HELPER
// ============================================================================

function toDriveThumbnailUrl(url, size) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  if (!url) return '';
  if (url.includes('/thumbnail?')) return url;
  let fileId = '';
  let match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) { fileId = match[1]; }
  else {
    match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) fileId = match[1];
  }
  if (fileId) {
    return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + (size || 400);
  }
  return url;
}

// ============================================================================
// CONCURRENCY LOCK
// ============================================================================

function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);
    return fn();
  } catch (e) {
    throw new Error('Concurrency lock timeout: ' + e.toString());
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// SYSTEM CONFIG
// ============================================================================

function getSystemConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('Config');
  const defaults = {
    decimal_precision_rates: 4,
    decimal_precision_qty: 3,
    decimal_precision_money: 2
  };
  if (!configSheet) return defaults;
  const values = configSheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < values.length; i++) {
    config[values[i][0]] = values[i][1];
  }
  return {
    decimal_precision_rates: parseInt(config['decimal_precision_rates']) || defaults.decimal_precision_rates,
    decimal_precision_qty: parseInt(config['decimal_precision_qty']) || defaults.decimal_precision_qty,
    decimal_precision_money: parseInt(config['decimal_precision_money']) || defaults.decimal_precision_money
  };
}

// ============================================================================
// WAC CALCULATION
// ============================================================================

function calculateNewWAC(currentQty, currentWAC, newQty, newRate) {
  if (currentQty + newQty === 0) return 0;
  return (currentQty * currentWAC + newQty * newRate) / (currentQty + newQty);
}

// ============================================================================
// DROPDOWN DATA — Returns all data needed for the frontend
// ============================================================================

function getDropdownData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Sites
  let sites = [];
  try {
    let siteSheet = ss.getSheetByName(SITE_LIST_SHEET_NAME);
    if (!siteSheet) {
      siteSheet = ss.insertSheet(SITE_LIST_SHEET_NAME);
    }
    const lastRow = siteSheet.getLastRow();
    if (lastRow > 0) {
      sites = siteSheet.getRange(1, 1, lastRow, 1).getValues()
        .flat().map(s => s.toString().trim()).filter(String);
    }
  } catch (e) {
    console.error('Error fetching sites: ' + e.toString());
  }

  // Categories & Items
  const categories = [];
  const itemsMap = {};
  const sheets = ss.getSheets();
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    if (sheetName.startsWith(MT_SHEET_PREFIX)) {
      categories.push(sheetName);
      try {
        const lastRow = sheet.getLastRow();
        if (lastRow > HEADER_ROW_COUNT) {
          const lastCol = sheet.getLastColumn();
          const numCols = Math.max(8, lastCol > 0 ? lastCol : 8);
          const data = sheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, numCols).getValues();
          const items = data.map((row, i) => {
            const mainStock = parseFloat(row[1] || 0);
            const secStock = parseFloat(row[4] || 0);
            const storedFactor = numCols >= 8 ? parseFloat(row[7]) : null;
            const conversionFactor = (storedFactor !== null && !isNaN(storedFactor) && storedFactor !== 0)
              ? storedFactor
              : (mainStock > 0 ? secStock / mainStock : 1);
            return {
              name: (row[0] || '').toString().trim(),
              stock: mainStock,
              unit: (row[2] || '').toString().trim() || 'pcs',
              rate: parseFloat(row[3] || 0),
              imageUrl: '',
              secondaryUom: (row[5] || '').toString().trim(),
              stockSec: secStock,
              conversionFactor: conversionFactor,
              reorderLevel: 0,
              leadTime: 5,
              safetyStock: 0,
              categoryType: 'Profile',
              valuationMethod: 'WAC',
              rateSec: parseFloat(row[6] || 0),
              category: sheetName,
              rowIndex: i + HEADER_ROW_COUNT + 1
            };
          }).filter(item => item.name);
          itemsMap[sheetName] = items;
        } else {
          itemsMap[sheetName] = [];
        }
      } catch (e) {
        console.error('Error loading items from sheet ' + sheetName + ': ' + e.toString());
        itemsMap[sheetName] = [];
      }
    }
  });

  // UOMs
  let uoms = [];
  try {
    const uomSheet = ss.getSheetByName('UOM_Master');
    if (uomSheet && uomSheet.getLastRow() > 1) {
      uoms = uomSheet.getRange(2, 1, uomSheet.getLastRow() - 1, 4).getValues()
        .map(r => ({ code: r[0], name: r[1], type: r[2], isBase: r[3] }));
    }
  } catch (e) { console.error('Error fetching UOMs: ' + e.toString()); }

  return {
    sites: sites,
    categories: categories,
    itemsByCategory: itemsMap,
    uoms: uoms,
    suppliers: [],
    activeBatches: [], // Return empty array to keep frontend from breaking
    userEmail: Session.getActiveUser().getEmail()
  };
}

// ============================================================================
// ADD SITE NAME
// ============================================================================

function addSiteName(siteName) {
  if (!siteName || !siteName.trim()) throw new Error('Site name is required');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let siteSheet = ss.getSheetByName(SITE_LIST_SHEET_NAME);
  if (!siteSheet) {
    siteSheet = ss.insertSheet(SITE_LIST_SHEET_NAME);
  }
  const lastRow = siteSheet.getLastRow();
  if (lastRow > 0) {
    const existing = siteSheet.getRange(1, 1, lastRow, 1).getValues().flat()
      .map(s => s.toString().trim().toLowerCase());
    if (existing.includes(siteName.trim().toLowerCase())) {
      return { success: true, message: 'Site already exists', alreadyExists: true };
    }
  }
  siteSheet.appendRow([siteName.trim()]);
  return { success: true, message: 'Site "' + siteName.trim() + '" added' };
}

// ============================================================================
// ADD CATEGORY
// ============================================================================

function addCategory(categoryName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = MT_SHEET_PREFIX + categoryName;
  if (ss.getSheetByName(sheetName)) throw new Error('Category "' + categoryName + '" already exists');
  const newSheet = ss.insertSheet(sheetName);
  const headerValues = [
    'Item Name / Description', 'Quantity 1', 'Unit 1', 'Rate 1',
    'Quantity 2', 'Unit 2', 'Rate 2', 'Conversion Factor'
  ];
  newSheet.getRange(1, 1, 1, headerValues.length)
    .setValues([headerValues])
    .setFontWeight('bold')
    .setBackground('#4CAF50')
    .setFontColor('white');
  newSheet.setFrozenRows(1);
  return { success: true, message: 'Category "' + categoryName + '" created', sheetName: sheetName };
}

// ============================================================================
// ADD ITEM
// ============================================================================

function addItem(formData) {
  const {
    itemName, itemCategory, itemUnit, currentQty, rate,
    secondaryUom, currentStockSec, rateSec
  } = formData;

  if (!itemName?.trim()) throw new Error('Item name is required.');
  if (!itemCategory?.trim()) throw new Error('Category is required.');
  if (!itemUnit?.trim()) throw new Error('Unit is required.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(itemCategory.trim());
  if (!sheet) throw new Error('Sheet ' + itemCategory + ' not found');

  // Check for duplicates
  const targetBase = itemName.split('/')[0].trim().toLowerCase();
  const dataRows = sheet.getLastRow() - HEADER_ROW_COUNT;
  const existingItems = dataRows > 0
    ? sheet.getRange(HEADER_ROW_COUNT + 1, 1, dataRows, 1).getValues().flat()
    : [];
  for (let existing of existingItems) {
    if (existing && existing.toString().split('/')[0].trim().toLowerCase() === targetBase) {
      throw new Error('An item with this name already exists in ' + itemCategory);
    }
  }

  const stock = Math.max(0, parseFloat(currentQty) || 0);
  const parsedRate = Math.max(0, parseFloat(rate) || 0);
  const secUom = (secondaryUom || '').toString().trim();
  const secStock = Math.max(0, parseFloat(currentStockSec) || 0);
  const wacRateSec = parseFloat(rateSec) || 0;
  const conversionFactor = stock > 0 ? secStock / stock : 1;

  sheet.appendRow([
    itemName.trim(), stock, itemUnit.trim(), parsedRate,
    secStock, secUom, wacRateSec, conversionFactor
  ]);

  return {
    success: true,
    item: {
      name: itemName.trim(), stock: stock, unit: itemUnit.trim(),
      rate: parsedRate, imageUrl: '',
      secondaryUom: secUom, stockSec: secStock, conversionFactor: conversionFactor,
      reorderLevel: 0, leadTime: 5, safetyStock: 0,
      categoryType: 'Profile', valuationMethod: 'WAC', rateSec: wacRateSec,
      category: itemCategory.trim()
    }
  };
}

// ============================================================================
// GET ITEM DETAILS
// ============================================================================

function getItemDetails(category, itemName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(category);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const lastCol = sheet.getLastColumn();
  const readCols = Math.max(8, lastCol > 0 ? lastCol : 8);
  const values = sheet.getRange(2, 1, lastRow - 1, readCols).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] && values[i][0].toString().trim().toLowerCase() === itemName.toString().trim().toLowerCase()) {
      const mainStock = parseFloat(values[i][1]) || 0;
      const secStock = parseFloat(values[i][4]) || 0;
      const storedFactor = readCols >= 8 ? parseFloat(values[i][7]) : null;
      const conversionFactor = (storedFactor !== null && !isNaN(storedFactor) && storedFactor !== 0)
        ? storedFactor
        : (mainStock > 0 ? secStock / mainStock : 1);
      return {
        name: values[i][0],
        currentStockBase: mainStock,
        unitBase: values[i][2],
        wacRateBase: parseFloat(values[i][3]) || 0,
        imageUrl: '',
        secondaryUom: values[i][5],
        currentStockSec: secStock,
        conversionFactor: conversionFactor,
        reorderLevel: 0,
        leadTime: 5,
        safetyStock: 0,
        categoryType: 'Profile',
        valuationMethod: 'WAC',
        wacRateSec: parseFloat(values[i][6]) || 0,
        rowIndex: i + 2
      };
    }
  }
  return null;
}

// ============================================================================
// CATEGORY CACHE FOR BATCH SUBMISSIONS
// ============================================================================

function loadCategoryCache(ss, category) {
  const sheet = ss.getSheetByName(category);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROW_COUNT) return { sheet, nameIndex: {}, values: [], numCols: 8 };
  const numCols = Math.max(8, sheet.getLastColumn());
  const values = sheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, numCols).getValues();
  const nameIndex = {};
  values.forEach((row, i) => {
    if (row[0]) {
      nameIndex[row[0].toString().trim().toLowerCase()] = i;
    }
  });
  return { sheet, values, nameIndex, numCols };
}

function getItemFromCache(cache, itemName) {
  if (!cache) return null;
  const key = itemName.toString().trim().toLowerCase();
  if (!(key in cache.nameIndex)) return null;
  const i = cache.nameIndex[key];
  const row = cache.values[i];
  const mainStock = parseFloat(row[1]) || 0;
  const secStock = parseFloat(row[4]) || 0;
  const storedFactor = cache.numCols >= 8 ? parseFloat(row[7]) : null;
  const conversionFactor = (storedFactor !== null && !isNaN(storedFactor) && storedFactor !== 0)
    ? storedFactor
    : (mainStock > 0 ? secStock / mainStock : 1);
  return {
    name: row[0],
    currentStockBase: mainStock,
    unitBase: row[2],
    wacRateBase: parseFloat(row[3]) || 0,
    imageUrl: '',
    secondaryUom: row[5],
    currentStockSec: secStock,
    conversionFactor: conversionFactor,
    reorderLevel: 0,
    leadTime: 5,
    safetyStock: 0,
    categoryType: 'Profile',
    valuationMethod: 'WAC',
    wacRateSec: parseFloat(row[6]) || 0,
    rowIndex: i + HEADER_ROW_COUNT + 1
  };
}

// ============================================================================
// RECENT TRANSACTIONS
// ============================================================================

function getRecentTransactions(limit) {
  limit = limit || 50;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
    if (!transSheet) return [];
    const lastRow = transSheet.getLastRow();
    if (lastRow <= HEADER_ROW_COUNT) return [];
    const numRows = Math.min(limit, lastRow - HEADER_ROW_COUNT);
    const startRow = Math.max(HEADER_ROW_COUNT + 1, lastRow - numRows + 1);
    const values = transSheet.getRange(startRow, 1, numRows, 22).getValues();
    return values.map(row => {
      let timestamp = row[1];
      if (timestamp instanceof Date) {
        timestamp = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
      }
      return {
        transactionId: row[0], timestamp: timestamp, site: row[2] || '',
        processedBy: row[3] || '', type: row[4] || '', category: row[5] || '',
        itemName: row[6] || '', qty: parseFloat(row[7]) || 0,
        unit: row[8] || '', rate: parseFloat(row[9]) || 0,
        amount: parseFloat(row[10]) || 0,
        stockBefore: parseFloat(row[11]) || 0, stockAfter: parseFloat(row[12]) || 0,
        invoiceNumber: row[19] || '', fileLink: row[20] || ''
      };
    }).reverse();
  } catch (e) {
    console.error('getRecentTransactions failed:', e);
    return [];
  }
}

// ============================================================================
// AI BILL EXTRACTION (GEMINI VISION)
// ============================================================================

function extractBillWithAI(imageData, aiConfig) {
  const prompt = `You are an expert Indian bill/invoice data extractor. Invoices may have ONE or TWO units of measurement per line item. You must detect which case applies for EACH item and extract accordingly.

Analyze this bill image and return a JSON object in EXACTLY this structure:

{
  "invoiceNumber": "invoice or bill number",
  "date": "YYYY-MM-DD",
  "items": [
    {
      "itemName": "full item name — combine product code + description + size + finish",
      "quantity": 0,
      "unit": "primary unit",
      "rate": 0,
      "amount": 0,
      "quantity2": 0,
      "unit2": "secondary unit or empty string if single-unit item",
      "rate2": 0,
      "amount2": 0,
      "unitCount": 1,
      "additionalDetail": "grade, batch, HSN code, or extra info"
    }
  ],
  "totalAmount": 0
}

FIELD DEFINITIONS:
- unitCount: Set to 2 if the item has TWO separate quantity/unit columns on the invoice. Set to 1 if the item has only ONE quantity/unit.
- quantity, unit, rate, amount: The FIRST/PRIMARY quantity, its unit, rate, and line total.
- quantity2, unit2, rate2, amount2: The SECOND quantity and its unit (only when unitCount=2). Set ALL to 0/empty when unitCount=1.

HOW TO IDENTIFY PRIMARY vs SECONDARY:
- The FIRST quantity column (leftmost) in the invoice table is ALWAYS the primary quantity. The SECOND quantity column (if present) is the secondary.
- Do NOT reclassify based on unit names. Even if the unit is KGS or SQM, if it appears in the first quantity column, it is PRIMARY.
- Common column header patterns:
  * "Qty" / "Qnty" / "NOS" → primary quantity column
  * "Weight" / "Weight/Sqr" / "SQM" / "Qty in SQM/KG" → secondary quantity column
  * "Qty in Pcs/SHT" = primary, "Qty in SQM/KG" = secondary

RATE ASSIGNMENT:
- If there is only ONE rate column, check the column header:
  * "Rate" with no unit qualifier → assign to rate (primary)
  * "Rate Per SQM" / "Rate Per KG" → assign to rate2 (secondary), set rate=0
- If rate column header just says "Rate" and UOM column tells the unit (like KGS, PCS, SQM), assign the rate to the primary field (rate) since it matches the primary quantity.
- amount = the line total / net value from the invoice (assign to primary amount field always).

SINGLE-UNIT ITEMS (unitCount=1):
- Items with only one Qty column and one unit (e.g., PCS, KGS, SQF, MTR, ROLLS, BOXES, NOS, SET).
- Put everything in primary fields (quantity, unit, rate, amount).
- Set quantity2=0, unit2="", rate2=0, amount2=0.

DUAL-UNIT ITEMS (unitCount=2):
- Items where TWO separate quantity columns exist (e.g., NOS + SQM, Pcs/SHT + SQM/KG).
- First column → quantity + unit (primary).
- Second column → quantity2 + unit2 (secondary).

ITEM NAME RULES:
- COMBINE all description columns: product code + product name + size + colour + finish.
- Example: "ER-341-3WRB 3660x1220 Grade A", "386815C Sliding Interlock Colour", "AL45-AD131-3050mmx1220mm-FRB".

OTHER RULES:
- totalAmount = the grand total / final payable amount AFTER tax & rounding (look for "Grand Total", "Total Value after Tax", "Total Invoice Value").
- Convert DD/MM/YYYY or DD.MM.YYYY dates to YYYY-MM-DD format.
- Include HSN codes, batch numbers in additionalDetail.
- If any field is unclear, use your best judgment or leave as 0 / empty string.

Return ONLY valid JSON, no markdown code fences, no extra text.`;


  // ── 1. BUILT-IN GEMINI AI ──
  if (!aiConfig || aiConfig.provider === 'gemini') {
    if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured. Set GEMINI_API_KEY in Script Properties.');

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: imageData.mime, data: imageData.data } }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
    };

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_API_KEY;
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    if (result.error) throw new Error('Gemini API error: ' + result.error.message);

    const text = result.candidates[0].content.parts[0].text;
    // Strip markdown code fences if present
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);

    // ── 2. CUSTOM OPENAI-COMPATIBLE API (NVIDIA, Groq, custom model, etc.) ──
  } else {
    if (!aiConfig.apiKey) throw new Error('Custom API Key is required. Please set it in AI Configuration.');

    const baseURL = (aiConfig.baseURL || 'https://integrate.api.nvidia.com/v1').toString().trim().replace(/\/+$/, '');
    const url = baseURL + '/chat/completions';

    const payload = {
      model: (aiConfig.model || 'z-ai/glm-5.2').toString().trim(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: "data:" + imageData.mime + ";base64," + imageData.data } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 4096
    };

    const options = {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + aiConfig.apiKey.toString().trim(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const textResponse = response.getContentText();
    let result;
    try {
      result = JSON.parse(textResponse);
    } catch (parseErr) {
      throw new Error('Failed to parse API response as JSON: ' + textResponse.substring(0, 300));
    }

    if (result.error) {
      throw new Error('API Error: ' + (result.error.message || JSON.stringify(result.error)));
    }

    if (!result.choices || result.choices.length === 0 || !result.choices[0].message) {
      throw new Error('Invalid API response structure: ' + JSON.stringify(result).substring(0, 300));
    }

    const text = result.choices[0].message.content;
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  }
}

// ============================================================================
// UPLOAD BILL IMAGE
// ============================================================================

function uploadBillImage(fileData) {
  if (!fileData || !fileData.data) throw new Error('No file data provided');
  const folder = getOrCreateActiveFolder(UPLOAD_FOLDER_NAME);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(fileData.data),
    fileData.mime || 'application/octet-stream',
    fileData.name || 'bill_upload'
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);
  return { success: true, url: file.getUrl(), id: file.getId() };
}

// ============================================================================
// PRE-SUBMIT STOCK VALIDATION — Check stock availability with fresh data
// ============================================================================

/**
 * Validates stock availability for all Out/Repair transactions in a batch.
 * Called from frontend before submission to catch stale-data issues early.
 * Returns { valid: true } or { valid: false, errors: [...] } with details.
 */
function validateStockAvailability(transactionList) {
  const config = getSystemConfig();
  const round = function (val, dec) {
    return Number(Math.round(val + 'e' + dec) + 'e-' + dec);
  };

  const errors = [];
  // Track cumulative stock changes per item across the batch
  // key = "category|||itemName", value = { currentStock, unit }
  const stockTracker = {};

  transactionList.forEach(function (txn, index) {
    const cat = (txn.category || '').trim();
    const itemNameRaw = (txn.name || '').toString().trim();
    const txType = txn.transactionType;
    const qtyBase = parseFloat(txn.quantity) || 0;

    if (!cat || !itemNameRaw || txType === 'Direct') return;

    const key = cat + '|||' + itemNameRaw.toLowerCase();

    // Initialize tracker with fresh sheet data on first encounter
    if (!stockTracker[key]) {
      const itemDetails = getItemDetails(cat, itemNameRaw);
      stockTracker[key] = {
        currentStock: itemDetails ? itemDetails.currentStockBase : 0,
        unit: itemDetails ? itemDetails.unitBase : (txn.unit || 'pcs'),
        exists: !!itemDetails
      };
    }

    // Simulate stock changes
    if (txType === 'In' || txType === 'Return') {
      stockTracker[key].currentStock += qtyBase;
    } else if (txType === 'Out' || txType === 'Repair') {
      const roundedQty = round(qtyBase, config.decimal_precision_qty);
      const roundedStock = round(stockTracker[key].currentStock, config.decimal_precision_qty);
      if (roundedQty > roundedStock) {
        errors.push({
          index: index + 1,
          itemName: itemNameRaw,
          category: cat,
          unit: stockTracker[key].unit,
          available: stockTracker[key].currentStock,
          requested: qtyBase
        });
      }
      stockTracker[key].currentStock -= qtyBase;
    } else if (txType === 'Stock Adjust') {
      stockTracker[key].currentStock = qtyBase;
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors: errors };
  }
  return { valid: true };
}

// ============================================================================
// SUBMIT FORM — Process transaction batch
// ============================================================================

function submitForm(transactionList) {
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timeZone = Session.getScriptTimeZone();
    const baseTransactionId = 'TXN' + Utilities.formatDate(new Date(), timeZone, 'yyyyMMddHHmmss');
    const config = getSystemConfig();
    const round = function (val, dec) {
      return Number(Math.round(val + 'e' + dec) + 'e-' + dec);
    };

    const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
    if (!transSheet) throw new Error('All_Transactions sheet not found');

    const itemDetailsCache = {};
    const validationErrors = [];

    // Lazy load category caches
    const categoryCache = {};
    const getCategoryCache = function (cat) {
      if (!categoryCache[cat]) {
        categoryCache[cat] = loadCategoryCache(ss, cat);
      }
      return categoryCache[cat];
    };

    // ── PRE-VALIDATION: Check ALL stock availability BEFORE modifying anything ──
    const stockChanges = {}; // key = "cat|||itemName", cumulative change
    transactionList.forEach(function (txn, index) {
      const cat = (txn.category || '').trim();
      const itemNameRaw = (txn.name || '').toString().trim();
      const txType = txn.transactionType;
      const qtyBase = parseFloat(txn.quantity) || 0;

      if (!cat || !itemNameRaw || txType === 'Direct') return;

      const key = cat + '|||' + itemNameRaw.toLowerCase();

      if (!stockChanges[key]) {
        const catCache = getCategoryCache(cat);
        const itemDetails = getItemFromCache(catCache, itemNameRaw);
        itemDetailsCache[key] = itemDetails; // Cache it!
        stockChanges[key] = {
          currentStock: itemDetails ? itemDetails.currentStockBase : 0,
          unit: itemDetails ? itemDetails.unitBase : (txn.unit || 'pcs'),
          itemName: itemNameRaw,
          exists: !!itemDetails || !!txn.isNewItem
        };
      }

      if (txType === 'In' || txType === 'Return') {
        stockChanges[key].currentStock += qtyBase;
      } else if (txType === 'Out' || txType === 'Repair') {
        const roundedQty = round(qtyBase, config.decimal_precision_qty);
        const roundedStock = round(stockChanges[key].currentStock, config.decimal_precision_qty);
        if (roundedQty > roundedStock) {
          validationErrors.push({
            index: index + 1,
            itemName: itemNameRaw,
            category: cat,
            unit: stockChanges[key].unit,
            available: stockChanges[key].currentStock,
            requested: qtyBase
          });
        }
        stockChanges[key].currentStock -= qtyBase;
      } else if (txType === 'Stock Adjust') {
        stockChanges[key].currentStock = qtyBase;
      }
    });

    if (validationErrors.length > 0) {
      return {
        success: false,
        validationErrors: validationErrors
      };
    }

    // Lazy folder initialization
    let folder = null;
    function ensureUploadFolder() {
      if (!folder) folder = getOrCreateActiveFolder(UPLOAD_FOLDER_NAME);
      return folder;
    }

    const rowsToAppend = [];
    const dirtyRows = {}; // key: "category|||rowIndex"

    // Auto-add new site names
    const siteSheet = ss.getSheetByName(SITE_LIST_SHEET_NAME) || ss.insertSheet(SITE_LIST_SHEET_NAME);
    const existingSites = siteSheet.getLastRow() > 0
      ? siteSheet.getRange(1, 1, siteSheet.getLastRow(), 1).getValues().flat().map(s => s.toString().trim().toLowerCase())
      : [];

    const newSitesToAdd = [];

    transactionList.forEach(function (txn, index) {
      const cat = (txn.category || '').trim();
      const itemNameRaw = (txn.name || '').toString().trim();
      const txType = txn.transactionType;
      const invoiceNum = txn.invoiceNumber || '';

      // Auto-add site name
      if (txn.siteName && txn.siteName.trim()) {
        const siteKey = txn.siteName.trim().toLowerCase();
        if (!existingSites.includes(siteKey) && !newSitesToAdd.includes(siteKey)) {
          newSitesToAdd.push(siteKey);
          siteSheet.appendRow([txn.siteName.trim()]);
          existingSites.push(siteKey);
        }
      }

      // Upload file if present
      let finalFileUrl = (txn.preUploadedFileUrl || '').toString().trim();
      if (!finalFileUrl && txn.fileData && txn.fileData.data) {
        try {
          const blob = Utilities.newBlob(
            Utilities.base64Decode(txn.fileData.data),
            txn.fileData.mime || 'application/octet-stream',
            txn.fileData.name
          );
          const file = ensureUploadFolder().createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);
          finalFileUrl = file.getUrl();
        } catch (e) {
          finalFileUrl = 'Upload Error: ' + e.toString();
        }
      }

      const qtyBase = parseFloat(txn.quantity) || 0;
      const qtySec = parseFloat(txn.quantitySecondary) || 0;

      let finalItemName = itemNameRaw;
      if (txn.additionalDescription && txn.additionalDescription.trim() !== '') {
        finalItemName += ' | ' + txn.additionalDescription.trim();
      }

      const transactionDate = new Date(txn.transactionDateTime || new Date());
      const dateString = Utilities.formatDate(transactionDate, timeZone, 'dd/MM/yyyy HH:mm');

      const key = cat + '|||' + itemNameRaw.toLowerCase();
      let itemDetails = itemDetailsCache[key];
      let isNewItemJustCreated = false;
      if (!itemDetails && txn.isNewItem) {
        isNewItemJustCreated = true;
        const newUnit = txn.unitOverride || txn.unit || 'pcs';
        const newRate = parseFloat(txn.rateOverride || txn.rate || 0) || 0;
        const catSheet = ss.getSheetByName(cat);
        if (catSheet) {
          const qty2 = parseFloat(txn.quantitySecondary) || 0;
          const rate2 = parseFloat(txn.rateSecondary) || 0;
          const unit2 = txn.unitSecondary || '';
          const initialQty = parseFloat(txn.quantity) || 0;
          const convFactor = initialQty > 0 ? (qty2 / initialQty) : 1;

          // Build new row data array
          const newRowData = [
            itemNameRaw, 0, newUnit, newRate,
            0, unit2, rate2, convFactor
          ];

          // Append to spreadsheet
          catSheet.appendRow(newRowData);

          // ✅ FIX: Manually insert into existing cache instead of reloading.
          // Reloading (loadCategoryCache) would discard in-memory stock modifications
          // made by prior items in the same category during this batch.
          let catCache = categoryCache[cat];
          if (!catCache) {
            catCache = { sheet: catSheet, values: [], nameIndex: {}, numCols: 8 };
            categoryCache[cat] = catCache;
          }

          // Pad newRowData to match cache column count
          while (newRowData.length < catCache.numCols) {
            newRowData.push('');
          }

          const newCacheIndex = catCache.values.length;
          catCache.values.push(newRowData);
          catCache.nameIndex[itemNameRaw.trim().toLowerCase()] = newCacheIndex;

          // Build itemDetails directly instead of calling getItemFromCache
          itemDetails = {
            name: itemNameRaw,
            currentStockBase: 0,
            unitBase: newUnit,
            wacRateBase: newRate,
            imageUrl: '',
            secondaryUom: unit2,
            currentStockSec: 0,
            conversionFactor: convFactor,
            reorderLevel: 0,
            leadTime: 5,
            safetyStock: 0,
            categoryType: 'Profile',
            valuationMethod: 'WAC',
            wacRateSec: rate2,
            rowIndex: newCacheIndex + HEADER_ROW_COUNT + 1
          };
          itemDetailsCache[key] = itemDetails;
        }
      }

      if (!itemDetails && txType !== 'Direct') {
        throw new Error('Item "' + itemNameRaw + '" in category "' + cat + '" could not be found or created.');
      }

      let cacheIndex = -1;
      let rowValues = null;
      if (itemDetails) {
        const catCache = getCategoryCache(cat);
        cacheIndex = itemDetails.rowIndex - 2;
        rowValues = catCache.values[cacheIndex];

        let rowModified = false;
        if (txn.unit && txn.unit.toString().trim()) {
          rowValues[2] = txn.unit.toString().trim();
          itemDetails.unitBase = txn.unit.toString().trim();
          rowModified = true;
        }
        if (txn.unitSecondary !== undefined && txn.unitSecondary !== null) {
          rowValues[5] = txn.unitSecondary.toString().trim();
          itemDetails.secondaryUom = txn.unitSecondary.toString().trim();
          rowModified = true;
        }
        if (rowModified) {
          dirtyRows[cat + '|||' + itemDetails.rowIndex] = true;
        }
      }

      let stockBeforeBase = (itemDetails && !isNewItemJustCreated) ? itemDetails.currentStockBase : 0;
      let stockAfterBase = stockBeforeBase;
      let stockBeforeSec = (itemDetails && !isNewItemJustCreated) ? (itemDetails.currentStockSec || 0) : 0;
      let stockAfterSec = stockBeforeSec;

      let rateApplied = parseFloat(
        txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== ''
          ? txn.rateOverride
          : (itemDetails ? itemDetails.wacRateBase : 0)
      ) || 0;
      let totalValue = qtyBase * rateApplied;

      // ── IN (Purchase) ──
      if (txType === 'In') {
        stockAfterBase = stockBeforeBase + qtyBase;
        const newWacBase = calculateNewWAC(stockBeforeBase, itemDetails ? itemDetails.wacRateBase : 0, qtyBase, rateApplied);

        rowValues[1] = round(stockAfterBase, config.decimal_precision_qty);
        rowValues[3] = round(newWacBase, config.decimal_precision_rates);

        if (itemDetails) {
          itemDetails.currentStockBase = stockAfterBase;
          itemDetails.wacRateBase = newWacBase;
        }

        if (qtySec > 0 || stockBeforeSec > 0) {
          const rateSec = qtySec > 0 ? (qtyBase * rateApplied) / qtySec : 0;
          stockAfterSec = stockBeforeSec + qtySec;
          const newWacSec = calculateNewWAC(stockBeforeSec, itemDetails ? itemDetails.wacRateSec : 0, qtySec, rateSec);

          rowValues[4] = round(stockAfterSec, config.decimal_precision_qty);
          rowValues[6] = round(newWacSec, config.decimal_precision_rates);

          if (itemDetails) {
            itemDetails.currentStockSec = stockAfterSec;
            itemDetails.wacRateSec = newWacSec;
          }
        }
        dirtyRows[cat + '|||' + itemDetails.rowIndex] = true;

        // ── OUT / REPAIR ──
      } else if (txType === 'Out' || txType === 'Repair') {
        const roundedQty = round(qtyBase, config.decimal_precision_qty);
        const roundedStock = round(stockBeforeBase, config.decimal_precision_qty);
        if (roundedQty > roundedStock) {
          const unitLabel = itemDetails ? itemDetails.unitBase : (txn.unit || '');
          throw new Error('INSUFFICIENT STOCK for ' + itemNameRaw + ': ' + roundedStock + ' ' + unitLabel + ' available, trying to remove ' + roundedQty + ' ' + unitLabel + '. Please refresh your data and try again.');
        }

        stockAfterBase = stockBeforeBase - qtyBase;
        rowValues[1] = round(stockAfterBase, config.decimal_precision_qty);

        let rateOverrideBase = itemDetails ? itemDetails.wacRateBase : 0;
        // Update rate if overridden
        if (txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== '') {
          rateOverrideBase = parseFloat(txn.rateOverride);
          rowValues[3] = round(rateOverrideBase, config.decimal_precision_rates);
        }

        if (itemDetails) {
          itemDetails.currentStockBase = stockAfterBase;
          itemDetails.wacRateBase = rateOverrideBase;
        }

        if (qtySec > 0 || stockBeforeSec > 0) {
          stockAfterSec = Math.max(0, stockBeforeSec - qtySec);
          rowValues[4] = round(stockAfterSec, config.decimal_precision_qty);

          let rateOverrideSec = itemDetails ? itemDetails.wacRateSec : 0;
          if (txn.rateSecondary !== null && txn.rateSecondary !== undefined && txn.rateSecondary !== '') {
            rateOverrideSec = parseFloat(txn.rateSecondary);
            rowValues[6] = round(rateOverrideSec, config.decimal_precision_rates);
          }

          if (itemDetails) {
            itemDetails.currentStockSec = stockAfterSec;
            itemDetails.wacRateSec = rateOverrideSec;
          }
        }
        dirtyRows[cat + '|||' + itemDetails.rowIndex] = true;

        // ── DIRECT ──
      } else if (txType === 'Direct') {
        // Direct bypass: stock values remain unchanged, only transaction records are written.
        stockAfterBase = stockBeforeBase;
        stockAfterSec = stockBeforeSec;

        // ── RETURN ──
      } else if (txType === 'Return') {
        stockAfterBase = stockBeforeBase + qtyBase;
        const newWacBase = calculateNewWAC(stockBeforeBase, itemDetails ? itemDetails.wacRateBase : 0, qtyBase, rateApplied);

        rowValues[1] = round(stockAfterBase, config.decimal_precision_qty);
        rowValues[3] = round(newWacBase, config.decimal_precision_rates);

        if (itemDetails) {
          itemDetails.currentStockBase = stockAfterBase;
          itemDetails.wacRateBase = newWacBase;
        }

        if (qtySec > 0 || stockBeforeSec > 0) {
          const rateSec = qtySec > 0 ? (qtyBase * rateApplied) / qtySec : 0;
          stockAfterSec = stockBeforeSec + qtySec;
          const newWacSec = calculateNewWAC(stockBeforeSec, itemDetails ? itemDetails.wacRateSec : 0, qtySec, rateSec);

          rowValues[4] = round(stockAfterSec, config.decimal_precision_qty);
          rowValues[6] = round(newWacSec, config.decimal_precision_rates);

          if (itemDetails) {
            itemDetails.currentStockSec = stockAfterSec;
            itemDetails.wacRateSec = newWacSec;
          }
        }
        dirtyRows[cat + '|||' + itemDetails.rowIndex] = true;

        // ── STOCK ADJUST ──
      } else if (txType === 'Stock Adjust') {
        stockAfterBase = qtyBase;
        rowValues[1] = round(stockAfterBase, config.decimal_precision_qty);

        let rateOverrideBase = itemDetails ? itemDetails.wacRateBase : 0;
        // Update rate if overridden
        if (txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== '') {
          rateOverrideBase = parseFloat(txn.rateOverride);
          rowValues[3] = round(rateOverrideBase, config.decimal_precision_rates);
        }

        if (itemDetails) {
          itemDetails.currentStockBase = stockAfterBase;
          itemDetails.wacRateBase = rateOverrideBase;
        }

        if (qtySec > 0 || stockBeforeSec > 0) {
          stockAfterSec = qtySec;
          rowValues[4] = round(stockAfterSec, config.decimal_precision_qty);

          let rateOverrideSec = itemDetails ? itemDetails.wacRateSec : 0;
          if (txn.rateSecondary !== null && txn.rateSecondary !== undefined && txn.rateSecondary !== '') {
            rateOverrideSec = parseFloat(txn.rateSecondary);
            rowValues[6] = round(rateOverrideSec, config.decimal_precision_rates);
          }

          if (itemDetails) {
            itemDetails.currentStockSec = stockAfterSec;
            itemDetails.wacRateSec = rateOverrideSec;
          }
        }
        dirtyRows[cat + '|||' + itemDetails.rowIndex] = true;
      }

      // Build the transaction row
      const effectiveUnit = txn.unitOverride || txn.unit || (itemDetails ? itemDetails.unitBase : 'pcs');
      const effectiveRate = rateApplied;
      const itemTotalAmt = qtyBase * effectiveRate;

      const secRate = parseFloat(txn.rateSecondary) || 0;
      const secAmt = qtySec * secRate;

      rowsToAppend.push([
        baseTransactionId + '-' + (index + 1),  // 1. Transaction ID
        dateString,                             // 2. Timestamp
        txn.siteName || '',                     // 3. Site Location
        txn.processedBy || '',                  // 4. Processed By
        txType,                                 // 5. Transaction Type
        cat,                                    // 6. Category
        finalItemName,                          // 7. Item Name / Description
        qtyBase,                                // 8. Quantity 1
        effectiveUnit,                          // 9. Unit 1
        effectiveRate,                          // 10. Rate 1
        itemTotalAmt,                           // 11. Total Amount 1
        stockBeforeBase,                        // 12. Stock Before 1
        stockAfterBase,                         // 13. Stock After 1
        qtySec,                                 // 14. Quantity 2
        txn.unitSecondary || '',                // 15. Unit 2
        secRate,                                // 16. Rate 2
        secAmt,                                 // 17. Total Amount 2
        stockBeforeSec,                         // 18. Stock Before 2
        stockAfterSec,                          // 19. Stock After 2
        invoiceNum,                             // 20. Invoice Number
        finalFileUrl,                           // 21. File Link
        txn.additionalNote || ''                // 22. Additional Note
      ]);
    });

    // Write all dirty rows back to the category sheets in bulk (one call per modified item)
    Object.keys(dirtyRows).forEach(function (dirtyKey) {
      const parts = dirtyKey.split('|||');
      const catName = parts[0];
      const rIndex = parseInt(parts[1]);
      const catCache = categoryCache[catName];
      const rowValues = catCache.values[rIndex - 2];
      const catSheet = ss.getSheetByName(catName);
      if (catSheet && rowValues) {
        catSheet.getRange(rIndex, 1, 1, rowValues.length).setValues([rowValues]);
      }
    });

    // Write all transaction rows at once
    if (rowsToAppend.length > 0) {
      transSheet.getRange(transSheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length)
        .setValues(rowsToAppend);

      // Save 'In' transactions with invoice numbers to 'InStockBilll' sheet
      const billRows = rowsToAppend.filter(r => r[4] === 'In' && r[19] && r[19].toString().trim() !== '');
      if (billRows.length > 0) {
        let billSheet = ss.getSheetByName('InStockBilll');
        if (!billSheet) {
          billSheet = ss.insertSheet('InStockBilll');
          const billHeaders = [
            'Transaction ID', 'Timestamp', 'Site Location', 'Processed By', 'Transaction Type',
            'Category', 'Item Name / Description', 'Quantity 1', 'Unit 1', 'Rate 1', 'Total Amount 1',
            'Stock Before 1', 'Stock After 1', 'Quantity 2', 'Unit 2', 'Rate 2', 'Total Amount 2',
            'Stock Before 2', 'Stock After 2', 'Invoice Number', 'File Link', 'Additional Note'
          ];
          billSheet.getRange(1, 1, 1, billHeaders.length).setValues([billHeaders]);
          billSheet.getRange(1, 1, 1, billHeaders.length).setFontWeight('bold');
        }
        billSheet.getRange(billSheet.getLastRow() + 1, 1, billRows.length, billRows[0].length).setValues(billRows);
      }
    }

    SpreadsheetApp.flush(); // guarantee writes are committed before we read them back

    const updatedItems = Object.keys(itemDetailsCache).map(function (key) {
      const d = itemDetailsCache[key];
      if (!d) return null;
      return {
        category: key.split('|||')[0],
        name: d.name,
        stock: d.currentStockBase,
        unit: d.unitBase,
        rate: d.wacRateBase,
        secondaryUom: d.secondaryUom,
        stockSec: d.currentStockSec,
        rateSec: d.wacRateSec,
        conversionFactor: d.conversionFactor
      };
    }).filter(Boolean);

    return {
      success: true,
      count: transactionList.length,
      updatedItems: updatedItems
    };
  });
}

// ============================================================================
// SAVE ITEM CONVERSION FACTOR
// ============================================================================

function saveItemConversionFactor(category, itemName, factor, secondaryUnitName, primaryUnitName) {
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(category);
    if (!sheet) throw new Error('Category sheet not found: ' + category);

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) throw new Error('No items found in sheet');

    const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    let rowIndex = -1;
    for (let i = 0; i < values.length; i++) {
      if (values[i] && values[i].toString().trim().toLowerCase() === itemName.toString().trim().toLowerCase()) {
        rowIndex = i + 2;
        break;
      }
    }

    if (rowIndex === -1) throw new Error('Item not found: ' + itemName);

    // Ensure header for column 8 exists
    if (sheet.getLastColumn() < 8) {
      sheet.getRange(1, 8).setValue('Conversion Factor')
        .setFontWeight('bold')
        .setBackground('#4CAF50')
        .setFontColor('white');
    }

    // Persist primary unit name (column C is 3) - always update if provided
    if (primaryUnitName && primaryUnitName.toString().trim()) {
      sheet.getRange(rowIndex, 3).setValue(primaryUnitName.toString().trim());
    }

    // Persist secondary unit name (column F is 6) - always update if provided
    if (secondaryUnitName && secondaryUnitName.toString().trim()) {
      sheet.getRange(rowIndex, 6).setValue(secondaryUnitName.toString().trim());
    }

    sheet.getRange(rowIndex, 8).setValue(parseFloat(factor) || 1);
    return { success: true };
  });
}

// ============================================================================
// ITEM MASTER MANAGER BACKEND FUNCTIONS
// ============================================================================

/**
 * Log master edit/delete/merge operations for auditing.
 */
function logMasterEdit(action, category, rowIndex, itemName, details) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName('Master_Edit_Log');
    if (!logSheet) {
      logSheet = ss.insertSheet('Master_Edit_Log');
      logSheet.appendRow(['Timestamp', 'User Email', 'Action', 'Category', 'Row Index', 'Item Name', 'Details']);
      logSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#f1f5f9');
      logSheet.setFrozenRows(1);
    }
    const userEmail = Session.getActiveUser().getEmail() || 'Unknown';
    logSheet.appendRow([new Date(), userEmail, action, category, rowIndex, itemName, details]);
  } catch (e) {
    console.error('Failed to write master edit log: ' + e.toString());
  }
}

/**
 * Update an item's details in its category sheet.
 */
function updateMasterItem(payload) {
  // payload: {category, rowIndex, expectedName, name, qty, unit, rate, qty2, unit2, rate2, conversionFactor}
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(payload.category);
    if (!sheet) throw new Error('Category not found: ' + payload.category);

    const row = sheet.getRange(payload.rowIndex, 1, 1, 8).getValues()[0];
    // Optimistic-concurrency guard: someone else may have edited/deleted this row
    if (row[0].toString().trim().toLowerCase() !== payload.expectedName.trim().toLowerCase()) {
      throw new Error('Row changed since you loaded it — please refresh and retry.');
    }

    sheet.getRange(payload.rowIndex, 1, 1, 8).setValues([[
      payload.name, payload.qty, payload.unit, payload.rate,
      payload.qty2, payload.unit2, payload.rate2, payload.conversionFactor
    ]]);

    logMasterEdit(
      'UPDATE',
      payload.category,
      payload.rowIndex,
      payload.name,
      'Old name: "' + payload.expectedName + '". New values: qty1=' + payload.qty + ', rate1=' + payload.rate + ', qty2=' + payload.qty2 + ', rate2=' + payload.rate2 + ', convFactor=' + payload.conversionFactor
    );

    return { success: true };
  });
}

/**
 * Delete an item row from its category sheet.
 */
function deleteMasterItem(category, rowIndex, expectedName) {
  return withLock(function () {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(category);
    if (!sheet) throw new Error('Category not found: ' + category);
    const actualName = sheet.getRange(rowIndex, 1).getValue().toString().trim().toLowerCase();
    if (actualName !== expectedName.trim().toLowerCase()) {
      throw new Error('Row changed since you loaded it — please refresh and retry.');
    }
    sheet.deleteRow(rowIndex);

    logMasterEdit('DELETE', category, rowIndex, expectedName, 'Deleted row');

    return { success: true };
  });
}

/**
 * Merge duplicate items into a single row and delete other duplicates.
 */
function mergeMasterItems(category, keepRowIndex, deleteRowIndexes, mergedValues) {
  // mergedValues: {qty, rate, qty2, rate2, conversionFactor}
  return withLock(function () {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(category);
    if (!sheet) throw new Error('Category not found: ' + category);

    const keepItemName = sheet.getRange(keepRowIndex, 1).getValue().toString();

    sheet.getRange(keepRowIndex, 2, 1, 3).setValues([[mergedValues.qty, sheet.getRange(keepRowIndex, 3).getValue(), mergedValues.rate]]);
    sheet.getRange(keepRowIndex, 5, 1, 3).setValues([[mergedValues.qty2, sheet.getRange(keepRowIndex, 6).getValue(), mergedValues.rate2]]);
    sheet.getRange(keepRowIndex, 8).setValue(mergedValues.conversionFactor);

    // Delete highest row index first so lower indexes don't shift
    const sortedDeletes = deleteRowIndexes.slice().sort(function (a, b) { return b - a; });
    sortedDeletes.forEach(function (r) {
      sheet.deleteRow(r);
    });

    logMasterEdit(
      'MERGE',
      category,
      keepRowIndex,
      keepItemName,
      'Merged ' + deleteRowIndexes.length + ' duplicates (rows: ' + deleteRowIndexes.join(',') + '). Merged values: qty1=' + mergedValues.qty + ', rate1=' + mergedValues.rate + ', qty2=' + mergedValues.qty2 + ', rate2=' + mergedValues.rate2
    );

    return { success: true };
  });
}

/**
 * Helper function to retrieve and format a single item from a category sheet.
 */
function getFormattedItemForClient(ss, category, itemName) {
  const sheet = ss.getSheetByName(category);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROW_COUNT) return null;
  const lastCol = sheet.getLastColumn();
  const numCols = Math.max(8, lastCol > 0 ? lastCol : 8);
  const data = sheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, numCols).getValues();
  const itemLower = itemName.trim().toLowerCase();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if ((row[0] || '').toString().trim().toLowerCase() === itemLower) {
      const mainStock = parseFloat(row[1] || 0);
      const secStock = parseFloat(row[4] || 0);
      const storedFactor = numCols >= 8 ? parseFloat(row[7]) : null;
      const conversionFactor = (storedFactor !== null && !isNaN(storedFactor) && storedFactor !== 0)
        ? storedFactor
        : (mainStock > 0 ? secStock / mainStock : 1);
      return {
        name: (row[0] || '').toString().trim(),
        stock: mainStock,
        unit: (row[2] || '').toString().trim() || 'pcs',
        rate: parseFloat(row[3] || 0),
        imageUrl: '',
        secondaryUom: (row[5] || '').toString().trim(),
        stockSec: secStock,
        conversionFactor: conversionFactor,
        reorderLevel: 0,
        leadTime: 5,
        safetyStock: 0,
        categoryType: 'Profile',
        valuationMethod: 'WAC',
        rateSec: parseFloat(row[6] || 0),
        category: category,
        rowIndex: i + HEADER_ROW_COUNT + 1
      };
    }
  }
  return null;
}

// ============================================================================
// LIVE RATE SYNC — Push rate edits to MT.* sheet in real time (pre-submit)
// ============================================================================

/**
 * Write a single rate value to the item's row in its category sheet.
 * Uses the client-supplied rowIndex for a fast single-cell lookup;
 * falls back to a name scan if the row shifted or rowIndex is missing.
 */
function updateItemRateLive(category, rowIndex, expectedName, rateField, newRate) {
  return withLock(function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(category);
    if (!sheet) throw new Error('Category not found: ' + category);

    var targetLower = expectedName.toString().trim().toLowerCase();
    var resolvedRow = -1;

    // Fast path: trust the client-supplied rowIndex if it still matches
    if (rowIndex && rowIndex > HEADER_ROW_COUNT) {
      var nameAtRow = sheet.getRange(rowIndex, 1).getValue().toString().trim().toLowerCase();
      if (nameAtRow === targetLower) resolvedRow = rowIndex;
    }

    // Fallback: name scan (new item this session / row shifted / no rowIndex given)
    if (resolvedRow === -1) {
      var lastRow = sheet.getLastRow();
      if (lastRow <= HEADER_ROW_COUNT) throw new Error('Item "' + expectedName + '" not found in ' + category);
      var names = sheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, 1).getValues().flat();
      for (var i = 0; i < names.length; i++) {
        if (names[i].toString().trim().toLowerCase() === targetLower) {
          resolvedRow = i + HEADER_ROW_COUNT + 1;
          break;
        }
      }
      if (resolvedRow === -1) throw new Error('Item "' + expectedName + '" no longer exists in ' + category + ' — refresh and retry.');
    }

    var rate = parseFloat(newRate) || 0;
    var col = (rateField === 'rate2') ? 7 : 4; // D=Rate1, G=Rate2
    sheet.getRange(resolvedRow, col).setValue(rate);

    logMasterEdit('LIVE_RATE_UPDATE', category, resolvedRow, expectedName,
      (rateField === 'rate2' ? 'Rate 2' : 'Rate 1') + ' -> ' + rate + ' (live draft edit, pre-submit)');

    return { success: true, item: getFormattedItemForClient(ss, category, expectedName) };
  });
}

/**
 * Move an item to a new (possibly brand-new/custom) category.
 * Updates: the MT.* master sheets (old→new, merging if it already
 * exists there) AND every matching row in All_Transactions.
 */
function recategorizeItem(oldCategory, newCategory, itemName) {
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!newCategory.startsWith(MT_SHEET_PREFIX)) newCategory = MT_SHEET_PREFIX + newCategory;
    if (oldCategory === newCategory) return { success: true, transactionsUpdated: 0, updatedItems: [] };

    // 1. Ensure destination sheet exists (creates it if this is a brand-new/custom category)
    let newSheet = ss.getSheetByName(newCategory);
    if (!newSheet) {
      newSheet = ss.insertSheet(newCategory);
      const headers = ['Item Name / Description', 'Quantity 1', 'Unit 1', 'Rate 1',
        'Quantity 2', 'Unit 2', 'Rate 2', 'Conversion Factor'];
      newSheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#4CAF50').setFontColor('white');
      newSheet.setFrozenRows(1);
    }

    // 2. Pull item off the old sheet (if it's actually there)
    const oldSheet = ss.getSheetByName(oldCategory);
    let movedRow = null;
    if (oldSheet) {
      const lastRow = oldSheet.getLastRow();
      if (lastRow > HEADER_ROW_COUNT) {
        const values = oldSheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, 8).getValues();
        for (let i = 0; i < values.length; i++) {
          if (values[i][0].toString().trim().toLowerCase() === itemName.trim().toLowerCase()) {
            movedRow = values[i];
            oldSheet.deleteRow(i + HEADER_ROW_COUNT + 1);
            break;
          }
        }
      }
    }

    // 3. Append into new sheet, or merge with an existing row of the same name there
    const newLastRow = newSheet.getLastRow();
    let targetRow = -1, existing = null;
    if (newLastRow > HEADER_ROW_COUNT) {
      const vals = newSheet.getRange(HEADER_ROW_COUNT + 1, 1, newLastRow - HEADER_ROW_COUNT, 8).getValues();
      for (let i = 0; i < vals.length; i++) {
        if (vals[i][0].toString().trim().toLowerCase() === itemName.trim().toLowerCase()) {
          targetRow = i + HEADER_ROW_COUNT + 1;
          existing = vals[i];
          break;
        }
      }
    }

    if (existing) {
      const q1a = parseFloat(existing[1]) || 0, r1a = parseFloat(existing[3]) || 0;
      const q1b = movedRow ? (parseFloat(movedRow[1]) || 0) : 0, r1b = movedRow ? (parseFloat(movedRow[3]) || 0) : 0;
      const q1 = q1a + q1b, r1 = q1 > 0 ? ((q1a * r1a) + (q1b * r1b)) / q1 : 0;

      const q2a = parseFloat(existing[4]) || 0, r2a = parseFloat(existing[6]) || 0;
      const q2b = movedRow ? (parseFloat(movedRow[4]) || 0) : 0, r2b = movedRow ? (parseFloat(movedRow[6]) || 0) : 0;
      const q2 = q2a + q2b, r2 = q2 > 0 ? ((q2a * r2a) + (q2b * r2b)) / q2 : 0;

      newSheet.getRange(targetRow, 2, 1, 1).setValue(q1);
      newSheet.getRange(targetRow, 4, 1, 1).setValue(r1);
      newSheet.getRange(targetRow, 5, 1, 1).setValue(q2);
      newSheet.getRange(targetRow, 7, 1, 1).setValue(r2);
    } else if (movedRow) {
      newSheet.appendRow(movedRow);
    } else {
      newSheet.appendRow([itemName, 0, '', 0, 0, '', 0, 1]); // item had no master row anywhere
    }

    // 4. Update EVERY matching row in All_Transactions — single read + single write, safe for 8000+ rows
    const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
    let transactionsUpdated = 0;
    if (transSheet) {
      const lastRow = transSheet.getLastRow();
      if (lastRow > HEADER_ROW_COUNT) {
        const numRows = lastRow - HEADER_ROW_COUNT;
        const data = transSheet.getRange(HEADER_ROW_COUNT + 1, 6, numRows, 2).getValues(); // Category, Item Name
        const itemLower = itemName.trim().toLowerCase();
        const newCatColumn = data.map(function (row) {
          const rowCat = row[0].toString();
          const rowBase = row[1].toString().split(' | ')[0].trim().toLowerCase();
          if (rowCat === oldCategory && rowBase === itemLower) {
            transactionsUpdated++;
            return [newCategory];
          }
          return [rowCat];
        });
        if (transactionsUpdated > 0) {
          transSheet.getRange(HEADER_ROW_COUNT + 1, 6, numRows, 1).setValues(newCatColumn);
        }
      }
    }

    SpreadsheetApp.flush();
    const updatedItems = [];
    const moved = getFormattedItemForClient(ss, newCategory, itemName);
    if (moved) updatedItems.push(moved);

    return { success: true, transactionsUpdated: transactionsUpdated, newCategory: newCategory, updatedItems: updatedItems };
  });
}

// ============================================================================
// TRANSACTION MANAGER BACKEND FUNCTIONS
// ============================================================================

/**
 * Helper to match text using fuzzy matching on the backend.
 */
function fuzzyMatch(query, text) {
  if (!query || !text) return false;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Tier 1: Normal substring
  if (t.indexOf(q) !== -1) return true;

  // Tier 2: Strip non-alphanumeric, then substring
  const qStrip = q.replace(/[^a-z0-9]/g, '');
  const tStrip = t.replace(/[^a-z0-9]/g, '');
  if (qStrip && tStrip.indexOf(qStrip) !== -1) return true;

  // Tier 3: Digit-only query
  if (/^\d+$/.test(qStrip)) {
    const tDigits = t.replace(/[^0-9]/g, '');
    if (tDigits.indexOf(qStrip) !== -1) return true;
  }

  // Tier 4: Subsequence match
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Get distinct Site Location values directly from All_Transactions (column C)
 * — used to power the searchable site dropdown in Transaction Manager.
 */
function getDistinctTransactionSites() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
  if (!transSheet) return [];
  const lastRow = transSheet.getLastRow();
  if (lastRow <= HEADER_ROW_COUNT) return [];

  const siteValues = transSheet.getRange(HEADER_ROW_COUNT + 1, 3, lastRow - HEADER_ROW_COUNT, 1)
    .getValues().flat();

  const seen = {};
  siteValues.forEach(function (v) {
    const name = (v || '').toString().trim();
    if (name) seen[name.toLowerCase()] = name; // de-dupe, keep original casing
  });

  return Object.keys(seen).sort().map(function (k) { return seen[k]; });
}

/**
 * Retrieve filtered transactions from All_Transactions sheet (server-applied).
 */
function getFilteredTransactions(filters) {
  // filters: {dateFrom, dateTo, site, type, category, search}
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
    if (!transSheet) return { rows: [], totalCount: 0 };

    const lastRow = transSheet.getLastRow();
    if (lastRow <= HEADER_ROW_COUNT) return { rows: [], totalCount: 0 };

    const values = transSheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, 22).getValues();

    let dateFrom = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00') : null;
    let dateTo = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59') : null;

    // Default to last 90 days if no date range is set
    if (!dateFrom && !dateTo) {
      const now = new Date();
      dateTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90, 0, 0, 0);
    }

    const filtered = [];

    // Scan backwards (newest first)
    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];
      const rIndex = i + HEADER_ROW_COUNT + 1; // 1-based row index in All_Transactions

      const tsStr = row[1] ? row[1].toString() : '';
      if (!tsStr) continue;

      // Parse date format: dd/MM/yyyy HH:mm
      const parts = tsStr.split(' ');
      const dParts = parts[0].split('/');
      const tParts = parts[1] ? parts[1].split(':') : [0, 0];
      const rowDate = new Date(dParts[2], dParts[1] - 1, dParts[0], tParts[0], tParts[1]);

      if (dateFrom && rowDate < dateFrom) continue;
      if (dateTo && rowDate > dateTo) continue;

      // Site Location filter — substring/fuzzy match so "patna" matches
      // "Patna Site 1", "Patna Site 2", "Patna Warehouse", etc.
      if (filters.site && filters.site.trim() && !fuzzyMatch(filters.site.trim(), row[2].toString())) continue;

      // Transaction Type filter
      if (filters.type && row[4].toString().toLowerCase() !== filters.type.toLowerCase()) continue;

      // Category filter
      if (filters.category && row[5].toString().toLowerCase() !== filters.category.toLowerCase()) continue;

      // Item Name fuzzy search
      const fullName = row[6].toString();
      const baseName = fullName.split(' | ')[0].trim();
      if (filters.search && !fuzzyMatch(filters.search, baseName)) continue;

      filtered.push({
        rowIndex: rIndex,
        transactionId: row[0].toString(),
        timestamp: tsStr,
        site: row[2].toString(),
        processedBy: row[3].toString(),
        type: row[4].toString(),
        category: row[5].toString(),
        itemName: fullName,
        baseItemName: baseName,
        qty: parseFloat(row[7]) || 0,
        unit: row[8].toString(),
        rate: parseFloat(row[9]) || 0,
        amount: parseFloat(row[10]) || 0,
        stockBefore: parseFloat(row[11]) || 0,
        stockAfter: parseFloat(row[12]) || 0,
        qty2: parseFloat(row[13]) || 0,
        unit2: row[14].toString(),
        rate2: parseFloat(row[15]) || 0,
        amount2: parseFloat(row[16]) || 0,
        stockBeforeSec: parseFloat(row[17]) || 0,
        stockAfterSec: parseFloat(row[18]) || 0,
        invoiceNumber: row[19].toString(),
        fileLink: row[20].toString(),
        additionalNote: row[21].toString()
      });
    }

    const totalCount = filtered.length;
    const capped = filtered.slice(0, 300);

    return {
      rows: capped,
      totalCount: totalCount
    };
  });
}

/**
 * Fetch a single transaction row, verifying ID for optimistic concurrency.
 */
function getTransactionSnapshot(rowIndex, transactionId) {
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
    if (!transSheet) throw new Error('All_Transactions sheet not found');

    const row = transSheet.getRange(rowIndex, 1, 1, 22).getValues()[0];
    if (row[0].toString() !== transactionId) {
      throw new Error('Transaction ID mismatch. Row may have changed. Please refresh.');
    }

    const fullName = row[6].toString();
    const parts = fullName.split(' | ');
    const baseName = parts[0].trim();
    const additionalDesc = parts[1] ? parts.slice(1).join(' | ').trim() : '';

    return {
      rowIndex: rowIndex,
      transactionId: row[0].toString(),
      timestamp: row[1].toString(),
      site: row[2].toString(),
      processedBy: row[3].toString(),
      type: row[4].toString(),
      category: row[5].toString(),
      itemName: baseName,
      additionalDescription: additionalDesc,
      qty: parseFloat(row[7]) || 0,
      unit: row[8].toString(),
      rate: parseFloat(row[9]) || 0,
      amount: parseFloat(row[10]) || 0,
      stockBefore: parseFloat(row[11]) || 0,
      stockAfter: parseFloat(row[12]) || 0,
      qty2: parseFloat(row[13]) || 0,
      unit2: row[14].toString(),
      rate2: parseFloat(row[15]) || 0,
      amount2: parseFloat(row[16]) || 0,
      stockBeforeSec: parseFloat(row[17]) || 0,
      stockAfterSec: parseFloat(row[18]) || 0,
      invoiceNumber: row[19].toString(),
      fileLink: row[20].toString(),
      additionalNote: row[21].toString()
    };
  });
}

/**
 * Log transaction revisions to Transaction_Edit_Log.
 */
function logTransactionEdit(txnId, oldRowData, newRowData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName('Transaction_Edit_Log');
    if (!logSheet) {
      logSheet = ss.insertSheet('Transaction_Edit_Log');
      logSheet.appendRow(['Timestamp', 'User Email', 'Transaction ID', 'Old Values JSON', 'New Values JSON']);
      logSheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f1f5f9');
      logSheet.setFrozenRows(1);
    }
    const userEmail = Session.getActiveUser().getEmail() || 'Unknown';
    logSheet.appendRow([
      new Date(),
      userEmail,
      txnId,
      JSON.stringify(oldRowData),
      JSON.stringify(newRowData)
    ]);
  } catch (e) {
    console.error('Failed to write transaction edit log:', e);
  }
}

/**
 * Formats a live category item row for updatedItems callback
 */
function getFormattedItemForClient(ss, category, itemName) {
  const sheet = ss.getSheetByName(category);
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0].toString().trim().toLowerCase() === itemName.trim().toLowerCase()) {
      const row = values[i];
      const mainStock = parseFloat(row[1] || 0);
      const secStock = parseFloat(row[4] || 0);
      const storedFactor = values[0].length >= 8 ? parseFloat(row[7]) : null;
      const conversionFactor = (storedFactor !== null && !isNaN(storedFactor) && storedFactor !== 0)
        ? storedFactor
        : (mainStock > 0 ? secStock / mainStock : 1);
      return {
        category: category,
        name: row[0].toString().trim(),
        stock: mainStock,
        unit: row[2].toString().trim() || 'pcs',
        rate: parseFloat(row[3] || 0),
        secondaryUom: row[5].toString().trim(),
        stockSec: secStock,
        rateSec: parseFloat(row[6] || 0),
        conversionFactor: conversionFactor,
        rowIndex: i + 1
      };
    }
  }
  return null;
}

/**
 * Edit a transaction, reverse old stock changes, validate and apply new ones.
 */
function updateTransactionAndReconcile(payload) {
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
    if (!transSheet) throw new Error('All_Transactions sheet not found');

    // 1. Read existing row
    const oldRow = transSheet.getRange(payload.rowIndex, 1, 1, 22).getValues()[0];
    if (oldRow[0].toString() !== payload.transactionId) {
      throw new Error('Transaction ID mismatch. Row may have changed. Please refresh and try again.');
    }

    // 2. Capture old transaction values
    const oldType = oldRow[4].toString();
    const oldCatName = oldRow[5].toString();
    const oldFullName = oldRow[6].toString();
    const oldBaseName = oldFullName.split(' | ')[0].trim();
    const oldQty1 = parseFloat(oldRow[7]) || 0;
    const oldStockBefore1 = parseFloat(oldRow[11]) || 0;
    const oldStockAfter1 = parseFloat(oldRow[12]) || 0;
    const oldQty2 = parseFloat(oldRow[13]) || 0;
    const oldStockBefore2 = parseFloat(oldRow[17]) || 0;
    const oldStockAfter2 = parseFloat(oldRow[18]) || 0;

    // 3. Reverse the old stock changes
    const oldDelta1 = oldStockAfter1 - oldStockBefore1;
    const oldDelta2 = oldStockAfter2 - oldStockBefore2;

    const oldCatSheet = ss.getSheetByName(oldCatName);
    let oldItemRowIndex = -1;

    if (oldCatSheet && oldType !== 'Direct') {
      const oldCatValues = oldCatSheet.getDataRange().getValues();
      for (let i = 1; i < oldCatValues.length; i++) {
        if (oldCatValues[i][0].toString().trim().toLowerCase() === oldBaseName.toLowerCase()) {
          oldItemRowIndex = i + 1;
          break;
        }
      }
      if (oldItemRowIndex !== -1) {
        const liveStock1 = parseFloat(oldCatSheet.getRange(oldItemRowIndex, 2).getValue()) || 0;
        oldCatSheet.getRange(oldItemRowIndex, 2).setValue(liveStock1 - oldDelta1);

        const liveStock2 = parseFloat(oldCatSheet.getRange(oldItemRowIndex, 5).getValue()) || 0;
        oldCatSheet.getRange(oldItemRowIndex, 5).setValue(liveStock2 - oldDelta2);
      }
    }

    // 4. Calculate new stock before & after
    const newCatName = payload.category;
    const newBaseName = payload.itemName.trim();
    const newType = payload.type;
    const newQty1 = parseFloat(payload.qty) || 0;
    const newQty2 = parseFloat(payload.qty2) || 0;
    const newRate = parseFloat(payload.rate) || 0;
    const newRate2 = parseFloat(payload.rate2) || 0;

    const newCatSheet = ss.getSheetByName(newCatName);
    if (!newCatSheet) throw new Error('Category sheet not found: ' + newCatName);

    let newItemRowIndex = -1;
    const newCatValues = newCatSheet.getDataRange().getValues();
    for (let i = 1; i < newCatValues.length; i++) {
      if (newCatValues[i][0].toString().trim().toLowerCase() === newBaseName.toLowerCase()) {
        newItemRowIndex = i + 1;
        break;
      }
    }

    if (newItemRowIndex === -1 && newType !== 'Direct') {
      throw new Error('Item "' + newBaseName + '" not found in category "' + newCatName + '".');
    }

    let stockBefore1 = 0;
    let stockBefore2 = 0;
    let stockAfter1 = 0;
    let stockAfter2 = 0;
    let currentWac1 = 0;
    let currentWac2 = 0;

    if (newItemRowIndex !== -1 && newType !== 'Direct') {
      // Re-read stock after old-reversal (in case old item == new item)
      stockBefore1 = parseFloat(newCatSheet.getRange(newItemRowIndex, 2).getValue()) || 0;
      stockBefore2 = parseFloat(newCatSheet.getRange(newItemRowIndex, 5).getValue()) || 0;
      currentWac1 = parseFloat(newCatSheet.getRange(newItemRowIndex, 4).getValue()) || 0;
      currentWac2 = parseFloat(newCatSheet.getRange(newItemRowIndex, 7).getValue()) || 0;

      const config = getSystemConfig();
      const round = function (val, dec) {
        return Number(Math.round(val + 'e' + dec) + 'e-' + dec);
      };

      if (newType === 'In') {
        stockAfter1 = stockBefore1 + newQty1;
        stockAfter2 = stockBefore2 + newQty2;

        const newWac1 = calculateNewWAC(stockBefore1, currentWac1, newQty1, newRate);
        newCatSheet.getRange(newItemRowIndex, 2).setValue(round(stockAfter1, config.decimal_precision_qty));
        newCatSheet.getRange(newItemRowIndex, 4).setValue(round(newWac1, config.decimal_precision_rates));

        if (newQty2 > 0) {
          const rate2Applied = (newQty1 * newRate) / newQty2;
          const newWac2 = calculateNewWAC(stockBefore2, currentWac2, newQty2, rate2Applied);
          newCatSheet.getRange(newItemRowIndex, 5).setValue(round(stockAfter2, config.decimal_precision_qty));
          newCatSheet.getRange(newItemRowIndex, 7).setValue(round(newWac2, config.decimal_precision_rates));
        }

      } else if (newType === 'Out' || newType === 'Repair') {
        if (newQty1 > stockBefore1) {
          throw new Error('INSUFFICIENT STOCK: Only ' + stockBefore1 + ' ' + payload.unit + ' available in ' + newCatName + ', trying to withdraw ' + newQty1);
        }

        stockAfter1 = stockBefore1 - newQty1;
        stockAfter2 = Math.max(0, stockBefore2 - newQty2);

        newCatSheet.getRange(newItemRowIndex, 2).setValue(round(stockAfter1, config.decimal_precision_qty));
        newCatSheet.getRange(newItemRowIndex, 5).setValue(round(stockAfter2, config.decimal_precision_qty));

      } else if (newType === 'Return') {
        stockAfter1 = stockBefore1 + newQty1;
        stockAfter2 = stockBefore2 + newQty2;

        const newWac1 = calculateNewWAC(stockBefore1, currentWac1, newQty1, newRate);
        newCatSheet.getRange(newItemRowIndex, 2).setValue(round(stockAfter1, config.decimal_precision_qty));
        newCatSheet.getRange(newItemRowIndex, 4).setValue(round(newWac1, config.decimal_precision_rates));

        if (newQty2 > 0) {
          const rate2Applied = (newQty1 * newRate) / newQty2;
          const newWac2 = calculateNewWAC(stockBefore2, currentWac2, newQty2, rate2Applied);
          newCatSheet.getRange(newItemRowIndex, 5).setValue(round(stockAfter2, config.decimal_precision_qty));
          newCatSheet.getRange(newItemRowIndex, 7).setValue(round(newWac2, config.decimal_precision_rates));
        }

      } else if (newType === 'Stock Adjust') {
        stockAfter1 = newQty1;
        stockAfter2 = newQty2;
        newCatSheet.getRange(newItemRowIndex, 2).setValue(round(stockAfter1, config.decimal_precision_qty));
        newCatSheet.getRange(newItemRowIndex, 5).setValue(round(stockAfter2, config.decimal_precision_qty));
      }
    } else {
      stockAfter1 = stockBefore1;
      stockAfter2 = stockBefore2;
    }

    if (newItemRowIndex !== -1) {
      if (payload.unit && payload.unit.trim()) {
        newCatSheet.getRange(newItemRowIndex, 3).setValue(payload.unit.trim());
      }
      if (payload.unit2 && payload.unit2.trim()) {
        newCatSheet.getRange(newItemRowIndex, 6).setValue(payload.unit2.trim());
      }
      if (payload.conversionFactor !== undefined && payload.conversionFactor !== null) {
        newCatSheet.getRange(newItemRowIndex, 8).setValue(parseFloat(payload.conversionFactor) || 1);
      }
    }

    // 5. Update transaction row
    let finalItemName = newBaseName;
    if (payload.additionalDescription && payload.additionalDescription.trim() !== '') {
      finalItemName += ' | ' + payload.additionalDescription.trim();
    }

    const timeZone = Session.getScriptTimeZone();
    const transactionDate = new Date(payload.date || new Date());
    const dateString = Utilities.formatDate(transactionDate, timeZone, 'dd/MM/yyyy HH:mm');

    const totalAmt = newQty1 * newRate;
    const totalAmt2 = newQty2 * newRate2;

    const newRowValues = [
      payload.transactionId,                       // 1. Transaction ID
      dateString,                                  // 2. Timestamp
      payload.site || '',                          // 3. Site Location
      oldRow[3],                                   // 4. Processed By (keep old)
      newType,                                     // 5. Transaction Type
      newCatName,                                  // 6. Category
      finalItemName,                               // 7. Item Name / Description
      newQty1,                                     // 8. Quantity 1
      payload.unit,                                // 9. Unit 1
      newRate,                                     // 10. Rate 1
      totalAmt,                                    // 11. Total Amount 1
      stockBefore1,                                // 12. Stock Before 1
      stockAfter1,                                 // 13. Stock After 1
      newQty2,                                     // 14. Quantity 2
      payload.unit2 || '',                         // 15. Unit 2
      newRate2,                                    // 16. Rate 2
      totalAmt2,                                   // 17. Total Amount 2
      stockBefore2,                                // 18. Stock Before 2
      stockAfter2,                                 // 19. Stock After 2
      payload.invoiceNumber || '',                 // 20. Invoice Number
      oldRow[20] || '',                            // 21. File Link (keep old)
      payload.additionalNote || ''                 // 22. Additional Note
    ];

    transSheet.getRange(payload.rowIndex, 1, 1, 22).setValues([newRowValues]);

    // 6. Write to Transaction_Edit_Log
    const oldObj = {
      type: oldType, category: oldCatName, itemName: oldFullName,
      qty: oldQty1, qty2: oldQty2, stockBefore1: oldStockBefore1, stockAfter1: oldStockAfter1,
      stockBefore2: oldStockBefore2, stockAfter2: oldStockAfter2,
      site: oldRow[2], invoiceNumber: oldRow[19], additionalNote: oldRow[21], timestamp: oldRow[1]
    };
    const newObj = {
      type: newType, category: newCatName, itemName: finalItemName,
      qty: newQty1, qty2: newQty2, stockBefore1: stockBefore1, stockAfter1: stockAfter1,
      stockBefore2: stockBefore2, stockAfter2: stockAfter2,
      site: payload.site, invoiceNumber: payload.invoiceNumber, additionalNote: payload.additionalNote, timestamp: dateString
    };
    logTransactionEdit(payload.transactionId, oldObj, newObj);

    // 7. Retrieve formatted updated items for client-side sync
    const updatedItems = [];
    const item1 = getFormattedItemForClient(ss, oldCatName, oldBaseName);
    if (item1) updatedItems.push(item1);

    if (oldCatName !== newCatName || oldBaseName.toLowerCase() !== newBaseName.toLowerCase()) {
      const item2 = getFormattedItemForClient(ss, newCatName, newBaseName);
      if (item2) updatedItems.push(item2);
    }

    return {
      success: true,
      updatedItems: updatedItems
    };
  });
}

// ============================================================================
// PENDING BILLS TRACKER BACKEND
// ============================================================================

/**
 * Fetch bills/invoices whose items still have stock > 0 in master sheets.
 * Includes bill image link, invoice number, items list, remaining stock,
 * and outgoing dispatches log.
 */
function getPendingBills() {
  return withLock(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Read bill data ONLY from 'InStockBilll' sheet
    const billSheet = ss.getSheetByName('InStockBilll');
    if (!billSheet || billSheet.getLastRow() <= HEADER_ROW_COUNT) return [];
    const billData = billSheet.getRange(HEADER_ROW_COUNT + 1, 1, billSheet.getLastRow() - HEADER_ROW_COUNT, 22).getValues();

    // Read All_Transactions only for Out/Repair dispatches
    const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET_NAME);
    let transData = [];
    if (transSheet && transSheet.getLastRow() > HEADER_ROW_COUNT) {
      transData = transSheet.getRange(HEADER_ROW_COUNT + 1, 1, transSheet.getLastRow() - HEADER_ROW_COUNT, 22).getValues();
    }

    // Map current stock of all items in MT.* sheets for quick lookup
    const stockMap = {}; // key: category|||itemNameLower -> { stock, unit, stockSec, secondaryUom }
    const sheets = ss.getSheets();
    sheets.forEach(sheet => {
      const sName = sheet.getName();
      if (sName.startsWith(MT_SHEET_PREFIX)) {
        const sLastRow = sheet.getLastRow();
        if (sLastRow > HEADER_ROW_COUNT) {
          const sLastCol = Math.max(8, sheet.getLastColumn());
          const rows = sheet.getRange(HEADER_ROW_COUNT + 1, 1, sLastRow - HEADER_ROW_COUNT, sLastCol).getValues();
          rows.forEach(r => {
            const iName = (r[0] || '').toString().trim();
            if (iName) {
              const key = sName + '|||' + iName.toLowerCase();
              stockMap[key] = {
                category: sName,
                name: iName,
                stock: parseFloat(r[1]) || 0,
                unit: (r[2] || '').toString().trim() || 'pcs',
                rate: parseFloat(r[3]) || 0,
                stockSec: parseFloat(r[4]) || 0,
                secondaryUom: (r[5] || '').toString().trim()
              };
            }
          });
        }
      }
    });

    // Group outgoing dispatches (Out / Repair) from All_Transactions
    const outDispatches = [];
    transData.forEach(row => {
      const type = (row[4] || '').toString().trim();
      if (type === 'Out' || type === 'Repair') {
        const invoiceNo = (row[19] || '').toString().trim();
        const cat = (row[5] || '').toString().trim();
        const fullName = (row[6] || '').toString().trim();
        const baseName = fullName.split(' | ')[0].trim();
        const qty1 = parseFloat(row[7]) || 0;
        const unit1 = (row[8] || '').toString().trim();
        const fileUrl = (row[20] || '').toString().trim();
        const site = (row[2] || '').toString().trim();
        const timestamp = (row[1] || '').toString().trim();

        outDispatches.push({
          timestamp: timestamp,
          site: site,
          type: type,
          category: cat,
          itemName: baseName,
          fullName: fullName,
          qty: qty1,
          unit: unit1,
          invoiceNumber: invoiceNo,
          fileLink: fileUrl
        });
      }
    });

    // Group bill data by Invoice Number (only non-empty invoice numbers)
    const billsMap = {}; // key: invoiceNumber -> bill object

    billData.forEach(row => {
      const type = (row[4] || '').toString().trim();
      const invoiceNo = (row[19] || '').toString().trim();
      if (!invoiceNo) return; // Skip entries without invoice numbers

      const cat = (row[5] || '').toString().trim();
      const fullName = (row[6] || '').toString().trim();
      const baseName = fullName.split(' | ')[0].trim();
      const qty1 = parseFloat(row[7]) || 0;
      const unit1 = (row[8] || '').toString().trim();
      const rate1 = parseFloat(row[9]) || 0;
      const fileUrl = (row[20] || '').toString().trim();
      const site = (row[2] || '').toString().trim();
      const timestamp = (row[1] || '').toString().trim();

      const invKey = invoiceNo.toLowerCase();
      if (!billsMap[invKey]) {
        billsMap[invKey] = {
          invoiceNumber: invoiceNo,
          date: timestamp,
          vendor: site,
          fileLink: fileUrl,
          itemsMap: {}
        };
      }
      if (fileUrl && !billsMap[invKey].fileLink) {
        billsMap[invKey].fileLink = fileUrl;
      }

      const itemKey = cat + '|||' + baseName.toLowerCase();
      if (!billsMap[invKey].itemsMap[itemKey]) {
        billsMap[invKey].itemsMap[itemKey] = {
          category: cat,
          name: baseName,
          fullName: fullName,
          inQty: 0,
          unit: unit1,
          rate: rate1
        };
      }
      billsMap[invKey].itemsMap[itemKey].inQty += qty1;
    });

    // Process bills to compute stock & dispatches
    const pendingBills = [];

    Object.keys(billsMap).forEach(invKey => {
      const bill = billsMap[invKey];
      const itemsList = [];
      let totalStockRemaining = 0;
      let hasPositiveStock = false;

      Object.keys(bill.itemsMap).forEach(itemKey => {
        const itemInfo = bill.itemsMap[itemKey];
        const masterStockObj = stockMap[itemKey] || { stock: 0, unit: itemInfo.unit, stockSec: 0, secondaryUom: '' };
        const currentStock = masterStockObj.stock;

        if (currentStock > 0) {
          hasPositiveStock = true;
        }
        totalStockRemaining += currentStock;

        // Find outgoing dispatches for this item
        const itemOuts = outDispatches.filter(d => 
          d.category === itemInfo.category && 
          d.itemName.toLowerCase() === itemInfo.name.toLowerCase()
        ).map(d => ({
          date: d.timestamp,
          site: d.site,
          qty: d.qty,
          unit: d.unit,
          invoiceNumber: bill.invoiceNumber,
          fileLink: bill.fileLink || d.fileLink
        }));

        itemsList.push({
          category: itemInfo.category,
          name: itemInfo.name,
          fullName: itemInfo.fullName,
          inQty: itemInfo.inQty,
          currentStock: currentStock,
          unit: masterStockObj.unit || itemInfo.unit,
          dispatches: itemOuts
        });
      });

      // Include bill if at least one item has stock > 0
      if (hasPositiveStock) {
        pendingBills.push({
          invoiceNumber: bill.invoiceNumber,
          date: bill.date,
          vendor: bill.vendor,
          fileLink: bill.fileLink,
          thumbnailUrl: toDriveThumbnailUrl(bill.fileLink, 400),
          totalItems: itemsList.length,
          itemsWithStock: itemsList.filter(i => i.currentStock > 0).length,
          items: itemsList
        });
      }
    });

    // Sort newest date first
    pendingBills.reverse();
    return pendingBills;
  });
}
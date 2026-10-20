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
    lock.waitLock(30000);
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
          const numCols = Math.min(7, lastCol > 0 ? lastCol : 7);
          const data = sheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, numCols).getValues();
          const items = data.map(row => {
            const mainStock = parseFloat(row[1] || 0);
            const secStock = parseFloat(row[4] || 0);
            return {
              name: (row[0] || '').toString().trim(),
              stock: mainStock,
              unit: (row[2] || '').toString().trim() || 'pcs',
              rate: parseFloat(row[3] || 0),
              imageUrl: '',
              secondaryUom: (row[5] || '').toString().trim(),
              stockSec: secStock,
              conversionFactor: mainStock > 0 ? secStock / mainStock : 1,
              reorderLevel: 0,
              leadTime: 5,
              safetyStock: 0,
              categoryType: 'Profile',
              valuationMethod: 'WAC',
              rateSec: parseFloat(row[6] || 0),
              category: sheetName
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
    'Quantity 2', 'Unit 2', 'Rate 2'
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

  sheet.appendRow([
    itemName.trim(), stock, itemUnit.trim(), parsedRate,
    secStock, secUom, wacRateSec
  ]);

  return {
    success: true,
    item: {
      name: itemName.trim(), stock: stock, unit: itemUnit.trim(),
      rate: parsedRate, imageUrl: '',
      secondaryUom: secUom, stockSec: secStock, conversionFactor: stock > 0 ? secStock / stock : 1,
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
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] && values[i][0].toString().trim().toLowerCase() === itemName.toString().trim().toLowerCase()) {
      const mainStock = parseFloat(values[i][1]) || 0;
      const secStock = parseFloat(values[i][4]) || 0;
      return {
        name: values[i][0],
        currentStockBase: mainStock,
        unitBase: values[i][2],
        wacRateBase: parseFloat(values[i][3]) || 0,
        imageUrl: '',
        secondaryUom: values[i][5],
        currentStockSec: secStock,
        conversionFactor: mainStock > 0 ? secStock / mainStock : 1,
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
  const prompt = `You are an expert bill/invoice data extractor. Analyze this bill image and extract the following fields in JSON format:
{
  "invoiceNumber": "invoice or bill number",
  "date": "date in YYYY-MM-DD format",
  "items": [
    {
      "itemName": "name of the item",
      "quantity": number,
      "unit": "unit of measurement",
      "rate": number,
      "amount": number,
      "additionalDetail": "any extra description"
    }
  ],
  "totalAmount": number
}
If any field is unclear, use your best judgment or leave it as empty string/0. Return ONLY valid JSON, no markdown.`;

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
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
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
      max_tokens: 2048
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

    // ── PRE-VALIDATION: Check ALL stock availability BEFORE modifying anything ──
    // This prevents partial writes where items #1-2 succeed but #3 fails
    const stockChanges = {}; // key = "cat|||itemName", cumulative change
    transactionList.forEach(function (txn) {
      const cat = (txn.category || '').trim();
      const itemNameRaw = (txn.name || '').toString().trim();
      const txType = txn.transactionType;
      const qtyBase = parseFloat(txn.quantity) || 0;

      if (!cat || !itemNameRaw || txType === 'Direct') return;

      const key = cat + '|||' + itemNameRaw.toLowerCase();

      if (!stockChanges[key]) {
        const itemDetails = getItemDetails(cat, itemNameRaw);
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
          throw new Error(
            'INSUFFICIENT STOCK for ' + itemNameRaw +
            ': ' + round(stockChanges[key].currentStock, config.decimal_precision_qty) + ' ' + stockChanges[key].unit +
            ' available, trying to remove ' + round(qtyBase, config.decimal_precision_qty) + ' ' + stockChanges[key].unit +
            '. Please refresh your data and try again.'
          );
        }
        stockChanges[key].currentStock -= qtyBase;
      } else if (txType === 'Stock Adjust') {
        stockChanges[key].currentStock = qtyBase;
      }
    });

    const folder = getOrCreateActiveFolder(UPLOAD_FOLDER_NAME);
    const rowsToAppend = [];

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
          const file = folder.createFile(blob);
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

      // Create new item if needed
      let itemDetails = getItemDetails(cat, itemNameRaw);
      if (!itemDetails && txn.isNewItem) {
        const newUnit = txn.unitOverride || txn.unit || 'pcs';
        const newRate = parseFloat(txn.rateOverride || txn.rate || 0) || 0;
        const catSheet = ss.getSheetByName(cat);
        if (catSheet) {
          const qty2 = parseFloat(txn.quantitySecondary) || 0;
          const rate2 = parseFloat(txn.rateSecondary) || 0;
          const unit2 = txn.unitSecondary || '';
          catSheet.appendRow([
            itemNameRaw, 0, newUnit, newRate,
            0, unit2, rate2
          ]);
        }
        itemDetails = getItemDetails(cat, itemNameRaw);
      }

      if (!itemDetails && txType !== 'Direct') {
        throw new Error('Item "' + itemNameRaw + '" in category "' + cat + '" could not be found or created.');
      }

      if (itemDetails) {
        const catSheet = ss.getSheetByName(cat);
        if (catSheet) {
          if (txn.unit && txn.unit.toString().trim()) {
            catSheet.getRange(itemDetails.rowIndex, 3).setValue(txn.unit.toString().trim());
          }
          if (txn.unitSecondary !== undefined && txn.unitSecondary !== null) {
            catSheet.getRange(itemDetails.rowIndex, 6).setValue(txn.unitSecondary.toString().trim());
          }
        }
      }

      let stockBeforeBase = itemDetails ? itemDetails.currentStockBase : 0;
      let stockAfterBase = stockBeforeBase;
      let rateApplied = parseFloat(
        txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== ''
          ? txn.rateOverride
          : (itemDetails ? itemDetails.wacRateBase : 0)
      ) || 0;
      let totalValue = qtyBase * rateApplied;

      // ── IN (Purchase) ──
      if (txType === 'In') {
        stockAfterBase = stockBeforeBase + qtyBase;
        const newWacBase = calculateNewWAC(stockBeforeBase, itemDetails.wacRateBase, qtyBase, rateApplied);
        const catSheet = ss.getSheetByName(cat);
        catSheet.getRange(itemDetails.rowIndex, 2).setValue(round(stockAfterBase, config.decimal_precision_qty));
        catSheet.getRange(itemDetails.rowIndex, 4).setValue(round(newWacBase, config.decimal_precision_rates));

        if (qtySec > 0) {
          const rateSec = qtySec > 0 ? (qtyBase * rateApplied) / qtySec : 0;
          const stockAfterSec = (itemDetails.currentStockSec || 0) + qtySec;
          const newWacSec = calculateNewWAC(itemDetails.currentStockSec || 0, itemDetails.wacRateSec || 0, qtySec, rateSec);
          catSheet.getRange(itemDetails.rowIndex, 5).setValue(round(stockAfterSec, config.decimal_precision_qty));
          catSheet.getRange(itemDetails.rowIndex, 7).setValue(round(newWacSec, config.decimal_precision_rates));
        }

        // ── OUT / REPAIR ──
      } else if (txType === 'Out' || txType === 'Repair') {
        const roundedQty = round(qtyBase, config.decimal_precision_qty);
        const roundedStock = round(stockBeforeBase, config.decimal_precision_qty);
        if (roundedQty > roundedStock) {
          const unitLabel = itemDetails ? itemDetails.unitBase : (txn.unit || '');
          throw new Error('INSUFFICIENT STOCK for ' + itemNameRaw + ': ' + roundedStock + ' ' + unitLabel + ' available, trying to remove ' + roundedQty + ' ' + unitLabel + '. Please refresh your data and try again.');
        }

        stockAfterBase = stockBeforeBase - qtyBase;
        const catSheet = ss.getSheetByName(cat);
        catSheet.getRange(itemDetails.rowIndex, 2).setValue(round(stockAfterBase, config.decimal_precision_qty));

        // Update rate if overridden
        if (txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== '') {
          catSheet.getRange(itemDetails.rowIndex, 4).setValue(round(parseFloat(txn.rateOverride), config.decimal_precision_rates));
        }

        if (qtySec > 0) {
          const stockAfterSec = Math.max(0, (itemDetails.currentStockSec || 0) - qtySec);
          catSheet.getRange(itemDetails.rowIndex, 5).setValue(round(stockAfterSec, config.decimal_precision_qty));
          if (txn.rateSecondary !== null && txn.rateSecondary !== undefined && txn.rateSecondary !== '') {
            catSheet.getRange(itemDetails.rowIndex, 7).setValue(round(parseFloat(txn.rateSecondary), config.decimal_precision_rates));
          }
        }

        // ── DIRECT ──
      } else if (txType === 'Direct') {
        // Direct bypass: stock values remain unchanged, only transaction records are written.
        stockAfterBase = stockBeforeBase;

        // ── RETURN ──
      } else if (txType === 'Return') {
        stockAfterBase = stockBeforeBase + qtyBase;
        const newWacBase = calculateNewWAC(stockBeforeBase, itemDetails.wacRateBase, qtyBase, rateApplied);
        const catSheet = ss.getSheetByName(cat);
        catSheet.getRange(itemDetails.rowIndex, 2).setValue(round(stockAfterBase, config.decimal_precision_qty));
        catSheet.getRange(itemDetails.rowIndex, 4).setValue(round(newWacBase, config.decimal_precision_rates));

        if (qtySec > 0) {
          const rateSec = qtySec > 0 ? (qtyBase * rateApplied) / qtySec : 0;
          const stockAfterSec = (itemDetails.currentStockSec || 0) + qtySec;
          const newWacSec = calculateNewWAC(itemDetails.currentStockSec || 0, itemDetails.wacRateSec || 0, qtySec, rateSec);
          catSheet.getRange(itemDetails.rowIndex, 5).setValue(round(stockAfterSec, config.decimal_precision_qty));
          catSheet.getRange(itemDetails.rowIndex, 7).setValue(round(newWacSec, config.decimal_precision_rates));
        }

        // ── STOCK ADJUST ──
      } else if (txType === 'Stock Adjust') {
        stockAfterBase = qtyBase;

        const catSheet = ss.getSheetByName(cat);
        catSheet.getRange(itemDetails.rowIndex, 2).setValue(round(stockAfterBase, config.decimal_precision_qty));

        // Update rate if overridden
        if (txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== '') {
          catSheet.getRange(itemDetails.rowIndex, 4).setValue(round(parseFloat(txn.rateOverride), config.decimal_precision_rates));
        }

        if (qtySec > 0) {
          catSheet.getRange(itemDetails.rowIndex, 5).setValue(round(qtySec, config.decimal_precision_qty));
          if (txn.rateSecondary !== null && txn.rateSecondary !== undefined && txn.rateSecondary !== '') {
            catSheet.getRange(itemDetails.rowIndex, 7).setValue(round(parseFloat(txn.rateSecondary), config.decimal_precision_rates));
          }
        }
      }

      // Build the transaction row
      const effectiveUnit = txn.unitOverride || txn.unit || (itemDetails ? itemDetails.unitBase : 'pcs');
      const effectiveRate = rateApplied;
      const itemTotalAmt = qtyBase * effectiveRate;

      const stockBeforeSec = itemDetails ? (itemDetails.currentStockSec || 0) : 0;
      let stockAfterSec = stockBeforeSec;
      if (txType === 'In' || txType === 'Return') {
        stockAfterSec = stockBeforeSec + qtySec;
      } else if (txType === 'Out') {
        stockAfterSec = stockBeforeSec - qtySec;
      }

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

    // Write all transaction rows at once
    if (rowsToAppend.length > 0) {
      transSheet.getRange(transSheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length)
        .setValues(rowsToAppend);
    }

    return {
      success: true,
      count: transactionList.length
    };
  });
}
/**
 * ═══════════════════════════════════════════════════════════════════
 * STOCK MANAGER — Google Apps Script Backend (Code.gs)
 * Modernized & Optimized
 * ═══════════════════════════════════════════════════════════════════
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
  if (currentQty + newQty < 0) {
    // If stock goes below zero, preserve the existing WAC rate
    return currentWAC;
  }
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
    activeBatches: [],
    userEmail: Session.getActiveUser().getEmail()
  };
}

// ============================================================================
// GET INVENTORY SNAPSHOT — Flat list of all items for high-speed lookup
// ============================================================================
function getInventorySnapshot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const items = [];
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    if (sheetName.startsWith(MT_SHEET_PREFIX)) {
      try {
        const lastRow = sheet.getLastRow();
        if (lastRow > HEADER_ROW_COUNT) {
          const lastCol = sheet.getLastColumn();
          const numCols = Math.min(7, lastCol > 0 ? lastCol : 7);
          const data = sheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, numCols).getValues();
          data.forEach(row => {
            if (row[0] && row[0].toString().trim()) {
              const mainStock = parseFloat(row[1] || 0);
              const secStock = parseFloat(row[4] || 0);
              items.push({
                name: row[0].toString().trim(),
                stock: mainStock,
                unit: row[2].toString().trim() || 'pcs',
                rate: parseFloat(row[3] || 0),
                secondaryUom: row[5].toString().trim(),
                stockSec: secStock,
                conversionFactor: mainStock > 0 ? secStock / mainStock : 1,
                rateSec: parseFloat(row[6] || 0),
                category: sheetName
              });
            }
          });
        }
      } catch (e) {
        console.error('Error fetching inventory snapshot for ' + sheetName + ': ' + e.toString());
      }
    }
  });
  return items;
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
// AI BILL EXTRACTION (GEMINI VISION) — Context Injected
// ============================================================================

function extractBillWithAI(imageData, aiConfig, inventoryContext) {
  // Construct a concise inventory context description string
  let inventoryListString = "";
  if (inventoryContext && Array.isArray(inventoryContext)) {
    inventoryListString = inventoryContext.map(i => i.name).join(', ').substring(0, 2000);
  }

  const prompt = `You are an expert bill/invoice data extractor. 
  Analyze this bill image and extract the data in JSON format.
  
  IMPORTANT: Here is my current inventory item list: [${inventoryListString}].
  If an item on the bill closely matches an item in my list, use my exact item name. 
  If it does not match any, keep the bill's original name and add "isNewItem": true.

  Return ONLY valid JSON:
  {
    "invoiceNumber": "string",
    "date": "YYYY-MM-DD",
    "items": [
      {
        "itemName": "exact name from inventory list or bill name",
        "quantity": number,
        "unit": "unit of measurement",
        "rate": number,
        "amount": number,
        "additionalDetail": "grade or extra description",
        "isNewItem": boolean
      }
    ],
    "totalAmount": number
  }`;

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

function validateStockAvailability(transactionList) {
  const config = getSystemConfig();
  const round = function (val, dec) {
    return Number(Math.round(val + 'e' + dec) + 'e-' + dec);
  };

  const errors = [];
  const stockTracker = {};

  transactionList.forEach(function (txn, index) {
    const cat = (txn.category || '').trim();
    const itemNameRaw = (txn.name || '').toString().trim();
    const txType = txn.transactionType;
    const qtyBase = parseFloat(txn.quantity) || 0;

    if (!cat || !itemNameRaw || txType === 'Direct') return;

    const key = cat + '|||' + itemNameRaw.toLowerCase();

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
// SUBMIT FORM — Process transaction batch using Cache & Single Batch Write
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

    // 1. PRE-LOAD AND CACHE CATEGORY DATA IN MEMORY
    const categoriesToUpdate = {};
    
    transactionList.forEach(function (txn) {
      const cat = (txn.category || '').trim();
      if (!cat || !cat.startsWith(MT_SHEET_PREFIX)) return;

      if (!categoriesToUpdate[cat]) {
        const sheet = ss.getSheetByName(cat);
        if (sheet) {
          const lastRow = sheet.getLastRow();
          const data = lastRow > HEADER_ROW_COUNT 
            ? sheet.getRange(HEADER_ROW_COUNT + 1, 1, lastRow - HEADER_ROW_COUNT, 7).getValues() 
            : [];
          
          const itemMap = {};
          data.forEach(function (row, idx) {
            if (row[0]) {
              itemMap[row[0].toString().trim().toLowerCase()] = idx;
            }
          });

          categoriesToUpdate[cat] = { 
            sheet: sheet, 
            data: data, 
            itemMap: itemMap,
            dirty: false 
          };
        }
      }
    });

    // Pre-validation checking stock using cached values
    transactionList.forEach(function (txn) {
      const cat = (txn.category || '').trim();
      const itemNameRaw = (txn.name || '').toString().trim();
      const txType = txn.transactionType;
      const qtyBase = parseFloat(txn.quantity) || 0;

      if (!cat || !itemNameRaw || txType === 'Direct') return;
      const catObj = categoriesToUpdate[cat];
      if (!catObj) return;

      const itemIdx = catObj.itemMap[itemNameRaw.toLowerCase()];
      if (itemIdx === undefined && !txn.isNewItem) {
        throw new Error('Item "' + itemNameRaw + '" not found in category "' + cat + '".');
      }

      let currentStockBase = itemIdx !== undefined ? (parseFloat(catObj.data[itemIdx][1]) || 0) : 0;
      let unitLabel = itemIdx !== undefined ? (catObj.data[itemIdx][2] || 'pcs') : (txn.unit || 'pcs');

      if (txType === 'Out' || txType === 'Repair') {
        const roundedQty = round(qtyBase, config.decimal_precision_qty);
        const roundedStock = round(currentStockBase, config.decimal_precision_qty);
        if (roundedQty > roundedStock) {
          throw new Error(
            'INSUFFICIENT STOCK for ' + itemNameRaw +
            ': ' + roundedStock + ' ' + unitLabel + ' available, trying to remove ' + roundedQty + ' ' + unitLabel + '.'
          );
        }
      }
    });

    // Auto-add new site names in a batch append
    const siteSheet = ss.getSheetByName(SITE_LIST_SHEET_NAME) || ss.insertSheet(SITE_LIST_SHEET_NAME);
    const lastSiteRow = siteSheet.getLastRow();
    const existingSites = lastSiteRow > 0
      ? siteSheet.getRange(1, 1, lastSiteRow, 1).getValues().flat().map(s => s.toString().trim().toLowerCase())
      : [];
    const newSitesToAdd = [];

    transactionList.forEach(function (txn) {
      if (txn.siteName && txn.siteName.trim()) {
        const siteTrimmed = txn.siteName.trim();
        const siteKey = siteTrimmed.toLowerCase();
        if (!existingSites.includes(siteKey) && !newSitesToAdd.includes(siteTrimmed)) {
          newSitesToAdd.push(siteTrimmed);
        }
      }
    });

    if (newSitesToAdd.length > 0) {
      const siteRows = newSitesToAdd.map(s => [s]);
      siteSheet.getRange(lastSiteRow + 1, 1, siteRows.length, 1).setValues(siteRows);
    }

    const folder = getOrCreateActiveFolder(UPLOAD_FOLDER_NAME);
    const rowsToAppend = [];

    // 2. MUTATE IN-MEMORY DATA CACHE AND PROCESS TRANSACTIONS
    transactionList.forEach(function (txn, index) {
      const cat = (txn.category || '').trim();
      const itemNameRaw = (txn.name || '').toString().trim();
      const txType = txn.transactionType;
      const invoiceNum = txn.invoiceNumber || '';
      const qtyBase = parseFloat(txn.quantity) || 0;
      const qtySec = parseFloat(txn.quantitySecondary) || 0;

      // Handle file upload
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

      let finalItemName = itemNameRaw;
      if (txn.additionalDescription && txn.additionalDescription.trim() !== '') {
        finalItemName += ' | ' + txn.additionalDescription.trim();
      }

      const transactionDate = new Date(txn.transactionDateTime || new Date());
      const dateString = Utilities.formatDate(transactionDate, timeZone, 'dd/MM/yyyy HH:mm');

      const catObj = categoriesToUpdate[cat];
      if (!catObj && txType !== 'Direct') {
        throw new Error('Category sheet "' + cat + '" not found.');
      }

      // Check if new item creation is requested
      let itemIdx = catObj ? catObj.itemMap[itemNameRaw.toLowerCase()] : undefined;
      if (itemIdx === undefined && txn.isNewItem && catObj) {
        const newUnit = txn.unitOverride || txn.unit || 'pcs';
        const newRate = parseFloat(txn.rateOverride || txn.rate || 0) || 0;
        const newUnitSec = txn.unitSecondary || '';
        const newRateSec = parseFloat(txn.rateSecondary || 0) || 0;

        // Insert new item directly into our memory database
        const newRow = [
          itemNameRaw,
          0, // Quantity 1
          newUnit,
          newRate, // Rate 1
          0, // Quantity 2
          newUnitSec,
          newRateSec // Rate 2
        ];
        
        itemIdx = catObj.data.length;
        catObj.data.push(newRow);
        catObj.itemMap[itemNameRaw.toLowerCase()] = itemIdx;
        catObj.dirty = true;
      }

      if (itemIdx === undefined && txType !== 'Direct') {
        throw new Error('Item "' + itemNameRaw + '" could not be found or created in ' + cat);
      }

      let stockBeforeBase = 0;
      let stockBeforeSec = 0;
      let currentWacBase = 0;
      let currentWacSec = 0;
      let unitBase = txn.unit || 'pcs';
      let unitSec = txn.unitSecondary || '';

      if (itemIdx !== undefined && catObj) {
        const row = catObj.data[itemIdx];
        stockBeforeBase = parseFloat(row[1]) || 0;
        unitBase = row[2];
        currentWacBase = parseFloat(row[3]) || 0;
        stockBeforeSec = parseFloat(row[4]) || 0;
        unitSec = row[5];
        currentWacSec = parseFloat(row[6]) || 0;

        // Sync inputs back to master if changed
        if (txn.unit && txn.unit.toString().trim()) {
          row[2] = txn.unit.toString().trim();
          unitBase = row[2];
        }
        if (txn.unitSecondary !== undefined && txn.unitSecondary !== null) {
          row[5] = txn.unitSecondary.toString().trim();
          unitSec = row[5];
        }
      }

      let stockAfterBase = stockBeforeBase;
      let stockAfterSec = stockBeforeSec;
      
      let rateApplied = parseFloat(
        txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== ''
          ? txn.rateOverride
          : currentWacBase
      ) || 0;
      let rateSecApplied = parseFloat(txn.rateSecondary) || (qtySec > 0 ? (qtyBase * rateApplied) / qtySec : 0);

      // Mutate cache and calculate stock levels
      if (itemIdx !== undefined && catObj) {
        const row = catObj.data[itemIdx];

        if (txType === 'In' || txType === 'Return') {
          stockAfterBase = stockBeforeBase + qtyBase;
          const newWacBase = calculateNewWAC(stockBeforeBase, currentWacBase, qtyBase, rateApplied);
          row[1] = round(stockAfterBase, config.decimal_precision_qty);
          row[3] = round(newWacBase, config.decimal_precision_rates);

          if (qtySec > 0) {
            stockAfterSec = stockBeforeSec + qtySec;
            const newWacSec = calculateNewWAC(stockBeforeSec, currentWacSec, qtySec, rateSecApplied);
            row[4] = round(stockAfterSec, config.decimal_precision_qty);
            row[6] = round(newWacSec, config.decimal_precision_rates);
          }
          catObj.dirty = true;

        } else if (txType === 'Out' || txType === 'Repair') {
          stockAfterBase = stockBeforeBase - qtyBase;
          row[1] = round(stockAfterBase, config.decimal_precision_qty);

          // Update rate if overridden
          if (txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== '') {
            row[3] = round(parseFloat(txn.rateOverride), config.decimal_precision_rates);
          }

          if (qtySec > 0) {
            stockAfterSec = Math.max(0, stockBeforeSec - qtySec);
            row[4] = round(stockAfterSec, config.decimal_precision_qty);
            if (txn.rateSecondary !== null && txn.rateSecondary !== undefined && txn.rateSecondary !== '') {
              row[6] = round(parseFloat(txn.rateSecondary), config.decimal_precision_rates);
            }
          }
          catObj.dirty = true;

        } else if (txType === 'Stock Adjust') {
          stockAfterBase = qtyBase;
          row[1] = round(stockAfterBase, config.decimal_precision_qty);

          if (txn.rateOverride !== null && txn.rateOverride !== undefined && txn.rateOverride !== '') {
            row[3] = round(parseFloat(txn.rateOverride), config.decimal_precision_rates);
          }

          if (qtySec > 0) {
            stockAfterSec = qtySec;
            row[4] = round(stockAfterSec, config.decimal_precision_qty);
            if (txn.rateSecondary !== null && txn.rateSecondary !== undefined && txn.rateSecondary !== '') {
              row[6] = round(parseFloat(txn.rateSecondary), config.decimal_precision_rates);
            }
          }
          catObj.dirty = true;
        }
      }

      // Compile Transaction Record Row
      const itemTotalAmt = qtyBase * rateApplied;
      const secAmt = qtySec * rateSecApplied;

      rowsToAppend.push([
        baseTransactionId + '-' + (index + 1),  // 1. Transaction ID
        dateString,                             // 2. Timestamp
        txn.siteName || '',                     // 3. Site Location
        txn.processedBy || '',                  // 4. Processed By
        txType,                                 // 5. Transaction Type
        cat,                                    // 6. Category
        finalItemName,                          // 7. Item Name / Description
        qtyBase,                                // 8. Quantity 1
        unitBase,                               // 9. Unit 1
        rateApplied,                            // 10. Rate 1
        itemTotalAmt,                           // 11. Total Amount 1
        stockBeforeBase,                        // 12. Stock Before 1
        stockAfterBase,                         // 13. Stock After 1
        qtySec,                                 // 14. Quantity 2
        unitSec,                                // 15. Unit 2
        rateSecApplied,                         // 16. Rate 2
        secAmt,                                 // 17. Total Amount 2
        stockBeforeSec,                         // 18. Stock Before 2
        stockAfterSec,                          // 19. Stock After 2
        invoiceNum,                             // 20. Invoice Number
        finalFileUrl,                           // 21. File Link
        txn.additionalNote || ''                // 22. Additional Note
      ]);
    });

    // 3. WRITE ALL MUTATED DATA BACK IN ONE SINGLE BATCH CALL PER CATEGORY SHEET
    Object.keys(categoriesToUpdate).forEach(function (cat) {
      const catObj = categoriesToUpdate[cat];
      if (catObj.dirty && catObj.data.length > 0) {
        catObj.sheet.getRange(HEADER_ROW_COUNT + 1, 1, catObj.data.length, 7).setValues(catObj.data);
      }
    });

    // 4. APPEND ALL TRANSACTION RECORDS AT ONCE
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

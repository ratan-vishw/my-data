/**
 * ============================================================================
 *  uPVC FMS - Google Apps Script Backend  (Code.js)
 *  Built strictly to the uPVC Database Architecture plan (database.html v2.4 Clean)
 * ============================================================================
 *
 *  PIPELINE ENTITIES (section wise)
 *    Section 1    uPVC_Quotation_Master      15 cols            Active inquiries
 *    Section 2A   uPVC_Quote_Win             15 cols            Won pipeline -> feeds PO
 *    Section 2B   uPVC_Quote_Loss            15 cols            Lost pipeline -> terminates
 *    Section 3    uPVC_Purchase_Order_Master 19 cols / 5 uploads Execution
 *    Section 4    uPVC_Done_PO_Archive       17 cols            Settled / cold storage
 *    Section 5    uPVC_Config_Dropdowns      5 lookup columns A-E
 *
 *  PLAN RULES ENFORCED IN CODE
 *    - No "Status" / "Note" column anywhere; Quotation Master ends at "Our Amount"
 *    - No "Gross Margin" anywhere
 *    - "System Variants" renamed to "Variant" everywhere
 *    - 5 ordered uploads : 1 Rough Sizes, 2 Vendor Quote, 3 Our Quote, 4 PO Order, 5 Bills
 *    - "Vendor Amount" written immediately after "Vendor Quote",
 *      "Our Amount" written immediately after "Our Quote"
 *    - Quotation Master carries only 3 uploads (Rough Sizes, Vendor Quote, Our Quote)
 *    - Every amount is stored WITHOUT GST (labels say "excl. GST" in the UI)
 *    - "Bills" is the only multi-file upload: its cell keeps a JSON array of
 *      attachments, each carrying its own excl-GST "amount"; "Bills AMT" sits
 *      right after "Bills" and always holds the SUM of those amounts
 *    - Every other upload column holds exactly ONE file; re-uploading replaces it
 *      and the previous Drive file is trashed
 * ============================================================================
 */

/* ==========================================================================
 * SECTION 1 - CONFIGURATION
 * ======================================================================== */

const APP_NAME = 'uPVC FMS';
const APP_SUBTITLE = 'uPVC Quotation & Procurement Portal';

/** Leave blank ('') to use the spreadsheet this script is bound to. */
const SPREADSHEET_ID = '';

/** Google Drive folder (created on demand) that stores every [DOC] upload. */
const DRIVE_ROOT_FOLDER_NAME = 'uPVC FMS Documents';

/** Grant "anyone with the link" viewer access to uploads so they preview in-app. */
const SHARE_UPLOADS_WITH_LINK = true;

const ID_PREFIX = { QUOTATION: 'QT-UPVC-', PO: 'PO-UPVC-' };
const ID_PAD = 4;
const CURRENCY = '\u20B9';

const SHEET = {
  QUOTATION_MASTER: 'uPVC_Quotation_Master',
  QUOTE_WIN: 'uPVC_Quote_Win',
  QUOTE_LOSS: 'uPVC_Quote_Loss',
  PO_MASTER: 'uPVC_Purchase_Order_Master',
  DONE_PO_ARCHIVE: 'uPVC_Done_PO_Archive',
  CONFIG_DROPDOWNS: 'uPVC_Config_Dropdowns'
};

/** Section 5 - uPVC_Config_Dropdowns central lookups. */
const CONFIG_HEADERS = [
  'Col A: Vendors',
  'Col B: Variant',
  'Col C: Mesh / Jaali',
  'Col D: Glass Types',
  'Col E: Loss Reasons'
];

const CONFIG_COLUMN_INDEX = {
  vendors: 1,
  variants: 2,
  meshTypes: 3,
  glassTypes: 4,
  lossReasons: 5
};

const CONFIG_DEFAULTS = {
  vendors: ['NCL', 'Poonam Alu.', 'WinFrame', 'Magnesta', 'Alumil', 'Prominance'],
  variants: ['Fix-Light', '2-Track Sliding', '2.5-Track Sliding', '3-Track Sliding',
    'Casement / Openable', 'Sliding Folding', 'Ventilator'],
  meshTypes: ['None', 'Nylon Mesh', 'SS 304 Mesh', 'Pleated Mesh', 'Fiberglass Mesh'],
  glassTypes: ['Toughened / Tempered', 'Clear Float', 'Tinted Glass', 'Reflective Glass',
    'Frosted / Obscure', 'Laminated Glass', 'DGU (Double Glazed)'],
  lossReasons: ['Price Too High', 'Lead Time Too Long', 'Competitor Selected',
    'Client Postponed', 'Site Not Feasible', 'Specification Mismatch']
};

/* ==========================================================================
 * SECTION 2 - COLUMN MAP (single source of truth for headers + field keys)
 *   [ header, clientFieldKey, storageType ]
 *   storageType : text | int | num | date | doc
 * ======================================================================== */

const COLUMN_MAP = {};

/* 1. uPVC_Quotation_Master - 15 Cols (Active Inquiries) */
COLUMN_MAP[SHEET.QUOTATION_MASTER] = [
  ['Quotation ID', 'id', 'text'],
  ['Client / Site Name', 'site', 'text'],
  ['Date', 'date', 'date'],
  ['Location', 'location', 'text'],
  ['Vendor Name', 'vendor', 'text'],
  ['Variant', 'variant', 'text'],
  ['Mesh / Jaali', 'mesh', 'text'],
  ['Glass Specs', 'glass', 'text'],
  ['Total Item Qty', 'qty', 'int'],
  ['Lead Time', 'leadTime', 'int'],
  ['Rough Sizes', 'roughSizes', 'doc'],
  ['Vendor Quote', 'vendorQuote', 'doc'],
  ['Vendor Amount', 'vendorAmount', 'num'],
  ['Our Quote', 'ourQuote', 'doc'],
  ['Our Amount', 'ourAmount', 'num']
];

/* 2A. uPVC_Quote_Win - Won Pipeline (Feeds PO) */
COLUMN_MAP[SHEET.QUOTE_WIN] = [
  ['Quotation ID', 'id', 'text'],
  ['Client / Site Name', 'site', 'text'],
  ['Win Date', 'date', 'date'],
  ['Location', 'location', 'text'],
  ['Vendor Name', 'vendor', 'text'],
  ['Variant', 'variant', 'text'],
  ['Mesh / Jaali', 'mesh', 'text'],
  ['Glass Specs', 'glass', 'text'],
  ['Total Item Qty', 'qty', 'int'],
  ['Lead Time', 'leadTime', 'int'],
  ['Rough Sizes', 'roughSizes', 'doc'],
  ['Vendor Quote', 'vendorQuote', 'doc'],
  ['Vendor Amount', 'vendorAmount', 'num'],
  ['Our Quote', 'ourQuote', 'doc'],
  ['Our Amount', 'ourAmount', 'num']
];

/* 2B. uPVC_Quote_Loss - Lost Pipeline (Terminates; Our Amount -> Loss Reason) */
COLUMN_MAP[SHEET.QUOTE_LOSS] = [
  ['Quotation ID', 'id', 'text'],
  ['Client / Site Name', 'site', 'text'],
  ['Loss Date', 'date', 'date'],
  ['Location', 'location', 'text'],
  ['Vendor Name', 'vendor', 'text'],
  ['Variant', 'variant', 'text'],
  ['Mesh / Jaali', 'mesh', 'text'],
  ['Glass Specs', 'glass', 'text'],
  ['Total Item Qty', 'qty', 'int'],
  ['Lead Time', 'leadTime', 'int'],
  ['Rough Sizes', 'roughSizes', 'doc'],
  ['Vendor Quote', 'vendorQuote', 'doc'],
  ['Vendor Amount', 'vendorAmount', 'num'],
  ['Our Quote', 'ourQuote', 'doc'],
  ['Loss Reason', 'lossReason', 'text']
];

/* 3. uPVC_Purchase_Order_Master - 19 Cols / 5 Uploads (Execution) */
COLUMN_MAP[SHEET.PO_MASTER] = [
  ['PO ID', 'id', 'text'],
  ['Quotation ID', 'quotationId', 'text'],
  ['Client / Site Name', 'site', 'text'],
  ['PO Date', 'date', 'date'],
  ['Location', 'location', 'text'],
  ['Vendor Name', 'vendor', 'text'],
  ['Variant', 'variant', 'text'],
  ['Mesh / Jaali', 'mesh', 'text'],
  ['Glass Specs', 'glass', 'text'],
  ['Total Item Qty', 'qty', 'int'],
  ['Lead Time (Days)', 'leadTime', 'int'],
  ['Rough Sizes', 'roughSizes', 'doc'],
  ['Vendor Quote', 'vendorQuote', 'doc'],
  ['Vendor Amount', 'vendorAmount', 'num'],
  ['Our Quote', 'ourQuote', 'doc'],
  ['Our Amount', 'ourAmount', 'num'],
  ['PO Order', 'poOrder', 'doc'],
  ['Bills', 'bills', 'doc'],
  ['Bills AMT', 'billsAmt', 'num']
];

/* 4. uPVC_Done_PO_Archive - 16 Cols (Settled / Cold storage) */
COLUMN_MAP[SHEET.DONE_PO_ARCHIVE] = [
  ['PO ID', 'id', 'text'],
  ['Quotation ID', 'quotationId', 'text'],
  ['Client / Site Name', 'site', 'text'],
  ['Vendor Name', 'vendor', 'text'],
  ['Order Date', 'date', 'date'],
  ['Variant', 'variant', 'text'],
  ['Total Item Qty', 'qty', 'int'],
  ['Rough Sizes', 'roughSizes', 'doc'],
  ['Vendor Quote', 'vendorQuote', 'doc'],
  ['Vendor Amount', 'vendorAmount', 'num'],
  ['Our Quote', 'ourQuote', 'doc'],
  ['Our Amount', 'ourAmount', 'num'],
  ['PO Order', 'poOrder', 'doc'],
  ['Bills', 'bills', 'doc'],
  ['Bills AMT', 'billsAmt', 'num'],
  ['Archived Date', 'archivedDate', 'date']
];

/** Canonical header list per sheet - derived so headers can never drift from the map. */
const HEADERS = (function () {
  var out = {};
  Object.keys(COLUMN_MAP).forEach(function (sheetName) {
    out[sheetName] = COLUMN_MAP[sheetName].map(function (spec) { return spec[0]; });
  });
  return out;
})();

/* --------------------------------------------------------------------------
 * LEGACY HEADER SUPPORT
 *   Row 1 of every sheet is the contract. These aliases let a hand-built /
 *   legacy sheet (different spellings, or a slightly different column order)
 *   still line up with COLUMN_MAP instead of being silently mis-read, and
 *   records_() resolves every column by NAME rather than by position.
 * ------------------------------------------------------------------------ */
const HEADER_ALIASES = {
  'quotation id': ['quote id', 'quotationid', 'quote no', 'quotation no', 'quote ref', 'qt id'],
  'client / site name': ['client/site name', 'client name', 'client', 'site', 'site name', 'client / site', 'party name',
    'client name / site name', 'client name / site'],
  'date': ['quote date', 'quotation date', 'timestamp'],
  'location': ['site location', 'address', 'site address'],
  'vendor name': ['vendor', 'supplier', 'supplier name', 'party', 'vendor/supplier', 'vendor name:'],
  'variant': ['variants', 'system variant', 'system variants', 'product type', 'type', 'orientation'],
  'mesh / jaali': ['mesh', 'jaali', 'mesh/jaali', 'mesh jaali', 'which jaali ?', 'mesh type'],
  'glass specs': ['glass', 'glass spec', 'glass specification', 'glass thickness'],
  'total item qty': ['qty', 'quantity', 'total qty', 'total item quantity', 'item qty', 'total items'],
  'lead time': ['leadtime', 'lead time (days)', 'lead time days', 'delivery time'],
  'lead time (days)': ['lead time', 'leadtime', 'lead time days', 'lead time(days)', 'delivery time'],
  'rough sizes': ['rough size', 'roughsizes', 'sizing', 'sizes', 'sizing schedule', 'size pdf'],
  'vendor quote': ['vendor quotation', 'supplier quote', 'vendor quote doc', 'quotation from ncl(pdf)'],
  'vendor amount': ['vendor amt', 'vendoramt', 'vendor price', 'vendor value', 'ncl quotation amount'],
  'our quote': ['our quotation', 'client quote', 'our quote doc', 'co. quote', 'current company quotation'],
  'our amount': ['our amt', 'ouramount', 'our price', 'our value', 'quoted amount', 'quote amount', 'client amount'],
  'po id': ['po no', 'po number', 'purchase order id', 'poid', 'po ref'],
  'po date': ['purchase order date', 'order date', 'po dt', 'timestamp'],
  'po order': ['poorder', 'po copy', 'po document', 'po order copy'],
  'bills': ['bill', 'invoice', 'invoices', 'tax invoice', 'bills/invoices', 'ncl billing uploads'],
  'bills amt': ['bills amount', 'bill amount', 'billsamt', 'bills total', 'bill amt', 'ncl billing amount'],
  'archived date': ['archive date', 'completed date', 'handover date', 'archived on'],
  'win date': ['won date', 'decision date', 'win dt'],
  'loss date': ['lost date', 'decision date', 'loss dt'],
  'loss reason': ['reason', 'lossreason', 'loss remark']
};

/** Normalises a header cell for comparison (trim + collapse spaces + lowercase). */
function normHeader_(value) {
  return String(value === null || value === undefined ? '' : value)
    .trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when the canonical header (or one of its aliases) is present in row 1. */
function headerPresent_(header, presentNames) {
  var target = normHeader_(header);
  if (presentNames.indexOf(target) > -1) return true;
  var aliases = HEADER_ALIASES[target] || [];
  for (var i = 0; i < aliases.length; i++) {
    if (presentNames.indexOf(aliases[i]) > -1) return true;
  }
  return false;
}

/**
 * Maps each canonical header of a sheet to the column where it actually sits,
 * resolving legacy spellings through HEADER_ALIASES. Missing headers are absent.
 */
function actualHeaderMap_(sheet, sheetName) {
  var last = Math.max(sheet.getLastColumn(), 1);
  var row1 = sheet.getRange(1, 1, 1, last).getValues()[0];
  var present = {};
  for (var i = 0; i < row1.length; i++) {
    var name = normHeader_(row1[i]);
    if (name && !Object.prototype.hasOwnProperty.call(present, name)) present[name] = i + 1;
  }
  var map = {};
  headersOf_(sheetName).forEach(function (header) {
    var target = normHeader_(header);
    if (!target) return;
    if (Object.prototype.hasOwnProperty.call(present, target)) { map[header] = present[target]; return; }
    var aliases = HEADER_ALIASES[target] || [];
    for (var a = 0; a < aliases.length; a++) {
      if (Object.prototype.hasOwnProperty.call(present, aliases[a])) { map[header] = present[aliases[a]]; return; }
    }
  });
  return map;
}

/**
 * 0-based offset of every COLUMN_MAP column inside the sheet's real row, so a
 * legacy sheet whose columns are re-ordered is read/written correctly. Falls
 * back to the plan position only when a header is genuinely absent.
 */
function columnIndexMap_(sheetName, sheet) {
  var specs = columnSpecs_(sheetName);
  var headerMap = actualHeaderMap_(sheet, sheetName);
  var last = Math.max(sheet.getLastColumn(), 1);
  var row1 = sheet.getRange(1, 1, 1, last).getValues()[0];
  return specs.map(function (spec, i) {
    var col = headerMap[spec[0]];
    if (col && col > 0) return col - 1;
    // Header genuinely absent. Only trust the plan position when that cell is
    // blank (or already carries the expected name) - never when it holds a
    // different column's label, otherwise the id would be read from, and later
    // written over, someone else's column (legacy sheets often have no id column).
    var label = normHeader_(row1[i]);
    if (!label || label === normHeader_(spec[0])) return i;
    return -1;
  });
}

/** True when every cell of the row is blank. */
function isBlankRow_(values) {
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (String(v === null || v === undefined ? '' : v).trim()) return false;
  }
  return true;
}


/**
 * Legacy sheets split the item count across 'Window Qty' and 'Ventilator Qty'
 * instead of holding a single 'Total Item Qty'. Returns the 0-based column
 * offsets to add together, or null when the sheet has neither.
 */
function legacyQtyCols_(sheet) {
  var last = Math.max(sheet.getLastColumn(), 1);
  var row1 = sheet.getRange(1, 1, 1, last).getValues()[0];
  var cols = [];
  ['window qty', 'ventilator qty'].forEach(function (name) {
    for (var i = 0; i < row1.length; i++) {
      if (normHeader_(row1[i]) === name) { cols.push(i); return; }
    }
  });
  return cols.length ? cols : null;
}

/** Adds the given columns using the same integer coercion used for other int fields. */
function sumQtyColumns_(values, cols) {
  var total = 0;
  for (var i = 0; i < cols.length; i++) {
    var raw = values[cols[i]];
    var n = typeof raw === 'number' ? Math.round(raw)
      : parseInt(String(raw === null || raw === undefined ? '' : raw).replace(/[^\d\-]/g, ''), 10);
    if (!isNaN(n)) total += n;
  }
  return total;
}
/** Vendor / Mesh / Loss Reason dropdowns sourced from Col A, C, E of Config sheet (Variant and Glass Specs allow multiple selections). */
function getValidationSpecs_() {
  var stageSheets = [
    SHEET.QUOTATION_MASTER,
    SHEET.QUOTE_WIN,
    SHEET.QUOTE_LOSS,
    SHEET.PO_MASTER,
    SHEET.DONE_PO_ARCHIVE
  ];
  var base = [
    ['Vendor Name', 'vendors'],
    ['Mesh / Jaali', 'meshTypes'],
    ['Loss Reason', 'lossReasons']
  ];
  var specs = [];
  stageSheets.forEach(function (sheetName) {
    base.forEach(function (pair) {
      if (columnIndexByHeader_(sheetName, pair[0])) {
        specs.push({ sheet: sheetName, header: pair[0], config: pair[1] });
      }
    });
  });
  return specs;
}

const VALIDATION_SPECS = getValidationSpecs_();

/* ==========================================================================
 * SECTION 3 - WEB APP ENTRY POINT
 * ======================================================================== */

function doGet(e) {
  // Index.html is a fully static page (no scriptlets) so it can also be opened
  // directly in a browser for UI preview; the deployed title comes from setTitle().
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_NAME + ' \u2014 ' + APP_SUBTITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Allows <?!= include('Partial') ?> composition if the page is ever split. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Spreadsheet-menu shortcut (visible when the script is bound to a Sheet). */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('uPVC FMS')
      .addItem('Initialize / Repair Database', 'initDatabase')
      .addItem('Repair Legacy Data (Backfill IDs)', 'repairLegacyIds')
      .addItem('Open Web App', 'showWebAppDialog')
      .addToUi();
  } catch (err) {
    Logger.log('onOpen menu skipped: ' + err);
  }
}

function showWebAppDialog() {
  var html = HtmlService.createTemplateFromFile('Index').evaluate()
    .setWidth(1500)
    .setHeight(900);
  SpreadsheetApp.getUi().showModalDialog(html, APP_NAME + ' \u2014 ' + APP_SUBTITLE);
}

/* ==========================================================================
 * SECTION 4 - SCHEMA BOOTSTRAP (idempotent; safe to run repeatedly)
 * ======================================================================== */

function getSpreadsheet_() {
  if (SPREADSHEET_ID && String(SPREADSHEET_ID).trim()) {
    return SpreadsheetApp.openById(String(SPREADSHEET_ID).trim());
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No spreadsheet available. Bind this script to a Google Sheet ' +
      'or set SPREADSHEET_ID in Code.js.');
  }
  return ss;
}

/** Returns the sheet, creating + schema-stamping it when missing. */
function getSheet_(sheetName, createIfMissing) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    if (createIfMissing === false) {
      throw new Error('Sheet "' + sheetName + '" not found. ' +
        'Run  uPVC FMS > Initialize / Repair Database.');
    }
    sheet = createSheetWithSchema_(ss, sheetName);
  }
  return sheet;
}

function createSheetWithSchema_(ss, sheetName) {
  var sheet = ss.insertSheet(sheetName);

  if (sheetName === SHEET.CONFIG_DROPDOWNS) {
    sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([CONFIG_HEADERS]);
    Object.keys(CONFIG_COLUMN_INDEX).forEach(function (key) {
      var values = CONFIG_DEFAULTS[key] || [];
      if (values.length) {
        sheet.getRange(2, CONFIG_COLUMN_INDEX[key], values.length, 1)
          .setValues(values.map(function (v) { return [v]; }));
      }
    });
    styleHeader_(sheet, CONFIG_HEADERS.length);
    sheet.setColumnWidths(1, CONFIG_HEADERS.length, 200);
  } else {
    var headers = HEADERS[sheetName];
    if (!headers) throw new Error('No column map defined for sheet: ' + sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sheet, headers.length);
    applyColumnWidths_(sheet, sheetName);
  }

  sheet.setFrozenRows(1);
  return sheet;
}

function styleHeader_(sheet, width) {
  sheet.getRange(1, 1, 1, width)
    .setFontWeight('bold')
    .setFontSize(10)
    .setFontFamily('Roboto Mono')
    .setBackground('#1E40AF')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 36);
}

function applyColumnWidths_(sheet, sheetName) {
  var specs = COLUMN_MAP[sheetName] || [];
  specs.forEach(function (spec, i) {
    var type = spec[2] || 'text';
    var width = 135;
    if (type === 'doc') width = 260;
    else if (type === 'num') width = 120;
    else if (type === 'date') width = 105;
    else if (spec[1] === 'site') width = 220;
    else if (spec[1] === 'location') width = 200;
    sheet.setColumnWidth(i + 1, width);
  });
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), specs.length)
    .setFontFamily('Roboto Mono')
    .setFontSize(10);
}

/**
 * Inserts any plan column that is missing from an existing sheet at its mapped
 * position (data to the right shifts along), so adding a column to COLUMN_MAP
 * never overwrites a neighbouring column's data.
 * @return {number} how many columns were inserted
 */
function syncSheetColumns_(sheet, headers) {
  var inserted = 0;

  headers.forEach(function (header, index) {
    var last = Math.max(sheet.getLastColumn(), 1);
    var row1 = sheet.getRange(1, 1, 1, last).getValues()[0].map(normHeader_);
    if (headerPresent_(header, row1)) return;

    var position = Math.min(index, last) + 1;
    if (position > sheet.getMaxColumns()) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), position - sheet.getMaxColumns());
    }
    sheet.insertColumnBefore(position);
    sheet.getRange(1, position).setValue(header);
    inserted++;
  });

  return inserted;
}

/** Full bootstrap: sheets, exact headers, Section 5 lookups, formats and Col A-E validation. */
function initDatabase() {
  var ss = getSpreadsheet_();

  Object.keys(HEADERS).forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      createSheetWithSchema_(ss, sheetName);
      return;
    }
    var headers = HEADERS[sheetName];
    // Migrate older sheets in place: any missing plan column (or alias) is
    // inserted so neighbouring data is never overwritten. Existing header
    // names / order are preserved - the reader and writer resolve columns by
    // name - so canonical headers are only stamped onto an empty sheet.
    syncSheetColumns_(sheet, headers);
    if (sheet.getLastRow() < 2) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    styleHeader_(sheet, headers.length);
    applyColumnWidths_(sheet, sheetName);
    sheet.setFrozenRows(1);
    // Trim stray trailing columns only when they are completely empty.
    if (sheet.getMaxColumns() > headers.length && sheet.getLastColumn() <= headers.length) {
      sheet.deleteColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
    }
  });

  var cfg = ss.getSheetByName(SHEET.CONFIG_DROPDOWNS);
  if (cfg && cfg.getLastRow() < 2) {
    Object.keys(CONFIG_COLUMN_INDEX).forEach(function (key) {
      var values = CONFIG_DEFAULTS[key] || [];
      if (values.length) {
        cfg.getRange(2, CONFIG_COLUMN_INDEX[key], values.length, 1)
          .setValues(values.map(function (v) { return [v]; }));
      }
    });
  }

  applyValidations_();
  SpreadsheetApp.flush();

  var result = { success: true, sheets: Object.keys(HEADERS), config: getConfigData() };
  Logger.log('uPVC FMS database initialized: ' + JSON.stringify(result.sheets));
  return result;
}

/** Lightweight guard used before reads so the very first page load auto-provisions the schema. */
function ensureSchema_() {
  var ss = getSpreadsheet_();
  var missing = false;
  Object.keys(HEADERS).concat([SHEET.CONFIG_DROPDOWNS]).forEach(function (sheetName) {
    if (!ss.getSheetByName(sheetName)) missing = true;
  });
  if (missing) initDatabase();
}

/** Technical validation schema - dropdowns validate against Col A-E of uPVC_Config_Dropdowns. */
function applyValidations_() {
  var ss = getSpreadsheet_();
  var cfg = ss.getSheetByName(SHEET.CONFIG_DROPDOWNS);
  if (!cfg) return;
  if (cfg.getMaxRows() < 2) cfg.insertRowAfter(1);
  var span = Math.max(cfg.getMaxRows() - 1, 1);

  // Clear single-choice validations from multi-select columns (Variant and Glass Specs)
  var stageSheets = [SHEET.QUOTATION_MASTER, SHEET.QUOTE_WIN, SHEET.QUOTE_LOSS, SHEET.PO_MASTER, SHEET.DONE_PO_ARCHIVE];
  stageSheets.forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    ['Variant', 'Glass Specs'].forEach(function (header) {
      var col = columnIndexByHeader_(sheetName, header, sheet);
      if (col && sheet.getMaxRows() > 1) {
        sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).clearDataValidations();
      }
    });
  });

  var specs = getValidationSpecs_();
  specs.forEach(function (spec) {
    var sheet = ss.getSheetByName(spec.sheet);
    if (!sheet) return;
    if (sheet.getMaxRows() < 2) sheet.insertRowAfter(1);
    var col = columnIndexByHeader_(spec.sheet, spec.header, sheet);
    var sourceCol = CONFIG_COLUMN_INDEX[spec.config];
    if (!col || !sourceCol) return;

    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(cfg.getRange(2, sourceCol, span, 1), true)
      .setAllowInvalid(true)
      .setHelpText(spec.header + ' is validated against ' + CONFIG_HEADERS[sourceCol - 1] + '.')
      .build();

    sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  });
}

/* ==========================================================================
 * SECTION 5 - LOW LEVEL HELPERS
 * ======================================================================== */

function columnSpecs_(sheetName) {
  var specs = COLUMN_MAP[sheetName];
  if (!specs) throw new Error('Unknown sheet in COLUMN_MAP: ' + sheetName);
  return specs;
}

function headersOf_(sheetName) {
  return COLUMN_MAP[sheetName].map(function (spec) { return spec[0]; });
}

function columnSpecByKey_(sheetName, key) {
  var specs = columnSpecs_(sheetName);
  for (var i = 0; i < specs.length; i++) {
    if (specs[i][1] === key) return specs[i];
  }
  return null;
}

function columnSpecByHeader_(sheetName, header) {
  var specs = columnSpecs_(sheetName);
  for (var i = 0; i < specs.length; i++) {
    if (specs[i][0] === header) return specs[i];
  }
  return null;
}

/**
 * 1-based column of a header. When the sheet is supplied the column is resolved
 * from the sheet's own row 1 (legacy order / alias aware); otherwise the plan
 * position from COLUMN_MAP is returned.
 */
function columnIndexByHeader_(sheetName, header, sheet) {
  if (sheet) {
    var map = actualHeaderMap_(sheet, sheetName);
    if (map[header]) return map[header];
  }
  var specs = COLUMN_MAP[sheetName];
  if (!specs) return 0;
  for (var i = 0; i < specs.length; i++) {
    if (specs[i][0] === header) return i + 1;
  }
  return 0;
}

function scriptZone_() {
  return Session.getScriptTimeZone() || 'Asia/Kolkata';
}

function today_() {
  return Utilities.formatDate(new Date(), scriptZone_(), 'yyyy-MM-dd');
}

function toDateStr_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, scriptZone_(), 'yyyy-MM-dd');
  }
  var text = String(value).trim();
  var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var slash = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    return slash[3] + '-' + pad_(slash[2], 2) + '-' + pad_(slash[1], 2);
  }
  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return Utilities.formatDate(parsed, scriptZone_(), 'yyyy-MM-dd');
  return text;
}

function pad_(value, width) {
  var s = String(value);
  while (s.length < width) s = '0' + s;
  return s;
}

/**
 * Highest numeric sequence already used for an id prefix across the given sheets.
 * The match is case-insensitive and the id column is resolved by name, so a
 * legacy sheet (lowercase ids, alias header) still advances the counter instead
 * of letting nextId_ restart at 0001 and overwrite an existing row.
 */
function highestIdNumber_(prefix, sheetOrSheets) {
  var sheets = Array.isArray(sheetOrSheets) ? sheetOrSheets : [sheetOrSheets];
  var ss = getSpreadsheet_();
  var highest = 0;

  sheets.forEach(function (sh) {
    var sheetName = typeof sh === 'string' ? sh : '';
    var targetSheet = sheetName ? ss.getSheetByName(sheetName) : sh;
    if (!targetSheet) return;
    var last = targetSheet.getLastRow();
    if (last < 2) return;

    var idCol = 1;
    if (sheetName && HEADERS[sheetName]) {
      var map = actualHeaderMap_(targetSheet, sheetName);
      var idHeader = headersOf_(sheetName)[0];
      if (map[idHeader]) idCol = map[idHeader];
    }

    var values = targetSheet.getRange(2, idCol, last - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var n = idSequenceNumber_(values[i][0], prefix);
      if (n > highest) highest = n;
    }
  });

  return highest;
}

/** Autogenerates QT-UPVC-0001 / PO-UPVC-0001 style primary keys across active and completed pipeline sheets. */
function nextId_(prefix, sheetOrSheets) {
  return prefix + pad_(highestIdNumber_(prefix, sheetOrSheets) + 1, ID_PAD);
}

/**
 * Numeric sequence of an id like 'QT-UPVC-0012' (case-insensitive). Returns -1
 * when the value does not carry the prefix or holds no digits.
 */
function idSequenceNumber_(raw, prefix) {
  var text = String(raw === null || raw === undefined ? '' : raw).trim().toUpperCase();
  var head = String(prefix).toUpperCase();
  if (text.indexOf(head) !== 0) return -1;
  var digits = text.substring(head.length).replace(/[^0-9]/g, '');
  if (!digits) return -1;
  var n = parseInt(digits, 10);
  return isNaN(n) ? -1 : n;
}

/** Finds the 1-based row index of a record by its primary key, or -1 when absent. */
function findRowById_(sheetName, sheet, idValue) {
  var target = String(idValue === null || idValue === undefined ? '' : idValue).trim().toLowerCase();
  if (!target) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === target) return i + 2;
  }
  return -1;
}

/* ------------------------- [DOC] attachment helpers ---------------------- */

function serializeDocs_(value, docKey) {
  if (value === null || value === undefined || value === '') return '';
  var list = Array.isArray(value) ? value : (typeof value === 'object' ? [value] : []);
  if (list.length === 0) {
    var str = String(value).trim();
    if (str && (str.charAt(0) === '[' || str.charAt(0) === '{')) {
      try {
        var parsed = JSON.parse(str);
        return serializeDocs_(parsed, docKey);
      } catch (e) { }
    }
    return str;
  }

  // Multi-file upload is ONLY for Bills: store JSON
  if (docKey === 'bills') {
    return JSON.stringify(list);
  }

  // All other single-file columns: store normal direct link URL so user can click and open directly from Google Sheets
  var first = list[0];
  if (typeof first === 'string') return first;
  var linkUrl = (first && (first.url || first.previewUrl || (first.id ? ('https://drive.google.com/file/d/' + first.id + '/view') : ''))) || '';
  return linkUrl;
}

function parseDocs_(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object') return [value];

  var text = String(value).trim();
  if (!text) return [];

  var first = text.charAt(0);
  if (first === '[' || first === '{') {
    try {
      var parsed = JSON.parse(text);
      var arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.filter(function (item) {
        return item && (item.id || item.url || item.name);
      });
    } catch (err) { /* fall through to legacy single-URL handling */ }
  }

  var cleanUrl = text;
  var displayName = '';
  var hypMatch = text.match(/HYPERLINK\s*\(\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\)/i);
  if (hypMatch) {
    cleanUrl = hypMatch[1];
    displayName = hypMatch[2] || '';
  }

  var driveId = driveIdFromUrl_(cleanUrl);

  // If not a Drive link, not a web URL, and not a data URL, ignore placeholder/empty text
  if (!driveId && cleanUrl.indexOf('http') !== 0 && cleanUrl.indexOf('data:') !== 0) {
    return [];
  }

  var fileName = displayName || cleanUrl.split('/').pop().split('?')[0] || 'Attachment';
  if (!fileName || fileName.toLowerCase() === 'view') fileName = 'Attachment';

  return [{
    id: driveId,
    name: fileName,
    url: cleanUrl,
    previewUrl: driveId ? ('https://drive.google.com/file/d/' + driveId + '/preview') : cleanUrl,
    thumbnailUrl: driveId ? ('https://drive.google.com/thumbnail?id=' + driveId + '&sz=w800') : '',
    type: /\.pdf($|\?)/i.test(cleanUrl) ? 'pdf' : (/\.(png|jpe?g|webp|gif|svg)($|\?)/i.test(cleanUrl) ? 'image' : 'file'),
    size: 0,
    uploadedAt: ''
  }];
}

function driveIdFromUrl_(url) {
  var text = String(url || '');
  var patterns = [/\/d\/([-\w]{20,})/, /[?&]id=([-\w]{20,})/, /\/file\/d\/([-\w]{20,})/];
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) return m[1];
  }
  return '';
}

/* --------------------------- value coercion ------------------------------ */

function coerceValue_(spec, value) {
  var type = spec[2] || 'text';

  if (type === 'doc') return serializeDocs_(value, spec[1]);

  if (type === 'int') {
    if (value === '' || value === null || value === undefined) return '';
    var asInt = parseInt(String(value).replace(/[^0-9\-]/g, ''), 10);
    return isNaN(asInt) ? '' : asInt;
  }

  if (type === 'num') {
    if (value === '' || value === null || value === undefined) return '';
    var asNum = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
    return isNaN(asNum) ? '' : asNum;
  }

  if (type === 'date') return toDateStr_(value);

  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * Builds a full sheet-width row honouring the sheet's OWN column order, so a
 * legacy sheet whose columns are re-ordered is written correctly. Columns not
 * owned by the plan keep their existing values.
 */
function buildRow_(sheetName, sheet, payload, existingRow, forcedId) {
  var specs = columnSpecs_(sheetName);
  var data = payload || {};
  var indexMap = columnIndexMap_(sheetName, sheet);
  var width = Math.max(sheet.getLastColumn(), headersOf_(sheetName).length, 1);
  var row = new Array(width);
  for (var c = 0; c < width; c++) {
    row[c] = (existingRow && existingRow[c] !== undefined) ? existingRow[c] : '';
  }

  specs.forEach(function (spec, i) {
    var key = spec[1];
    var col = indexMap[i];
    if (col < 0) return;   // column absent in this sheet - nothing to write into
    if (forcedId && key === 'id') { row[col] = forcedId; return; }
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      row[col] = coerceValue_(spec, data[key]);
    }
  });

  return row;
}

/** Turns a raw sheet row into the canonical client record object. */
function recordFromValues_(sheetName, values, indexMap) {
  var specs = columnSpecs_(sheetName);
  var record = {};

  specs.forEach(function (spec, i) {
    var type = spec[2] || 'text';
    var idx = indexMap ? indexMap[i] : i;
    var raw = (idx >= 0 && idx < values.length) ? values[idx] : undefined;

    if (type === 'doc') {
      record[spec[1]] = parseDocs_(raw);
    } else if (type === 'int') {
      var asInt = typeof raw === 'number' ? Math.round(raw) : parseInt(String(raw || '').replace(/[^0-9\-]/g, ''), 10);
      record[spec[1]] = isNaN(asInt) ? 0 : asInt;
    } else if (type === 'num') {
      var asNum = typeof raw === 'number' ? raw : parseFloat(String(raw || '').replace(/[^0-9.\-]/g, ''));
      record[spec[1]] = isNaN(asNum) ? 0 : asNum;
    } else if (type === 'date') {
      record[spec[1]] = toDateStr_(raw);
    } else {
      record[spec[1]] = raw === null || raw === undefined ? '' : String(raw).trim();
    }
  });

  return record;
}

/**
 * Reads every data row of a sheet (row 1 is the frozen header). Columns are
 * resolved by header NAME (with legacy aliases), and a row counts as a record
 * when ANY of its mapped cells hold data - so a hand-entered legacy row is no
 * longer hidden just because its primary key cell was left blank.
 */
function records_(sheetName) {
  var sheet = getSheet_(sheetName, false);
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var width = Math.max(sheet.getLastColumn(), headersOf_(sheetName).length, 1);
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  var indexMap = columnIndexMap_(sheetName, sheet);
  var out = [];
  var qtyCols = legacyQtyCols_(sheet);

  for (var i = 0; i < values.length; i++) {
    if (isBlankRow_(values[i])) continue;
    var record = recordFromValues_(sheetName, values[i], indexMap);
    record._row = i + 2;
    // Legacy import: the canonical 'Total Item Qty' column is only filled once
    // someone edits it, so until then fall back to Window + Ventilator qty.
    if (qtyCols && !record.qty) record.qty = sumQtyColumns_(values[i], qtyCols);
    out.push(record);
  }
  return out;
}

function readRowRecord_(sheetName, sheet, rowIndex) {
  var width = Math.max(sheet.getLastColumn(), headersOf_(sheetName).length, 1);
  var values = sheet.getRange(rowIndex, 1, 1, width).getValues()[0];
  var record = recordFromValues_(sheetName, values, columnIndexMap_(sheetName, sheet));
  record._row = rowIndex;
  if (!record.qty) {
    var qtyCols = legacyQtyCols_(sheet);
    if (qtyCols) record.qty = sumQtyColumns_(values, qtyCols);
  }
  return record;
}

/** Writes (or appends) a full row keyed by primary key. Returns the saved record. */
function upsertRow_(sheetName, payload, forcedId) {
  var sheet = getSheet_(sheetName, true);
  var idValue = forcedId || payload.id || '';
  var rowIndex = findRowById_(sheetName, sheet, idValue);
  var width = Math.max(sheet.getLastColumn(), headersOf_(sheetName).length, 1);
  var existing = rowIndex > 0 ? sheet.getRange(rowIndex, 1, 1, width).getValues()[0] : null;

  var row = buildRow_(sheetName, sheet, payload, existing, idValue);
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    rowIndex = sheet.getLastRow();
  }
  return readRowRecord_(sheetName, sheet, rowIndex);
}

function deleteRowById_(sheetName, idValue) {
  var sheet = getSheet_(sheetName, false);
  var rowIndex = findRowById_(sheetName, sheet, idValue);
  if (rowIndex > 0) {
    sheet.deleteRow(rowIndex);
    return true;
  }
  return false;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    throw new Error('Another save is in progress. Please retry in a moment.');
  }
  try {
    return fn();
  } finally {
    try { SpreadsheetApp.flush(); } catch (e) { /* ignore */ }
    lock.releaseLock();
  }
}

/* ==========================================================================
 * SECTION 6 - READ APIs  (called from Index.html via google.script.run)
 * ======================================================================== */

/**
 * Single bootstrap payload for the whole web app.
 * @return {{success:boolean, masterQuotations:Array, quoteWin:Array, quoteLoss:Array,
 *           purchaseOrders:Array, doneArchive:Array, config:Object, meta:Object}}
 */
function getInitialData() {
  ensureSchema_();
  return {
    success: true,
    masterQuotations: records_(SHEET.QUOTATION_MASTER),
    quoteWin: records_(SHEET.QUOTE_WIN),
    quoteLoss: records_(SHEET.QUOTE_LOSS),
    purchaseOrders: records_(SHEET.PO_MASTER),
    doneArchive: records_(SHEET.DONE_PO_ARCHIVE),
    config: getConfigData(),
    meta: {
      app: APP_NAME,
      subtitle: APP_SUBTITLE,
      currency: CURRENCY,
      generatedAt: new Date().toISOString(),
      sheetNames: {
        master: SHEET.QUOTATION_MASTER,
        win: SHEET.QUOTE_WIN,
        loss: SHEET.QUOTE_LOSS,
        po: SHEET.PO_MASTER,
        done: SHEET.DONE_PO_ARCHIVE,
        config: SHEET.CONFIG_DROPDOWNS
      }
    }
  };
}

/** Section 5 - uPVC_Config_Dropdowns (Col A-E). */
function getConfigData() {
  var sheet = getSheet_(SHEET.CONFIG_DROPDOWNS, true);
  var last = sheet.getLastRow();
  var out = {};

  Object.keys(CONFIG_COLUMN_INDEX).forEach(function (key) {
    out[key] = (CONFIG_DEFAULTS[key] || []).slice();
  });

  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, CONFIG_HEADERS.length).getValues();
    Object.keys(CONFIG_COLUMN_INDEX).forEach(function (key) {
      var col = CONFIG_COLUMN_INDEX[key] - 1;
      var seen = {};
      var list = [];
      for (var r = 0; r < values.length; r++) {
        var text = String(values[r][col] || '').trim();
        if (!text) continue;
        var dedupe = text.toLowerCase();
        if (seen[dedupe]) continue;
        seen[dedupe] = true;
        list.push(text);
      }
      if (list.length) out[key] = list;
    });
  }
  return out;
}

/** Kept for API-compatibility with the reference portal's suggestion engine. */
function getSuggestionDatabase() {
  var config = getConfigData();
  return {
    success: true,
    productTypes: config.variants,
    vendors: config.vendors,
    meshTypes: config.meshTypes,
    glassTypes: config.glassTypes,
    lossReasons: config.lossReasons
  };
}

/** Raw read of one stage (sheet name must be one of the five pipeline sheets). */
function getStageRecords(sheetName) {
  if (!HEADERS[sheetName]) throw new Error('Unknown stage sheet: ' + sheetName);
  return { success: true, sheet: sheetName, records: records_(sheetName) };
}

/* ==========================================================================
 * SECTION 7 - WRITE APIs  (Section 1: Quotation Master + generic row save)
 * ======================================================================== */

/**
 * Creates a brand new active inquiry in uPVC_Quotation_Master.
 * The primary key (QT-UPVC-xxxx) is generated server side.
 */
function createQuotation(payload) {
  return withLock_(function () {
    var quotationSheets = [SHEET.QUOTATION_MASTER, SHEET.QUOTE_WIN, SHEET.QUOTE_LOSS];
    var id = nextId_(ID_PREFIX.QUOTATION, quotationSheets);
    var record = upsertRow_(SHEET.QUOTATION_MASTER, payload || {}, id);
    return { success: true, quotationId: id, record: record };
  });
}

/** Section 1 - full row update of the Quotation Master (detail page save). */
function updateMasterRowFull(quotationId, payload) {
  return updateRecordFull(SHEET.QUOTATION_MASTER, quotationId, payload);
}

/** Section 3 - full row update of a Purchase Order. */
function updatePurchaseOrderFull(poId, payload) {
  return updateRecordFull(SHEET.PO_MASTER, poId, payload);
}

/** Generic full-row update used by every editable stage. */
function updateRecordFull(sheetName, idValue, payload) {
  if (!HEADERS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  if (!idValue) throw new Error('Missing primary key for ' + sheetName);

  return withLock_(function () {
    var sheet = getSheet_(sheetName, false);
    var rowIndex = findRowById_(sheetName, sheet, idValue);
    if (rowIndex < 0) {
      throw new Error('Record not found in ' + sheetName + ' -> ' + idValue);
    }

    var width = Math.max(sheet.getLastColumn(), headersOf_(sheetName).length, 1);
    var existing = sheet.getRange(rowIndex, 1, 1, width).getValues()[0];
    var row = buildRow_(sheetName, sheet, payload || {}, existing, idValue);
    row[columnIndexMap_(sheetName, sheet)[0]] = String(idValue).trim();

    // 'Bills AMT' is a derived column: it always equals the sum of the excl-GST
    // amounts stored inside the 'Bills' JSON cell, never whatever a client sent.
    var billsCol = columnIndexByHeader_(sheetName, 'Bills', sheet);
    var billsAmtCol = columnIndexByHeader_(sheetName, 'Bills AMT', sheet);
    if (billsCol && billsAmtCol) {
      row[billsAmtCol - 1] = sumBillAmounts_(parseDocs_(row[billsCol - 1]));
    }

    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);

    return { success: true, sheet: sheetName, id: idValue, record: readRowRecord_(sheetName, sheet, rowIndex) };
  });
}

/**
 * Single cell write-through (used when a [DOC] cell or one inline field changes).
 * columnName is the exact plan header, e.g. 'Rough Sizes' or 'Vendor Amount'.
 */
function updateTableCell(sheetName, idValue, columnName, value) {
  if (!HEADERS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);

  return withLock_(function () {
    var sheet = getSheet_(sheetName, false);
    var rowIndex = findRowById_(sheetName, sheet, idValue);
    if (rowIndex < 0) throw new Error('Record not found in ' + sheetName + ' -> ' + idValue);

    var col = columnIndexByHeader_(sheetName, columnName, sheet);
    var spec = columnSpecByHeader_(sheetName, columnName);
    if (!col || !spec) throw new Error('Unknown column "' + columnName + '" on ' + sheetName);

    // 'Bills AMT' is derived, never authored: a direct write is redirected to the
    // sum of the excl-GST amounts held inside the 'Bills' JSON cell.
    var billsCol = columnIndexByHeader_(sheetName, 'Bills', sheet);
    var billsAmtCol = columnIndexByHeader_(sheetName, 'Bills AMT', sheet);
    if (columnName === 'Bills AMT' && billsCol && billsAmtCol) {
      col = billsAmtCol;
      value = sumBillAmounts_(parseDocs_(sheet.getRange(rowIndex, billsCol).getValue()));
    }

    var written = coerceValue_(spec, value);
    sheet.getRange(rowIndex, col).setValue(written);

    // Writing the Bills cell must refresh 'Bills AMT' in the same pass.
    if (columnName === 'Bills' && billsCol && billsAmtCol) {
      writeBillsTotal_(sheet, rowIndex, sheetName, parseDocs_(written));
    }

    return {
      success: true, sheet: sheetName, id: idValue,
      column: spec[0], value: written,
      record: readRowRecord_(sheetName, sheet, rowIndex)
    };
  });
}

/** Optional maintenance helper - deletes a record from any stage by primary key. */
function deleteRecord(sheetName, idValue) {
  if (!HEADERS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  return withLock_(function () {
    var removed = deleteRowById_(sheetName, idValue);
    return { success: removed, sheet: sheetName, id: idValue };
  });
}

/* ==========================================================================
 * SECTION 8 - PIPELINE TRANSITIONS
 *   2A Won  : Master -> Quote_Win  and  auto-creates the PO row  (3. PO Master)
 *   2B Lost : Master -> Quote_Loss with Loss Reason (terminates)
 *   4  Done : PO Master -> Done_PO_Archive (settled / cold storage)
 * ======================================================================== */

/**
 * Routes a quotation out of Section 1 into Section 2A or 2B.
 * @param {string} quotationId  QT-UPVC-xxxx primary key
 * @param {string} outcome      'Won' | 'Lost'
 * @param {string} reason       Loss Reason (Col E) when outcome is 'Lost'
 * @param {Object} payload      optional overrides { decisionDate, poDate, vendorAmount, ourAmount, ... }
 */
function submitDecision(quotationId, outcome, reason, payload) {
  return withLock_(function () {
    var masterSheet = getSheet_(SHEET.QUOTATION_MASTER, false);
    var rowIndex = findRowById_(SHEET.QUOTATION_MASTER, masterSheet, quotationId);
    if (rowIndex < 0) throw new Error('Quotation not found in Master: ' + quotationId);

    var master = readRowRecord_(SHEET.QUOTATION_MASTER, masterSheet, rowIndex);
    var overrides = payload || {};
    var merged = {};
    Object.keys(master).forEach(function (key) {
      if (key.indexOf('_') === 0) return;
      merged[key] = master[key];
    });
    Object.keys(overrides).forEach(function (key) {
      if (overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== '') {
        merged[key] = overrides[key];
      }
    });

    var decisionDate = toDateStr_(overrides.decisionDate) || today_();
    var isWon = String(outcome || '').toLowerCase() === 'won';
    var result = { success: true, outcome: isWon ? 'Won' : 'Lost', quotationId: quotationId };

    if (isWon) {
      /* --- 2A. uPVC_Quote_Win : auto-carries all data ------------------- */
      merged.id = quotationId;
      merged.date = decisionDate;
      var winRecord = upsertRow_(SHEET.QUOTE_WIN, merged, quotationId);
      result.winRecord = winRecord;

      /* --- 3. uPVC_Purchase_Order_Master : auto-populated from the Win --- */
      var poSheets = [SHEET.PO_MASTER, SHEET.DONE_PO_ARCHIVE];
      var poId = String(overrides.poId || '').trim() || nextId_(ID_PREFIX.PO, poSheets);
      var poPayload = {};
      Object.keys(merged).forEach(function (key) { poPayload[key] = merged[key]; });
      poPayload.quotationId = quotationId;
      poPayload.date = toDateStr_(overrides.poDate) || decisionDate;
      poPayload.poOrder = overrides.poOrder !== undefined ? overrides.poOrder : merged.poOrder;
      poPayload.bills = overrides.bills !== undefined ? overrides.bills : merged.bills;
      // Bills AMT is always derived from the per-bill amounts inside the Bills JSON cell.
      poPayload.billsAmt = sumBillAmounts_(parseDocs_(poPayload.bills));

      var poRecord = upsertRow_(SHEET.PO_MASTER, poPayload, poId);
      result.poId = poId;
      result.poRecord = poRecord;
    } else {
      /* --- 2B. uPVC_Quote_Loss : Our Amount is replaced by Loss Reason -- */
      var lossReason = String(reason || overrides.lossReason || '').trim();
      if (!lossReason) throw new Error('A Loss Reason is required to archive a lost quotation.');

      var lossPayload = {};
      Object.keys(merged).forEach(function (key) { lossPayload[key] = merged[key]; });
      delete lossPayload.ourAmount;
      lossPayload.id = quotationId;
      lossPayload.date = decisionDate;
      lossPayload.lossReason = lossReason;

      result.lossRecord = upsertRow_(SHEET.QUOTE_LOSS, lossPayload, quotationId);
      result.lossReason = lossReason;
    }

    deleteRowById_(SHEET.QUOTATION_MASTER, quotationId);
    return result;
  });
}

/** Convenience wrapper - explicit "Mark Won". */
function markQuotationWon(quotationId, payload) {
  return submitDecision(quotationId, 'Won', '', payload || {});
}

/** Convenience wrapper - explicit "Mark Lost" (terminates the inquiry). */
function markQuotationLost(quotationId, lossReason, payload) {
  return submitDecision(quotationId, 'Lost', lossReason, payload || {});
}

/**
 * Section 4 transition - moves a settled PO from uPVC_Purchase_Order_Master
 * into uPVC_Done_PO_Archive (16 cols) and stamps the Archived Date.
 */
function markPOCompleted(poId, handoverPayload) {
  return withLock_(function () {
    var poSheet = getSheet_(SHEET.PO_MASTER, false);
    var rowIndex = findRowById_(SHEET.PO_MASTER, poSheet, poId);
    if (rowIndex < 0) throw new Error('Purchase Order not found: ' + poId);

    var poRecord = readRowRecord_(SHEET.PO_MASTER, poSheet, rowIndex);
    var extra = handoverPayload || {};
    var payload = {};

    Object.keys(poRecord).forEach(function (key) {
      if (key.indexOf('_') === 0) return;
      payload[key] = poRecord[key];
    });

    payload.id = poId;
    payload.quotationId = poRecord.quotationId || extra.quotationId || '';
    payload.date = poRecord.date || toDateStr_(extra.date);
    payload.billsAmt = sumBillAmounts_(parseDocs_(payload.bills));
    payload.archivedDate = toDateStr_(extra.archivedDate) || today_();

    var archived = upsertRow_(SHEET.DONE_PO_ARCHIVE, payload, poId);
    deleteRowById_(SHEET.PO_MASTER, poId);

    return { success: true, poId: poId, archivedRecord: archived };
  });
}

/* ==========================================================================
 * SECTION 9 - SECTION 5 CONFIG APIs (uPVC_Config_Dropdowns Col A-E)
 * ======================================================================== */

/** Appends a new option to one of the five lookup columns. */
function saveConfigOption(columnKey, value) {
  var col = CONFIG_COLUMN_INDEX[columnKey];
  if (!col) throw new Error('Unknown config column: ' + columnKey);

  var text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) throw new Error('Cannot save an empty lookup value.');

  return withLock_(function () {
    var sheet = getSheet_(SHEET.CONFIG_DROPDOWNS, true);
    var config = getConfigData();
    var list = config[columnKey] || [];

    var exists = list.some(function (item) { return item.toLowerCase() === text.toLowerCase(); });
    if (exists) {
      return { success: true, duplicated: true, columnKey: columnKey, config: config };
    }

    var last = sheet.getLastRow();
    var targetRow = 2;
    if (last >= 2) {
      var used = sheet.getRange(2, col, last - 1, 1).getValues();
      for (var i = 0; i < used.length; i++) {
        if (String(used[i][0] || '').trim()) targetRow = i + 3;
      }
    }
    sheet.getRange(targetRow, col).setValue(text);

    return { success: true, duplicated: false, columnKey: columnKey, value: text, config: getConfigData() };
  });
}

/** Clears an option from a lookup column (blank rows are ignored by the reader). */
function deleteConfigOption(columnKey, value) {
  var col = CONFIG_COLUMN_INDEX[columnKey];
  if (!col) throw new Error('Unknown config column: ' + columnKey);

  var text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();

  return withLock_(function () {
    var sheet = getSheet_(SHEET.CONFIG_DROPDOWNS, true);
    var last = sheet.getLastRow();
    if (last >= 2) {
      var range = sheet.getRange(2, col, last - 1, 1);
      var values = range.getValues();
      var changed = false;
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][0] || '').trim().toLowerCase() === text) {
          values[i][0] = '';
          changed = true;
        }
      }
      if (changed) range.setValues(values);
    }
    return { success: true, columnKey: columnKey, value: value, config: getConfigData() };
  });
}

/** Re-applies all Col A-E dropdown validations after the lookups change. */
function refreshValidations() {
  applyValidations_();
  return { success: true, config: getConfigData() };
}

/* ==========================================================================
 * SECTION 10 - [DOC] FILE APIs (Google Drive backed)
 * ======================================================================== */

/** Root folder that owns every upload; created on first use. */
function getRootFolder_() {
  var iterator = DriveApp.getFoldersByName(DRIVE_ROOT_FOLDER_NAME);
  if (iterator.hasNext()) return iterator.next();
  return DriveApp.createFolder(DRIVE_ROOT_FOLDER_NAME);
}

/** Per-record sub folder, e.g. "uPVC FMS Documents/QT-UPVC-0001". */
function getRecordFolder_(recordId) {
  var root = getRootFolder_();
  var folderName = String(recordId || 'unassigned').trim() || 'unassigned';
  var iterator = root.getFoldersByName(folderName);
  if (iterator.hasNext()) return iterator.next();
  return root.createFolder(folderName);
}

function guessDocType_(mimeType, fileName) {
  var mime = String(mimeType || '').toLowerCase();
  var name = String(fileName || '').toLowerCase();
  if (mime.indexOf('pdf') > -1 || /\.pdf$/.test(name)) return 'pdf';
  if (mime.indexOf('image') > -1 || /\.(png|jpe?g|gif|bmp|webp|svg|heic)$/.test(name)) return 'image';
  if (/\.(xlsx?|csv)$/.test(name)) return 'sheet';
  if (/\.(docx?|txt)$/.test(name)) return 'doc';
  if (/\.(dwg|dxf)$/.test(name)) return 'cad';
  return 'file';
}

/**
 * Uploads one file into a [DOC] cell of any stage sheet.
 * @param {string} sheetName   one of the five pipeline sheet names
 * @param {string} recordId    primary key of the row (QT-UPVC-xxxx / PO-UPVC-xxxx)
 * @param {string} docKey      roughSizes | vendorQuote | ourQuote | poOrder | bills
 * @param {string} base64Data  raw base64 payload (data: prefix tolerated)
 * @param {string} mimeType    e.g. application/pdf, image/jpeg
 * @param {string} fileName    original file name
 * @param {Object} [options]   { replaceSingle: boolean, amount: number }
 *                             replaceSingle trashes the previous Drive file so a
 *                             single-file column always keeps exactly one file;
 *                             amount is the excl-GST amount kept on the attachment
 *                             (Bills) and refreshes the 'Bills AMT' total
 */
function uploadRecordFile(sheetName, recordId, docKey, base64Data, mimeType, fileName, options) {
  if (!HEADERS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);

  var spec = columnSpecByKey_(sheetName, docKey);
  if (!spec || spec[2] !== 'doc') {
    throw new Error('Column "' + docKey + '" is not a [DOC] column of ' + sheetName);
  }

  var sheet = getSheet_(sheetName, false);
  var rowIndex = findRowById_(sheetName, sheet, recordId);
  if (rowIndex < 0) throw new Error('Record not found in ' + sheetName + ' -> ' + recordId);

  var base64 = String(base64Data || '');
  if (!base64) throw new Error('Empty file payload for ' + fileName);
  var comma = base64.indexOf(',');
  if (comma > -1 && base64.substring(0, comma).indexOf('base64') > -1) {
    base64 = base64.substring(comma + 1);
  }

  var safeName = String(fileName || 'upload').replace(/[\\\/:*?"<>|]/g, '_');
  var folder = getRecordFolder_(recordId);
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType || 'application/octet-stream', safeName);
  var file = folder.createFile(blob);

  if (SHARE_UPLOADS_WITH_LINK) {
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      Logger.log('Sharing skipped for ' + safeName + ': ' + err);
    }
  }

  var fileId = file.getId();
  var attachOptions = options || {};
  var attachment = {
    id: fileId,
    name: file.getName(),
    url: file.getUrl(),
    previewUrl: 'https://drive.google.com/file/d/' + fileId + '/preview',
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w600',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + fileId,
    type: guessDocType_(mimeType, safeName),
    mime: mimeType || '',
    size: Number(file.getSize()) || Math.floor(base64.replace(/=+$/, '').length * 3 / 4),
    uploadedAt: new Date().toISOString()
  };

  // Bills carry their own excl-GST amount; every other upload never has one.
  if (docKey === 'bills') {
    attachment.amount = toAmount_(attachOptions.amount);
  }

  return withLock_(function () {
    // Re-resolve the row inside the lock so concurrent edits cannot shift the target.
    var rowIndex = findRowById_(sheetName, sheet, recordId);
    if (rowIndex < 0) throw new Error('Record not found in ' + sheetName + ' -> ' + recordId);

    var col = columnIndexByHeader_(sheetName, spec[0], sheet);
    var cellValue = sheet.getRange(rowIndex, col).getValue();
    var files = parseDocs_(cellValue);
    var trashed = [];

    // Single-file columns keep exactly one file - the previous one is trashed.
    if (attachOptions.replaceSingle && files.length) {
      trashed = trashDocumentSet_(files);
      files = [];
    }

    files.push(attachment);
    var serializedCell = (docKey === 'bills')
      ? JSON.stringify(files)
      : (attachment.url || (attachment.id ? ('https://drive.google.com/file/d/' + attachment.id + '/view') : ''));
    sheet.getRange(rowIndex, col).setValue(serializedCell);

    var total = null;
    if (docKey === 'bills') {
      total = writeBillsTotal_(sheet, rowIndex, sheetName, files);
    }

    return {
      success: true, sheet: sheetName, id: recordId, docKey: docKey, column: spec[0],
      file: attachment, files: files, replacedIds: trashed, billsAmt: total,
      cellValue: serializedCell
    };
  });
}

/** Coerces any user input into a non-negative excl-GST amount (blank -> 0). */
function toAmount_(value) {
  if (value === '' || value === null || value === undefined) return 0;
  var n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Sums the per-bill 'amount' values stored inside a Bills [DOC] cell. */
function sumBillAmounts_(files) {
  return (files || []).reduce(function (sum, entry) {
    return sum + toAmount_(entry && entry.amount);
  }, 0);
}

/** Trashes the Drive files of an attachment list. Returns the ids that were trashed. */
function trashDocumentSet_(files) {
  var trashed = [];
  (files || []).forEach(function (entry) {
    var driveId = entry && (entry.id || driveIdFromUrl_(entry.url));
    if (!driveId) return;
    try {
      var driveFile = DriveApp.getFileById(driveId);
      if (isManagedFile_(driveFile)) {
        driveFile.setTrashed(true);
        trashed.push(driveId);
      }
    } catch (err) {
      Logger.log('Drive trash skipped for ' + driveId + ': ' + err);
    }
  });
  return trashed;
}

/** Writes the summed bill amounts into the 'Bills AMT' column of the row. */
function writeBillsTotal_(sheet, rowIndex, sheetName, files) {
  var total = sumBillAmounts_(files);
  var totalCol = columnIndexByHeader_(sheetName, 'Bills AMT', sheet);
  if (totalCol) sheet.getRange(rowIndex, totalCol).setValue(total);
  return total;
}

/** Removes one attachment from a [DOC] cell and trashes the Drive file. */
function deleteRecordFile(sheetName, recordId, docKey, fileId) {
  if (!HEADERS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);

  var spec = columnSpecByKey_(sheetName, docKey);
  if (!spec || spec[2] !== 'doc') throw new Error('Not a [DOC] column: ' + docKey);

  return withLock_(function () {
    var sheet = getSheet_(sheetName, false);
    var rowIndex = findRowById_(sheetName, sheet, recordId);
    if (rowIndex < 0) throw new Error('Record not found -> ' + recordId);

    var col = columnIndexByHeader_(sheetName, spec[0], sheet);
    var files = parseDocs_(sheet.getRange(rowIndex, col).getValue());
    var removed = null;
    var remaining = [];

    files.forEach(function (file) {
      var matched = String(file.id || '') === String(fileId) || String(file.url || '') === String(fileId);
      if (matched && !removed) {
        removed = file;
        return;
      }
      remaining.push(file);
    });

    var serializedRemaining = '';
    if (remaining.length) {
      serializedRemaining = (docKey === 'bills')
        ? JSON.stringify(remaining)
        : (remaining[0].url || (remaining[0].id ? ('https://drive.google.com/file/d/' + remaining[0].id + '/view') : ''));
    }
    sheet.getRange(rowIndex, col).setValue(serializedRemaining);

    var billsTotal = null;
    if (docKey === 'bills') {
      // Removing a bill must keep 'Bills AMT' (the sum of the per-bill amounts)
      // in sync with the files left in the cell.
      billsTotal = writeBillsTotal_(sheet, rowIndex, sheetName, remaining);
    }

    if (removed) {
      var driveId = removed.id || driveIdFromUrl_(removed.url);
      if (driveId) {
        try {
          var driveFile = DriveApp.getFileById(driveId);
          if (isManagedFile_(driveFile)) driveFile.setTrashed(true);
        } catch (err) {
          Logger.log('Drive trash skipped for ' + driveId + ': ' + err);
        }
      }
    }

    return {
      success: true, sheet: sheetName, id: recordId, docKey: docKey,
      removed: removed, files: remaining, billsAmt: billsTotal,
      cellValue: serializedRemaining
    };
  });
}

/**
 * Saves the excl-GST amount of one or more bills and refreshes 'Bills AMT'.
 * The Bills cell stays the single source of truth: every amount lives on its
 * attachment entry and 'Bills AMT' always holds their sum.
 * @param {string} sheetName  uPVC_Purchase_Order_Master | uPVC_Done_PO_Archive
 * @param {string} recordId   PO-UPVC-xxxx primary key
 * @param {Array}  entries    [{ id: <drive file id>, amount: <number> }]
 */
function saveBillAmounts(sheetName, recordId, entries) {
  if (!HEADERS[sheetName]) throw new Error('Unknown sheet: ' + sheetName);
  var spec = columnSpecByKey_(sheetName, 'bills');
  if (!spec || spec[2] !== 'doc') throw new Error('No Bills [DOC] column on ' + sheetName);

  return withLock_(function () {
    var sheet = getSheet_(sheetName, false);
    var rowIndex = findRowById_(sheetName, sheet, recordId);
    if (rowIndex < 0) throw new Error('Record not found in ' + sheetName + ' -> ' + recordId);

    var incoming = {};
    (entries || []).forEach(function (entry, idx) {
      if (!entry) return;
      if (entry.id) incoming[String(entry.id)] = entry.amount;
      if (entry.url) incoming[String(entry.url)] = entry.amount;
      incoming[String(idx)] = entry.amount;
    });

    var col = columnIndexByHeader_(sheetName, spec[0], sheet);
    var files = parseDocs_(sheet.getRange(rowIndex, col).getValue());

    files.forEach(function (file, index) {
      var idKey = String(file.id || '');
      var urlKey = String(file.url || '');
      if (idKey && Object.prototype.hasOwnProperty.call(incoming, idKey)) {
        file.amount = toAmount_(incoming[idKey]);
      } else if (urlKey && Object.prototype.hasOwnProperty.call(incoming, urlKey)) {
        file.amount = toAmount_(incoming[urlKey]);
      } else if (Object.prototype.hasOwnProperty.call(incoming, String(index))) {
        file.amount = toAmount_(incoming[String(index)]);
      } else if (file.amount !== undefined) {
        file.amount = toAmount_(file.amount);
      }
    });

    sheet.getRange(rowIndex, col).setValue(files.length ? JSON.stringify(files) : '');
    var total = writeBillsTotal_(sheet, rowIndex, sheetName, files);

    return {
      success: true, sheet: sheetName, id: recordId, docKey: 'bills',
      files: files, billsAmt: total, cellValue: files.length ? JSON.stringify(files) : ''
    };
  });
}

/** Backwards-compatible alias used by file cards in the modal viewers. */
function deleteDriveFile(fileIdOrUrl) {
  var driveId = String(fileIdOrUrl || '');
  if (driveId.indexOf('http') === 0) driveId = driveIdFromUrl_(driveId);
  if (!driveId) return { success: false, message: 'No Drive file id supplied' };
  try {
    var file = DriveApp.getFileById(driveId);
    if (isManagedFile_(file)) file.setTrashed(true);
    return { success: true, fileId: driveId };
  } catch (err) {
    return { success: false, fileId: driveId, message: String(err) };
  }
}

/** Safety guard - only files living inside the uPVC FMS Documents tree get trashed. */
function isManagedFile_(file) {
  try {
    var rootName = DRIVE_ROOT_FOLDER_NAME;
    var parents = file.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getName() === rootName) return true;
      var grandParents = parent.getParents();
      while (grandParents.hasNext()) {
        if (grandParents.next().getName() === rootName) return true;
      }
    }
  } catch (err) {
    Logger.log('isManagedFile_ check failed: ' + err);
  }
  return false;
}

/* ==========================================================================
 * SECTION 11 - UTILITIES EXPOSED TO THE CLIENT
 * ======================================================================== */

/** Currency / count KPI snapshot used by the Analytics section. */
function getPipelineSummary() {
  ensureSchema_();
  var result = getInitialData();
  var sum = function (list, key) {
    return list.reduce(function (total, item) { return total + (Number(item[key]) || 0); }, 0);
  };

  var won = result.quoteWin;
  var wonValue = sum(won, 'ourAmount');
  var vendorCost = sum(won, 'vendorAmount');
  var decided = won.length + result.quoteLoss.length;

  return {
    success: true,
    inquiries: result.masterQuotations.length,
    won: won.length,
    lost: result.quoteLoss.length,
    winRate: decided ? Math.round((won.length / decided) * 1000) / 10 : 0,
    wonValue: wonValue,
    vendorCost: vendorCost,
    grossValue: wonValue - vendorCost,
    activePOs: result.purchaseOrders.length,
    archived: result.doneArchive.length,
    archivedValue: sum(result.doneArchive, 'ourAmount'),
    config: result.config
  };
}

/**
 * Manual verification helper - run from the Apps Script editor.
 *   selfTestBills()                  pure-logic + column-plan checks (no writes)
 *   selfTestBills('PO-UPVC-0001', true)
 *                                    also exercises the live round-trip on that PO:
 *                                    appends two bills (Bills AMT = sum), replaces a
 *                                    single-file slot (old Drive file trashed) and
 *                                    finally restores the original state.
 */
function selfTestBills(poId, runLive) {
  var log = [];
  var ok = true;

  var sample = [{ id: 'a', amount: 100.5 }, { id: 'b', amount: 249.5 }];
  var sum = sumBillAmounts_(sample);
  log.push('sumBillAmounts_ = ' + sum + ' (expected 350)');
  ok = ok && sum === 350;

  var parsed = parseDocs_(JSON.stringify(sample));
  log.push('parseDocs_ keeps the per-bill amount = ' + parsed[1].amount);
  ok = ok && parsed[1].amount === 249.5;

  log.push('toAmount_: blank -> ' + toAmount_('') + ' | "Rs 1,250.75" -> ' + toAmount_('Rs 1,250.75'));
  ok = ok && toAmount_('') === 0 && toAmount_('Rs 1,250.75') === 1250.75;

  [SHEET.QUOTATION_MASTER, SHEET.QUOTE_WIN, SHEET.QUOTE_LOSS, SHEET.PO_MASTER, SHEET.DONE_PO_ARCHIVE]
    .forEach(function (sheetName) {
      var headers = headersOf_(sheetName);
      var at = headers.indexOf('Bills AMT');
      log.push(sheetName + ' -> ' + headers.length + ' plan cols' +
        (at > -1 ? ' | Bills AMT @ col ' + (at + 1) : ' | no Bills column'));
    });

  if (runLive !== true || !poId) {
    log.push('Live round-trip skipped - call selfTestBills("<PO-UPVC-xxxx>", true) to exercise upload/replace.');
    Logger.log('\n' + log.join('\n'));
    return { success: ok, log: log };
  }

  var sheetName = SHEET.PO_MASTER;
  try {
    var bytes = Utilities.newBlob('uPVC FMS bills self-test payload').getBytes();
    var base64 = Utilities.base64Encode(bytes);

    var first = uploadRecordFile(sheetName, poId, 'bills', base64, 'text/plain', 'self_test_bill_1.txt', { amount: 111 });
    log.push('bill upload #1 -> files=' + first.files.length + ' | Bills AMT=' + first.billsAmt);

    var second = uploadRecordFile(sheetName, poId, 'bills', base64, 'text/plain', 'self_test_bill_2.txt', { amount: 222 });
    log.push('bill upload #2 -> files=' + second.files.length + ' | Bills AMT=' + second.billsAmt + ' (expect 333)');
    ok = ok && second.files.length === 2 && second.billsAmt === 333;

    uploadRecordFile(sheetName, poId, 'poOrder', base64, 'text/plain', 'self_test_po_1.txt', { replaceSingle: true });
    var swapped = uploadRecordFile(sheetName, poId, 'poOrder', base64, 'text/plain', 'self_test_po_2.txt', { replaceSingle: true });
    log.push('poOrder replace -> files=' + swapped.files.length + ' | trashed old=' +
      (swapped.replacedIds || []).length + ' (expect 1 file / 1 trashed)');
    ok = ok && swapped.files.length === 1 && (swapped.replacedIds || []).length === 1;

    deleteRecordFile(sheetName, poId, 'poOrder', swapped.file.id);
    deleteRecordFile(sheetName, poId, 'bills', second.file.id);
    var cleaned = deleteRecordFile(sheetName, poId, 'bills', first.file.id);
    var restored = saveBillAmounts(sheetName, poId, []);
    log.push('cleanup -> bills left=' + restored.files.length + ' | Bills AMT=' + restored.billsAmt +
      ' | removed test bill ids=' + (cleaned.files.length === restored.files.length ? 'yes' : 'check manually'));
  } catch (err) {
    ok = false;
    log.push('LIVE TEST FAILED: ' + err);
  }

  Logger.log('\n' + log.join('\n'));
  return { success: ok, log: log };
}

/** Creates the Google Drive root folder without uploading anything (first-run warm-up). */
function ensureDriveFolder() {
  var folder = getRootFolder_();
  return { success: true, folderId: folder.getId(), folderUrl: folder.getUrl(), name: folder.getName() };
}

/* ==========================================================================
 * SECTION 12 - LEGACY DATA REPAIR
 *   A one-time, idempotent backfill for sheets that were filled in by hand
 *   before the app existed: it trims stray whitespace on every primary key and
 *   assigns a proper QT-UPVC-xxxx / PO-UPVC-xxxx id to any data row whose key
 *   cell is blank, so the row is addressable for edits, uploads and links.
 * ======================================================================== */

/**
 * Run from the sheet menu (uPVC FMS > Repair Legacy Data) or the Apps Script
 * editor. Safe to run repeatedly.
 * @return {{success:boolean, assigned:number, perSheet:Object}}
 */
function repairLegacyIds() {
  return withLock_(function () {
    var qt = [SHEET.QUOTATION_MASTER, SHEET.QUOTE_WIN, SHEET.QUOTE_LOSS];
    var po = [SHEET.PO_MASTER, SHEET.DONE_PO_ARCHIVE];
    var report = {
      master: repairSheetIds_(SHEET.QUOTATION_MASTER, ID_PREFIX.QUOTATION, qt),
      win: repairSheetIds_(SHEET.QUOTE_WIN, ID_PREFIX.QUOTATION, qt),
      loss: repairSheetIds_(SHEET.QUOTE_LOSS, ID_PREFIX.QUOTATION, qt),
      po: repairSheetIds_(SHEET.PO_MASTER, ID_PREFIX.PO, po),
      done: repairSheetIds_(SHEET.DONE_PO_ARCHIVE, ID_PREFIX.PO, po)
    };
    SpreadsheetApp.flush();
    var assigned = 0;
    Object.keys(report).forEach(function (k) { assigned += report[k]; });
    Logger.log('repairLegacyIds assigned ' + assigned + ' id(s): ' + JSON.stringify(report));
    return { success: true, assigned: assigned, perSheet: report };
  });
}

/**
 * Trims the primary key of every data row and back-fills a fresh id where it is
 * blank. Returns how many ids were assigned on this sheet.
 */
function repairSheetIds_(sheetName, prefix, familySheets) {
  var sheet = getSheet_(sheetName, false);
  // A legacy sheet may have no primary-key column at all, so create any missing
  // plan column BEFORE touching data - otherwise ids would be written into
  // whatever happens to sit in column A.
  syncSheetColumns_(sheet, headersOf_(sheetName));

  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var width = Math.max(sheet.getLastColumn(), headersOf_(sheetName).length, 1);
  var idCol = columnIndexMap_(sheetName, sheet)[0] + 1;
  if (idCol < 1) return 0;   // no id column could be resolved - never write blind
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  var counter = highestIdNumber_(prefix, familySheets);
  var assigned = 0;
  var edits = [];

  for (var i = 0; i < values.length; i++) {
    var raw = values[i][idCol - 1];
    var original = String(raw === null || raw === undefined ? '' : raw);
    var current = original.trim();
    if (!current) {
      if (isBlankRow_(values[i])) continue;   // spacer row - leave untouched
      current = prefix + pad_(++counter, ID_PAD);
      assigned++;
    }
    if (current !== original) edits.push({ row: i + 2, value: current });
  }

  edits.forEach(function (e) { sheet.getRange(e.row, idCol).setValue(e.value); });
  return assigned;
}


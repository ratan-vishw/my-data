/****************************************************
 *  ARCHIVING SYSTEM — MANUAL RUN ONLY
 *  Status columns are live-scanned from row 6 on every run —
 *  never trusted from storage, so they can't go stale.
 *
 *  SetupConfig sheet still supplies (row 1 = header, data from row 2):
 *    A: Sheet Name
 *    D: Response Sheet
 *    E: Response Row Offset
 *    F: Cancel Sheet
 *    G: Done Sheet
 *  (Columns B/C are kept only as a human-readable reference —
 *   see refreshSetupConfigColumns() — the script itself ignores them.)
 *
 *  RULE:
 *    - ANY Status column        = "cancel"  -> archive to Cancel sheet
 *    - The LAST Status column   = "yes"     -> archive to Done sheet
 *
 *  Run archiveAllRows() manually (script editor, or the
 *  "Archiving Tools" menu after reopening the sheet).


const SETUP_SHEET_NAME  = "SetupConfig";
const STATUS_HEADER_ROW = 6; // row holding the "Status" labels on tracked sheets

/* ============================================================
 *  MAIN — run this manually whenever you want to archive.
 * ============================================================ 
function archiveAllRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = loadSheetConfig(ss);
  if (!config) return; // error already logged in loadSheetConfig

  let totalDone = 0;
  let totalCancelled = 0;

  Object.keys(config).forEach(sheetName => {
    const cfg = config[sheetName];
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`Sheet "${sheetName}" not found, skipping.`);
      return;
    }

    // Always re-scan row 6 fresh — never trust stale stored column letters.
    const statusCols = getStatusColumns(sheet);
    if (statusCols.length === 0) {
      Logger.log(`No "Status" headers found in row ${STATUS_HEADER_ROW} of "${sheetName}", skipping.`);
      return;
    }
    const completionCol = statusCols[statusCols.length - 1]; // last Status column = overall completion

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= STATUS_HEADER_ROW) return; // no data rows

    // ONE bulk read for the whole sheet instead of one read per row.
    const numDataRows = lastRow - STATUS_HEADER_ROW;
    const data = sheet.getRange(STATUS_HEADER_ROW + 1, 1, numDataRows, lastCol).getValues();

    const doneRows   = [];
    const cancelRows = [];
    const rowsToDelete = []; // source-sheet row numbers

    data.forEach((rowData, idx) => {
      const rowNumber = STATUS_HEADER_ROW + 1 + idx;
      const valueAt = col => {
        const v = rowData[col - 1];
        return typeof v === "string" ? v.trim().toLowerCase() : v;
      };

      if (statusCols.some(c => valueAt(c) === "cancel")) {
        cancelRows.push(rowData);
        rowsToDelete.push(rowNumber);
      } else if (valueAt(completionCol) === "yes") {
        doneRows.push(rowData);
        rowsToDelete.push(rowNumber);
      }
    });

    if (doneRows.length)   appendRowsToSheet(ss, cfg.doneSheet, sheet, doneRows);
    if (cancelRows.length) appendRowsToSheet(ss, cfg.cancelSheet, sheet, cancelRows);

    // Delete matched rows bottom-to-top so row numbers stay valid as we go.
    rowsToDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));

    // Clean up the matching rows on the Response sheet too.
    const responsesSheet = ss.getSheetByName(cfg.responseSheet);
    if (responsesSheet) {
      rowsToDelete
        .map(r => r - cfg.responseRowOffset)
        .filter(r => r > 1)
        .sort((a, b) => b - a)
        .forEach(r => {
          if (r <= responsesSheet.getLastRow()) responsesSheet.deleteRow(r);
        });
    }

    totalDone += doneRows.length;
    totalCancelled += cancelRows.length;
  });

  if (typeof generatePendingSummary === "function") {
    generatePendingSummary();
  }

  const msg = `Archiving complete: ${totalDone} moved to Done, ${totalCancelled} moved to Cancel.`;
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    // No UI available (running from the script editor) — fine, already logged above.
  }
}

/**
 * Scans row 6 of a sheet and returns the 1-based column numbers of
 * every header labelled "Status" — always live, never cached/stored.
 
function getStatusColumns(sheet) {
  const header = sheet.getRange(STATUS_HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cols = [];
  header.forEach((val, i) => {
    if (val && val.toString().trim().toLowerCase() === "status") {
      cols.push(i + 1);
    }
  });
  return cols;
}

/**
 * Appends multiple rows to a destination sheet in a single write call
 * (instead of one appendRow() call per row).
 *
function appendRowsToSheet(ss, destSheetName, sourceSheet, rows) {
  let destSheet = ss.getSheetByName(destSheetName);
  if (!destSheet) {
    destSheet = createSheetWithHeaders(ss, destSheetName, sourceSheet);
  }

  const timestamp = new Date();
  const withTimestamp = rows.map(r => [...r, timestamp]);
  const startRow = destSheet.getLastRow() + 1;
  destSheet.getRange(startRow, 1, withTimestamp.length, withTimestamp[0].length).setValues(withTimestamp);
}

/**
 * Reads the SetupConfig sheet into a plain config object keyed by sheet name.
 * Only sheet/response/offset info is trusted from here — Status columns
 * are always live-scanned by getStatusColumns(), never read from storage.
 *
function loadSheetConfig(ss) {
  const setupSheet = ss.getSheetByName(SETUP_SHEET_NAME);
  if (!setupSheet) {
    Logger.log(`"${SETUP_SHEET_NAME}" sheet not found.`);
    return null;
  }

  const lastRow = setupSheet.getLastRow();
  if (lastRow < 2) return {};

  const rows = setupSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const config = {};

  rows.forEach(([sheetName, , , responseSheet, offset, cancelSheet, doneSheet]) => {
    if (!sheetName) return;
    config[sheetName] = {
      responseSheet:     responseSheet,
      responseRowOffset: Number(offset) || 0,
      cancelSheet:       cancelSheet,
      doneSheet:         doneSheet
    };
  });

  return config;
}

/* ============================================================
 *  ARCHIVING
 * ============================================================ *
function createSheetWithHeaders(ss, sheetName, sourceSheet) {
  const newSheet = ss.insertSheet(sheetName);
  const lastCol  = sourceSheet.getLastColumn();

  sourceSheet.getRange(1, 1, 1, lastCol).copyTo(newSheet.getRange(1, 1));
  newSheet.getRange(1, lastCol + 1).setValue("Archived Date");

  return newSheet;
}

/* ============================================================
 *  OPTIONAL — keeps SetupConfig's Cancel/Completion columns in
 *  sync if you ever add or remove a "Status" column on a sheet.
 *  Run manually whenever that happens.
 * ============================================================ *
function refreshSetupConfigColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const setupSheet = ss.getSheetByName(SETUP_SHEET_NAME);
  if (!setupSheet) {
    Logger.log(`"${SETUP_SHEET_NAME}" sheet not found.`);
    return;
  }

  const lastRow = setupSheet.getLastRow();
  for (let r = 2; r <= lastRow; r++) {
    const sheetName = setupSheet.getRange(r, 1).getValue();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    const statusCols = getStatusColumns(sheet).map(columnToLetter);
    if (statusCols.length === 0) continue;

    setupSheet.getRange(r, 2).setValue(statusCols.join(","));                  // Cancel Columns
    setupSheet.getRange(r, 3).setValue(statusCols[statusCols.length - 1]);     // Completion Columns
    Logger.log(`"${sheetName}": Cancel=[${statusCols.join(",")}] Completion=[${statusCols[statusCols.length - 1]}]`);
  }

  Logger.log("✅ SetupConfig columns refreshed (for reference only — archiving no longer depends on this).");
}

/* ============================================================
 *  UTILITIES
 * ============================================================ *
function columnToLetter(column) {
  let letter = "";
  while (column > 0) {
    const mod = (column - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    column = Math.floor((column - mod) / 26);
  }
  return letter;
}

/* ============================================================
 *  Menu — so you don't have to open the script editor
 * ============================================================ *
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Archiving Tools")
    .addItem("📦 Archive Now", "archiveAllRows")
    .addItem("🔄 Refresh Setup Columns", "refreshSetupConfigColumns")
    .addToUi();
}****************************************************/
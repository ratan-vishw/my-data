/**
 * ============================================================================
 * OM TRADING - ENQUIRY & SITE WORKFLOW BACKEND (Code.gs)
 * Sheets:
 * - Active: Enquiries_Master, Quotation_Revisions, Site_Photos_Ledger, Payment_Transactions
 * - Partitioned Archive: Done_Enquiries_Master, Cancel_Enquiries_Master,
 *   Done/Cancel_Quotation_Revisions, Done/Cancel_Site_Photos_Ledger, Done/Cancel_Payment_Transactions
 * - Shared: dataBase, App_Settings
 * ============================================================================
 */

const CONFIG = {
    ROOT_FOLDER_ID: "YOUR_GOOGLE_DRIVE_ROOT_FOLDER_ID_HERE", // Optional: leave default to auto-save in sheet's parent folder
    SHEET_NAMES: {
        MASTER: "Enquiries_Master",
        REVISIONS: "Quotation_Revisions",
        PHOTOS: "Site_Photos_Ledger",
        PAYMENTS: "Payment_Transactions",
        DATABASE: "dataBase",
        SETTINGS: "App_Settings",
        // Partitioned Archive Sheets
        DONE_MASTER: "Done_Enquiries_Master",
        CANCEL_MASTER: "Cancel_Enquiries_Master",
        ARCHIVE_REVISIONS: "Done/Cancel_Quotation_Revisions",
        ARCHIVE_PHOTOS: "Done/Cancel_Site_Photos_Ledger",
        ARCHIVE_PAYMENTS: "Done/Cancel_Payment_Transactions"
    }
};

/**
 * 1. Web App Entrypoint
 */
function doGet(e) {
    try {
        setupSheets(); // Auto-create sheets with headers on first run
    } catch (err) {
        console.warn("setupSheets error: " + err.toString());
    }
    return HtmlService.createHtmlOutputFromFile("Index")
        .setTitle("OM Trading | Enquiry & Site Manager")
        .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Helper: Column Index Mapper for Enquiries_Master / Done_Enquiries_Master / Cancel_Enquiries_Master
 * Guarantees flexible, future-proof column lookup even if columns change order.
 */
function getMasterColMap(headers) {
    const h = (headers || []).map(x => String(x || "").trim().toLowerCase());

    // Strict priority match: exact match first, then specific phrase contains match
    const findIdx = (exactKeywords, containsKeywords = []) => {
        for (let i = 0; i < h.length; i++) {
            if (exactKeywords.includes(h[i])) return i;
        }
        for (let i = 0; i < h.length; i++) {
            for (const k of containsKeywords) {
                if (h[i].includes(k)) return i;
            }
        }
        return -1;
    };

    return {
        enquiryId: findIdx(["enquiry id", "enquiryid", "inquiry id", "id", "enquiry no", "inquiry no"], ["enquiry id", "inquiry id", "enquiry no"]),
        date: findIdx(["date of enquiry", "enquiry date", "date", "inquiry date"], ["date"]),
        reference: findIdx(["reference", "ref"], ["reference", "refer"]),
        place: findIdx(["place name", "place", "site area", "location"], ["place", "location"]),
        client: findIdx(["client name", "client", "customer name", "customer"], ["client", "customer"]),
        contact: findIdx(["contact number", "contact", "phone number", "phone", "mobile"], ["contact", "phone", "mobile"]),
        map: findIdx(["google map link", "google map", "map location", "map link", "map"], ["map link", "google map", "map"]),
        purposes: findIdx(["purposes", "scope purposes", "purpose", "scope"], ["purposes", "purpose", "scope"]),
        handler: findIdx(["site handler", "site handler(s)", "handler", "site handlers"], ["handler"]),
        note: findIdx(["site note / status", "site note", "note / status", "note/status", "status note", "note", "remarks"], ["site note", "note"]),
        supervisor: findIdx(["supervisor", "assigned supervisor"], ["supervisor"]),
        finalAmount: findIdx(["final amount", "quotations final amount", "final total amount", "total quotation amount", "total amount"], ["final amount", "total quotation", "total amount"]),
        payBank: findIdx(["payment in bank", "bank payment", "paid in bank", "pay bank", "bank"], ["bank"]),
        payCash: findIdx(["payment in cash", "cash payment", "paid in cash", "pay cash", "cash"], ["cash"]),
        balance: findIdx(["balance amount", "balance amount with gst included", "balance amount (with gst)", "balance due", "balance"], ["balance"]),
        status: findIdx(["done/cancel", "done / cancel", "done_cancel", "donecancel", "enquiry status", "done", "cancel"], ["done/cancel", "done / cancel", "done_cancel", "donecancel"]),
        quotationNo: findIdx(["quotation/pi no", "quotation / pi no", "quotation no", "pi no"], ["quotation/pi", "quotation no", "pi no"]),
        fileLink: findIdx(["quotation file link", "quotation / estimate file link", "quotation link", "file link"], ["quotation file link", "file link"])
    };
}

/**
 * Helper: Find an Enquiry across all Master sheets (Active, Done, Cancel)
 */
function findEnquiryInMasterSheets(ss, enquiryId) {
    if (!enquiryId) return null;
    const cleanId = String(enquiryId).trim();
    const sheetNames = [
        CONFIG.SHEET_NAMES.MASTER,
        CONFIG.SHEET_NAMES.DONE_MASTER,
        CONFIG.SHEET_NAMES.CANCEL_MASTER
    ];

    for (const sName of sheetNames) {
        const sheet = ss.getSheetByName(sName);
        if (!sheet || sheet.getLastRow() <= 1) continue;
        const data = sheet.getDataRange().getValues();
        const cols = getMasterColMap(data[0]);
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][idCol]).trim() === cleanId) {
                return {
                    sheet: sheet,
                    sheetName: sName,
                    rowIndex: i + 1,
                    rowData: data[i],
                    cols: cols,
                    isArchive: sName !== CONFIG.SHEET_NAMES.MASTER
                };
            }
        }
    }
    return null;
}

/**
 * Helper: Move child records (Quotations, Photos, Payments) between Active and Archive sheets
 */
function moveChildRecords(sourceSheet, targetSheet, enquiryId, idColIndex = 1) {
    if (!sourceSheet || !targetSheet) return;
    const cleanId = String(enquiryId).trim();
    if (sourceSheet.getLastRow() <= 1) return;

    const data = sourceSheet.getDataRange().getValues();
    // Iterate backwards so row deletions don't offset subsequent indices
    for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][idColIndex]).trim() === cleanId) {
            targetSheet.appendRow(data[i]);
            sourceSheet.deleteRow(i + 1);
        }
    }
}

/**
 * 2. Save / Update Enquiry Record
 * Handles auto-ID generation and updates in the appropriate master sheet without creating ghost revisions.
 */
function saveEnquiry(payload) {
    if (!payload) return { success: false, error: "No payload provided." };

    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets(); // Ensure all sheets exist
        const isNew = !payload.enquiryId;
        const today = new Date();

        let masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);
        let enquiryId = "";
        let existingLoc = null;

        if (isNew) {
            enquiryId = generateEnquiryId(ss);
        } else {
            enquiryId = String(payload.enquiryId).trim();
            existingLoc = findEnquiryInMasterSheets(ss, enquiryId);
            if (!existingLoc) {
                return { success: false, error: "Enquiry record " + enquiryId + " not found." };
            }
            masterSheet = existingLoc.sheet;
        }

        const data = masterSheet.getDataRange().getValues();
        const headers = data[0] || [];
        const cols = existingLoc ? existingLoc.cols : getMasterColMap(headers);
        const existingRecord = existingLoc ? existingLoc.rowData : null;
        const rowIndex = existingLoc ? existingLoc.rowIndex : -1;

        // Financial values: preserve existing or default to 0
        let finalAmount = 0;
        let paymentBank = 0;
        let paymentCash = 0;
        let balanceAmount = 0;

        if (existingRecord) {
            finalAmount = cols.finalAmount !== -1 ? (parseFloat(existingRecord[cols.finalAmount]) || 0) : 0;
            paymentBank = cols.payBank !== -1 ? (parseFloat(existingRecord[cols.payBank]) || 0) : 0;
            paymentCash = cols.payCash !== -1 ? (parseFloat(existingRecord[cols.payCash]) || 0) : 0;
            balanceAmount = finalAmount - (paymentBank + paymentCash);
        }

        // Format Purposes and Site Handlers (Array or String)
        const purposesStr = Array.isArray(payload.purposes) ? payload.purposes.filter(Boolean).join(", ") : (payload.purposes || "");
        const handlersStr = Array.isArray(payload.siteHandlers) ? payload.siteHandlers.filter(Boolean).join(", ") : (payload.siteHandlers || "");
        const siteNoteStr = payload.siteNote !== undefined
            ? String(payload.siteNote).trim()
            : (existingRecord && cols.note !== -1 ? String(existingRecord[cols.note] || "").trim() : "");
        const statusStr = payload.status !== undefined
            ? String(payload.status).trim()
            : (existingRecord && cols.status !== -1 ? String(existingRecord[cols.status] || "").trim() : "");

        // Enquiry date format
        let dateVal = payload.dateOfEnquiry;
        if (!dateVal) {
            dateVal = today;
        } else if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
            const parts = dateVal.split("T")[0].split("-");
            dateVal = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }

        // Build row based on existing headers
        const numCols = Math.max(headers.length, 16);
        let rowData = existingRecord ? [...existingRecord] : new Array(numCols).fill("");

        const setColVal = (colIdx, val) => {
            if (colIdx !== -1) {
                while (rowData.length <= colIdx) rowData.push("");
                rowData[colIdx] = val;
            }
        };

        setColVal(cols.enquiryId !== -1 ? cols.enquiryId : 0, enquiryId);
        setColVal(cols.date !== -1 ? cols.date : 1, dateVal);
        setColVal(cols.reference, payload.reference || "");
        setColVal(cols.place, payload.placeName || "");
        setColVal(cols.client, payload.clientName || "");
        setColVal(cols.contact, payload.contactNumber || "");
        setColVal(cols.map, payload.googleMapLink || "");
        setColVal(cols.purposes, purposesStr);
        setColVal(cols.handler, handlersStr);
        setColVal(cols.note, siteNoteStr);
        setColVal(cols.supervisor, payload.supervisor || "");
        setColVal(cols.finalAmount, finalAmount);
        setColVal(cols.payBank, paymentBank);
        setColVal(cols.payCash, paymentCash);
        setColVal(cols.balance, balanceAmount);
        setColVal(cols.status, statusStr);

        if (isNew) {
            masterSheet.appendRow(rowData);

            // Auto-create designated Drive Folder structure safely
            try {
                getOrCreateEnquiryFolder(enquiryId, payload.clientName, payload.placeName);
            } catch (folderErr) {
                console.warn("Folder creation notice: " + folderErr.message);
            }
        } else {
            masterSheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
        }

        return {
            success: true,
            enquiryId: enquiryId,
            siteNote: siteNoteStr,
            status: statusStr,
            balanceAmount: balanceAmount,
            finalAmount: finalAmount
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 2b. Fast Inline Site Note / Status Update
 * Updates only the Site Note / Status cell for quick on-site typing.
 */
function updateSiteNote(enquiryId, siteNote) {
    if (!enquiryId) return { success: false, error: "Enquiry ID required." };

    const lock = LockService.getScriptLock();
    lock.tryLock(5000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const loc = findEnquiryInMasterSheets(ss, enquiryId);
        if (!loc) {
            return { success: false, error: "Enquiry record " + enquiryId + " not found." };
        }

        const cols = loc.cols;
        let noteColIndex = cols.note + 1; // 1-based column

        if (cols.note === -1) {
            const insertAfter = cols.handler !== -1 ? cols.handler + 1 : 9;
            loc.sheet.insertColumnAfter(insertAfter);
            noteColIndex = insertAfter + 1;
            loc.sheet.getRange(1, noteColIndex).setValue("Site Note / Status").setFontWeight("bold").setBackground("#f0f0f0");
        }

        const cleanNote = siteNote !== undefined ? String(siteNote).trim() : "";
        loc.sheet.getRange(loc.rowIndex, noteColIndex).setValue(cleanNote);
        return { success: true, enquiryId: enquiryId, siteNote: cleanNote };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 2c. Fast Inline Done / Cancel Status Update with Multi-Sheet Row Migration
 * Moves the Enquiry row and all its attached Quotations, Photos, and Payments
 * between Enquiries_Master, Done_Enquiries_Master, and Cancel_Enquiries_Master.
 */
function updateEnquiryStatus(enquiryId, status) {
    if (!enquiryId) return { success: false, error: "Enquiry ID required." };

    const lock = LockService.getScriptLock();
    lock.tryLock(15000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();

        const cleanStatus = status !== undefined ? String(status).trim() : "";
        const cleanId = String(enquiryId).trim();

        // 1. Locate existing enquiry in any master sheet
        const loc = findEnquiryInMasterSheets(ss, cleanId);
        if (!loc) {
            return { success: false, error: "Enquiry " + cleanId + " not found." };
        }

        // 2. Determine target master sheet
        let targetSheetName = CONFIG.SHEET_NAMES.MASTER;
        if (cleanStatus.toLowerCase() === "done") {
            targetSheetName = CONFIG.SHEET_NAMES.DONE_MASTER;
        } else if (cleanStatus.toLowerCase() === "cancel") {
            targetSheetName = CONFIG.SHEET_NAMES.CANCEL_MASTER;
        }

        const currentSheet = loc.sheet;
        const currentSheetName = loc.sheetName;
        const targetSheet = ss.getSheetByName(targetSheetName);

        // Update status in the row data
        const cols = loc.cols;
        let statusCol = cols.status !== -1 ? cols.status : 15;
        const rowData = [...loc.rowData];
        while (rowData.length <= statusCol) rowData.push("");
        rowData[statusCol] = cleanStatus;

        // If target sheet is different, move the master row
        if (currentSheetName !== targetSheetName) {
            targetSheet.appendRow(rowData);
            currentSheet.deleteRow(loc.rowIndex);
        } else {
            // Same sheet, update status cell
            currentSheet.getRange(loc.rowIndex, statusCol + 1).setValue(cleanStatus);
        }

        // 3. Move child records (Quotations, Photos, Payments)
        const isTargetArchive = (targetSheetName !== CONFIG.SHEET_NAMES.MASTER);
        const isSourceArchive = (currentSheetName !== CONFIG.SHEET_NAMES.MASTER);

        if (isSourceArchive !== isTargetArchive) {
            // Revisions
            const revSource = ss.getSheetByName(isSourceArchive ? CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS : CONFIG.SHEET_NAMES.REVISIONS);
            const revTarget = ss.getSheetByName(isTargetArchive ? CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS : CONFIG.SHEET_NAMES.REVISIONS);
            moveChildRecords(revSource, revTarget, cleanId, 1);

            // Photos
            const photoSource = ss.getSheetByName(isSourceArchive ? CONFIG.SHEET_NAMES.ARCHIVE_PHOTOS : CONFIG.SHEET_NAMES.PHOTOS);
            const photoTarget = ss.getSheetByName(isTargetArchive ? CONFIG.SHEET_NAMES.ARCHIVE_PHOTOS : CONFIG.SHEET_NAMES.PHOTOS);
            moveChildRecords(photoSource, photoTarget, cleanId, 1);

            // Payments
            const paySource = ss.getSheetByName(isSourceArchive ? CONFIG.SHEET_NAMES.ARCHIVE_PAYMENTS : CONFIG.SHEET_NAMES.PAYMENTS);
            const payTarget = ss.getSheetByName(isTargetArchive ? CONFIG.SHEET_NAMES.ARCHIVE_PAYMENTS : CONFIG.SHEET_NAMES.PAYMENTS);
            moveChildRecords(paySource, payTarget, cleanId, 1);
        }

        return {
            success: true,
            enquiryId: cleanId,
            status: cleanStatus,
            movedTo: targetSheetName
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 3. Direct Photo Upload Handler
 * Uploads Base64 image directly to Enquiry's Drive subfolder and records in the appropriate Ledger (Active or Archive).
 */
function uploadPhoto(enquiryId, clientName, placeName, base64Data, fileName, stage) {
    const lock = LockService.getScriptLock();
    lock.tryLock(15000);

    try {
        const photoFolder = getOrCreateEnquiryPhotoFolder(enquiryId, clientName, placeName);
        if (!photoFolder) {
            return { success: false, error: "Could not access or create Google Drive folder for photos." };
        }

        // Process base64 blob
        const splitData = base64Data.split(",");
        const contentType = splitData[0].match(/:(.*?);/)[1] || "image/jpeg";
        const decodedBytes = Utilities.base64Decode(splitData[1]);
        const safeFileName = (fileName || "photo.jpg").replace(/[/\\?%*:|"<>]/g, "_");
        const blob = Utilities.newBlob(decodedBytes, contentType, `${enquiryId}_${Date.now()}_${safeFileName}`);

        // Save to Google Drive
        const driveFile = photoFolder.createFile(blob);
        try {
            driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {
            console.warn("Set sharing warning: " + shareErr.message);
        }

        const fileId = driveFile.getId();
        const viewUrl = driveFile.getUrl();
        const directThumbnailUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
        const photoId = "PHT-" + Utilities.getUuid().substring(0, 8);
        const timestamp = new Date();

        // Determine destination sheet (Active or Archive)
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const loc = findEnquiryInMasterSheets(ss, enquiryId);
        const isArchive = loc ? loc.isArchive : false;
        const targetSheetName = isArchive ? CONFIG.SHEET_NAMES.ARCHIVE_PHOTOS : CONFIG.SHEET_NAMES.PHOTOS;

        const photoSheet = ss.getSheetByName(targetSheetName);
        if (photoSheet) {
            photoSheet.appendRow([
                photoId,
                enquiryId,
                stage || "Initial Site Visit",
                fileId,
                viewUrl,
                directThumbnailUrl,
                safeFileName,
                timestamp
            ]);
        }

        return {
            success: true,
            photo: {
                photoId: photoId,
                enquiryId: enquiryId,
                stage: stage || "Initial Site Visit",
                fileId: fileId,
                viewUrl: viewUrl,
                thumbnailUrl: directThumbnailUrl,
                fileName: safeFileName
            }
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4. Photo Deletion Handler
 * Moves Drive file to trash and removes database row in Ledger (searching Active & Archive).
 */
function deletePhoto(photoId, enquiryId) {
    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const photoSheetNames = [CONFIG.SHEET_NAMES.PHOTOS, CONFIG.SHEET_NAMES.ARCHIVE_PHOTOS];

        let foundSheet = null;
        let rowToDelete = -1;
        let fileId = "";

        for (const sName of photoSheetNames) {
            const sheet = ss.getSheetByName(sName);
            if (!sheet || sheet.getLastRow() <= 1) continue;
            const data = sheet.getDataRange().getValues();
            for (let i = 1; i < data.length; i++) {
                if (String(data[i][0]).trim() === String(photoId).trim() && String(data[i][1]).trim() === String(enquiryId).trim()) {
                    foundSheet = sheet;
                    rowToDelete = i + 1;
                    fileId = data[i][3];
                    break;
                }
            }
            if (foundSheet) break;
        }

        if (!foundSheet || rowToDelete === -1) {
            return { success: false, error: "Photo record not found in sheet." };
        }

        // Move file to Drive Trash
        if (fileId) {
            try {
                const file = DriveApp.getFileById(fileId);
                file.setTrashed(true);
            } catch (err) {
                console.warn("Drive file already deleted or inaccessible: " + err.message);
            }
        }

        // Remove row from Sheet
        foundSheet.deleteRow(rowToDelete);

        return { success: true, photoId: photoId };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4b. Direct Quotation / PI File Upload Handler
 * Uploads PDF, Excel, Word, or Image files directly to Enquiry's Drive folder (02_Quotations)
 * and records the individual quotation/PI document with its Amount in Active or Archive Revisions.
 */
function uploadQuotationFile(enquiryId, clientName, placeName, base64Data, fileName, quotationDocNo, amount, notes) {
    if (enquiryId && typeof enquiryId === "object") {
        const p = enquiryId;
        enquiryId = p.enquiryId;
        clientName = p.clientName;
        placeName = p.placeName;
        base64Data = p.base64Data;
        fileName = p.fileName;
        quotationDocNo = p.quotationDocNo || p.docTitle;
        amount = p.amount;
        notes = p.notes;
    }

    const lock = LockService.getScriptLock();
    lock.tryLock(15000);

    try {
        const quoteFolder = getOrCreateEnquiryQuotationFolder(enquiryId, clientName, placeName);
        if (!quoteFolder) {
            return { success: false, error: "Could not access or create Google Drive folder for quotations." };
        }

        // Process base64 blob
        const splitData = base64Data.split(",");
        const contentTypeMatch = splitData[0].match(/:(.*?);/);
        const contentType = contentTypeMatch ? contentTypeMatch[1] : "application/pdf";
        const decodedBytes = Utilities.base64Decode(splitData[1]);
        const safeFileName = (fileName || "Quotation.pdf").replace(/[/\\?%*:|"<>]/g, "_");
        const docPrefix = (quotationDocNo || "QT").replace(/[/\\?%*:|"<>]/g, "_");
        const blob = Utilities.newBlob(decodedBytes, contentType, `${enquiryId}_${docPrefix}_${safeFileName}`);

        // Save to Google Drive
        const driveFile = quoteFolder.createFile(blob);
        try {
            driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {
            console.warn("Set sharing warning: " + shareErr.message);
        }

        const fileId = driveFile.getId();
        const viewUrl = driveFile.getUrl();
        const docAmount = parseFloat(amount) || 0;
        const revId = "REV-" + Utilities.getUuid().substring(0, 8);
        const today = new Date();
        const docTitle = quotationDocNo || safeFileName.replace(/\.[^/.]+$/, "");

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const loc = findEnquiryInMasterSheets(ss, enquiryId);
        const isArchive = loc ? loc.isArchive : false;
        const targetRevSheetName = isArchive ? CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS : CONFIG.SHEET_NAMES.REVISIONS;
        const revSheet = ss.getSheetByName(targetRevSheetName);

        // 1. Record in Revisions Sheet
        if (revSheet) {
            revSheet.appendRow([
                revId,
                enquiryId,
                docTitle,
                docAmount,
                notes || ("Document attached: " + safeFileName),
                today,
                viewUrl
            ]);
        }

        // 2. Calculate Total Final Amount from all Revisions for this enquiry (checking both sheets)
        let totalQuotationsAmount = 0;
        [CONFIG.SHEET_NAMES.REVISIONS, CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const revData = sh.getDataRange().getValues();
            for (let i = 1; i < revData.length; i++) {
                if (String(revData[i][1]).trim() === String(enquiryId).trim()) {
                    totalQuotationsAmount += (parseFloat(revData[i][3]) || 0);
                }
            }
        });

        // 3. Update Master sheet
        let newBalance = totalQuotationsAmount;
        if (loc) {
            const cols = loc.cols;
            const payBank = cols.payBank !== -1 ? (parseFloat(loc.rowData[cols.payBank]) || 0) : 0;
            const payCash = cols.payCash !== -1 ? (parseFloat(loc.rowData[cols.payCash]) || 0) : 0;
            newBalance = totalQuotationsAmount - (payBank + payCash);

            if (cols.finalAmount !== -1) loc.sheet.getRange(loc.rowIndex, cols.finalAmount + 1).setValue(totalQuotationsAmount);
            if (cols.balance !== -1) loc.sheet.getRange(loc.rowIndex, cols.balance + 1).setValue(newBalance);
            if (cols.fileLink !== -1) loc.sheet.getRange(loc.rowIndex, cols.fileLink + 1).setValue(viewUrl);
        }

        return {
            success: true,
            fileUrl: viewUrl,
            fileName: safeFileName,
            fileId: fileId,
            doc: {
                revId: revId,
                enquiryId: enquiryId,
                revNo: docTitle,
                amount: docAmount,
                notes: notes || ("Document attached: " + safeFileName),
                date: today.toISOString(),
                fileLink: viewUrl,
                fileName: safeFileName
            },
            totalFinalAmount: totalQuotationsAmount,
            balanceAmount: newBalance
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4c. Save / Edit Quotation or PI Document Metadata (Without re-uploading file)
 */
function saveQuotationDocument(payload) {
    if (!payload || !payload.enquiryId) {
        return { success: false, error: "Enquiry ID is required." };
    }

    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const enquiryId = String(payload.enquiryId).trim();
        const revId = payload.revId ? String(payload.revId).trim() : ("REV-" + Utilities.getUuid().substring(0, 8));
        const docTitle = payload.docTitle || payload.revNo || "Quotation";
        const docAmount = parseFloat(payload.amount) || 0;
        const notes = payload.notes || "";
        const fileLink = payload.fileLink || "";
        const today = new Date();

        const loc = findEnquiryInMasterSheets(ss, enquiryId);
        const isArchive = loc ? loc.isArchive : false;
        const targetRevSheetName = isArchive ? CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS : CONFIG.SHEET_NAMES.REVISIONS;
        const revSheet = ss.getSheetByName(targetRevSheetName);

        let revRow = -1;
        if (payload.revId && revSheet && revSheet.getLastRow() > 1) {
            const revData = revSheet.getDataRange().getValues();
            for (let i = 1; i < revData.length; i++) {
                if (String(revData[i][0]).trim() === revId && String(revData[i][1]).trim() === enquiryId) {
                    revRow = i + 1;
                    break;
                }
            }
        }

        if (revRow !== -1) {
            revSheet.getRange(revRow, 3).setValue(docTitle);
            revSheet.getRange(revRow, 4).setValue(docAmount);
            revSheet.getRange(revRow, 5).setValue(notes);
            if (fileLink) revSheet.getRange(revRow, 7).setValue(fileLink);
        } else if (revSheet) {
            revSheet.appendRow([
                revId,
                enquiryId,
                docTitle,
                docAmount,
                notes,
                today,
                fileLink
            ]);
        }

        // Recalculate Master Total Amount & Balance
        let totalQuotationsAmount = 0;
        [CONFIG.SHEET_NAMES.REVISIONS, CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const revData = sh.getDataRange().getValues();
            for (let i = 1; i < revData.length; i++) {
                if (String(revData[i][1]).trim() === enquiryId) {
                    totalQuotationsAmount += (parseFloat(revData[i][3]) || 0);
                }
            }
        });

        let newBalance = totalQuotationsAmount;
        if (loc) {
            const cols = loc.cols;
            const payBank = cols.payBank !== -1 ? (parseFloat(loc.rowData[cols.payBank]) || 0) : 0;
            const payCash = cols.payCash !== -1 ? (parseFloat(loc.rowData[cols.payCash]) || 0) : 0;
            newBalance = totalQuotationsAmount - (payBank + payCash);

            if (cols.finalAmount !== -1) loc.sheet.getRange(loc.rowIndex, cols.finalAmount + 1).setValue(totalQuotationsAmount);
            if (cols.balance !== -1) loc.sheet.getRange(loc.rowIndex, cols.balance + 1).setValue(newBalance);
            if (cols.fileLink !== -1 && fileLink) {
                loc.sheet.getRange(loc.rowIndex, cols.fileLink + 1).setValue(fileLink);
            }
        }

        return {
            success: true,
            doc: {
                revId: revId,
                enquiryId: enquiryId,
                revNo: docTitle,
                amount: docAmount,
                notes: notes,
                date: today.toISOString(),
                fileLink: fileLink,
                fileName: payload.fileName || docTitle
            },
            totalFinalAmount: totalQuotationsAmount,
            balanceAmount: newBalance
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4d. Delete Quotation / PI Document Handler
 */
function deleteQuotationDocument(revId, enquiryId) {
    if (!revId || !enquiryId) return { success: false, error: "Revision ID and Enquiry ID are required." };

    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const revSheetNames = [CONFIG.SHEET_NAMES.REVISIONS, CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS];

        let foundRevSheet = null;
        let rowToDelete = -1;

        for (const sName of revSheetNames) {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) continue;
            const revData = sh.getDataRange().getValues();
            for (let i = 1; i < revData.length; i++) {
                if (String(revData[i][0]).trim() === String(revId).trim() && String(revData[i][1]).trim() === String(enquiryId).trim()) {
                    foundRevSheet = sh;
                    rowToDelete = i + 1;
                    break;
                }
            }
            if (foundRevSheet) break;
        }

        if (!foundRevSheet || rowToDelete === -1) {
            return { success: false, error: "Quotation document record not found." };
        }

        // Delete row
        foundRevSheet.deleteRow(rowToDelete);

        // Recalculate Master Total Amount & Balance
        let totalQuotationsAmount = 0;
        let latestFileLink = "";
        revSheetNames.forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const revData = sh.getDataRange().getValues();
            for (let i = 1; i < revData.length; i++) {
                if (String(revData[i][1]).trim() === String(enquiryId).trim()) {
                    totalQuotationsAmount += (parseFloat(revData[i][3]) || 0);
                    if (revData[i][6]) latestFileLink = revData[i][6].toString();
                }
            }
        });

        const loc = findEnquiryInMasterSheets(ss, enquiryId);
        let newBalance = totalQuotationsAmount;
        if (loc) {
            const cols = loc.cols;
            const payBank = cols.payBank !== -1 ? (parseFloat(loc.rowData[cols.payBank]) || 0) : 0;
            const payCash = cols.payCash !== -1 ? (parseFloat(loc.rowData[cols.payCash]) || 0) : 0;
            newBalance = totalQuotationsAmount - (payBank + payCash);

            if (cols.finalAmount !== -1) loc.sheet.getRange(loc.rowIndex, cols.finalAmount + 1).setValue(totalQuotationsAmount);
            if (cols.balance !== -1) loc.sheet.getRange(loc.rowIndex, cols.balance + 1).setValue(newBalance);
            if (cols.fileLink !== -1) loc.sheet.getRange(loc.rowIndex, cols.fileLink + 1).setValue(latestFileLink);
        }

        return {
            success: true,
            revId: revId,
            totalFinalAmount: totalQuotationsAmount,
            balanceAmount: newBalance
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 5. Record Payment & Recalculate Master Balance
 * Updates Transaction log in Active or Archive sheet and adjusts master balance.
 */
function recordPayment(paymentPayload) {
    if (!paymentPayload || !paymentPayload.enquiryId) {
        return { success: false, error: "Invalid payment payload." };
    }

    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();

        const cleanId = String(paymentPayload.enquiryId).trim();
        const loc = findEnquiryInMasterSheets(ss, cleanId);
        const isArchive = loc ? loc.isArchive : false;
        const targetPaymentSheetName = isArchive ? CONFIG.SHEET_NAMES.ARCHIVE_PAYMENTS : CONFIG.SHEET_NAMES.PAYMENTS;
        const paymentSheet = ss.getSheetByName(targetPaymentSheetName);

        const paymentId = "PAY-" + Utilities.getUuid().substring(0, 8);
        const paymentAmount = parseFloat(paymentPayload.amount) || 0;
        const paymentMode = paymentPayload.mode || "Bank"; // 'Bank' or 'Cash'
        const today = new Date();

        // 1. Append to Payment_Transactions
        if (paymentSheet) {
            paymentSheet.appendRow([
                paymentId,
                cleanId,
                today,
                paymentAmount,
                paymentMode,
                paymentPayload.referenceNo || "",
                paymentPayload.notes || ""
            ]);
        }

        // 2. Aggregate all payments for this Enquiry across both active & archive sheets
        let totalBank = 0;
        let totalCash = 0;

        [CONFIG.SHEET_NAMES.PAYMENTS, CONFIG.SHEET_NAMES.ARCHIVE_PAYMENTS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const payData = sh.getDataRange().getValues();
            for (let i = 1; i < payData.length; i++) {
                if (String(payData[i][1]).trim() === cleanId) {
                    const amt = parseFloat(payData[i][3]) || 0;
                    const mode = String(payData[i][4]).trim();
                    if (mode.toLowerCase() === "bank") totalBank += amt;
                    if (mode.toLowerCase() === "cash") totalCash += amt;
                }
            }
        });

        // 3. Update Master sheet balance
        if (loc) {
            const cols = loc.cols;
            const finalAmount = cols.finalAmount !== -1 ? (parseFloat(loc.rowData[cols.finalAmount]) || 0) : 0;
            const currentDocNo = cols.quotationNo !== -1 ? (loc.rowData[cols.quotationNo] || "").toString().trim() : "";
            const newBalance = finalAmount - (totalBank + totalCash);

            if (cols.payBank !== -1) loc.sheet.getRange(loc.rowIndex, cols.payBank + 1).setValue(totalBank);
            if (cols.payCash !== -1) loc.sheet.getRange(loc.rowIndex, cols.payCash + 1).setValue(totalCash);
            if (cols.balance !== -1) loc.sheet.getRange(loc.rowIndex, cols.balance + 1).setValue(newBalance);

            return {
                success: true,
                paymentId: paymentId,
                updatedBank: totalBank,
                updatedCash: totalCash,
                balanceAmount: newBalance,
                updatedQuotationPiNo: currentDocNo
            };
        } else {
            return { success: false, error: "Master Enquiry record not found." };
        }
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 6. Get Comprehensive Enquiry Data (For Frontend Viewing & Editing)
 * Searches across Active and Archive sheets to load complete details.
 */
function getEnquiryDetails(enquiryId) {
    if (!enquiryId) return { success: false, error: "Enquiry ID required." };

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const targetId = String(enquiryId).trim();

        // 1. Locate Master Enquiry
        const loc = findEnquiryInMasterSheets(ss, targetId);
        if (!loc) return { success: false, error: "Enquiry " + targetId + " not found." };

        const row = loc.rowData;
        const cols = loc.cols;
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;

        const enquiry = {
            enquiryId: idCol !== -1 && row[idCol] ? row[idCol].toString().trim() : targetId,
            dateOfEnquiry: cols.date !== -1 && row[cols.date] instanceof Date ? row[cols.date].toISOString().split("T")[0] : (cols.date !== -1 && row[cols.date] ? row[cols.date].toString() : ""),
            reference: cols.reference !== -1 && row[cols.reference] ? row[cols.reference].toString().trim() : "",
            placeName: cols.place !== -1 && row[cols.place] ? row[cols.place].toString().trim() : "",
            clientName: cols.client !== -1 && row[cols.client] ? row[cols.client].toString().trim() : "",
            contactNumber: cols.contact !== -1 && row[cols.contact] ? row[cols.contact].toString().trim() : "",
            googleMapLink: cols.map !== -1 && row[cols.map] ? row[cols.map].toString().trim() : "",
            purposes: cols.purposes !== -1 && row[cols.purposes] ? row[cols.purposes].toString().split(",").map(p => p.trim()).filter(Boolean) : [],
            siteHandlers: cols.handler !== -1 && row[cols.handler] ? row[cols.handler].toString().trim() : "",
            siteNote: cols.note !== -1 && row[cols.note] ? row[cols.note].toString().trim() : "",
            supervisor: cols.supervisor !== -1 && row[cols.supervisor] ? row[cols.supervisor].toString().trim() : "",
            quotationPiNo: cols.quotationNo !== -1 && row[cols.quotationNo] ? row[cols.quotationNo].toString().trim() : "",
            quotationsFinalAmount: cols.finalAmount !== -1 ? (parseFloat(row[cols.finalAmount]) || 0) : 0,
            paymentInBank: cols.payBank !== -1 ? (parseFloat(row[cols.payBank]) || 0) : 0,
            paymentInCash: cols.payCash !== -1 ? (parseFloat(row[cols.payCash]) || 0) : 0,
            balanceAmount: cols.balance !== -1 ? (parseFloat(row[cols.balance]) || 0) : 0,
            status: cols.status !== -1 && row[cols.status] ? row[cols.status].toString().trim() : "",
            quotationFileLink: cols.fileLink !== -1 && row[cols.fileLink] ? row[cols.fileLink].toString().trim() : ""
        };

        // 2. Fetch Photos (Active & Archive)
        const photos = [];
        [CONFIG.SHEET_NAMES.PHOTOS, CONFIG.SHEET_NAMES.ARCHIVE_PHOTOS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const photosData = sh.getDataRange().getValues();
            for (let i = 1; i < photosData.length; i++) {
                if (String(photosData[i][1]).trim() === targetId) {
                    const fileId = photosData[i][3] ? photosData[i][3].toString() : "";
                    photos.push({
                        photoId: photosData[i][0] ? photosData[i][0].toString() : "",
                        stage: photosData[i][2] ? photosData[i][2].toString() : "Initial Site Visit",
                        fileId: fileId,
                        viewUrl: photosData[i][4] ? photosData[i][4].toString() : "",
                        thumbnailUrl: photosData[i][5] ? photosData[i][5].toString() : (fileId ? `https://lh3.googleusercontent.com/d/${fileId}` : ""),
                        fileName: photosData[i][6] ? photosData[i][6].toString() : "photo.jpg"
                    });
                }
            }
        });

        // 3. Fetch Payments (Active & Archive)
        const payments = [];
        [CONFIG.SHEET_NAMES.PAYMENTS, CONFIG.SHEET_NAMES.ARCHIVE_PAYMENTS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const paymentsData = sh.getDataRange().getValues();
            for (let i = 1; i < paymentsData.length; i++) {
                if (String(paymentsData[i][1]).trim() === targetId) {
                    const dateVal = paymentsData[i][2] instanceof Date ? paymentsData[i][2].toISOString() : (paymentsData[i][2] || "");
                    payments.push({
                        paymentId: paymentsData[i][0] ? paymentsData[i][0].toString() : "",
                        date: dateVal,
                        amount: parseFloat(paymentsData[i][3]) || 0,
                        mode: paymentsData[i][4] ? paymentsData[i][4].toString() : "Bank",
                        refNo: paymentsData[i][5] ? paymentsData[i][5].toString() : "",
                        notes: paymentsData[i][6] ? paymentsData[i][6].toString() : ""
                    });
                }
            }
        });

        // 4. Fetch Revisions / Quotation Documents (Active & Archive)
        const revisions = [];
        [CONFIG.SHEET_NAMES.REVISIONS, CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const revData = sh.getDataRange().getValues();
            for (let i = 1; i < revData.length; i++) {
                if (String(revData[i][1]).trim() === targetId) {
                    const dateVal = revData[i][5] instanceof Date ? revData[i][5].toISOString() : (revData[i][5] || "");
                    const notesStr = revData[i][4] ? revData[i][4].toString() : "";
                    let parsedFileName = "";
                    if (notesStr) {
                        const match = notesStr.match(/(?:Document attached:\s*|Batch uploaded:\s*|Attached\s*)([^\r\n]+)/i);
                        if (match && match[1]) parsedFileName = match[1].trim();
                    }
                    if (!parsedFileName && revData[i][2]) {
                        parsedFileName = revData[i][2].toString().trim();
                    }
                    revisions.push({
                        revId: revData[i][0] ? revData[i][0].toString() : "",
                        revNo: revData[i][2] ? revData[i][2].toString() : "Quotation",
                        amount: parseFloat(revData[i][3]) || 0,
                        notes: notesStr,
                        date: dateVal,
                        fileLink: revData[i][6] ? revData[i][6].toString() : "",
                        fileName: parsedFileName || (revData[i][2] ? revData[i][2].toString() : "Quotation")
                    });
                }
            }
        });

        return {
            success: true,
            data: {
                enquiry: enquiry,
                photos: photos,
                payments: payments,
                revisions: revisions
            }
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

/**
 * 7. Helper Utilities: Auto ID Generation across all Master Sheets
 */
function generateEnquiryId(ss) {
    const currentYear = new Date().getFullYear();
    const currentYearPrefix = `ENQ-${currentYear}-`;
    let nextSeq = 1;

    const masterSheetNames = [
        CONFIG.SHEET_NAMES.MASTER,
        CONFIG.SHEET_NAMES.DONE_MASTER,
        CONFIG.SHEET_NAMES.CANCEL_MASTER
    ];

    masterSheetNames.forEach(sName => {
        const sheet = ss.getSheetByName(sName);
        if (!sheet || sheet.getLastRow() <= 1) return;
        const lastRow = sheet.getLastRow();
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
        const yearIds = ids.filter(id => typeof id === "string" && id.startsWith(currentYearPrefix));

        if (yearIds.length > 0) {
            const sequences = yearIds.map(id => {
                const parts = id.split("-");
                return parseInt(parts[2], 10) || 0;
            });
            const maxSeq = Math.max(...sequences);
            if (maxSeq >= nextSeq) nextSeq = maxSeq + 1;
        }
    });

    const paddedSeq = String(nextSeq).padStart(4, "0");
    return `ENQ-${currentYear}-${paddedSeq}`;
}

/**
 * Smart Folder Root Resolver
 */
function getRootDriveFolder() {
    let rootFolder = null;
    if (CONFIG.ROOT_FOLDER_ID && CONFIG.ROOT_FOLDER_ID !== "YOUR_GOOGLE_DRIVE_ROOT_FOLDER_ID_HERE") {
        try {
            rootFolder = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
        } catch (e) {
            console.warn("Could not find folder by CONFIG.ROOT_FOLDER_ID: " + e.message);
        }
    }

    if (!rootFolder) {
        try {
            const ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
            const parents = ssFile.getParents();
            if (parents.hasNext()) {
                rootFolder = parents.next();
            }
        } catch (e) { }
    }

    if (!rootFolder) {
        rootFolder = DriveApp.getRootFolder();
    }

    return rootFolder;
}

function getOrCreateEnquiryFolder(enquiryId, clientName, placeName) {
    try {
        const rootFolder = getRootDriveFolder();
        const currentYear = new Date().getFullYear().toString();

        let yearFolder;
        const yearIter = rootFolder.getFoldersByName(currentYear);
        yearFolder = yearIter.hasNext() ? yearIter.next() : rootFolder.createFolder(currentYear);

        const safeClient = (clientName || "Client").replace(/[/\\?%*:|"<>]/g, "_").trim();
        const safePlace = (placeName || "Site").replace(/[/\\?%*:|"<>]/g, "_").trim();
        const folderName = `${enquiryId}_${safeClient}_${safePlace}`;

        const siteIter = yearFolder.getFoldersByName(folderName);
        const siteFolder = siteIter.hasNext() ? siteIter.next() : yearFolder.createFolder(folderName);

        // Subfolders
        const photoIter = siteFolder.getFoldersByName("01_Site_Photos");
        if (!photoIter.hasNext()) siteFolder.createFolder("01_Site_Photos");

        return siteFolder;
    } catch (err) {
        console.warn("Drive folder creation error: " + err.message);
        return null;
    }
}

function getOrCreateEnquiryPhotoFolder(enquiryId, clientName, placeName) {
    const siteFolder = getOrCreateEnquiryFolder(enquiryId, clientName, placeName);
    if (!siteFolder) return null;
    const photoIter = siteFolder.getFoldersByName("01_Site_Photos");
    return photoIter.hasNext() ? photoIter.next() : siteFolder.createFolder("01_Site_Photos");
}

function getOrCreateEnquiryQuotationFolder(enquiryId, clientName, placeName) {
    const siteFolder = getOrCreateEnquiryFolder(enquiryId, clientName, placeName);
    if (!siteFolder) return null;
    const quoteIter = siteFolder.getFoldersByName("02_Quotations");
    return quoteIter.hasNext() ? quoteIter.next() : siteFolder.createFolder("02_Quotations");
}

/**
 * 8. Auto-Setup: Ensure all active & partitioned archive sheets exist with proper headers
 */
function setupSheets() {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) return;

        const masterHeaders = [
            "Enquiry ID", "Date of Enquiry", "Reference", "Place Name",
            "Client Name", "Contact Number", "Google Map Link", "Purposes",
            "Site Handler", "Site Note / Status", "Supervisor",
            "Final Amount", "Payment in Bank", "Payment in Cash", "Balance Amount", "Done/Cancel"
        ];

        // 1. Master Sheets (Active, Done, Cancel)
        [CONFIG.SHEET_NAMES.MASTER, CONFIG.SHEET_NAMES.DONE_MASTER, CONFIG.SHEET_NAMES.CANCEL_MASTER].forEach(sName => {
            let sh = ss.getSheetByName(sName);
            if (!sh) {
                sh = ss.insertSheet(sName);
                sh.appendRow(masterHeaders);
                sh.getRange(1, 1, 1, masterHeaders.length).setFontWeight("bold").setBackground("#f0f0f0");
                sh.setFrozenRows(1);
            } else {
                // Ensure Site Note / Status column exists
                const headerVals = sh.getRange(1, 1, 1, sh.getLastColumn() || 1).getValues()[0];
                const hasNoteCol = headerVals.some(h => String(h).toLowerCase().includes("note") || String(h).toLowerCase().includes("status"));
                if (!hasNoteCol && sh.getLastColumn() >= 9) {
                    sh.insertColumnAfter(9);
                    sh.getRange(1, 10).setValue("Site Note / Status").setFontWeight("bold").setBackground("#f0f0f0");
                }
                const latestHeaders = sh.getRange(1, 1, 1, sh.getLastColumn() || 1).getValues()[0];
                const hasDoneCancelCol = latestHeaders.some(h => {
                    const s = String(h).toLowerCase().trim();
                    return s.includes("done/cancel") || s.includes("done / cancel") || s === "done" || s === "cancel" || (s.includes("status") && !s.includes("note"));
                });
                if (!hasDoneCancelCol) {
                    const nextCol = sh.getLastColumn() + 1;
                    sh.getRange(1, nextCol).setValue("Done/Cancel").setFontWeight("bold").setBackground("#f0f0f0");
                }
            }
        });

        // 2. Revision Sheets (Active & Archive)
        const revHeaders = ["Revision ID", "Enquiry ID", "Revision No", "Amount", "Notes", "Date", "File Link"];
        [CONFIG.SHEET_NAMES.REVISIONS, CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS].forEach(sName => {
            let rev = ss.getSheetByName(sName);
            if (!rev) {
                rev = ss.insertSheet(sName);
                rev.appendRow(revHeaders);
                rev.getRange(1, 1, 1, revHeaders.length).setFontWeight("bold").setBackground("#f0f0f0");
                rev.setFrozenRows(1);
            }
        });

        // 3. Site Photos Sheets (Active & Archive)
        const photoHeaders = ["Photo ID", "Enquiry ID", "Stage", "File ID", "View URL", "Thumbnail URL", "File Name", "Timestamp"];
        [CONFIG.SHEET_NAMES.PHOTOS, CONFIG.SHEET_NAMES.ARCHIVE_PHOTOS].forEach(sName => {
            let photos = ss.getSheetByName(sName);
            if (!photos) {
                photos = ss.insertSheet(sName);
                photos.appendRow(photoHeaders);
                photos.getRange(1, 1, 1, photoHeaders.length).setFontWeight("bold").setBackground("#f0f0f0");
                photos.setFrozenRows(1);
            }
        });

        // 4. Payment Sheets (Active & Archive)
        const payHeaders = ["Payment ID", "Enquiry ID", "Date", "Amount", "Mode", "Reference No", "Notes"];
        [CONFIG.SHEET_NAMES.PAYMENTS, CONFIG.SHEET_NAMES.ARCHIVE_PAYMENTS].forEach(sName => {
            let payments = ss.getSheetByName(sName);
            if (!payments) {
                payments = ss.insertSheet(sName);
                payments.appendRow(payHeaders);
                payments.getRange(1, 1, 1, payHeaders.length).setFontWeight("bold").setBackground("#f0f0f0");
                payments.setFrozenRows(1);
            }
        });

        // 5. dataBase (Dropdown Suggestions)
        let db = ss.getSheetByName(CONFIG.SHEET_NAMES.DATABASE);
        if (!db) {
            db = ss.insertSheet(CONFIG.SHEET_NAMES.DATABASE);
            db.appendRow(["References", "Places", "Site Handlers", "Supervisors", "Purposes"]);
            db.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#e8f0fe");
            db.setFrozenRows(1);
            const defaultPurposes = ["ACP", "Glazing", "uPVC", "Aluminum", "GI", "Sliding System", "Slim Profile", "Glass Door"];
            const purposeData = defaultPurposes.map(p => [p]);
            db.getRange(2, 5, purposeData.length, 1).setValues(purposeData);
        }
    } catch (err) {
        console.warn("setupSheets error: " + err.message);
    }
}

/**
 * 9. Get All Enquiries + Details Bulk across Active & Archive sheets
 * Fast bulk query with in-memory aggregation.
 */
function getAllEnquiryDetailsBulk() {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();

        const masterSheetConfigs = [
            { name: CONFIG.SHEET_NAMES.MASTER, defaultStatus: "" },
            { name: CONFIG.SHEET_NAMES.DONE_MASTER, defaultStatus: "Done" },
            { name: CONFIG.SHEET_NAMES.CANCEL_MASTER, defaultStatus: "Cancel" }
        ];

        const enquiries = [];
        const detailsMap = {};

        // 1. Read All Master Sheets
        masterSheetConfigs.forEach(cfg => {
            const sh = ss.getSheetByName(cfg.name);
            if (!sh || sh.getLastRow() <= 1) return;
            const masterData = sh.getDataRange().getValues();
            const cols = getMasterColMap(masterData[0]);
            const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;

            for (let i = 1; i < masterData.length; i++) {
                const row = masterData[i];
                if (!row[idCol] && !row[0]) continue;
                const enqId = String(row[idCol] || row[0]).trim();
                const statusVal = cols.status !== -1 && row[cols.status] ? row[cols.status].toString().trim() : cfg.defaultStatus;

                const enqObj = {
                    enquiryId: enqId,
                    dateOfEnquiry: cols.date !== -1 && row[cols.date] instanceof Date ? row[cols.date].toISOString().split("T")[0] : (cols.date !== -1 && row[cols.date] ? row[cols.date].toString() : ""),
                    reference: cols.reference !== -1 && row[cols.reference] ? row[cols.reference].toString().trim() : "",
                    placeName: cols.place !== -1 && row[cols.place] ? row[cols.place].toString().trim() : "",
                    clientName: cols.client !== -1 && row[cols.client] ? row[cols.client].toString().trim() : "",
                    contactNumber: cols.contact !== -1 && row[cols.contact] ? row[cols.contact].toString().trim() : "",
                    googleMapLink: cols.map !== -1 && row[cols.map] ? row[cols.map].toString().trim() : "",
                    purposes: cols.purposes !== -1 && row[cols.purposes] ? row[cols.purposes].toString().split(",").map(p => p.trim()).filter(Boolean) : [],
                    siteHandlers: cols.handler !== -1 && row[cols.handler] ? row[cols.handler].toString().trim() : "",
                    siteNote: cols.note !== -1 && row[cols.note] ? row[cols.note].toString().trim() : "",
                    supervisor: cols.supervisor !== -1 && row[cols.supervisor] ? row[cols.supervisor].toString().trim() : "",
                    quotationPiNo: cols.quotationNo !== -1 && row[cols.quotationNo] ? row[cols.quotationNo].toString().trim() : "",
                    quotationsFinalAmount: cols.finalAmount !== -1 ? (parseFloat(row[cols.finalAmount]) || 0) : 0,
                    paymentInBank: cols.payBank !== -1 ? (parseFloat(row[cols.payBank]) || 0) : 0,
                    paymentInCash: cols.payCash !== -1 ? (parseFloat(row[cols.payCash]) || 0) : 0,
                    balanceAmount: cols.balance !== -1 ? (parseFloat(row[cols.balance]) || 0) : 0,
                    status: statusVal,
                    quotationFileLink: cols.fileLink !== -1 && row[cols.fileLink] ? row[cols.fileLink].toString().trim() : "",
                    revisions: []
                };

                enquiries.push(enqObj);
                detailsMap[enqId] = {
                    enquiry: enqObj,
                    photos: [],
                    payments: [],
                    revisions: []
                };
            }
        });

        // 2. Read Photos (Active & Archive)
        [CONFIG.SHEET_NAMES.PHOTOS, CONFIG.SHEET_NAMES.ARCHIVE_PHOTOS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const photosData = sh.getDataRange().getValues();
            for (let i = 1; i < photosData.length; i++) {
                const eId = String(photosData[i][1]).trim();
                if (detailsMap[eId]) {
                    const fileId = photosData[i][3] ? photosData[i][3].toString() : "";
                    detailsMap[eId].photos.push({
                        photoId: photosData[i][0] ? photosData[i][0].toString() : "",
                        stage: photosData[i][2] ? photosData[i][2].toString() : "Initial Site Visit",
                        fileId: fileId,
                        viewUrl: photosData[i][4] ? photosData[i][4].toString() : "",
                        thumbnailUrl: photosData[i][5] ? photosData[i][5].toString() : (fileId ? `https://lh3.googleusercontent.com/d/${fileId}` : ""),
                        fileName: photosData[i][6] ? photosData[i][6].toString() : "photo.jpg"
                    });
                }
            }
        });

        // 3. Read Payments (Active & Archive)
        [CONFIG.SHEET_NAMES.PAYMENTS, CONFIG.SHEET_NAMES.ARCHIVE_PAYMENTS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const paymentsData = sh.getDataRange().getValues();
            for (let i = 1; i < paymentsData.length; i++) {
                const eId = String(paymentsData[i][1]).trim();
                if (detailsMap[eId]) {
                    const dateVal = paymentsData[i][2] instanceof Date ? paymentsData[i][2].toISOString() : (paymentsData[i][2] || "");
                    detailsMap[eId].payments.push({
                        paymentId: paymentsData[i][0] ? paymentsData[i][0].toString() : "",
                        date: dateVal,
                        amount: parseFloat(paymentsData[i][3]) || 0,
                        mode: paymentsData[i][4] ? paymentsData[i][4].toString() : "Bank",
                        refNo: paymentsData[i][5] ? paymentsData[i][5].toString() : "",
                        notes: paymentsData[i][6] ? paymentsData[i][6].toString() : ""
                    });
                }
            }
        });

        // 4. Read Revisions (Active & Archive)
        [CONFIG.SHEET_NAMES.REVISIONS, CONFIG.SHEET_NAMES.ARCHIVE_REVISIONS].forEach(sName => {
            const sh = ss.getSheetByName(sName);
            if (!sh || sh.getLastRow() <= 1) return;
            const revData = sh.getDataRange().getValues();
            for (let i = 1; i < revData.length; i++) {
                const eId = String(revData[i][1]).trim();
                if (detailsMap[eId]) {
                    const dateVal = revData[i][5] instanceof Date ? revData[i][5].toISOString() : (revData[i][5] || "");
                    const notesStr = revData[i][4] ? revData[i][4].toString() : "";
                    let parsedFileName = "";
                    if (notesStr) {
                        const match = notesStr.match(/(?:Document attached:\s*|Batch uploaded:\s*|Attached\s*)([^\r\n]+)/i);
                        if (match && match[1]) parsedFileName = match[1].trim();
                    }
                    if (!parsedFileName && revData[i][2]) {
                        parsedFileName = revData[i][2].toString().trim();
                    }
                    const revObj = {
                        revId: revData[i][0] ? revData[i][0].toString() : "",
                        revNo: revData[i][2] ? revData[i][2].toString() : "Quotation",
                        amount: parseFloat(revData[i][3]) || 0,
                        notes: notesStr,
                        date: dateVal,
                        fileLink: revData[i][6] ? revData[i][6].toString() : "",
                        fileName: parsedFileName || (revData[i][2] ? revData[i][2].toString() : "Quotation")
                    };
                    detailsMap[eId].revisions.push(revObj);
                    if (detailsMap[eId].enquiry) {
                        if (!detailsMap[eId].enquiry.revisions) detailsMap[eId].enquiry.revisions = [];
                        detailsMap[eId].enquiry.revisions.push(revObj);
                    }
                }
            }
        });

        return { success: true, enquiries: enquiries, detailsMap: detailsMap };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

/**
 * 10. Get Dropdown / Suggestion Data from the "dataBase" sheet
 */
function getDropdownData() {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const db = ss.getSheetByName(CONFIG.SHEET_NAMES.DATABASE);

        const result = { references: [], places: [], siteHandlers: [], supervisors: [], purposes: [] };

        if (!db || db.getLastRow() <= 1) {
            result.purposes = ["ACP", "Glazing", "uPVC", "Aluminum", "GI", "Sliding System", "Slim Profile", "Glass Door"];
            return { success: true, data: result };
        }

        const lastRow = db.getLastRow();
        const data = db.getRange(2, 1, lastRow - 1, 5).getValues();

        data.forEach(row => {
            if (row[0] && row[0].toString().trim()) result.references.push(row[0].toString().trim());
            if (row[1] && row[1].toString().trim()) result.places.push(row[1].toString().trim());
            if (row[2] && row[2].toString().trim()) result.siteHandlers.push(row[2].toString().trim());
            if (row[3] && row[3].toString().trim()) result.supervisors.push(row[3].toString().trim());
            if (row[4] && row[4].toString().trim()) result.purposes.push(row[4].toString().trim());
        });

        // Ensure default purposes exist
        const defaults = ["ACP", "Glazing", "uPVC", "Aluminum", "GI", "Sliding System", "Slim Profile", "Glass Door"];
        defaults.forEach(d => {
            if (!result.purposes.some(p => p.toLowerCase() === d.toLowerCase())) {
                result.purposes.push(d);
            }
        });

        // De-duplicate all arrays
        for (const key in result) {
            result[key] = [...new Set(result[key])];
        }

        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

/**
 * 11. Save New Dropdown Entries to the "dataBase" sheet
 */
function saveNewDropdownEntries(entries) {
    if (!entries || typeof entries !== "object") return { success: false, error: "Invalid entries object." };

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const db = ss.getSheetByName(CONFIG.SHEET_NAMES.DATABASE);
        if (!db) return { success: false, error: "dataBase sheet not found." };

        const colMap = { references: 1, places: 2, siteHandlers: 3, supervisors: 4, purposes: 5 };

        // Read existing data
        const lastRow = db.getLastRow();
        let existingByCol = {};
        if (lastRow > 1) {
            const allData = db.getRange(2, 1, lastRow - 1, 5).getValues();
            for (const key in colMap) {
                const ci = colMap[key] - 1;
                existingByCol[key] = allData.map(r => r[ci] ? r[ci].toString().trim().toLowerCase() : "").filter(Boolean);
            }
        } else {
            for (const key in colMap) existingByCol[key] = [];
        }

        // Process each type
        for (const key in entries) {
            if (!colMap[key] || !entries[key]) continue;
            const col = colMap[key];
            const newValues = (Array.isArray(entries[key]) ? entries[key] : [entries[key]]).filter(v => v && v.toString().trim());

            for (const val of newValues) {
                const trimmed = val.toString().trim();
                if (existingByCol[key].includes(trimmed.toLowerCase())) continue; // Already exists

                const currentLast = db.getLastRow();
                let targetRow = -1;
                if (currentLast > 1) {
                    const colData = db.getRange(2, col, currentLast - 1, 1).getValues().flat();
                    for (let i = 0; i < colData.length; i++) {
                        if (!colData[i] || colData[i].toString().trim() === "") {
                            targetRow = i + 2;
                            break;
                        }
                    }
                }
                if (targetRow === -1) targetRow = Math.max(db.getLastRow() + 1, 2);

                db.getRange(targetRow, col).setValue(trimmed);
                existingByCol[key].push(trimmed.toLowerCase());
            }
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}
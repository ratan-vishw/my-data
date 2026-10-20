/**
 * ============================================================================
 * OM TRADING - ACP SHEET MANAGER BACKEND (Code.gs)
 * Sheets: ACP_Sheets_Master, PI_Documents, Invoice_Bills, Database
 * ============================================================================
 */

const CONFIG = {
    ROOT_FOLDER_ID: "YOUR_GOOGLE_DRIVE_ROOT_FOLDER_ID_HERE", // Optional: leave default to auto-save in spreadsheet's parent folder
    SHEET_NAMES: {
        MASTER: "ACP_Sheets_Master",
        PI_DOCS: "PI_Documents",
        BILLS: "Invoice_Bills",
        DATABASE: "Database"
    }
};

/**
 * 1. Web App Entrypoint
 */
function doGet(e) {
    try {
        setupSheets(); // Auto-create sheets with headers on first run
    } catch (err) {
        console.warn("setupSheets error on doGet: " + err.toString());
    }
    return HtmlService.createHtmlOutputFromFile("Index")
        .setTitle("OM Trading | ACP Sheet Manager")
        .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Helper: Column Index Mapper for ACP_Sheets_Master
 * Guarantees flexible, future-proof column lookup for ACP Sheet Manager fields.
 */
function getMasterColMap(headers) {
    const h = (headers || []).map(x => String(x || "").trim().toLowerCase());

    const findIdx = (keywords) => {
        for (let i = 0; i < h.length; i++) {
            if (keywords.includes(h[i])) return i;
        }
        for (let i = 0; i < h.length; i++) {
            for (const k of keywords) {
                if (h[i].includes(k)) return i;
            }
        }
        return -1;
    };

    return {
        enquiryId: findIdx(["entry id", "acp id", "enquiry id", "enquiryid", "inquiry id", "id"]),
        date: findIdx(["entry date", "date of enquiry", "enquiry date", "date", "order date"]),
        siteName: findIdx(["site name", "site name / location", "site location", "place name", "site", "place", "location"]),
        fabricator: findIdx(["fabricator name", "fabricator", "supervisor", "supervisor name"]),
        handler: findIdx(["site handler", "site handler(s)", "site handlers", "handler"]),
        vendor: findIdx(["vendor / supplier name", "vendor name", "vendor", "supplier", "supplier name", "reference"]),
        totalSheets: findIdx(["total sheets", "sheets", "total qty", "qty"]),
        totalSqFt: findIdx(["total sq.ft", "total sqft", "sq.ft", "sqft", "area"]),
        acpRows: findIdx(["acp specifications", "acp specifications & cut sizes", "acp rows", "acp sizes", "acp specs", "specifications", "purposes"]),
        note: findIdx(["remarks / cutting & delivery notes", "site note / status", "site note", "remarks", "notes", "status note"]),
        status: findIdx(["status", "action status"]),
        finalAmount: findIdx(["total pi amount", "quotations final amount", "final amount", "total amount", "amount"]),
        fileLink: findIdx(["pi file link", "quotation file link", "file link"])
    };
}

/**
 * 2. Save / Update ACP Sheet Entry Record
 */
function saveEnquiry(payload) {
    if (!payload) return { success: false, error: "No payload provided." };

    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);
        const data = masterSheet.getDataRange().getValues();
        const headers = data[0] || [];
        const cols = getMasterColMap(headers);

        const isNew = !payload.enquiryId;
        const enquiryId = isNew ? generateEnquiryId(masterSheet) : String(payload.enquiryId).trim();
        const today = new Date();

        let rowIndex = -1;
        let existingRecord = null;

        if (!isNew) {
            const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;
            for (let i = 1; i < data.length; i++) {
                if (String(data[i][idCol]).trim() === enquiryId) {
                    rowIndex = i + 1;
                    existingRecord = data[i];
                    break;
                }
            }
            if (rowIndex === -1) {
                return { success: false, error: "Record " + enquiryId + " not found in Master Sheet." };
            }
        }

        // PI amount
        let finalAmount = existingRecord && cols.finalAmount !== -1 ? (parseFloat(existingRecord[cols.finalAmount]) || 0) : 0;

        // Field values
        const siteName = String(payload.siteName || payload.placeName || "").trim();
        const fabricatorName = String(payload.fabricatorName || payload.supervisor || "").trim();
        const siteHandler = String(payload.siteHandler || payload.siteHandlers || "").trim();
        const vendorName = String(payload.vendorName || payload.reference || "").trim();
        const totalSheets = parseFloat(payload.totalSheets) || 0;
        const totalSqFt = parseFloat(payload.totalSqFt) || 0;
        const acpRowsJson = (payload.acpRows && Array.isArray(payload.acpRows)) ? JSON.stringify(payload.acpRows) : "";
        const siteNote = payload.siteNote !== undefined ? String(payload.siteNote).trim() : (existingRecord && cols.note !== -1 ? String(existingRecord[cols.note] || "").trim() : "");
        const status = payload.status || (siteNote.includes("[DONE]") ? "Done" : (siteNote.includes("[CANCELLED]") ? "Cancelled" : ""));

        // Date format handling
        let dateVal = payload.dateOfEnquiry;
        if (!dateVal) {
            dateVal = today;
        } else if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
            const parts = dateVal.split("T")[0].split("-");
            dateVal = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }

        const numCols = Math.max(headers.length, 13);
        let rowData = existingRecord ? [...existingRecord] : new Array(numCols).fill("");

        const setColVal = (colIdx, val) => {
            if (colIdx !== -1) {
                while (rowData.length <= colIdx) rowData.push("");
                rowData[colIdx] = val;
            }
        };

        setColVal(cols.enquiryId !== -1 ? cols.enquiryId : 0, enquiryId);
        setColVal(cols.date !== -1 ? cols.date : 1, dateVal);
        setColVal(cols.siteName !== -1 ? cols.siteName : 2, siteName);
        setColVal(cols.fabricator !== -1 ? cols.fabricator : 3, fabricatorName);
        setColVal(cols.handler !== -1 ? cols.handler : 4, siteHandler);
        setColVal(cols.vendor !== -1 ? cols.vendor : 5, vendorName);
        setColVal(cols.totalSheets !== -1 ? cols.totalSheets : 6, totalSheets);
        setColVal(cols.totalSqFt !== -1 ? cols.totalSqFt : 7, totalSqFt);
        setColVal(cols.acpRows !== -1 ? cols.acpRows : 8, acpRowsJson);
        setColVal(cols.note !== -1 ? cols.note : 9, siteNote);
        setColVal(cols.status !== -1 ? cols.status : 10, status);
        setColVal(cols.finalAmount !== -1 ? cols.finalAmount : 11, finalAmount);

        if (isNew) {
            masterSheet.appendRow(rowData);
            try {
                getOrCreateEnquiryFolder(enquiryId, fabricatorName || vendorName, siteName);
            } catch (folderErr) {
                console.warn("Folder creation notice: " + folderErr.message);
            }
        } else {
            masterSheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
        }

        return {
            success: true,
            enquiryId: enquiryId,
            siteNote: siteNote,
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
 */
function updateSiteNote(enquiryId, siteNote) {
    if (!enquiryId) return { success: false, error: "Entry ID required." };

    const lock = LockService.getScriptLock();
    lock.tryLock(5000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);
        const data = masterSheet.getDataRange().getValues();
        const headers = data[0] || [];
        const cols = getMasterColMap(headers);
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;
        const noteCol = cols.note !== -1 ? cols.note + 1 : 10;

        let targetRow = -1;
        for (let i = 1; i < data.length; i++) {
            if (String(data[i][idCol]).trim() === String(enquiryId).trim()) {
                targetRow = i + 1;
                break;
            }
        }

        if (targetRow !== -1) {
            const cleanNote = siteNote !== undefined ? String(siteNote).trim() : "";
            masterSheet.getRange(targetRow, noteCol).setValue(cleanNote);

            if (cols.status !== -1) {
                const status = cleanNote.includes("[DONE]") ? "Done" : (cleanNote.includes("[CANCELLED]") ? "Cancelled" : "");
                masterSheet.getRange(targetRow, cols.status + 1).setValue(status);
            }

            return { success: true, enquiryId: enquiryId, siteNote: cleanNote };
        } else {
            return { success: false, error: "Record " + enquiryId + " not found." };
        }
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 3. Direct Invoice Bill / Delivery DC Upload Handler
 */
function uploadPhoto(enquiryId, clientName, placeName, base64Data, fileName, stage, invoiceNumber, piRefNo, dispatchedQty, amount, notes) {
    if (enquiryId && typeof enquiryId === "object") {
        const p = enquiryId;
        enquiryId = p.enquiryId;
        clientName = p.clientName;
        placeName = p.placeName;
        base64Data = p.base64Data;
        fileName = p.fileName;
        stage = p.stage;
        invoiceNumber = p.invoiceNumber;
        piRefNo = p.piRefNo || p.piNo;
        dispatchedQty = p.dispatchedQty;
        amount = p.amount;
        notes = p.notes;
    }

    const lock = LockService.getScriptLock();
    lock.tryLock(15000);

    try {
        const photoFolder = getOrCreateEnquiryPhotoFolder(enquiryId, clientName, placeName);
        if (!photoFolder) {
            return { success: false, error: "Could not access Google Drive folder for bills." };
        }

        const splitData = base64Data.split(",");
        const contentTypeMatch = splitData[0].match(/:(.*?);/);
        const contentType = contentTypeMatch ? contentTypeMatch[1] : "application/pdf";
        const decodedBytes = Utilities.base64Decode(splitData[1]);
        const safeInv = (invoiceNumber || "INV").replace(/[/\\?%*:|"<>]/g, "_");
        const safeFileName = (fileName || "Bill.pdf").replace(/[/\\?%*:|"<>]/g, "_");
        const blob = Utilities.newBlob(decodedBytes, contentType, `${enquiryId}_${safeInv}_${safeFileName}`);

        const driveFile = photoFolder.createFile(blob);
        try {
            driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {
            console.warn("Set sharing warning: " + shareErr.message);
        }

        const fileId = driveFile.getId();
        const viewUrl = driveFile.getUrl();
        const directThumbnailUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
        const photoId = "INV-" + Utilities.getUuid().substring(0, 8);
        const timestamp = new Date();
        const finalInvNo = invoiceNumber || safeFileName.replace(/\.[^/.]+$/, "");
        const finalPiRef = piRefNo || stage || "";
        const finalDispatched = parseFloat(dispatchedQty) || 0;
        const finalAmount = parseFloat(amount) || 0;

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const photoSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.BILLS);
        if (photoSheet) {
            photoSheet.appendRow([
                photoId,
                enquiryId,
                finalInvNo,
                finalPiRef,
                finalDispatched,
                finalAmount,
                fileId,
                viewUrl,
                directThumbnailUrl,
                safeFileName,
                notes || "",
                timestamp
            ]);
        }

        return {
            success: true,
            photo: {
                photoId: photoId,
                enquiryId: enquiryId,
                invoiceNumber: finalInvNo,
                piRefNo: finalPiRef,
                dispatchedQty: finalDispatched,
                amount: finalAmount,
                notes: notes || "",
                fileId: fileId,
                viewUrl: viewUrl,
                thumbnailUrl: directThumbnailUrl,
                fileName: safeFileName,
                date: timestamp.toISOString()
            }
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4. Invoice Bill Deletion Handler
 */
function deletePhoto(photoId, enquiryId) {
    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const photoSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.BILLS);
        if (!photoSheet) return { success: false, error: "Invoice_Bills sheet not found." };

        const data = photoSheet.getDataRange().getValues();
        let rowToDelete = -1;
        let fileId = "";

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]).trim() === String(photoId).trim() && String(data[i][1]).trim() === String(enquiryId).trim()) {
                rowToDelete = i + 1;
                fileId = data[i].length >= 12 ? (data[i][6] ? data[i][6].toString() : "") : (data[i][3] ? data[i][3].toString() : "");
                break;
            }
        }

        if (rowToDelete === -1) {
            return { success: false, error: "Bill record not found in sheet." };
        }

        if (fileId && fileId !== "local") {
            try {
                const file = DriveApp.getFileById(fileId);
                file.setTrashed(true);
            } catch (err) {
                console.warn("Drive file already deleted: " + err.message);
            }
        }

        photoSheet.deleteRow(rowToDelete);
        return { success: true, photoId: photoId };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4b. Direct PI (Proforma Invoice) Document Upload Handler
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
            return { success: false, error: "Could not access Google Drive folder for PI documents." };
        }

        const splitData = base64Data.split(",");
        const contentTypeMatch = splitData[0].match(/:(.*?);/);
        const contentType = contentTypeMatch ? contentTypeMatch[1] : "application/pdf";
        const decodedBytes = Utilities.base64Decode(splitData[1]);
        const safeFileName = (fileName || "PI_Document.pdf").replace(/[/\\?%*:|"<>]/g, "_");
        const docPrefix = (quotationDocNo || "PI").replace(/[/\\?%*:|"<>]/g, "_");
        const blob = Utilities.newBlob(decodedBytes, contentType, `${enquiryId}_${docPrefix}_${safeFileName}`);

        const driveFile = quoteFolder.createFile(blob);
        try {
            driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {
            console.warn("Set sharing warning: " + shareErr.message);
        }

        const fileId = driveFile.getId();
        const viewUrl = driveFile.getUrl();
        const docAmount = parseFloat(amount) || 0;
        const revId = "PI-" + Utilities.getUuid().substring(0, 8);
        const today = new Date();
        const docTitle = quotationDocNo || safeFileName.replace(/\.[^/.]+$/, "");

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const revSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.PI_DOCS);
        if (revSheet) {
            revSheet.appendRow([
                revId,
                enquiryId,
                docTitle,
                docAmount,
                notes || ("Document attached: " + safeFileName),
                today,
                viewUrl,
                safeFileName
            ]);
        }

        // Calculate Total PI Amount
        const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);
        const masterData = masterSheet.getDataRange().getValues();
        const cols = getMasterColMap(masterData[0]);
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;
        let masterRow = -1;

        for (let i = 1; i < masterData.length; i++) {
            if (String(masterData[i][idCol]).trim() === String(enquiryId).trim()) {
                masterRow = i + 1;
                break;
            }
        }

        let totalQuotationsAmount = 0;
        if (revSheet) {
            const allRevs = revSheet.getDataRange().getValues();
            for (let i = 1; i < allRevs.length; i++) {
                if (String(allRevs[i][1]).trim() === String(enquiryId).trim()) {
                    totalQuotationsAmount += (parseFloat(allRevs[i][3]) || 0);
                }
            }
        }

        if (masterRow !== -1) {
            if (cols.finalAmount !== -1) masterSheet.getRange(masterRow, cols.finalAmount + 1).setValue(totalQuotationsAmount);
            if (cols.fileLink !== -1) masterSheet.getRange(masterRow, cols.fileLink + 1).setValue(viewUrl);
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
            totalFinalAmount: totalQuotationsAmount
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4c. Save / Edit PI Document Metadata
 */
function saveQuotationDocument(payload) {
    if (!payload || !payload.enquiryId) {
        return { success: false, error: "Entry ID is required." };
    }

    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const revSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.PI_DOCS);
        const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);

        const enquiryId = String(payload.enquiryId).trim();
        const revId = payload.revId ? String(payload.revId).trim() : ("PI-" + Utilities.getUuid().substring(0, 8));
        const docTitle = payload.docTitle || payload.revNo || "PI Document";
        const docAmount = parseFloat(payload.amount) || 0;
        const notes = payload.notes || "";
        const fileLink = payload.fileLink || "";
        const today = new Date();

        let revRow = -1;
        if (payload.revId) {
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
        } else {
            revSheet.appendRow([
                revId,
                enquiryId,
                docTitle,
                docAmount,
                notes,
                today,
                fileLink,
                docTitle + ".pdf"
            ]);
        }

        let totalQuotationsAmount = 0;
        const allRevs = revSheet.getDataRange().getValues();
        for (let i = 1; i < allRevs.length; i++) {
            if (String(allRevs[i][1]).trim() === enquiryId) {
                totalQuotationsAmount += (parseFloat(allRevs[i][3]) || 0);
            }
        }

        const masterData = masterSheet.getDataRange().getValues();
        const cols = getMasterColMap(masterData[0]);
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;
        let masterRow = -1;

        for (let i = 1; i < masterData.length; i++) {
            if (String(masterData[i][idCol]).trim() === enquiryId) {
                masterRow = i + 1;
                break;
            }
        }

        if (masterRow !== -1) {
            if (cols.finalAmount !== -1) masterSheet.getRange(masterRow, cols.finalAmount + 1).setValue(totalQuotationsAmount);
            if (cols.fileLink !== -1 && fileLink) {
                masterSheet.getRange(masterRow, cols.fileLink + 1).setValue(fileLink);
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
                fileLink: fileLink
            },
            totalFinalAmount: totalQuotationsAmount
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 4d. Delete PI Document Handler
 */
function deleteQuotationDocument(revId, enquiryId) {
    if (!revId || !enquiryId) return { success: false, error: "PI ID and Entry ID are required." };

    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const revSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.PI_DOCS);
        const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);

        if (!revSheet) return { success: false, error: "PI_Documents sheet not found." };

        const revData = revSheet.getDataRange().getValues();
        let rowToDelete = -1;

        for (let i = 1; i < revData.length; i++) {
            if (String(revData[i][0]).trim() === String(revId).trim() && String(revData[i][1]).trim() === String(enquiryId).trim()) {
                rowToDelete = i + 1;
                break;
            }
        }

        if (rowToDelete === -1) {
            return { success: false, error: "PI record not found." };
        }

        revSheet.deleteRow(rowToDelete);

        let totalQuotationsAmount = 0;
        let latestFileLink = "";
        const remainingRevs = revSheet.getDataRange().getValues();
        for (let i = 1; i < remainingRevs.length; i++) {
            if (String(remainingRevs[i][1]).trim() === String(enquiryId).trim()) {
                totalQuotationsAmount += (parseFloat(remainingRevs[i][3]) || 0);
                if (remainingRevs[i][6]) latestFileLink = remainingRevs[i][6].toString();
            }
        }

        const masterData = masterSheet.getDataRange().getValues();
        const cols = getMasterColMap(masterData[0]);
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;
        let masterRow = -1;

        for (let i = 1; i < masterData.length; i++) {
            if (String(masterData[i][idCol]).trim() === String(enquiryId).trim()) {
                masterRow = i + 1;
                break;
            }
        }

        if (masterRow !== -1) {
            if (cols.finalAmount !== -1) masterSheet.getRange(masterRow, cols.finalAmount + 1).setValue(totalQuotationsAmount);
            if (cols.fileLink !== -1) masterSheet.getRange(masterRow, cols.fileLink + 1).setValue(latestFileLink);
        }

        return {
            success: true,
            revId: revId,
            totalFinalAmount: totalQuotationsAmount
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * Helper to parse ACP rows from JSON or siteNote
 */
function parseAcpRowsHelper(acpRowsRaw, siteNote) {
    if (acpRowsRaw) {
        try {
            if (typeof acpRowsRaw === "string" && (acpRowsRaw.startsWith("[") || acpRowsRaw.startsWith("{"))) {
                const parsed = JSON.parse(acpRowsRaw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) { }
    }

    // Fallback: parse from [ACP: ...] or ACP: tag inside siteNote
    const note = siteNote || "";
    if (note.includes("ACP:") || note.includes("[ACP:")) {
        const tagMatch = note.match(/(?:\[ACP:|ACP:)\s*(.*?)(?:\]|$)/);
        if (tagMatch && tagMatch[1]) {
            const items = tagMatch[1].split(",");
            const parsed = [];
            items.forEach(it => {
                const dm = it.trim().match(/(\d+(?:\.\d+)?)\s*[*xX]\s*(\d+(?:\.\d+)?)\s*(?:ft)?\s*(?:\(\s*(\d+)\s*pcs(?:\s+(.*?))?\))?/i);
                if (dm) {
                    parsed.push({
                        width: parseFloat(dm[1]),
                        height: parseFloat(dm[2]),
                        qty: dm[3] ? parseInt(dm[3], 10) : 1,
                        colorGrade: (dm[4] || "").trim()
                    });
                }
            });
            if (parsed.length > 0) return parsed;
        }
    }
    return [];
}

/**
 * 5. Get Comprehensive Entry Data
 */
function getEnquiryDetails(enquiryId) {
    if (!enquiryId) return { success: false, error: "Entry ID required." };

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);
        const photoSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.BILLS);
        const revSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.PI_DOCS);

        const targetId = String(enquiryId).trim();

        // 1. Master Row
        const masterData = masterSheet.getDataRange().getValues();
        const cols = getMasterColMap(masterData[0]);
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;
        let enquiry = null;

        for (let i = 1; i < masterData.length; i++) {
            if (String(masterData[i][idCol]).trim() === targetId) {
                const row = masterData[i];
                const site = cols.siteName !== -1 && row[cols.siteName] ? row[cols.siteName].toString().trim() : "";
                const fab = cols.fabricator !== -1 && row[cols.fabricator] ? row[cols.fabricator].toString().trim() : "";
                const handler = cols.handler !== -1 && row[cols.handler] ? row[cols.handler].toString().trim() : "";
                const vendor = cols.vendor !== -1 && row[cols.vendor] ? row[cols.vendor].toString().trim() : "";
                const note = cols.note !== -1 && row[cols.note] ? row[cols.note].toString().trim() : "";
                const status = cols.status !== -1 && row[cols.status] ? row[cols.status].toString().trim() : (note.includes("[DONE]") ? "Done" : (note.includes("[CANCELLED]") ? "Cancelled" : ""));
                const totalSheets = cols.totalSheets !== -1 ? (parseFloat(row[cols.totalSheets]) || 0) : 0;
                const totalSqFt = cols.totalSqFt !== -1 ? (parseFloat(row[cols.totalSqFt]) || 0) : 0;
                const acpRows = parseAcpRowsHelper(cols.acpRows !== -1 ? row[cols.acpRows] : null, note);

                enquiry = {
                    enquiryId: targetId,
                    dateOfEnquiry: cols.date !== -1 && row[cols.date] instanceof Date ? row[cols.date].toISOString().split("T")[0] : (cols.date !== -1 && row[cols.date] ? row[cols.date].toString() : ""),
                    siteName: site,
                    placeName: site,
                    clientName: fab || vendor || site,
                    fabricatorName: fab,
                    supervisor: fab,
                    siteHandler: handler,
                    siteHandlers: handler,
                    vendorName: vendor,
                    reference: vendor,
                    totalSheets: totalSheets,
                    totalSqFt: totalSqFt,
                    acpRows: acpRows,
                    siteNote: note,
                    status: status,
                    quotationsFinalAmount: cols.finalAmount !== -1 ? (parseFloat(row[cols.finalAmount]) || 0) : 0,
                    quotationFileLink: cols.fileLink !== -1 && row[cols.fileLink] ? row[cols.fileLink].toString().trim() : ""
                };
                break;
            }
        }

        if (!enquiry) return { success: false, error: "Record " + targetId + " not found." };

        // 2. Invoice Bills
        const photosData = photoSheet ? photoSheet.getDataRange().getValues() : [];
        const photos = [];
        for (let i = 1; i < photosData.length; i++) {
            if (String(photosData[i][1]).trim() === targetId) {
                const row = photosData[i];
                const dateVal = row[11] instanceof Date ? row[11].toISOString() : (row[11] || (row[7] instanceof Date ? row[7].toISOString() : ""));
                photos.push({
                    photoId: row[0] ? row[0].toString() : "",
                    enquiryId: targetId,
                    invoiceNumber: row[2] ? row[2].toString() : "",
                    piRefNo: row[3] ? row[3].toString() : "",
                    dispatchedQty: parseFloat(row[4]) || 0,
                    amount: parseFloat(row[5]) || 0,
                    fileId: row[6] ? row[6].toString() : "",
                    viewUrl: row[7] ? row[7].toString() : (row[4] ? row[4].toString() : ""),
                    thumbnailUrl: row[8] ? row[8].toString() : (row[5] ? row[5].toString() : ""),
                    fileName: row[9] ? row[9].toString() : (row[6] ? row[6].toString() : "bill.pdf"),
                    notes: row[10] ? row[10].toString() : "",
                    date: dateVal
                });
            }
        }

        // 3. PI Documents
        const revData = revSheet ? revSheet.getDataRange().getValues() : [];
        const revisions = [];
        for (let i = 1; i < revData.length; i++) {
            if (String(revData[i][1]).trim() === targetId) {
                const dateVal = revData[i][5] instanceof Date ? revData[i][5].toISOString() : (revData[i][5] || "");
                revisions.push({
                    revId: revData[i][0] ? revData[i][0].toString() : "",
                    revNo: revData[i][2] ? revData[i][2].toString() : "PI Document",
                    amount: parseFloat(revData[i][3]) || 0,
                    notes: revData[i][4] ? revData[i][4].toString() : "",
                    date: dateVal,
                    fileLink: revData[i][6] ? revData[i][6].toString() : "",
                    fileName: revData[i][7] ? revData[i][7].toString() : ""
                });
            }
        }

        return {
            success: true,
            data: {
                enquiry: enquiry,
                photos: photos,
                revisions: revisions
            }
        };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

/**
 * 6. Bulk Data Fetcher (For Monitor Table & Cache Pre-warming)
 */
function getAllEnquiryDetailsBulk() {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);
        const photoSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.BILLS);
        const revSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.PI_DOCS);

        const masterData = masterSheet ? masterSheet.getDataRange().getValues() : [];
        if (masterData.length <= 1) {
            return { success: true, enquiries: [], detailsMap: {} };
        }

        const cols = getMasterColMap(masterData[0]);
        const idCol = cols.enquiryId !== -1 ? cols.enquiryId : 0;
        const enquiries = [];
        const detailsMap = {};

        for (let i = 1; i < masterData.length; i++) {
            const row = masterData[i];
            if (!row[idCol] && !row[0]) continue;
            const enqId = String(row[idCol] || row[0]).trim();

            const site = cols.siteName !== -1 && row[cols.siteName] ? row[cols.siteName].toString().trim() : "";
            const fab = cols.fabricator !== -1 && row[cols.fabricator] ? row[cols.fabricator].toString().trim() : "";
            const handler = cols.handler !== -1 && row[cols.handler] ? row[cols.handler].toString().trim() : "";
            const vendor = cols.vendor !== -1 && row[cols.vendor] ? row[cols.vendor].toString().trim() : "";
            const note = cols.note !== -1 && row[cols.note] ? row[cols.note].toString().trim() : "";
            const status = cols.status !== -1 && row[cols.status] ? row[cols.status].toString().trim() : (note.includes("[DONE]") ? "Done" : (note.includes("[CANCELLED]") ? "Cancelled" : ""));
            const totalSheets = cols.totalSheets !== -1 ? (parseFloat(row[cols.totalSheets]) || 0) : 0;
            const totalSqFt = cols.totalSqFt !== -1 ? (parseFloat(row[cols.totalSqFt]) || 0) : 0;
            const acpRows = parseAcpRowsHelper(cols.acpRows !== -1 ? row[cols.acpRows] : null, note);

            const enqObj = {
                enquiryId: enqId,
                dateOfEnquiry: cols.date !== -1 && row[cols.date] instanceof Date ? row[cols.date].toISOString().split("T")[0] : (cols.date !== -1 && row[cols.date] ? row[cols.date].toString() : ""),
                siteName: site,
                placeName: site,
                clientName: fab || vendor || site,
                fabricatorName: fab,
                supervisor: fab,
                siteHandler: handler,
                siteHandlers: handler,
                vendorName: vendor,
                reference: vendor,
                totalSheets: totalSheets,
                totalSqFt: totalSqFt,
                acpRows: acpRows,
                siteNote: note,
                status: status,
                quotationsFinalAmount: cols.finalAmount !== -1 ? (parseFloat(row[cols.finalAmount]) || 0) : 0,
                quotationFileLink: cols.fileLink !== -1 && row[cols.fileLink] ? row[cols.fileLink].toString().trim() : "",
                revisions: [],
                photos: []
            };

            enquiries.push(enqObj);
            detailsMap[enqId] = {
                enquiry: enqObj,
                photos: [],
                revisions: []
            };
        }

        // Invoice Bills
        const photosData = photoSheet ? photoSheet.getDataRange().getValues() : [];
        for (let i = 1; i < photosData.length; i++) {
            const eId = String(photosData[i][1]).trim();
            if (detailsMap[eId]) {
                const row = photosData[i];
                const dateVal = row[11] instanceof Date ? row[11].toISOString() : (row[11] || (row[7] instanceof Date ? row[7].toISOString() : ""));
                const billObj = {
                    photoId: row[0] ? row[0].toString() : "",
                    enquiryId: eId,
                    invoiceNumber: row[2] ? row[2].toString() : "",
                    piRefNo: row[3] ? row[3].toString() : "",
                    dispatchedQty: parseFloat(row[4]) || 0,
                    amount: parseFloat(row[5]) || 0,
                    fileId: row[6] ? row[6].toString() : "",
                    viewUrl: row[7] ? row[7].toString() : (row[4] ? row[4].toString() : ""),
                    thumbnailUrl: row[8] ? row[8].toString() : (row[5] ? row[5].toString() : ""),
                    fileName: row[9] ? row[9].toString() : (row[6] ? row[6].toString() : "bill.pdf"),
                    notes: row[10] ? row[10].toString() : "",
                    date: dateVal
                };
                detailsMap[eId].photos.push(billObj);
                if (detailsMap[eId].enquiry) detailsMap[eId].enquiry.photos.push(billObj);
            }
        }

        // PI Documents
        const revData = revSheet ? revSheet.getDataRange().getValues() : [];
        for (let i = 1; i < revData.length; i++) {
            const eId = String(revData[i][1]).trim();
            if (detailsMap[eId]) {
                const dateVal = revData[i][5] instanceof Date ? revData[i][5].toISOString() : (revData[i][5] || "");
                const revObj = {
                    revId: revData[i][0] ? revData[i][0].toString() : "",
                    revNo: revData[i][2] ? revData[i][2].toString() : "PI Document",
                    amount: parseFloat(revData[i][3]) || 0,
                    notes: revData[i][4] ? revData[i][4].toString() : "",
                    date: dateVal,
                    fileLink: revData[i][6] ? revData[i][6].toString() : "",
                    fileName: revData[i][7] ? revData[i][7].toString() : ""
                };
                detailsMap[eId].revisions.push(revObj);
                if (detailsMap[eId].enquiry) {
                    if (!detailsMap[eId].enquiry.revisions) detailsMap[eId].enquiry.revisions = [];
                    detailsMap[eId].enquiry.revisions.push(revObj);
                }
            }
        }

        return { success: true, enquiries: enquiries, detailsMap: detailsMap };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

function getAllEnquiries() {
    const res = getAllEnquiryDetailsBulk();
    if (res && res.success) {
        return { success: true, enquiries: res.enquiries };
    }
    return res;
}

/**
 * 7. Dropdown Suggestions from Database Sheet
 */
function getDropdownData() {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const db = ss.getSheetByName(CONFIG.SHEET_NAMES.DATABASE);

        const result = { references: [], places: [], siteHandlers: [], supervisors: [], purposes: [], fabricators: [], vendors: [], colors: [] };

        const defaultColors = [
            "Metallic Silver (0.25mm)", "Off White (0.25mm)", "Pure White (3mm)", "Sparkling Black (0.50mm)",
            "Wooden Teak (PVDF)", "Wooden Cherry", "Anthracite Grey 4mm", "Champagne Gold",
            "Mirror Gold", "Mirror Silver", "Copper Metallic", "Dark Grey PVDF 4mm",
            "Bright Red (Glossy)", "Traffic Yellow", "Emerald Green", "Charcoal Grey"
        ];

        if (!db || db.getLastRow() <= 1) {
            result.purposes = defaultColors;
            result.colors = defaultColors;
            result.fabricators = [];
            result.vendors = [];
            return { success: true, data: result };
        }

        const lastRow = db.getLastRow();
        const data = db.getRange(2, 1, lastRow - 1, 5).getValues();

        data.forEach(row => {
            if (row[0] && row[0].toString().trim()) result.places.push(row[0].toString().trim());
            if (row[1] && row[1].toString().trim()) result.supervisors.push(row[1].toString().trim());
            if (row[2] && row[2].toString().trim()) result.siteHandlers.push(row[2].toString().trim());
            if (row[3] && row[3].toString().trim()) result.references.push(row[3].toString().trim());
            if (row[4] && row[4].toString().trim()) result.purposes.push(row[4].toString().trim());
        });

        defaultColors.forEach(d => {
            if (!result.purposes.some(p => p.toLowerCase() === d.toLowerCase())) {
                result.purposes.push(d);
            }
        });

        for (const key in result) {
            result[key] = [...new Set(result[key])];
        }

        result.fabricators = [...result.supervisors];
        result.vendors = [...result.references];
        result.colors = [...result.purposes];

        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

function saveNewDropdownEntries(entries) {
    if (!entries || typeof entries !== "object") return { success: false, error: "Invalid entries." };

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();
        const db = ss.getSheetByName(CONFIG.SHEET_NAMES.DATABASE);
        if (!db) return { success: false, error: "Database sheet not found." };

        const colMap = {
            places: 1,
            supervisors: 2,
            fabricators: 2,
            siteHandlers: 3,
            vendors: 4,
            references: 4,
            purposes: 5,
            colors: 5
        };

        const lastRow = db.getLastRow();
        let existingByCol = { 1: [], 2: [], 3: [], 4: [], 5: [] };
        if (lastRow > 1) {
            const allData = db.getRange(2, 1, lastRow - 1, 5).getValues();
            for (let c = 1; c <= 5; c++) {
                const ci = c - 1;
                existingByCol[c] = allData.map(r => r[ci] ? r[ci].toString().trim().toLowerCase() : "").filter(Boolean);
            }
        }

        for (const key in entries) {
            if (!colMap[key] || !entries[key]) continue;
            const col = colMap[key];
            const newValues = (Array.isArray(entries[key]) ? entries[key] : [entries[key]]).filter(v => v && v.toString().trim());

            for (const val of newValues) {
                const trimmed = val.toString().trim();
                if (existingByCol[col].includes(trimmed.toLowerCase())) continue;

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
                existingByCol[col].push(trimmed.toLowerCase());
            }
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

/**
 * 8. Folder Management & Auto ID
 */
function generateEnquiryId(masterSheet) {
    const currentYear = new Date().getFullYear();
    const lastRow = masterSheet.getLastRow();
    let nextSeq = 1;

    if (lastRow > 1) {
        const ids = masterSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
        const currentYearPrefix = `ENQ-${currentYear}-`;
        const yearIds = ids.filter(id => typeof id === "string" && (id.startsWith(currentYearPrefix) || id.startsWith(`ACP-${currentYear}-`)));

        if (yearIds.length > 0) {
            const sequences = yearIds.map(id => {
                const parts = id.split("-");
                return parseInt(parts[2], 10) || 0;
            });
            nextSeq = Math.max(...sequences) + 1;
        }
    }

    return `ACP-${currentYear}-${String(nextSeq).padStart(4, "0")}`;
}

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

        const safeClient = (clientName || "Fabricator").replace(/[/\\?%*:|"<>]/g, "_").trim();
        const safePlace = (placeName || "Site").replace(/[/\\?%*:|"<>]/g, "_").trim();
        const folderName = `${enquiryId}_${safeClient}_${safePlace}`;

        const siteIter = yearFolder.getFoldersByName(folderName);
        const siteFolder = siteIter.hasNext() ? siteIter.next() : yearFolder.createFolder(folderName);

        const photoIter = siteFolder.getFoldersByName("01_Invoice_Bills");
        if (!photoIter.hasNext()) siteFolder.createFolder("01_Invoice_Bills");

        const quoteIter = siteFolder.getFoldersByName("02_PI_Documents");
        if (!quoteIter.hasNext()) siteFolder.createFolder("02_PI_Documents");

        return siteFolder;
    } catch (err) {
        console.warn("Drive folder error: " + err.message);
        return null;
    }
}

function getOrCreateEnquiryPhotoFolder(enquiryId, clientName, placeName) {
    const siteFolder = getOrCreateEnquiryFolder(enquiryId, clientName, placeName);
    if (!siteFolder) return null;
    let photoIter = siteFolder.getFoldersByName("01_Invoice_Bills");
    if (!photoIter.hasNext()) photoIter = siteFolder.getFoldersByName("01_Site_Photos");
    return photoIter.hasNext() ? photoIter.next() : siteFolder.createFolder("01_Invoice_Bills");
}

function getOrCreateEnquiryQuotationFolder(enquiryId, clientName, placeName) {
    const siteFolder = getOrCreateEnquiryFolder(enquiryId, clientName, placeName);
    if (!siteFolder) return null;
    let quoteIter = siteFolder.getFoldersByName("02_PI_Documents");
    if (!quoteIter.hasNext()) quoteIter = siteFolder.getFoldersByName("02_Quotations");
    return quoteIter.hasNext() ? quoteIter.next() : siteFolder.createFolder("02_PI_Documents");
}

/**
 * 9. Sheet Creation with ACP Specific Headers & Names
 */
function setupSheets() {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (!ss) return;

        // 1. ACP_Sheets_Master
        let master = ss.getSheetByName(CONFIG.SHEET_NAMES.MASTER);
        if (!master) {
            const legacyMaster = ss.getSheetByName("Enquiries_Master");
            if (legacyMaster) {
                legacyMaster.setName(CONFIG.SHEET_NAMES.MASTER);
                master = legacyMaster;
            } else {
                master = ss.insertSheet(CONFIG.SHEET_NAMES.MASTER);
                master.appendRow([
                    "Entry ID",
                    "Entry Date",
                    "Site Name",
                    "Fabricator Name",
                    "Site Handler",
                    "Vendor / Supplier Name",
                    "Total Sheets",
                    "Total Sq.Ft",
                    "ACP Specifications",
                    "Remarks / Cutting & Delivery Notes",
                    "Status",
                    "Total PI Amount",
                    "PI File Link"
                ]);
                master.getRange(1, 1, 1, 13).setFontWeight("bold").setBackground("#f0f0f0");
                master.setFrozenRows(1);
            }
        }

        // 2. PI_Documents
        let piSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.PI_DOCS);
        if (!piSheet) {
            const legacyRevs = ss.getSheetByName("Quotation_Revisions");
            if (legacyRevs) {
                legacyRevs.setName(CONFIG.SHEET_NAMES.PI_DOCS);
                piSheet = legacyRevs;
            } else {
                piSheet = ss.insertSheet(CONFIG.SHEET_NAMES.PI_DOCS);
                piSheet.appendRow(["PI ID", "Entry ID", "PI Number", "Amount", "Notes", "Date", "File Link", "File Name"]);
                piSheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#f0f0f0");
                piSheet.setFrozenRows(1);
            }
        }

        // 3. Invoice_Bills
        let billsSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.BILLS);
        if (!billsSheet) {
            const legacyPhotos = ss.getSheetByName("Site_Photos_Ledger");
            if (legacyPhotos) {
                legacyPhotos.setName(CONFIG.SHEET_NAMES.BILLS);
                billsSheet = legacyPhotos;
            } else {
                billsSheet = ss.insertSheet(CONFIG.SHEET_NAMES.BILLS);
                billsSheet.appendRow([
                    "Bill ID", "Entry ID", "Invoice Number", "PI Ref No",
                    "Dispatched Qty", "Amount", "File ID", "View URL",
                    "Thumbnail URL", "File Name", "Notes", "Timestamp"
                ]);
                billsSheet.getRange(1, 1, 1, 12).setFontWeight("bold").setBackground("#f0f0f0");
                billsSheet.setFrozenRows(1);
            }
        }

        // 4. Database
        let db = ss.getSheetByName(CONFIG.SHEET_NAMES.DATABASE);
        if (!db) {
            const legacyDb = ss.getSheetByName("dataBase");
            if (legacyDb) {
                legacyDb.setName(CONFIG.SHEET_NAMES.DATABASE);
                db = legacyDb;
            } else {
                db = ss.insertSheet(CONFIG.SHEET_NAMES.DATABASE);
                db.appendRow(["Sites / Places", "Fabricators", "Site Handlers", "Vendors / Suppliers", "ACP Colours / Grades / Shades"]);
                db.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#e8f0fe");
                db.setFrozenRows(1);

                const defaultAcpColors = [
                    ["", "", "", "", "Metallic Silver (0.25mm)"],
                    ["", "", "", "", "Off White (0.25mm)"],
                    ["", "", "", "", "Pure White (3mm)"],
                    ["", "", "", "", "Sparkling Black (0.50mm)"],
                    ["", "", "", "", "Wooden Teak (PVDF)"],
                    ["", "", "", "", "Wooden Cherry"],
                    ["", "", "", "", "Anthracite Grey 4mm"],
                    ["", "", "", "", "Champagne Gold"],
                    ["", "", "", "", "Mirror Gold"],
                    ["", "", "", "", "Mirror Silver"],
                    ["", "", "", "", "Copper Metallic"],
                    ["", "", "", "", "Dark Grey PVDF 4mm"],
                    ["", "", "", "", "Bright Red (Glossy)"],
                    ["", "", "", "", "Traffic Yellow"],
                    ["", "", "", "", "Emerald Green"],
                    ["", "", "", "", "Charcoal Grey"]
                ];
                db.getRange(2, 1, defaultAcpColors.length, 5).setValues(defaultAcpColors);
            }
        }
    } catch (err) {
        console.warn("setupSheets error: " + err.message);
    }
}

/**
 * 10. UI Menu & Admin Tools
 */
function onOpen() {
    try {
        SpreadsheetApp.getUi()
            .createMenu("🚀 ACP Sheet Manager")
            .addItem("🧹 Clear All Data", "clearAllData")
            .addSeparator()
            .addItem("⚙️ Setup / Fix Sheet Headers", "setupSheets")
            .addToUi();
    } catch (e) { }
}

function clearAllData() {
    const lock = LockService.getScriptLock();
    lock.tryLock(10000);

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        setupSheets();

        const sheetNames = [
            CONFIG.SHEET_NAMES.MASTER,
            CONFIG.SHEET_NAMES.PI_DOCS,
            CONFIG.SHEET_NAMES.BILLS
        ];

        sheetNames.forEach(name => {
            const sheet = ss.getSheetByName(name);
            if (sheet && sheet.getLastRow() > 1) {
                sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn() || 1).clearContent();
            }
        });

        return { success: true, message: "All sheet data cleared successfully." };
    } catch (err) {
        return { success: false, error: err.toString() };
    } finally {
        lock.releaseLock();
    }
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  FENESTRA uPVC — Quotation, Procurement & Order Management
 *  Google Apps Script Backend (Code.gs)
 *  
 *  Tables (Sheets):
 *    1. uPVC_Quotation_Master    — Active inquiries (15 cols)
 *    2A. uPVC_Quote_Win          — Won pipeline (16 cols)
 *    2B. uPVC_Quote_Loss         — Lost pipeline (7 cols)
 *    3. uPVC_Purchase_Order_Master — PO execution (18 cols)
 *    4. uPVC_Done_PO_Archive     — Completed archive (16 cols)
 *    5. uPVC_Config_Dropdowns    — Central lookups
 * ═══════════════════════════════════════════════════════════════
 */

// ──────────────────────────────────────────────
//  SHEET NAME CONSTANTS
// ──────────────────────────────────────────────
const SHEET_MASTER = 'uPVC_Quotation_Master';
const SHEET_WIN = 'uPVC_Quote_Win';
const SHEET_LOSS = 'uPVC_Quote_Loss';
const SHEET_PO = 'uPVC_Purchase_Order_Master';
const SHEET_ARCHIVE = 'uPVC_Done_PO_Archive';
const SHEET_CONFIG = 'uPVC_Config_Dropdowns';

// ──────────────────────────────────────────────
//  GOOGLE DRIVE FOLDER FOR UPLOADS
//  ► Create a folder in Drive and paste its ID here
// ──────────────────────────────────────────────
const UPLOAD_FOLDER_ID = ''; // e.g. '1aBcDeFgHiJkLmNoPqRsTuVwXyZ'

// ══════════════════════════════════════════════
//  WEB APP ENTRY POINTS
// ══════════════════════════════════════════════

function doGet(e) {
    const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'Index';
    return HtmlService.createTemplateFromFile(page)
        .evaluate()
        .setTitle('FENESTRA uPVC — Management System')
        .setFaviconUrl('https://img.icons8.com/fluency/48/window.png')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ══════════════════════════════════════════════
//  INITIALIZATION — Create sheets if missing
// ══════════════════════════════════════════════

function initializeSpreadsheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Quotation Master (15 cols)
    ensureSheet_(ss, SHEET_MASTER, [
        'Quotation ID', 'Client / Site Name', 'Date', 'Location',
        'Vendor Name', 'Variant', 'Mesh / Jaali', 'Glass Specs',
        'Total Item Qty', 'Lead Time', 'Rough Sizes', 'Vendor Quote',
        'Vendor Amount', 'Our Quote', 'Our Amount'
    ]);

    // 2A. Quote Win (16 cols — adds Win Date after Client/Site)
    ensureSheet_(ss, SHEET_WIN, [
        'Quotation ID', 'Client / Site Name', 'Win Date', 'Location',
        'Vendor Name', 'Variant', 'Mesh / Jaali', 'Glass Specs',
        'Total Item Qty', 'Lead Time', 'Rough Sizes', 'Vendor Quote',
        'Vendor Amount', 'Our Quote', 'Our Amount', 'Win Notes'
    ]);

    // 2B. Quote Loss (7 cols)
    ensureSheet_(ss, SHEET_LOSS, [
        'Quotation ID', 'Client / Site Name', 'Loss Date', 'Vendor Name',
        'Variant', 'Total Item Qty', 'Our Amount', 'Loss Reason'
    ]);

    // 3. PO Master (18 cols)
    ensureSheet_(ss, SHEET_PO, [
        'PO ID', 'Quotation ID', 'Client / Site Name', 'PO Date',
        'Location', 'Vendor Name', 'Variant', 'Mesh / Jaali',
        'Glass Specs', 'Total Item Qty', 'Lead Time (Days)',
        'Rough Sizes', 'Vendor Quote', 'Vendor Amount',
        'Our Quote', 'Our Amount', 'PO Order', 'Bills'
    ]);

    // 4. Done PO Archive (16 cols)
    ensureSheet_(ss, SHEET_ARCHIVE, [
        'PO ID', 'Quotation ID', 'Client / Site Name', 'Vendor Name',
        'Order Date', 'Variant', 'Total Item Qty',
        'Rough Sizes', 'Vendor Quote', 'Vendor Amount',
        'Our Quote', 'Our Amount', 'PO Order', 'Bills',
        'Handover Slip URL', 'Archived Date'
    ]);

    // 5. Config Dropdowns
    const configSheet = ensureSheet_(ss, SHEET_CONFIG, [
        'Vendors', 'Variant', 'Mesh / Jaali', 'Glass Types', 'Loss Reasons'
    ]);

    // Seed default config data if empty
    if (configSheet.getLastRow() <= 1) {
        const configData = [
            ['NCL', 'Fix-Light', 'None', 'Toughened / Tempered', 'Price Too High'],
            ['Poonam Alu.', '2-Track Sliding', 'Nylon Mesh', 'Clear Float', 'Lead Time Too Long'],
            ['WinFrame', '2.5-Track Sliding', 'SS 304 Mesh', 'Tinted Glass', 'Competitor Selected'],
            ['Magnesta', '3-Track Sliding', 'Pleated Mesh', 'Reflective Glass', 'Client Postponed'],
            ['Alumil', 'Casement / Openable', 'Fiberglass Mesh', 'Frosted / Obscure', 'Site Not Feasible'],
            ['Prominance', 'Sliding Folding', '', 'Laminated Glass', 'Specification Mismatch'],
            ['', 'Ventilator', '', 'DGU (Double Glazed)', '']
        ];
        configSheet.getRange(2, 1, configData.length, configData[0].length).setValues(configData);
    }

    return { success: true, message: 'All sheets initialized successfully.' };
}

/**
 * Seed comprehensive demo data into all 5 Google Sheets.
 * Run this function from the Apps Script editor to populate the sheets.
 */
function seedDemoData() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    initializeSpreadsheet();

    // 1. Quotation Master (15 cols)
    const masterSheet = ss.getSheetByName(SHEET_MASTER);
    if (masterSheet && masterSheet.getLastRow() <= 1) {
        const masterRows = [
            ['QT-UPVC-0001', 'Dr. Arvind Sharma — Grand Villa 42', '2026-09-22', 'Road No. 36, Jubilee Hills, Hyderabad', 'Prominance', '3-Track Sliding', 'SS 304 Mesh', 'Toughened / Tempered 6mm', 16, 15, 'https://drive.google.com/sample_rough_1.pdf', 'https://drive.google.com/sample_vendor_1.pdf', 284000, 'https://drive.google.com/sample_our_1.pdf', 385000],
            ['QT-UPVC-0002', 'Prestige Oasis — Penthouse Block B', '2026-09-23', 'Financial District, Nanakramguda, Hyderabad', 'Alumil', 'Sliding Folding', 'Pleated Mesh', 'DGU (Double Glazed) 24mm Acoustic', 8, 21, 'https://drive.google.com/sample_rough_2.pdf', 'https://drive.google.com/sample_vendor_2.pdf', 490000, 'https://drive.google.com/sample_our_2.pdf', 675000],
            ['QT-UPVC-0003', 'Mehta Residence — Renovation Project', '2026-09-24', 'Sector 14, Hiranandani Estate, Thane', 'NCL', '2.5-Track Sliding', 'Nylon Mesh', 'Tinted Glass 5mm Bronze', 12, 12, 'https://drive.google.com/sample_rough_3.pdf', 'https://drive.google.com/sample_vendor_3.pdf', 165000, 'https://drive.google.com/sample_our_3.pdf', 225000],
            ['QT-UPVC-0004', 'Aura Corporate Hub — Floor 4 & 5', '2026-09-24', 'Outer Ring Road, Marathahalli, Bengaluru', 'WinFrame', 'Fix-Light', 'None', 'Laminated Glass 10.38mm Soundproof', 34, 18, 'https://drive.google.com/sample_rough_4.pdf', 'https://drive.google.com/sample_vendor_4.pdf', 520000, 'https://drive.google.com/sample_our_4.pdf', 710000],
            ['QT-UPVC-0005', 'Suresh Reddy — Farmhouse Villa', '2026-09-25', 'Moinabad Green Acres, Hyderabad', 'Magnesta', 'Casement / Openable', 'Fiberglass Mesh', 'Reflective Glass 6mm Royal Blue', 19, 14, 'https://drive.google.com/sample_rough_5.pdf', 'https://drive.google.com/sample_vendor_5.pdf', 310000, 'https://drive.google.com/sample_our_5.pdf', 420000]
        ];
        masterSheet.getRange(2, 1, masterRows.length, masterRows[0].length).setValues(masterRows);
    }

    // 2A. Quote Win (16 cols)
    const winSheet = ss.getSheetByName(SHEET_WIN);
    if (winSheet && winSheet.getLastRow() <= 1) {
        const winRows = [
            ['QT-UPVC-0006', 'Aparna CyberLife — Tower 8 Unit 1204', '2026-09-21', 'Nallagandla, Gachibowli, Hyderabad', 'NCL', '2-Track Sliding', 'SS 304 Mesh', 'Toughened / Tempered 5mm', 10, 10, 'https://drive.google.com/sample_rough_6.pdf', 'https://drive.google.com/sample_vendor_6.pdf', 142000, 'https://drive.google.com/sample_our_6.pdf', 198000, 'Client confirmed via email; PO issuance pending'],
            ['QT-UPVC-0007', 'The Grove Luxury Club House', '2026-09-19', 'Sarjapur Main Road, Bengaluru', 'Prominance', 'Casement / Openable', 'Pleated Mesh', 'DGU (Double Glazed) 18mm Solar Control', 22, 20, 'https://drive.google.com/sample_rough_7.pdf', 'https://drive.google.com/sample_vendor_7.pdf', 580000, 'https://drive.google.com/sample_our_7.pdf', 795000, 'Negotiated 5% discount; 40% advance payment credited'],
            ['QT-UPVC-0008', 'Anand Kulkarni — Duplex Villa', '2026-09-18', 'Kalyan Nagar, Pune', 'WinFrame', '3-Track Sliding', 'Nylon Mesh', 'Clear Float 5mm', 14, 12, 'https://drive.google.com/sample_rough_8.pdf', 'https://drive.google.com/sample_vendor_8.pdf', 215000, 'https://drive.google.com/sample_our_8.pdf', 295000, 'Site survey completed; ready for PO release']
        ];
        winSheet.getRange(2, 1, winRows.length, winRows[0].length).setValues(winRows);
    }

    // 2B. Quote Loss (8 cols)
    const lossSheet = ss.getSheetByName(SHEET_LOSS);
    if (lossSheet && lossSheet.getLastRow() <= 1) {
        const lossRows = [
            ['QT-UPVC-0009', 'Sunway Commercial Complex', '2026-09-16', 'Poonam Alu.', '3-Track Sliding', 45, 1250000, 'Price Too High'],
            ['QT-UPVC-0010', 'Kiran Varma — Beach Cottage', '2026-09-14', 'Alumil', 'Sliding Folding', 6, 320000, 'Competitor Selected'],
            ['QT-UPVC-0011', 'Prime Dental Hospital Renovation', '2026-09-11', 'NCL', 'Ventilator', 18, 185000, 'Lead Time Too Long']
        ];
        lossSheet.getRange(2, 1, lossRows.length, lossRows[0].length).setValues(lossRows);
    }

    // 3. PO Master (18 cols)
    const poSheet = ss.getSheetByName(SHEET_PO);
    if (poSheet && poSheet.getLastRow() <= 1) {
        const poRows = [
            ['PO-UPVC-0001', 'QT-UPVC-0012', 'Aditya Imperial — Luxury Towers', '2026-09-17', 'Shaikpet, Hyderabad', 'Prominance', '3-Track Sliding', 'SS 304 Mesh', 'Toughened / Tempered 6mm', 28, 18, 'https://drive.google.com/sample_po1_rough.pdf', 'https://drive.google.com/sample_po1_vq.pdf', 540000, 'https://drive.google.com/sample_po1_oq.pdf', 745000, 'https://drive.google.com/sample_po_order_1.pdf', 'https://drive.google.com/sample_bill_1.pdf'],
            ['PO-UPVC-0002', 'QT-UPVC-0013', 'Emerald Heights Villa #19', '2026-09-20', 'Whitefield, Bengaluru', 'Magnesta', 'Casement / Openable', 'Pleated Mesh', 'Frosted / Obscure 5mm', 15, 14, 'https://drive.google.com/sample_po2_rough.pdf', 'https://drive.google.com/sample_po2_vq.pdf', 275000, 'https://drive.google.com/sample_po2_oq.pdf', 380000, 'https://drive.google.com/sample_po_order_2.pdf', '']
        ];
        poSheet.getRange(2, 1, poRows.length, poRows[0].length).setValues(poRows);
    }

    // 4. Done PO Archive (16 cols)
    const archiveSheet = ss.getSheetByName(SHEET_ARCHIVE);
    if (archiveSheet && archiveSheet.getLastRow() <= 1) {
        const archiveRows = [
            ['PO-UPVC-0003', 'QT-UPVC-0014', 'Vasavi Skyla Residential Suites', 'NCL', '2026-08-15', '2.5-Track Sliding', 32, 'https://drive.google.com/sample_arch1_rough.pdf', 'https://drive.google.com/sample_arch1_vq.pdf', 610000, 'https://drive.google.com/sample_arch1_oq.pdf', 830000, 'https://drive.google.com/sample_arch1_po.pdf', 'https://drive.google.com/sample_arch1_bill.pdf', 'https://drive.google.com/sample_handover_1.pdf', '2026-09-10'],
            ['PO-UPVC-0004', 'QT-UPVC-0015', 'Godrej Woodsman Estate Penthouse', 'WinFrame', '2026-08-22', 'Sliding Folding', 12, 'https://drive.google.com/sample_arch2_rough.pdf', 'https://drive.google.com/sample_arch2_vq.pdf', 395000, 'https://drive.google.com/sample_arch2_oq.pdf', 540000, 'https://drive.google.com/sample_arch2_po.pdf', 'https://drive.google.com/sample_arch2_bill.pdf', 'https://drive.google.com/sample_handover_2.pdf', '2026-09-18']
        ];
        archiveSheet.getRange(2, 1, archiveRows.length, archiveRows[0].length).setValues(archiveRows);
    }

    SpreadsheetApp.flush();
    return { success: true, message: 'All 5 sheets successfully populated with demo data!' };
}

// ══════════════════════════════════════════════
//  DROPDOWN CONFIG — Fetch options for forms
// ══════════════════════════════════════════════

function getDropdownOptions() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_CONFIG);

    if (!sheet) {
        initializeSpreadsheet();
        sheet = ss.getSheetByName(SHEET_CONFIG);
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const result = {};

    headers.forEach((header, colIdx) => {
        result[header] = [];
        for (let r = 1; r < data.length; r++) {
            const val = data[r][colIdx];
            if (val && val.toString().trim() !== '') {
                result[header].push(val.toString().trim());
            }
        }
    });

    return result;
}

// ══════════════════════════════════════════════
//  ID GENERATORS
// ══════════════════════════════════════════════

function generateQuotationId_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_MASTER);
    const lastRow = sheet.getLastRow();
    let maxNum = 0;

    if (lastRow > 1) {
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        ids.forEach(row => {
            const match = row[0].toString().match(/QT-UPVC-(\d+)/);
            if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
        });
    }

    return 'QT-UPVC-' + String(maxNum + 1).padStart(4, '0');
}

function generatePoId_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_PO);
    const lastRow = sheet.getLastRow();
    let maxNum = 0;

    if (lastRow > 1) {
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        ids.forEach(row => {
            const match = row[0].toString().match(/PO-UPVC-(\d+)/);
            if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
        });
    }

    return 'PO-UPVC-' + String(maxNum + 1).padStart(4, '0');
}

// ══════════════════════════════════════════════
//  FILE UPLOAD HELPER
// ══════════════════════════════════════════════

function uploadFileToDrive(fileData, fileName, mimeType) {
    try {
        let folder;
        if (UPLOAD_FOLDER_ID && UPLOAD_FOLDER_ID !== '') {
            folder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
        } else {
            // Fallback: create/use a folder in root
            const folders = DriveApp.getFoldersByName('FENESTRA_uPVC_Uploads');
            folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('FENESTRA_uPVC_Uploads');
        }

        const blob = Utilities.newBlob(Utilities.base64Decode(fileData), mimeType, fileName);
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        return file.getUrl();
    } catch (err) {
        Logger.log('Upload error: ' + err.message);
        return '';
    }
}

// ══════════════════════════════════════════════
//  CRUD: QUOTATION MASTER
// ══════════════════════════════════════════════

/**
 * Submit a new quotation to the Master sheet.
 * @param {Object} formData — All form fields
 * @param {Object} files — { roughSizes, vendorQuote, ourQuote } base64 file objects
 */
function submitQuotation(formData, files) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName(SHEET_MASTER);
        if (!sheet) { initializeSpreadsheet(); sheet = ss.getSheetByName(SHEET_MASTER); }

        const qId = generateQuotationId_();

        // Upload files
        const roughSizesUrl = files.roughSizes ? uploadFileToDrive(files.roughSizes.data, files.roughSizes.name, files.roughSizes.type) : '';
        const vendorQuoteUrl = files.vendorQuote ? uploadFileToDrive(files.vendorQuote.data, files.vendorQuote.name, files.vendorQuote.type) : '';
        const ourQuoteUrl = files.ourQuote ? uploadFileToDrive(files.ourQuote.data, files.ourQuote.name, files.ourQuote.type) : '';

        const row = [
            qId,
            formData.clientSiteName || '',
            formData.date || new Date().toISOString().split('T')[0],
            formData.location || '',
            formData.vendorName || '',
            formData.variant || '',
            formData.meshJaali || '',
            formData.glassSpecs || '',
            parseInt(formData.totalItemQty) || 1,
            parseInt(formData.leadTime) || 0,
            roughSizesUrl,
            vendorQuoteUrl,
            parseFloat(formData.vendorAmount) || 0,
            ourQuoteUrl,
            parseFloat(formData.ourAmount) || 0
        ];

        sheet.appendRow(row);
        SpreadsheetApp.flush();

        return { success: true, quotationId: qId, message: 'Quotation ' + qId + ' created successfully!' };
    } catch (err) {
        return { success: false, message: 'Error: ' + err.message };
    }
}

/**
 * Get all quotations from the Master sheet.
 */
function getQuotations() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_MASTER);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const result = [];

    for (let r = 1; r < data.length; r++) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = data[r][i]; });
        result.push(obj);
    }

    return result;
}

// ══════════════════════════════════════════════
//  PIPELINE: MARK WON / MARK LOST
// ══════════════════════════════════════════════

/**
 * Mark a quotation as WON — copies row to Quote_Win and removes from Master.
 */
function markQuotationWon(quotationId) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const masterSheet = ss.getSheetByName(SHEET_MASTER);
        let winSheet = ss.getSheetByName(SHEET_WIN);
        if (!winSheet) { initializeSpreadsheet(); winSheet = ss.getSheetByName(SHEET_WIN); }

        const masterData = masterSheet.getDataRange().getValues();
        let rowIndex = -1;
        let rowData = null;

        for (let r = 1; r < masterData.length; r++) {
            if (masterData[r][0] === quotationId) {
                rowIndex = r + 1; // 1-indexed sheet row
                rowData = masterData[r];
                break;
            }
        }

        if (!rowData) return { success: false, message: 'Quotation not found.' };

        // Quote Win row: insert Win Date at position 2 (after Client/Site Name)
        const winRow = [
            rowData[0],  // Quotation ID
            rowData[1],  // Client / Site Name
            new Date().toISOString().split('T')[0], // Win Date
            rowData[3],  // Location
            rowData[4],  // Vendor Name
            rowData[5],  // Variant
            rowData[6],  // Mesh / Jaali
            rowData[7],  // Glass Specs
            rowData[8],  // Total Item Qty
            rowData[9],  // Lead Time
            rowData[10], // Rough Sizes
            rowData[11], // Vendor Quote
            rowData[12], // Vendor Amount
            rowData[13], // Our Quote
            rowData[14], // Our Amount
            ''           // Win Notes
        ];

        winSheet.appendRow(winRow);
        masterSheet.deleteRow(rowIndex);
        SpreadsheetApp.flush();

        return { success: true, message: quotationId + ' marked as WON!' };
    } catch (err) {
        return { success: false, message: 'Error: ' + err.message };
    }
}

/**
 * Mark a quotation as LOST — copies core data to Quote_Loss and removes from Master.
 */
function markQuotationLost(quotationId, lossReason) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const masterSheet = ss.getSheetByName(SHEET_MASTER);
        let lossSheet = ss.getSheetByName(SHEET_LOSS);
        if (!lossSheet) { initializeSpreadsheet(); lossSheet = ss.getSheetByName(SHEET_LOSS); }

        const masterData = masterSheet.getDataRange().getValues();
        let rowIndex = -1;
        let rowData = null;

        for (let r = 1; r < masterData.length; r++) {
            if (masterData[r][0] === quotationId) {
                rowIndex = r + 1;
                rowData = masterData[r];
                break;
            }
        }

        if (!rowData) return { success: false, message: 'Quotation not found.' };

        const lossRow = [
            rowData[0],  // Quotation ID
            rowData[1],  // Client / Site Name
            new Date().toISOString().split('T')[0], // Loss Date
            rowData[4],  // Vendor Name
            rowData[5],  // Variant
            rowData[8],  // Total Item Qty
            rowData[14], // Our Amount
            lossReason || 'Not specified'
        ];

        lossSheet.appendRow(lossRow);
        masterSheet.deleteRow(rowIndex);
        SpreadsheetApp.flush();

        return { success: true, message: quotationId + ' marked as LOST.' };
    } catch (err) {
        return { success: false, message: 'Error: ' + err.message };
    }
}

// ══════════════════════════════════════════════
//  PO CREATION — From Won Quotation
// ══════════════════════════════════════════════

/**
 * Create a PO from a won quotation.
 */
function createPOFromWin(quotationId, poFiles) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const winSheet = ss.getSheetByName(SHEET_WIN);
        let poSheet = ss.getSheetByName(SHEET_PO);
        if (!poSheet) { initializeSpreadsheet(); poSheet = ss.getSheetByName(SHEET_PO); }

        const winData = winSheet.getDataRange().getValues();
        let rowData = null;

        for (let r = 1; r < winData.length; r++) {
            if (winData[r][0] === quotationId) {
                rowData = winData[r];
                break;
            }
        }

        if (!rowData) return { success: false, message: 'Won quotation not found.' };

        const poId = generatePoId_();

        // Upload PO-specific files
        const poOrderUrl = poFiles && poFiles.poOrder ? uploadFileToDrive(poFiles.poOrder.data, poFiles.poOrder.name, poFiles.poOrder.type) : '';
        const billsUrl = poFiles && poFiles.bills ? uploadFileToDrive(poFiles.bills.data, poFiles.bills.name, poFiles.bills.type) : '';

        const poRow = [
            poId,
            rowData[0],  // Quotation ID
            rowData[1],  // Client / Site Name
            new Date().toISOString().split('T')[0], // PO Date
            rowData[3],  // Location
            rowData[4],  // Vendor Name
            rowData[5],  // Variant
            rowData[6],  // Mesh / Jaali
            rowData[7],  // Glass Specs
            rowData[8],  // Total Item Qty
            rowData[9],  // Lead Time
            rowData[10], // Rough Sizes
            rowData[11], // Vendor Quote
            rowData[12], // Vendor Amount
            rowData[13], // Our Quote
            rowData[14], // Our Amount
            poOrderUrl,
            billsUrl
        ];

        poSheet.appendRow(poRow);
        SpreadsheetApp.flush();

        return { success: true, poId: poId, message: 'PO ' + poId + ' created from ' + quotationId + '!' };
    } catch (err) {
        return { success: false, message: 'Error: ' + err.message };
    }
}

// ══════════════════════════════════════════════
//  ARCHIVE — Move completed PO to archive
// ══════════════════════════════════════════════

/**
 * Archive a completed PO — moves to Done_PO_Archive.
 */
function archivePO(poId, handoverSlipFile) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const poSheet = ss.getSheetByName(SHEET_PO);
        let archiveSheet = ss.getSheetByName(SHEET_ARCHIVE);
        if (!archiveSheet) { initializeSpreadsheet(); archiveSheet = ss.getSheetByName(SHEET_ARCHIVE); }

        const poData = poSheet.getDataRange().getValues();
        let rowIndex = -1;
        let rowData = null;

        for (let r = 1; r < poData.length; r++) {
            if (poData[r][0] === poId) {
                rowIndex = r + 1;
                rowData = poData[r];
                break;
            }
        }

        if (!rowData) return { success: false, message: 'PO not found.' };

        const handoverUrl = handoverSlipFile ? uploadFileToDrive(handoverSlipFile.data, handoverSlipFile.name, handoverSlipFile.type) : '';

        const archiveRow = [
            rowData[0],  // PO ID
            rowData[1],  // Quotation ID
            rowData[2],  // Client / Site Name
            rowData[5],  // Vendor Name
            rowData[3],  // Order Date (PO Date)
            rowData[6],  // Variant
            rowData[9],  // Total Item Qty
            rowData[11], // Rough Sizes
            rowData[12], // Vendor Quote
            rowData[13], // Vendor Amount
            rowData[14], // Our Quote
            rowData[15], // Our Amount
            rowData[16], // PO Order
            rowData[17], // Bills
            handoverUrl,
            new Date().toISOString().split('T')[0] // Archived Date
        ];

        archiveSheet.appendRow(archiveRow);
        poSheet.deleteRow(rowIndex);
        SpreadsheetApp.flush();

        return { success: true, message: poId + ' archived successfully!' };
    } catch (err) {
        return { success: false, message: 'Error: ' + err.message };
    }
}

// ══════════════════════════════════════════════
//  DATA RETRIEVAL — For dashboard tables
// ══════════════════════════════════════════════

function getWonQuotations() {
    return getSheetData_(SHEET_WIN);
}

function getLostQuotations() {
    return getSheetData_(SHEET_LOSS);
}

function getPurchaseOrders() {
    return getSheetData_(SHEET_PO);
}

function getArchivedPOs() {
    return getSheetData_(SHEET_ARCHIVE);
}

/**
 * Get all data from all sheets for dashboard summary.
 */
function getDashboardData() {
    return {
        quotations: getQuotations(),
        won: getWonQuotations(),
        lost: getLostQuotations(),
        purchaseOrders: getPurchaseOrders(),
        archived: getArchivedPOs(),
        dropdowns: getDropdownOptions()
    };
}

// ══════════════════════════════════════════════
//  UPDATE PO FILES — Add PO Order / Bills later
// ══════════════════════════════════════════════

function updatePOFiles(poId, fileType, fileObj) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const poSheet = ss.getSheetByName(SHEET_PO);
        const poData = poSheet.getDataRange().getValues();

        for (let r = 1; r < poData.length; r++) {
            if (poData[r][0] === poId) {
                const url = uploadFileToDrive(fileObj.data, fileObj.name, fileObj.type);
                if (fileType === 'poOrder') {
                    poSheet.getRange(r + 1, 17).setValue(url); // Column Q (PO Order)
                } else if (fileType === 'bills') {
                    poSheet.getRange(r + 1, 18).setValue(url); // Column R (Bills)
                }
                SpreadsheetApp.flush();
                return { success: true, message: fileType + ' uploaded for ' + poId };
            }
        }

        return { success: false, message: 'PO not found.' };
    } catch (err) {
        return { success: false, message: 'Error: ' + err.message };
    }
}

// ══════════════════════════════════════════════
//  PRIVATE HELPERS
// ══════════════════════════════════════════════

function ensureSheet_(ss, name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(headers);
        // Style header row
        const headerRange = sheet.getRange(1, 1, 1, headers.length);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#1E40AF');
        headerRange.setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
    }
    return sheet;
}

function getSheetData_(sheetName) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const result = [];

    for (let r = 1; r < data.length; r++) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = data[r][i]; });
        result.push(obj);
    }

    return result;
}

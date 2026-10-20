/**
 * Google Apps Script Backend for uPVC CAD Drawing & BOQ Image Creator
 * Serves the HTML Web App and handles Google Drive image exports.
 */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('uPVC CAD Drawing & BOQ Image Creator')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Saves a base64 encoded PNG drawing directly to a Google Drive folder.
 * @param {string} base64Data - Base64 data URL string of the PNG image
 * @param {string} fileName - Destination file name
 * @return {object} Result object with success status and file URL
 */
function saveImageToDrive(base64Data, fileName) {
  try {
    const contentType = 'image/png';
    const cleanBase64 = base64Data.replace(/^data:image\/(png|jpeg);base64,/, '');
    const decoded = Utilities.base64Decode(cleanBase64);
    const defaultName = 'BOQ_CAD_Drawing_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.png';
    const blob = Utilities.newBlob(decoded, contentType, fileName || defaultName);

    // Save into dedicated folder 'BOQ Window Drawings' in user's Google Drive
    const folders = DriveApp.getFoldersByName('BOQ Window Drawings');
    let targetFolder;
    if (folders.hasNext()) {
      targetFolder = folders.next();
    } else {
      targetFolder = DriveApp.createFolder('BOQ Window Drawings');
    }

    const file = targetFolder.createFile(blob);
    file.setDescription('uPVC / Aluminium CAD Fenestration drawing generated for BOQ quoting.');

    return {
      success: true,
      fileUrl: file.getUrl(),
      fileName: file.getName(),
      folderName: targetFolder.getName()
    };
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}

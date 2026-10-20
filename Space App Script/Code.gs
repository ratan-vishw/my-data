/**
 * SPACE - Google Apps Script Web App
 * A stunning space-themed web application
 * 
 * HOW TO DEPLOY:
 * 1. Go to https://script.google.com
 * 2. Create a new project
 * 3. Paste this code into Code.gs
 * 4. Create a new HTML file called "index" and paste the index.html content
 * 5. Click Deploy > New Deployment > Web App
 * 6. Set "Who has access" to "Anyone" and deploy
 */

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('SPACE - Your Cosmic Workspace')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ========== TASK MANAGEMENT ==========

/**
 * Get all tasks from the connected Google Sheet
 * Creates the sheet if it doesn't exist
 */
function getTasks() {
  var sheet = getOrCreateSheet('Tasks');
  var data = sheet.getDataRange().getValues();
  var tasks = [];
  
  // Skip header row
  for (var i = 1; i < data.length; i++) {
    tasks.push({
      id: data[i][0],
      title: data[i][1],
      description: data[i][2],
      status: data[i][3],
      priority: data[i][4],
      createdAt: data[i][5],
      completedAt: data[i][6]
    });
  }
  return tasks;
}

/**
 * Add a new task
 */
function addTask(title, description, priority) {
  var sheet = getOrCreateSheet('Tasks');
  var id = Utilities.getUuid();
  var now = new Date().toISOString();
  
  sheet.appendRow([id, title, description || '', 'pending', priority || 'medium', now, '']);
  
  return {
    id: id,
    title: title,
    description: description || '',
    status: 'pending',
    priority: priority || 'medium',
    createdAt: now,
    completedAt: ''
  };
}

/**
 * Update task status
 */
function updateTaskStatus(taskId, newStatus) {
  var sheet = getOrCreateSheet('Tasks');
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === taskId) {
      sheet.getRange(i + 1, 4).setValue(newStatus);
      if (newStatus === 'completed') {
        sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
      }
      return true;
    }
  }
  return false;
}

/**
 * Delete a task
 */
function deleteTask(taskId) {
  var sheet = getOrCreateSheet('Tasks');
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === taskId) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ========== NOTES MANAGEMENT ==========

/**
 * Get all notes
 */
function getNotes() {
  var sheet = getOrCreateSheet('Notes');
  var data = sheet.getDataRange().getValues();
  var notes = [];
  
  for (var i = 1; i < data.length; i++) {
    notes.push({
      id: data[i][0],
      title: data[i][1],
      content: data[i][2],
      color: data[i][3],
      createdAt: data[i][4]
    });
  }
  return notes;
}

/**
 * Add a new note
 */
function addNote(title, content, color) {
  var sheet = getOrCreateSheet('Notes');
  var id = Utilities.getUuid();
  var now = new Date().toISOString();
  
  sheet.appendRow([id, title, content, color || '#6c5ce7', now]);
  
  return {
    id: id,
    title: title,
    content: content,
    color: color || '#6c5ce7',
    createdAt: now
  };
}

/**
 * Delete a note
 */
function deleteNote(noteId) {
  var sheet = getOrCreateSheet('Notes');
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === noteId) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ========== HELPER FUNCTIONS ==========

/**
 * Get or create a sheet with headers
 */
function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (!ss) {
    // Create a new spreadsheet if none is bound
    ss = SpreadsheetApp.create('SPACE - App Data');
  }
  
  var sheet = ss.getSheetByName(name);
  
  if (!sheet) {
    sheet = ss.insertSheet(name);
    
    if (name === 'Tasks') {
      sheet.appendRow(['ID', 'Title', 'Description', 'Status', 'Priority', 'Created At', 'Completed At']);
      sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    } else if (name === 'Notes') {
      sheet.appendRow(['ID', 'Title', 'Content', 'Color', 'Created At']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    }
  }
  
  return sheet;
}

/**
 * Get dashboard stats
 */
function getDashboardStats() {
  var tasks = getTasks();
  var notes = getNotes();
  
  var totalTasks = tasks.length;
  var completedTasks = tasks.filter(function(t) { return t.status === 'completed'; }).length;
  var pendingTasks = tasks.filter(function(t) { return t.status === 'pending'; }).length;
  var inProgressTasks = tasks.filter(function(t) { return t.status === 'in-progress'; }).length;
  
  return {
    totalTasks: totalTasks,
    completedTasks: completedTasks,
    pendingTasks: pendingTasks,
    inProgressTasks: inProgressTasks,
    totalNotes: notes.length,
    completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
  };
}

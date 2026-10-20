function onOpen() {
    var ui = SpreadsheetApp.getUi();
    var ss = SpreadsheetApp.getActive();
    ui.createMenu('BMP Formulas')
        .addItem('Run This First Time After\nInstall', 'initial')
        .addSeparator()
        .addItem('Assisted ImportRange', 'importRangeFormula')
        .addSeparator()
        .addSubMenu(ui.createMenu('FMS Formulas')
            .addItem('TAT in Hours(Timestamp inside the Working Hours)', 'plannedwwh')
            .addSeparator()
            .addItem('TAT in Hours(Timestamp outside the Working Hours)', 'plannedwwh2')
            .addSeparator()
            .addItem('TAT in days', 'plannedindays')
            .addSeparator()
            .addItem('T-x Formula', 'plannedlead')
            .addSeparator()
            .addItem('Specific Time', 'specificTime')
            .addSeparator()
            .addItem('Show planned only when status is NO', 'tatifno')
            .addSeparator()
            .addItem('Show planned only when status is YES', 'tatifyes')
            .addSeparator()
            .addItem('Set Actual Time (Formula)', 'actualTime')
            .addSeparator()
            .addItem('Set Actual Time (Script)', 'createTrigger')
            .addSeparator()
            .addItem('Time Delay Formula', 'timeDelay'))
        .addToUi();

    generatePendingSummary();


}


function createTrigger() {
    removeTrigger()
    removeTrigger()
    removeTrigger()
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ScriptApp.newTrigger('onChange_new').forSpreadsheet(ss).onChange().create();
}

function removeTrigger() {
    // Loop over all triggers.
    var allTriggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < allTriggers.length; i++) {
        // If the current trigger is the correct one, delete it.
        if (allTriggers[i].getUniqueId() == allTriggers[i].getUniqueId()) {
            ScriptApp.deleteTrigger(allTriggers[i]);
            break;
        }
    }
}

function importRangeFormula() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var donorSheet = ui.prompt('URL of the spreadsheet from where \ndata has to be imported', ui.ButtonSet.OK_CANCEL);

    if (donorSheet.getSelectedButton() == ui.Button.OK) {
        var donorSheet = donorSheet.getResponseText();
    }

    var tabName = ui.prompt('Name of the sheet/tab from where \ndata has to be imported', ui.ButtonSet.OK_CANCEL);

    if (tabName.getSelectedButton() == ui.Button.OK) {
        var tabName = tabName.getResponseText();
    }

    var rangeName = ui.prompt('Enter the range from where \ndata has to be imported.', ui.ButtonSet.OK_CANCEL);

    if (rangeName.getSelectedButton() == ui.Button.OK) {
        var rangeName = rangeName.getResponseText();
    }

    ss.getCurrentCell().setFormula('=importrange("' + donorSheet + '","' + tabName + '!' + rangeName + '")')


}

function initial() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var donorSheet = ui.prompt('Opening Time', ui.ButtonSet.OK_CANCEL);

    if (donorSheet.getSelectedButton() == ui.Button.OK) {
        var donorSheet = donorSheet.getResponseText();
    }

    var tabName = ui.prompt('Closing Time', ui.ButtonSet.OK_CANCEL);

    if (tabName.getSelectedButton() == ui.Button.OK) {
        var tabName = tabName.getResponseText();
    }
    iterative()
    var spreadsheet = SpreadsheetApp.getActive();
    spreadsheet.getRange('A1').activate();
    spreadsheet.getCurrentCell().setFormula('=now()');
    spreadsheet.getRange('C1').activate();
    spreadsheet.getCurrentCell().setValue(donorSheet);
    spreadsheet.getRange('D1').activate();
    spreadsheet.getCurrentCell().setValue(tabName);
    spreadsheet.getRange('B1').activate();
    spreadsheet.getCurrentCell().setFormula('=' + tabName + '/24-' + donorSheet + '/24');
    spreadsheet.getRange('B2:F2').activate();
    spreadsheet.getRange('1:1').activate();
    spreadsheet.getActiveSheet().hideRows(spreadsheet.getActiveRange().getRow(), spreadsheet.getActiveRange().getNumRows());
    spreadsheet.getRange('2:2').activate();
};




function plannedwwh() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var ofs = ss.getRange("C1").getValue()
    var ofe = ss.getRange("D1").getValue()

    var fromDate = ui.prompt('Date Cell in which you want to add TAT', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }

    var tatInHours = ui.prompt('TAT cell (example G$5)', ui.ButtonSet.OK_CANCEL);
    if (tatInHours.getSelectedButton() == ui.Button.OK) {
        var tatInHours = tatInHours.getResponseText()
    }

    ss.getCurrentCell().setFormula('=IF(' + fromDate + '<>"",IFS(HOUR(' + fromDate + '+' + tatInHours + ')>$D$1,workday.intl(' + fromDate + ',1,"0000001")+$C$1/24+' + tatInHours + ',HOUR(' + fromDate + '+' + tatInHours + ')<$C$1,Datevalue(' + fromDate + ')+$C$1/24+' + tatInHours + ',and(hour(' + fromDate + '+' + tatInHours + ')>=$C$1,hour(' + fromDate + '+' + tatInHours + ')<=$D$1),' + fromDate + '+' + tatInHours + '),"")');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);

}

function plannedwwh2() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var ofs = ss.getRange("C1").getValue()
    var ofe = ss.getRange("D1").getValue()

    var fromDate = ui.prompt('Date Cell in which you want to add TAT', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }

    var tatInHours = ui.prompt('TAT cell (example G$5)', ui.ButtonSet.OK_CANCEL);
    if (tatInHours.getSelectedButton() == ui.Button.OK) {
        var tatInHours = tatInHours.getResponseText()
    }

    ss.getCurrentCell().setFormula('=if(' + fromDate + ',if(and(hour(' + fromDate + '+' + tatInHours + ')>' + ofs.toString() + ',(hour(' + fromDate + '+' + tatInHours + ')<' + ofe.toString() + ')),' + fromDate + '+' + tatInHours + ',workday.intl(int(' + fromDate + '),1,"0000001",Holidays!A:A)+hour(' + fromDate + '+' + tatInHours + '-$B$1)/24+minute(' + fromDate + ')/1440),"")');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);

}

function plannedindays() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var ofs = ss.getRange("C1").getValue()
    var ofe = ss.getRange("D1").getValue()

    var fromDate = ui.prompt('Date Cell in which you want to add TAT', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }

    var tatInHours = ui.prompt('TAT cell (example G$5)', ui.ButtonSet.OK_CANCEL);
    if (tatInHours.getSelectedButton() == ui.Button.OK) {
        var tatInHours = tatInHours.getResponseText()
    }

    ss.getCurrentCell().setFormula('=if(' + fromDate + ',WORKDAY.INTL(' + fromDate + ',' + tatInHours + ',"0000001",Holidays!A:A)+hour(' + fromDate + ')/24+MINUTE(' + fromDate + ')/1440,"")');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);


}


function plannedlead() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var ofs = ss.getRange("C1")
    var ofe = ss.getRange("D1")
    var fromDate = ui.prompt('Date Cell in which you want to add lead time', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }
    var leadtime = ui.prompt('Lead Time Cell', ui.ButtonSet.OK_CANCEL);

    if (leadtime.getSelectedButton() == ui.Button.OK) {
        var leadtime = leadtime.getResponseText();
    }

    var tatInHours = ui.prompt('Number of Days Before Lead Time', ui.ButtonSet.OK_CANCEL);
    if (tatInHours.getSelectedButton() == ui.Button.OK) {
        var tatInHours = tatInHours.getResponseText()
    }

    ss.getCurrentCell().setFormula('=if(' + leadtime + ',' + fromDate + '+' + leadtime + '-' + tatInHours + ',"")');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);


}

function specificTime() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var ofs = ss.getRange("C1")
    var ofe = ss.getRange("D1")
    var fromDate = ui.prompt('Date Cell', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }
    var leadtime = ui.prompt('Number of Days after previous planned (Write 0 if same day)', ui.ButtonSet.OK_CANCEL);

    if (leadtime.getSelectedButton() == ui.Button.OK) {
        var leadtime = leadtime.getResponseText();
    }

    var tatInHours = ui.prompt('Time of day in hour/24 format', ui.ButtonSet.OK_CANCEL);
    if (tatInHours.getSelectedButton() == ui.Button.OK) {
        var tatInHours = tatInHours.getResponseText()
    }

    ss.getCurrentCell().setFormula('=if(' + fromDate + ',workday.intl(int(' + fromDate + '),' + leadtime + ',"0000001",Holidays!A:A)+' + tatInHours + ',"")');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);


}

function actualTime() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();

    var leadtime = ui.prompt('Status Cell', ui.ButtonSet.OK_CANCEL);

    if (leadtime.getSelectedButton() == ui.Button.OK) {
        var leadtime = leadtime.getResponseText();
    }
    var currcella1 = ss.getCurrentCell().getA1Notation()
    ss.getCurrentCell().setFormula('=if(' + currcella1 + ',' + currcella1 + ',if(' + leadtime + '<>"",$A$1,""))');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);


}

function timeDelay() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();

    var fromDate = ui.prompt('Planned Cell', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }
    var leadtime = ui.prompt('Actual Cell', ui.ButtonSet.OK_CANCEL);

    if (leadtime.getSelectedButton() == ui.Button.OK) {
        var leadtime = leadtime.getResponseText();
    }
    var conditionalFormatRules = ss.getActiveSheet().getConditionalFormatRules();
    ss.getCurrentCell().setFormula('=if(' + fromDate + ',if(' + leadtime + '<>"",if(' + leadtime + '>' + fromDate + ',' + leadtime + '-' + fromDate + ',""),$A$1-' + fromDate + '),"")');
    ss.getActiveRangeList().setNumberFormat('[h]:mm:ss');





    var spreadsheet = SpreadsheetApp.getActive();
    var conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.push(SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenCellNotEmpty()
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',if(' + leadtime + '>' + fromDate + ',1,0),0)')
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',if(' + leadtime + '>' + fromDate + ',1,0),0)')
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',if(' + leadtime + '>' + fromDate + ',1,0),0)')
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',if(' + leadtime + '>' + fromDate + ',1,0),0)')
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',if(' + leadtime + '>' + fromDate + ',1,0),0)')
        .setBackground('#F4C7C3')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.push(SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenCellNotEmpty()
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',0,if(' + fromDate + '<$A$1,1,0))')
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',0,if(' + fromDate + '<$A$1,1,0))')
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',0,if(' + fromDate + '<$A$1,1,0))')
        .setBackground('#B7E1CD')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);
    conditionalFormatRules = spreadsheet.getActiveSheet().getConditionalFormatRules();
    conditionalFormatRules.splice(conditionalFormatRules.length - 1, 1, SpreadsheetApp.newConditionalFormatRule()
        .setRanges([spreadsheet.getActiveRange()])
        .whenFormulaSatisfied('=if(' + leadtime + ',0,if(' + fromDate + '<$A$1,1,0))')
        .setBackground('#FCE8B2')
        .build());
    spreadsheet.getActiveSheet().setConditionalFormatRules(conditionalFormatRules);

    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);


}


function test() {
    var ss = SpreadsheetApp.getActive();
    var curr = ss.getCurrentCell().getFormula();
    Logger.log(curr.substr(1))
}

function tatifno() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var ofs = ss.getRange("C1")
    var ofe = ss.getRange("D1")
    var fromDate = ui.prompt('Status Cell', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }
    var formulaincell = ss.getCurrentCell().getFormula().substr(1);
    ss.getCurrentCell().setFormula('=if(' + fromDate + '="No",' + formulaincell + ',"")');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);


}

function tatifyes() {
    var ss = SpreadsheetApp.getActive();
    var ui = SpreadsheetApp.getUi();
    var ofs = ss.getRange("C1")
    var ofe = ss.getRange("D1")
    var fromDate = ui.prompt('Status Cell', ui.ButtonSet.OK_CANCEL);

    if (fromDate.getSelectedButton() == ui.Button.OK) {
        var fromDate = fromDate.getResponseText();
    }
    var formulaincell = ss.getCurrentCell().getFormula().substr(1);
    ss.getCurrentCell().setFormula('=if(' + fromDate + '="Yes",' + formulaincell + ',"")');
    ss.getActiveRangeList().setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    currentCell = ss.getCurrentCell();
    ss.getSelection().getNextDataRange(SpreadsheetApp.Direction.DOWN).activate();
    currentCell.activateAsCurrentCell();
    ss.getCurrentCell().copyTo(ss.getActiveRange(), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);


}

function iterative() {
    var spreadsheet = SpreadsheetApp.getActive();
    spreadsheet.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.ON_CHANGE);
    spreadsheet.setIterativeCalculationEnabled(true);
    spreadsheet.setMaxIterativeCalculationCycles(1);
    spreadsheet.setIterativeCalculationConvergenceThreshold(0.05);
};


function onChange_new() {
    var ss = SpreadsheetApp.getActiveSpreadsheet()
    var sheet = ss.getActiveSheet();
    var active = ss.getActiveCell();
    var row = active.getRow();
    var name = sheet.getSheetName();
    var col = active.getColumn();
    var val = active.getValue();
    var date = Utilities.formatDate(new Date(), "IST", "dd/MM/YYYY HH:mm:ss");
    if (val == "Done") {
        ts = sheet.getRange(row, col - 1).getValue();
        if (ts == "") { sheet.getRange(row, col - 1).setValue(new Date()) }
    }
    if (val == "Yes") {
        ts = sheet.getRange(row, col - 1).getValue();//Actual Time column
        if (ts == "") { sheet.getRange(row, col - 1).setValue(new Date()) }
    }
    if (val == "No") {
        ts = sheet.getRange(row, col - 1).getValue();//Actual Time column
        if (ts == "") { sheet.getRange(row, col - 1).setValue(new Date()) }
    }
    if (val == true) {
        ts = sheet.getRange(row, col - 1).getValue();
        if (ts == "") { sheet.getRange(row, col - 1).setValue(new Date()) }
    }
}




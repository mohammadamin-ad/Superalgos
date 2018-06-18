﻿var LRCIndicator = function (settings) {
    this.input = 'price';
    this.depth = settings;
    this.result = false;
    this.age = 0;
    this.history = [];
    this.x = [];
    /*
     * Do not use array(depth) as it might not be implemented
     */
    for (var i = 0; i < this.depth; i++) {
        this.history.push(0.0);
        this.x.push(i);
    }

    // log.debug("Created LRC indicator with h: ", this.depth);
}

LRCIndicator.prototype.update = function (price) {
    // We need sufficient history to get the right result. 
    if (this.result === false && this.age < this.depth) {

        this.history[this.age] = price;
        this.age++;
        this.result = false;
        // log.debug("Waiting for sufficient age: ", this.age, " out of ", this.depth);
        return;
    }

    this.age++;
    // shift history
    for (var i = 0; i < (this.depth - 1); i++) {
        this.history[i] = this.history[i + 1];
    }
    this.history[this.depth - 1] = price;

    this.calculate(price);

    // log.debug("Checking LRC: ", this.result.toFixed(8), "\tH: ", this.age);
    return;
}

/*
 * Least squares linear regression fitting.
 */
function linreg(values_x, values_y) {
    var sum_x = 0;
    var sum_y = 0;
    var sum_xy = 0;
    var sum_xx = 0;
    var count = 0;

    /*
     * We'll use those variables for faster read/write access.
     */
    var x = 0;
    var y = 0;
    var values_length = values_x.length;

    if (values_length != values_y.length) {
        throw new Error('The parameters values_x and values_y need to have same size!');
    }

    /*
     * Nothing to do.
     */
    if (values_length === 0) {
        return [[], []];
    }

    /*
     * Calculate the sum for each of the parts necessary.
     */
    for (var v = 0; v < values_length; v++) {
        x = values_x[v];
        y = values_y[v];
        sum_x += x;
        sum_y += y;
        sum_xx += x * x;
        sum_xy += x * y;
        count++;
    }

    /*
     * Calculate m and b for the formula: y = x * m + b
     * 
     */
    var m = (count * sum_xy - sum_x * sum_y) / (count * sum_xx - sum_x * sum_x);
    var b = (sum_y / count) - (m * sum_x) / count;

    return [m, b];
}


/*
 * Handle calculations
 */
LRCIndicator.prototype.calculate = function (price) {
    // get the reg
    var reg = linreg(this.x, this.history);

    // y = a * x + b
    this.result = ((this.depth - 1) * reg[0]) + reg[1];
}

exports.newUserBot = function newUserBot(bot, logger, COMMONS, UTILITIES, BLOB_STORAGE, FILE_STORAGE) {
    const FULL_LOG = true;
    const LOG_FILE_CONTENT = false;
    const USE_PARTIAL_LAST_CANDLE = true; // When running live the last candle generated is a partial candle.
    
    const ONE_MIN_IN_MILISECONDS = 60 * 1000;

    const MODULE_NAME = "User Bot";

    const EXCHANGE_NAME = "Poloniex";
    
    thisObject = {
        initialize: initialize,
        start: start
    };

    let gaussStorage = BLOB_STORAGE.newBlobStorage(bot, logger);
    let oliviaStorage = BLOB_STORAGE.newBlobStorage(bot, logger);

    let utilities = UTILITIES.newCloudUtilities(bot, logger);

    let statusDependencies;
    
    return thisObject;

    function initialize(pStatusDependencies, pMonth, pYear, callBackFunction) {

        try {

            logger.fileName = MODULE_NAME;

            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] initialize -> Entering function."); }
            
            statusDependencies = pStatusDependencies;

            gaussStorage.initialize(bot.devTeam, onGaussInizialized);

            function onGaussInizialized(err) {

                if (err.result === global.DEFAULT_OK_RESPONSE.result) {

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] initialize -> onGaussInizialized -> Initialization Succeed."); }
                    oliviaStorage.initialize("AAMasters", onOliviaInizialized);

                } else {
                    logger.write(MODULE_NAME, "[ERROR] initialize -> onGaussInizialized -> err = " + err.message);
                    callBackFunction(err);
                }
            }

            function onOliviaInizialized(err) {

                if (err.result === global.DEFAULT_OK_RESPONSE.result) {

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] initialize -> onOliviaInizialized -> Initialization Succeed."); }
                    callBackFunction(global.DEFAULT_OK_RESPONSE);

                } else {
                    logger.write(MODULE_NAME, "[ERROR] initialize -> onOliviaInizialized -> err = " + err.message);
                    callBackFunction(err);
                }
            }

        } catch (err) {
            logger.write(MODULE_NAME, "[ERROR] initialize -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    /*
        This process will do the following:
    	For every period on the market:
		a. Get olivia files for the current execution time
			i. If the file exist, validate we can get 63 candles
				1) 63 candles exist, proceed
				2) 63 candles doesn't exist, call for previous execution day until have 63
			ii. File doesn't exist, wait until get the files
		b. Once we have the 63 candles, calculate LRC
		c. Save LRC points
    */

    function start(callBackFunction) {

        try {

            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> Entering function."); }

            let market = global.MARKET;
            let reportFilePath = EXCHANGE_NAME + "/Processes/" + bot.process;
            let executionTime;
            let lastCandles;
            let dailyFileCache = {};
            let lrcPointsFileCache = {};
            
            getContextVariables();

            function getContextVariables() {

                try {

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getContextVariables -> Entering function."); }

                    let reportKey = "AAMasters" + "-" + "AAOlivia" + "-" + "Multi-Period-Daily" + "-" + "dataSet.V1";
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getContextVariables -> reportKey = " + reportKey); }

                    if (statusDependencies.statusReports.get(reportKey).status === "Status Report is corrupt.") {
                        logger.write(MODULE_NAME, "[ERROR] start -> getContextVariables -> Can not continue because self dependecy Status Report is corrupt. Aborting Process.");
                        callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                        return;
                    }

                    let thisReport = statusDependencies.statusReports.get(reportKey).file;

                    if (thisReport.lastFile === undefined) {
                        logger.write(MODULE_NAME, "[WARN] start -> getContextVariables -> Undefined Last File. -> reportKey = " + reportKey);

                        let customOK = {
                            result: global.CUSTOM_OK_RESPONSE.result,
                            message: "Dependency not ready."
                        }
                        logger.write(MODULE_NAME, "[WARN] start -> getContextVariables -> customOK = " + customOK.message);
                        callBackFunction(customOK);
                        return;
                    }

                    reportKey = "AAVikings" + "-" + "AAGauss" + "-" + "Multi-Period-Daily" + "-" + "dataSet.V1";
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getContextVariables -> reportKey = " + reportKey); }

                    if (statusDependencies.statusReports.get(reportKey).status === "Status Report is corrupt.") {
                        logger.write(MODULE_NAME, "[ERROR] start -> getContextVariables -> Can not continue because self dependecy Status Report is corrupt. Aborting Process.");
                        callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                        return;
                    }

                    thisReport = statusDependencies.statusReports.get(reportKey).file;
                    if (thisReport.lastCandles !== undefined) {
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getContextVariables -> thisReport.lastCandles: " + JSON.stringify(thisReport.lastCandles)) };

                        lastCandles = thisReport.lastCandles;
                        buildLRCPoints();

                    } else {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getContextVariables -> First time running the bot."); }

                        lastCandles = [];

                        for (n = 0; n < global.dailyFilePeriods.length; n++) {
                            lastCandles.push(0);
                        }

                        lastCandles[10] = new Date(Date.UTC(2018, 5)).valueOf();

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getContextVariables -> Starting at: " + new Date(lastCandles[10]).toISOString()); }

                        buildLRCPoints();

                    }

                } catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] start -> getContextVariables -> err = " + err.message);
                    if (err.message === "Cannot read property 'file' of undefined") {
                        logger.write(MODULE_NAME, "[HINT] start -> getContextVariables -> Check the bot configuration to see if all of its statusDependencies declarations are correct. ");
                        logger.write(MODULE_NAME, "[HINT] start -> getContextVariables -> Dependencies loaded -> keys = " + JSON.stringify(statusDependencies.keys));
                    }
                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                }
            }

            function buildLRCPoints() {

                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> Entering function."); }

                let writeReport = false;

                advanceTime();

                function advanceTime() {                    

                    executionTime = new Date(lastCandles[10] + ONE_MIN_IN_MILISECONDS);

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> advanceTime -> New processing time @ " + executionTime.toISOString()); }

                    /* Validation that we are not going past the head of the market. */
                    
                    if (isExecutionOnHeadOfMarket()) {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> advanceTime -> Head of the market found @ " + executionTime.toISOString()); }

                        callBackFunction(global.DEFAULT_OK_RESPONSE); // Here is where we finish processing and wait for the platform to run this module again.
                        return;
                    }
                    
                    periodsLoop();

                }

                function isExecutionOnHeadOfMarket() {
                    let candleBeginIndex = 4;
                    let lastDayIndex = 10 + '/' + executionTime.getUTCFullYear() + "/" + utilities.pad(executionTime.getUTCMonth() + 1, 2) + "/" + utilities.pad(executionTime.getUTCDate(), 2);

                    if (dailyFileCache[lastDayIndex] === undefined) {
                        return false;
                    }

                    let lastCandlePeriodOnCache = dailyFileCache[lastDayIndex][dailyFileCache[lastDayIndex].length - 1][candleBeginIndex];

                    return (executionTime.valueOf() >= lastCandlePeriodOnCache.valueOf());
                }

                function periodsLoop() {

                    let n = 0   // loop Variable representing each possible period as defined at the periods array.

                    loopBody();

                    function loopBody() {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> periodsLoop -> loopBody -> Entering function. Loop: " + n); }

                        const outputPeriod = global.dailyFilePeriods[n][0];
                        const folderName = global.dailyFilePeriods[n][1];
                        const nextExecution = lastCandles[n] + outputPeriod;

                        isTimeToRun();

                        function isTimeToRun() {
                            if (executionTime.valueOf() >= nextExecution && !isPeriodOnHeadOfMarket(executionTime)) {
                                getLRCPoints();
                            } else {
                                setTimeout(function() { controlLoop(); }, 0);
                            }
                        }

                        function getLRCPoints() {

                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> Entering function."); }

                            const maxLRCDepth = 63;
                            const maxBackwardsCount = 3;

                            let backwardsCount = 0;
                            let candleArray = [];

                            let queryDate = new Date(executionTime);
                            let candleFile = getDailyFile(queryDate, onDailyFileReceived);

                            function onDailyFileReceived(err, candleFile) {
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> onDailyFileReceived."); }

                                if (err.result === global.DEFAULT_OK_RESPONSE.result) {
                                    for (let i = 0; i < candleFile.length; i++) {
                                        let candle = {
                                            open: undefined,
                                            close: undefined,
                                            min: 10000000000000,
                                            max: 0,
                                            begin: undefined,
                                            end: undefined
                                        };

                                        candle.min = candleFile[i][0];
                                        candle.max = candleFile[i][1];

                                        candle.open = candleFile[i][2];
                                        candle.close = candleFile[i][3];

                                        candle.begin = candleFile[i][4];
                                        candle.end = candleFile[i][5];

                                        if (LOG_FILE_CONTENT === true) { logger.write(MODULE_NAME, "[INFO] Candle Date: " + new Date(candle.begin).toISOString() + ". Process Date: " + executionTime.toISOString()); }

                                        let lastCandle = executionTime.valueOf() - (outputPeriod * maxLRCDepth);

                                        if (candleArray.length < maxLRCDepth && candle.begin > lastCandle && candle.begin <= executionTime.valueOf()) {
                                            candleArray.push(candle);
                                        }
                                    }

                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> Candle Array Length: " + candleArray.length); }

                                    if (candleArray.length >= maxLRCDepth) {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> All candles available proceed with LRC calculations."); }

                                        let lrcPoint = performLRCCalculations(candleArray);
                                        savePoint(lrcPoint);

                                    } else if (backwardsCount <= maxBackwardsCount) {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> Getting file for day before."); }
                                        
                                        queryDate.setDate(queryDate.getDate() - 1);
                                        getDailyFile(queryDate, onDailyFileReceived);
                                        backwardsCount++;
                                    } else {
                                        logger.write(MODULE_NAME, "[WARN] start -> getLRCPoints -> Not enough history to calculate LRC. Moving to Next Period.");
                                        // Move to the next period without writing report
                                        setTimeout(function () { controlLoop(); }, 0);
                                    }
                                }
                            }

                            function getDailyFile(dateTime, onDailyFileReceived) {
                                try {
                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> getDailyFile -> Entering function."); }

                                    /**
                                     * Let's first check if we can use our own process cache in order to reduce network requests.
                                     * Otherwise, continue with the one from the servers.
                                     * 
                                     */

                                    let datePath = dateTime.getUTCFullYear() + "/" + utilities.pad(dateTime.getUTCMonth() + 1, 2) + "/" + utilities.pad(dateTime.getUTCDate(), 2);
                                    let cachePosition = n + '/' + datePath;
                                                                        
                                    if (dailyFileCache[cachePosition] !== undefined) {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> getDailyFile -> Getting the file from local cache."); }

                                        let cache = dailyFileCache[cachePosition];
                                        onDailyFileReceived(global.DEFAULT_OK_RESPONSE, cache);

                                    } else {
                                        let filePath = "AAMasters/AAOlivia.1.0/AACloud.1.1/Poloniex/dataSet.V1/Output/Candles/Multi-Period-Daily/" + folderName + "/" + datePath;
                                        let fileName = market.assetA + '_' + market.assetB + ".json"

                                        oliviaStorage.getTextFile(filePath, fileName, onFileReceived);
                                    }

                                    function onFileReceived(err, text) {
                                        if (err.result === global.DEFAULT_OK_RESPONSE.result) {
                                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> getDailyFile -> onFileReceived > Entering Function."); }

                                            let candleFile = JSON.parse(text);
                                            
                                            dailyFileCache[cachePosition] = candleFile;
                                            onDailyFileReceived(global.DEFAULT_OK_RESPONSE, candleFile);
                                        } else {
                                            logger.write(MODULE_NAME, "[ERROR] start -> getLRCPoints -> getDailyFile -> onFileReceived -> Failed to get the file. Will abort the process and request a retry.");
                                            callBackFunction(global.DEFAULT_RETRY_RESPONSE);
                                        }
                                    }
                                } catch (err) {
                                    logger.write(MODULE_NAME, "[ERROR] start -> getLRCPoints -> getDailyFile -> err = " + err.message);
                                    callBackFunction(global.DEFAULT_RETRY_RESPONSE);
                                }
                            }

                            function performLRCCalculations(candleArray) {

                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> performLRCCalculations -> Entering function."); }

                                /*
                                * It's needed to order since it's possible that we need to get another file and it will put an older candle at the end of the array.
                                */
                                candleArray.sort(function (a, b) {
                                    return a.begin - b.begin;
                                });

                                if (USE_PARTIAL_LAST_CANDLE === false) candleArray = candleArray.slice(0, candleArray.length - 1);

                                let lrcPoints = [];
                                lrcPoints.push(0); //firstCandleBeginTime               0
                                lrcPoints.push(0); //firstCandleEndTime                 1
                                lrcPoints.push(0); //minimumPointValue                  2
                                lrcPoints.push(0); //middlePointValue                   3
                                lrcPoints.push(0); //maximumPointValue                  4

                                if (LOG_FILE_CONTENT === true)
                                    lrcPoints.push(candleArray); //Entire candle array  5

                                calculateLRC(candleArray, lrcPoints);

                                let lastCandle = candleArray[0];
                                let firstCandle = candleArray[candleArray.length - 1];
                                lrcPoints[0] = firstCandle.begin;
                                lrcPoints[1] = firstCandle.end;

                                if (LOG_FILE_CONTENT === true) {
                                    logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> performLRCCalculations -> LRC Points calculation results: " + JSON.stringify(lrcPoints));
                                }

                                return lrcPoints;
                            }

                            function calculateLRC(candlesArray, lrcPoints) {

                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getLRCPoints -> calculateLRC -> Entering function."); }

                                let lrcMinIndicator = new LRCIndicator(15);
                                let lrcMidIndicator = new LRCIndicator(30);
                                let lrcMaxIndicator = new LRCIndicator(60);

                                for (let i = 0; i < candlesArray.length; i++) {
                                    let tempCandle = candlesArray[i];
                                    let averagePrice = (tempCandle.min + tempCandle.max + tempCandle.open + tempCandle.close) / 4;

                                    lrcMinIndicator.update(averagePrice);
                                    lrcMidIndicator.update(averagePrice);
                                    lrcMaxIndicator.update(averagePrice);
                                }

                                /*
                                * Only if there is enough history the result will be calculated
                                */
                                if (lrcMinIndicator.result != false && lrcMidIndicator.result != false && lrcMaxIndicator.result != false) {
                                    lrcPoints[2] = lrcMinIndicator.result;
                                    lrcPoints[3] = lrcMidIndicator.result;
                                    lrcPoints[4] = lrcMaxIndicator.result;

                                    return lrcPoints;
                                } else {
                                    logger.write(MODULE_NAME, "[ERROR] start -> getLRCPoints -> calculateLRC -> There is not enough history to calculate the LRC.");
                                }
                            }

                            function savePoint(lrcPoint) {

                                try {

                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> Entering function."); }

                                    /**
                                     * Let's first check if we can use our own process cache in order to reduce network requests.
                                     * Otherwise, continue with the one from the servers.
                                     * 
                                     */
                                    let datePath = executionTime.getUTCFullYear() + "/" + utilities.pad(executionTime.getUTCMonth() + 1, 2) + "/" + utilities.pad(executionTime.getUTCDate(), 2);
                                    let filePath = bot.filePathRoot + "/Output/LRC-Points/Multi-Period-Daily/" + folderName + "/" + datePath;
                                    let fileName = market.assetA + '_' + market.assetB + ".json"

                                    let cachePosition = n + '/' + datePath;

                                    if (lrcPointsFileCache[cachePosition] === undefined) {
                                        lrcPointsFileCache[cachePosition] = [];
                                    }
                                    
                                    lrcPointsFileCache[cachePosition].push(lrcPoint);                                    

                                    lastCandles[n] = lrcPoint[0];

                                    let timeToValidate = new Date(executionTime.valueOf() + outputPeriod);
                                    if (isPeriodOnHeadOfMarket(timeToValidate)) {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> getCurrentContent -> file = " + fileName + filePath); }
                                        
                                        gaussStorage.getTextFile(filePath, fileName, onFileRetrieved);
                                    } else {
                                        // Move to the next period without writing report
                                        setTimeout(function() { controlLoop(); }, 0);
                                    }

                                    function onFileRetrieved(err, text) {

                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> onFileRetrieved -> Entering function."); }

                                        if (err.result !== global.DEFAULT_OK_RESPONSE.result) {

                                            if (err.message === "File does not exist.") {
                                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> onFileRetrieved -> Daily file does not exist, creating folders."); }

                                                createFile();
                                                return;
                                            } else {
                                                logger.write(MODULE_NAME, "[ERROR] start -> savePoint -> onFileRetrieved -> err = " + err.message);
                                                callBackFunction(err);
                                                return;
                                            }
                                        }

                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> onFileRetrieved -> Daily file exist, appending content."); }

                                        let existingFileContent = JSON.parse(text);
                                        let finalContent = appendLRCPoints(existingFileContent);
                                        appendToFile(finalContent);
                                    }

                                    function createFile() {

                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> createFile -> Entering function."); }

                                        let fileContent = JSON.stringify(lrcPointsFileCache[cachePosition]);

                                        gaussStorage.createTextFile(filePath, fileName, fileContent, onFileCreated);

                                        function onFileCreated(err) {

                                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> onFileCreated -> Entering function."); }

                                            if (err.result !== global.DEFAULT_OK_RESPONSE.result) {
                                                logger.write(MODULE_NAME, "[ERROR] start -> savePoint -> onFileCreated -> err = " + err.message);
                                                callBackFunction(err);
                                                return;
                                            }

                                            if (LOG_FILE_CONTENT === true) {
                                                logger.write(MODULE_NAME, "[INFO] start -> savePoint -> onFileCreated ->  Content written = " + JSON.stringify(fileContent));
                                            }

                                            saveCleanAndMoveForward();
                                        }
                                    }

                                    function appendToFile(fileContent) {

                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> appendToFile -> Entering function."); }

                                        gaussStorage.createTextFile(filePath, fileName, JSON.stringify(fileContent), onExistingFileUpdated);

                                        function onExistingFileUpdated(err) {

                                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> savePoint -> onExistingFileUpdated -> Entering function."); }

                                            if (err.result !== global.DEFAULT_OK_RESPONSE.result) {
                                                logger.write(MODULE_NAME, "[ERROR] start -> savePoint -> onExistingFileUpdated -> err = " + err.message);
                                                callBackFunction(err);
                                                return;
                                            }

                                            if (LOG_FILE_CONTENT === true) {
                                                logger.write(MODULE_NAME, "[INFO] start -> savePoint -> onExistingFileUpdated ->  Content written = " + JSON.stringify(fileContent));
                                            }

                                            saveCleanAndMoveForward();
                                        }
                                    }

                                    function appendLRCPoints(existingLRCPoints) {
                                        if (existingLRCPoints === undefined)
                                            return lrcPointsFileCache[cachePosition];

                                        for (i = 0; i < lrcPointsFileCache[cachePosition].length; i++) {
                                            let lrcPoint = lrcPointsFileCache[cachePosition][i];
                                            let lastCandleOnFile = existingLRCPoints[existingLRCPoints.length - 1];

                                            if (lastCandleOnFile[0] < lrcPoint[0]) {
                                                existingLRCPoints.push(lrcPoint);
                                            } else {
                                                logger.write(MODULE_NAME, "[WARN] start -> savePoint -> appendLRCPoints -> The LCR Point calculated existed on the file storage, not saving: " + JSON.stringify(lrcPoint));
                                            }
                                        }
                                        return existingLRCPoints;
                                    }

                                    function saveCleanAndMoveForward() {
                                        writeReport = true;
                                        cleanUpCache(lrcPointsFileCache, executionTime);
                                        cleanUpCache(dailyFileCache, executionTime);
                                        controlLoop();
                                    }

                                    function cleanUpCache(fileCache, dateTime) {
                                        let date = new Date(dateTime);
                                        let datePath = date.getUTCFullYear() + "/" + utilities.pad(date.getUTCMonth() + 1, 2) + "/" + utilities.pad(date.getUTCDate(), 2);
                                        let cachePosition = n + '/' + datePath;

                                        // Remove and go back one day
                                        if (fileCache[cachePosition] !== undefined) {
                                            fileCache[cachePosition] = undefined;
                                            date.setDate(date.getDate() - 1);
                                            cleanUpCache(fileCache, date);
                                        }
                                    }

                                } catch (err) {
                                    logger.write(MODULE_NAME, "[ERROR] start -> savePoint -> err = " + err.message);
                                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                                }
                            }
                        }

                        function isPeriodOnHeadOfMarket(timeToValidate) {
                            let candleBeginIndex = 4;
                            let lastDayIndex = n + '/' + executionTime.getUTCFullYear() + "/" + utilities.pad(executionTime.getUTCMonth() + 1, 2) + "/" + utilities.pad(executionTime.getUTCDate(), 2);

                            if (dailyFileCache[lastDayIndex] === undefined) {
                                return false;
                            }

                            let lastCandlePeriodOnCache = dailyFileCache[lastDayIndex][dailyFileCache[lastDayIndex].length - 1][candleBeginIndex];

                            if (FULL_LOG === true) {
                                logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> savePoint -> Execution: " + new Date(timeToValidate).toISOString() + ". lastCandlePeriodOnCache: " + new Date(lastCandlePeriodOnCache).toISOString() + ". lastDayIndex: " + lastDayIndex);
                            }

                            if (timeToValidate >= lastCandlePeriodOnCache) {
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> savePoint -> Head of the market found @ " + new Date(lastCandlePeriodOnCache).toISOString()); }
                                
                                return true;
                            } else {
                                return false;
                            }
                        }
                    }

                    function controlLoop() {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> periodsLoop -> controlLoop -> Entering function."); }

                        n++;

                        if (n < global.dailyFilePeriods.length) {

                            loopBody();

                        } else {

                            if (writeReport) {
                                writeReport = false;
                                let lastOneMinuteCandle = lastCandles[10];
                                writeDataRange(lastOneMinuteCandle, onWritten);

                                function onWritten(err) {

                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> buildLRCPoints -> periodsLoop -> controlLoop -> onWritten -> Entering function."); }

                                    if (err.result !== global.DEFAULT_OK_RESPONSE.result) {
                                        logger.write(MODULE_NAME, "[ERROR] writeDataRanges -> writeDataRanges -> onWritten -> err = " + err.message);
                                        callBack(err);
                                        return;
                                    }

                                    writeStatusReport(advanceTime);
                                }
                            } else {
                                advanceTime();
                            }
                        }
                    }
                }
            }
            
            function writeDataRange(lastOneMinuteCandle, callBack) {

                try {

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> writeDataRange -> Entering function."); }

                    let dataRange = {
                        begin: 1522540800000,//TODO: 1424373300000,
                        end: lastOneMinuteCandle.valueOf()
                    };

                    let fileContentDataRange = JSON.stringify(dataRange);

                    let fileName = 'Data.Range.' + market.assetA + '_' + market.assetB + '.json';
                    let filePath = bot.filePathRoot + "/Output/LRC-Points/" + bot.process;

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> writeDataRange -> fileName = " + fileName); }
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> writeDataRange -> filePath = " + filePath); }

                    utilities.createFolderIfNeeded(filePath, gaussStorage, onFolderCreated);

                    function onFolderCreated(err) {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> writeDataRange -> onFolderCreated -> Entering function."); }

                        if (err.result !== global.DEFAULT_OK_RESPONSE.result) {
                            logger.write(MODULE_NAME, "[ERROR] start -> writeDataRange -> onFolderCreated -> err = " + err.message);
                            callBack(err);
                            return;
                        }

                        gaussStorage.createTextFile(filePath, fileName, fileContentDataRange + '\n', onFileCreated);

                        function onFileCreated(err) {

                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> writeDataRange -> onFolderCreated -> onFileCreated -> Entering function."); }

                            if (err.result !== global.DEFAULT_OK_RESPONSE.result) {
                                logger.write(MODULE_NAME, "[ERROR] start -> writeDataRange -> onFolderCreated -> onFileCreated -> err = " + err.message);
                                callBack(err);
                                return;
                            }

                            if (LOG_FILE_CONTENT === true) {
                                logger.write(MODULE_NAME, "[INFO] start -> writeDataRange -> onFolderCreated -> onFileCreated ->  Content written = " + fileContentDataRange);
                            }

                            callBack(global.DEFAULT_OK_RESPONSE);
                        }
                    }
                }
                catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] start -> writeDataRange -> err = " + err.message);
                    callBack(global.DEFAULT_FAIL_RESPONSE);
                }
            }

            function writeStatusReport(callBack) {

                try {

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> writeStatusReport -> Entering function."); }

                    let key = bot.devTeam + "-" + bot.codeName + "-" + bot.process + "-" + bot.dataSetVersion;

                    let statusReport = statusDependencies.statusReports.get(key);

                    statusReport.file.lastExecution = bot.processDatetime;
                    statusReport.file.lastCandles = lastCandles;
                    statusReport.save(callBack);

                } catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] start -> writeStatusReport -> err = " + err.message);
                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                }
            }

        } catch (err) {
            logger.write(MODULE_NAME, "[ERROR] start -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

};

const express = require('express');
const multer = require('multer');
const https = require('https');
const http = require('http');
const request = require('request');
const fs = require('fs');
const axios = require('axios');
const schedule = require('node-schedule');
const axiosRetry = require('axios-retry').default;
const { rimraf } = require('rimraf');
const path = require('path');

axiosRetry(axios, { retries: 3 });

// Define storage for uploaded files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './node_server/files/'); // Destination folder for uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); // Rename the file to include the timestamp
    },
});

// Initialize Multer with the storage configuration
const upload = multer({ storage: storage });

const app = express();

const { exec } = require('child_process');

app.use(express.json());
app.use(express.static(__dirname + '/static'));
app.use('/files', express.static('./node_server/files/'));

function downloadFile(fileName, fileUrl, callback) {
    if (fileUrl.startsWith('http') == false && fileUrl.startsWith('https') == false) {
        callback(false);
        return;
    }

    const proto = !fileUrl.charAt(4).localeCompare('s') ? https : http;

    try {
        const file = fs.createWriteStream("node_server/files/" + fileName);
        proto.get(fileUrl, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log('File downloaded successfully: ' + fileName);
                    callback(true);
                });
            });
        }).on('error', (err) => {
            fs.unlink(destination, () => {
                console.error('Error downloading file ' + fileName + ' : ', err);
                callback(false);
            });
        });
    }
    catch (err) {
        console.log("Download error: " + err);
        callback(false);
    }
}

function startProcess(req) {
    const sourceFileUrl = req.body.sourceFileUrl;
    const sourceFileName = req.body.sourceFileName;

    const targetFileUrl = req.body.targetFileUrl;
    const targetFileName = req.body.targetFileName;

    const outputFileName = req.body.outputFileName;
    const webhook = req.body.webhook;
    const outputAWSFileUrl = req.body.outputAWSFileUrl;

    function runCommand() {
        const command = 'python run.py --source \'node_server/files/' + sourceFileName
            + '\' --target \'node_server/files/' + targetFileName
            + '\' --output \'node_server/files/' + outputFileName + '\' --headless --frame-processors face_swapper face_enhancer --execution-providers cuda --execution-thread-count 128 --execution-queue-count 32';
        console.log(command);
        exec(command, (err, stdout, stderr) => {
            if (err) {
                console.log(err);
            } else {
                console.log('success process ouptputfile : ' + outputFileName);
            }

            console.log('process logs : ' + stdout + stderr);

            const isSuccess = (stdout + stderr).includes('Processing to video succeed') || (stdout + stderr).includes('Processing to image succeed')

            function callWebHook(success) {
                axios.post(webhook, {
                    isSuccess: success,
                    outputFileName,
                    stdout: stdout.slice(-5000),
                    stderr: stderr.slice(-5000),
                    usedSignedURL: true
                })
                    .then((res) => {
                        console.log(`Status: ${res.status}`);
                        console.log('Body: ', res.data);
                    }).catch((err) => {
                        console.error(err);
                    });
            }

            if (isSuccess == true) {

                const outputFilePath = './node_server/files/' + outputFileName;
                const options = {
                    uri: outputAWSFileUrl,
                    body: fs.createReadStream(outputFilePath),
                    headers: {
                        'content-length': fs.statSync(outputFilePath).size,
                        'content-type': 'application/octet-stream',
                    }
                };

                console.log("Uploading aws...");
                request.put(options, (error, response, body) => {
                    if (error) {
                        callWebHook(false);
                        console.log('Uploading aws failed: ', error);
                        return;
                    }
                    console.log("ploading aws finished with status code: " + response.statusCode);
                    callWebHook(response.statusCode == 200);
                });
            } else {
                callWebHook(isSuccess);
            }
        });
    }

    downloadFile(sourceFileName, sourceFileUrl, (isSuccessForSource) => {
        if (!isSuccessForSource) {
            console.log("sourceFile not downloaded!: URL: ", sourceFileUrl)
            axios.post(webhook, {
                isSuccess: false,
                stderr: "sourceFile not downloaded"
            })
                .then((res) => {
                    console.log(`Status: ${res.status}`);
                    console.log('Body: ', res.data);
                }).catch((err) => {
                    console.error(err);
                });
            return;
        }
        downloadFile(targetFileName, targetFileUrl, (isSuccessForTarget) => {
            if (!isSuccessForTarget) {
                console.log("targetFile not downloaded!: URL: ", targetFileUrl)
                axios.post(webhook, {
                    isSuccess: false,
                    stderr: "targetFile not downloaded"
                })
                    .then((res) => {
                        console.log(`Status: ${res.status}`);
                        console.log('Body: ', res.data);
                    }).catch((err) => {
                        console.error(err);
                    });
                return;
            }
            runCommand();
        });
    });
}

app.post('/startProcess', (req, res, next) => {
    res.on('finish', () => {
        console.log('Response has been sent!')
        startProcess(req);
    })
    res.status(200).json({
        ok: true
    });
});

// Add a health check route in express
app.get('/health', (req, res) => {
    res.status(200).send('ok')
})

const job = schedule.scheduleJob('*/10 * * * *', function () {
    console.log("files removing...");
    var uploadsDir = './node_server/files';
    fs.readdir(uploadsDir, function (err, files) {
        files.forEach(function (file, index) {
            fs.stat(path.join(uploadsDir, file), function (err, stat) {
                var endTime, now;
                if (err) {
                    return console.error(err);
                }
                now = new Date().getTime();
                endTime = new Date(stat.ctime).getTime() + 600000;
                if (now > endTime) {
                    return rimraf(path.join(uploadsDir, file))
                        .then(file => { })
                        .catch(err => { });
                }
            });
        });
    });
});

const jobForTemp = schedule.scheduleJob('*/2 * * * *', function () {
    console.log("temp files removing...");
    var tempDir = '../../tmp';
    fs.readdir(tempDir, function (err, files) {
        if (err) {
            console.log("temp files reading is failed: " + err);
            return;
        }
        files.forEach(function (file, index) {
            fs.stat(path.join(tempDir, file), function (err, stat) {
                var endTime, now;
                if (err) {
                    return console.error("temp files removing is failed: " + err);
                }
                now = new Date().getTime();
                endTime = new Date(stat.ctime).getTime() + 300000;
                if (now > endTime) {
                    return rimraf(path.join(tempDir, file))
                        .then(file => { })
                        .catch(err => { });
                }
            });
        });
    });
});

app.listen(7860, () => console.log('Listening on port 7860'));

const gracefulShutdown = () => {
    schedule.gracefulShutdown();
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGUSR2', gracefulShutdown); // Sent by nodemon
process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});
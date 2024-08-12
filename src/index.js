const express = require('express');
const multer = require('multer');
const https = require('https');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

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

            axios.post(webhook, {
                isSuccess: (stdout + stderr).includes('Processing to video succeed'),
                outputFileName,
                stdout: stdout.slice(-5000),
                stderr: stderr.slice(-5000)
            })
                .then((res) => {
                    console.log(`Status: ${res.status}`);
                    console.log('Body: ', res.data);
                }).catch((err) => {
                    console.error(err);
                });

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

app.listen(7860, () => console.log('Listening on port 7860'));

const gracefulShutdown = () => {
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGUSR2', gracefulShutdown); // Sent by nodemon
process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});
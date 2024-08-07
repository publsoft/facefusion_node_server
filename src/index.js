const express = require('express');
const multer = require('multer');
const https = require('https');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Define storage for uploaded files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './node_server/uploads/'); // Destination folder for uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname); // Rename the file to include the timestamp
    },
});

// Initialize Multer with the storage configuration
const upload = multer({ storage: storage });

const app = express();

const { exec } = require('child_process');

app.use(express.json());
app.use(express.static(__dirname + '/static'));

function downloadFile(fileName, fileUrl, callback) {
    const file = fs.createWriteStream("node_server/uploads/" + fileName);
    https.get(fileUrl, (response) => {
        response.pipe(file);
        file.on('finish', () => {
            file.close(() => {
                console.log('File downloaded successfully');
                callback(true);
            });
        });
    }).on('error', (err) => {
        fs.unlink(destination, () => {
            console.error('Error downloading file:', err);
            callback(false);
        });
    });
}

function startProcess(req) {
    const sourceFileUrl = req.body.sourceFileUrl;
    const sourceFileName = req.body.sourceFileName;

    const targetFileUrl = req.body.targetFileUrl;
    const targetFileName = req.body.targetFileName;

    const outputFileName = req.body.outputFileName;
    const webhook = req.body.webhook;

    function runCommand() {
        const command = 'python run.py --source \'node_server/uploads/' + sourceFileName
            + '\' --target \'node_server/uploads/' + targetFileName
            + '\' --output \'node_server/generated_videos/' + outputFileName + '\' --headless';
        exec(command, (err, stdout, stderr) => {
            console.log(command);
            if (err) {
                console.log(err);
                return;
            }

            console.log(`stdout: ${stdout}`);
            console.log(`stderr: ${stderr}`);
            if ((stdout + stderr).includes('Processing to video succeed')) {
                console.log(outputFileName);

                axios.post(webhook, {
                    outputFileName
                })
                    .then((res) => {
                        console.log(`Status: ${res.status}`);
                        console.log('Body: ', res.data);
                    }).catch((err) => {
                        console.error(err);
                    });
            }
        });
    }

    downloadFile(sourceFileName, sourceFileUrl, (isSuccessForSource) => {
        if (!isSuccessForSource) {
            return;
        }
        downloadFile(targetFileName, targetFileUrl, (isSuccessForTarget) => {
            if (!isSuccessForTarget) {
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

app.listen(7860, () => console.log('Listening on port 7860'));

const gracefulShutdown = () => {
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGUSR2', gracefulShutdown); // Sent by nodemon

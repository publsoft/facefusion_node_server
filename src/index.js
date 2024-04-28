const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// Define storage for uploaded files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './server_app/uploads/'); // Destination folder for uploaded files
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

app.post('/startProcess', (req, res) => {
    const sourceImageFile = req.body.sourceImageFile;
    const targetVideoFile = req.body.targetVideoFile;
    const outputFileName = uuidv4() + '.mp4';

    const command = 'python run.py --source \'server_app/uploads/' + sourceImageFile
        + '\' --target \'server_app/uploads/' + targetVideoFile
        + '\' --output \'server_app/generated_videos/' + outputFileName + '\' --headless';
    exec(command, (err, stdout, stderr) => {
            console.log(command);
            if (err) {
                res.status(400).json({
                    error: err
                })
                return;
            }

            console.log(`stdout: ${stdout}`);
            console.log(`stderr: ${stderr}`);
            if ((stdout + stderr).includes('Processing to video succeed')) {
                res.status(200).json({
                    outputFileName: outputFileName
                });
            }
        });
});

app.post('/upload', upload.single('file'), (req, res) => {
    console.log(req.file, req.body.name)
    res.status(200).json({
        fileName: req.file.filename
    });
});

app.listen(7860, () => console.log('Listening on port 7860'));

const gracefulShutdown = () => {
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGUSR2', gracefulShutdown); // Sent by nodemon

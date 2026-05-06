const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');

const imagePath = process.argv[2];

if (!imagePath) {
    process.exit(1);
}

Tesseract.recognize(
    imagePath,
    'eng',
    { logger: m => console.error(m) }
).then(({ data: { text } }) => {
    console.log(text);
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});

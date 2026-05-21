const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false, // Keep window hidden
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const htmlPath = path.join(__dirname, '../dist/index.html');
  await win.loadFile(htmlPath);

  // Wait for rendering
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Capture page
  const image = await win.webContents.capturePage();
  const buffer = image.toPNG();

  const destPath = 'C:\\Users\\lzh\\.gemini\\antigravity\\brain\\b71fa328-47fe-41af-845e-c3723f02236a\\media_check_brand.png';
  fs.writeFileSync(destPath, buffer);
  console.log('Screenshot captured successfully to:', destPath);

  app.quit();
});

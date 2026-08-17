const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'ani-cli', 'ani-cli');
const isWindows = process.platform === 'win32';

function commandExists(command) {
  if (path.isAbsolute(command)) return fs.existsSync(command);
  try {
    execFileSync(isWindows ? 'where.exe' : 'sh', isWindows ? [command] : ['-lc', `command -v '${command.replaceAll("'", "'\\''")}'`], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

const report = {
  platform: process.platform,
  bundledAniCli: fs.existsSync(script),
  browserNetwork: true,
  ffmpeg: commandExists('ffmpeg'),
  ytDlp: commandExists('yt-dlp'),
};

console.log(JSON.stringify(report, null, 2));
if (!report.bundledAniCli) process.exitCode = 1;

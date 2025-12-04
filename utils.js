import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module에서 __dirname/__filename 흉내 내기
export const getDirname = (importMetaUrl) => path.dirname(fileURLToPath(importMetaUrl));
export const getFilename = (importMetaUrl) => fileURLToPath(importMetaUrl);


export function runCommand(cmd) {
  // console.log("CMD >>", cmd);
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ 명령 실행 중 오류:', error.message);
        console.error(stderr);
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function checkDependency(command, installHint) {
  try {
    await runCommand(`${command} --help`); 
    return true;
  } catch (e) {
    console.error(`\n❌ 필수 도구 '${command}'가 설치되지 않았거나 PATH에 없습니다.`);
    if (installHint) console.error(`💡 설치 방법: ${installHint}\n`);
    return false;
  }
}

// -----------------------------
// Platform-aware helpers
// -----------------------------

export function buildRecordCommand(outputFile, silenceEffect, maxRecDuration) {
  if (process.platform === 'win32') {
    return `sox --buffer 8192 -q -c 1 -r 48000 -b 16 -t waveaudio -d "${outputFile}" rate -v 16000 ${silenceEffect} trim 0 ${maxRecDuration}`;
  }
  return `rec --buffer 8192 -q -c 1 -r 48000 -b 16 "${outputFile}" rate -v 16000 ${silenceEffect} trim 0 ${maxRecDuration}`;
}

export function buildPlaybackCommand(filePath) {
  if (process.platform === 'win32') {
    return `sox --buffer 1024 "${filePath}" -t waveaudio`;
  }
  return `afplay "${filePath}"`;
}

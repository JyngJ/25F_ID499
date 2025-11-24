import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module에서 __dirname/__filename 흉내 내기
export const getDirname = (importMetaUrl) => path.dirname(fileURLToPath(importMetaUrl));
export const getFilename = (importMetaUrl) => fileURLToPath(importMetaUrl);


export function runCommand(cmd) {
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

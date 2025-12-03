#!/bin/bash

# 1. 포트 자동 감지 (macOS 기준)
if [ -n "$1" ]; then
  PORT=$1
else
  PORT=$(ls /dev/tty.usbmodem* 2>/dev/null | head -n 1)
fi

if [ -z "$PORT" ]; then
  echo "❌ Error: 아두이노를 찾을 수 없습니다."
  echo "   USB 연결을 확인하거나, 포트 경로를 직접 입력해주세요."
  echo "   사용법: ./flash_pixel.sh /dev/tty.usbmodem1234"
  exit 1
fi

echo "✅ Found Arduino at: $PORT"
echo "🚀 Flashing 'Node-Pixel Firmware'..."

# 2. 펌웨어 업로드 실행
echo "Trying to install 'node-pixel' from registry..."
npx interchange install node-pixel -a uno -p $PORT

if [ $? -ne 0 ]; then
  echo "⚠️ Registry install failed. Trying git URL..."
  npx interchange install git+https://github.com/ajfisher/node-pixel -a uno -p $PORT
fi

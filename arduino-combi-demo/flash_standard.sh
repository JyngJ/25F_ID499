#!/bin/bash

# 1. 포트 자동 감지 (macOS 기준)
# 첫 번째 인자($1)가 있으면 그것을 포트로 사용, 없으면 자동 검색
if [ -n "$1" ]; then
  PORT=$1
else
  PORT=$(ls /dev/tty.usbmodem* 2>/dev/null | head -n 1)
fi

if [ -z "$PORT" ]; then
  echo "❌ Error: 아두이노를 찾을 수 없습니다."
  echo "   USB 연결을 확인하거나, 포트 경로를 직접 입력해주세요."
  echo "   사용법: ./flash_standard.sh /dev/tty.usbmodem1234"
  exit 1
fi

echo "✅ Found Arduino at: $PORT"
echo "🚀 Flashing 'StandardFirmata' (Basic)..."

# 2. 펌웨어 업로드 실행
npx interchange install StandardFirmata -a uno -p $PORT

#!/usr/bin/env bash
# 파일을 고친 뒤 실행하세요: 브라우저가 예전 파일(캐시)을 쓰지 않고 새 파일을 받게 됩니다.
# index.html / app.js / backend.js 안의 "?v=..." 를 현재 시각으로 바꿉니다.
set -euo pipefail
cd "$(dirname "$0")"
v=$(date +%Y%m%d%H%M)
sed -i -E "s/\?v=[0-9A-Za-z]+/?v=$v/g" index.html app.js backend.js
echo "버전: $v"

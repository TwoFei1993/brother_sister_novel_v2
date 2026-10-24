#!/usr/bin/env bash
# 安卓壳构建脚本（Capacitor）：APK 构建需要 JDK 17 + Android SDK（本机未装时只做 init/sync）
#
# 用法：
#   bash scripts/mobile.sh sync  [服务URL]   # 可选：写 server.url 后同步 WebView 配置
#   bash scripts/mobile.sh apk             # 构建调试 APK（需工具链；产物 android/app/build/outputs/apk/debug/）
#
# 服务地址注入：CAP_SERVER_URL 环境变量 → capacitor.config.ts 构建期读取。
set -euo pipefail
cd "$(dirname "$0")/../mobile"

cmd="${1:-sync}"
case "$cmd" in
  sync)
    if [ $# -ge 2 ]; then
      export CAP_SERVER_URL="$2"
      echo "server.url = $CAP_SERVER_URL"
    fi
    pnpm exec cap sync android
    echo "✅ WebView 配置已同步。构建 APK：bash scripts/mobile.sh apk"
    ;;
  apk)
    # JDK21 优先（Capacitor 7 需要 Java 21），退回 JDK17
    JDK21=$(ls -d "$LOCALAPPDATA/java"/jdk-21* 2>/dev/null | head -1)
    JDK17=$(ls -d "$LOCALAPPDATA/java"/jdk-17* 2>/dev/null | head -1)
    export JAVA_HOME="${JAVA_HOME:-${JDK21:-$JDK17}}"
    [ -n "$JAVA_HOME" ] || { echo '未找到 JDK：请安装到 %LOCALAPPDATA%/java/ 或设置 JAVA_HOME'; exit 1; }
    echo "JAVA_HOME=$JAVA_HOME"
    cd android
    ./gradlew assembleDebug --no-daemon
    echo "✅ APK：android/app/build/outputs/apk/debug/app-debug.apk"
    ;;
  *)
    echo "用法：bash scripts/mobile.sh [sync|apk]"; exit 1 ;;
esac

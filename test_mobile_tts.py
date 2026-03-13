from playwright.sync_api import sync_playwright
import json

def test_mobile_tts():
    with sync_playwright() as p:
        # 模拟 iPhone 14 Pro 浏览器
        iphone_14_pro = {
            "name": "iPhone 14 Pro",
            "viewport": {"width": 393, "height": 852},
            "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            "device_scale_factor": 3,
            "is_mobile": True,
            "has_touch": True
        }

        browser = p.chromium.launch(headless=True)
        context = browser.new_context(**iphone_14_pro)
        page = context.new_page()

        # 捕获控制台日志
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[ERROR] {err}"))

        print("=" * 60)
        print("测试手机端 (iPhone 14 Pro) TTS 功能")
        print("=" * 60)

        # 1. 访问页面
        print("\n[1] 访问页面...")
        page.goto('http://localhost:8081')
        page.wait_for_load_state('networkidle')
        print(f"    页面标题: {page.title()}")
        print(f"    URL: {page.url}")

        # 2. 检查页面上的读书按钮
        print("\n[2] 查找读书/朗读按钮...")
        # 尝试多种可能的按钮选择器
        button_selectors = [
            "button:has-text('读')",
            "button:has-text('朗')",
            "button:has-text('播放')",
            "[aria-label*='读']",
            "[aria-label*='朗']",
            "[aria-label*='播放']",
            ".tts-button",
            "[data-testid='tts']"
        ]

        tts_button = None
        for selector in button_selectors:
            try:
                btn = page.locator(selector).first
                if btn.count() > 0:
                    tts_button = btn
                    print(f"    找到按钮: {selector}")
                    break
            except:
                pass

        if not tts_button:
            print("    未找到明显的读书按钮，尝试查找所有按钮...")
            buttons = page.locator("button").all()
            print(f"    页面共有 {len(buttons)} 个按钮")
            for i, btn in enumerate(buttons[:10]):
                try:
                    text = btn.text_content()
                    print(f"    按钮 {i}: {text[:50] if text else '(无文本)'}")
                except:
                    pass

        # 3. 检查 Web Speech API 可用性
        print("\n[3] 检查 Web Speech API 可用性...")
        speech_check = page.evaluate("""
            () => {
                const result = {
                    speechSynthesisExists: typeof speechSynthesis !== 'undefined',
                    speechSynthesisUtteranceExists: typeof SpeechSynthesisUtterance !== 'undefined',
                    getVoicesFn: typeof speechSynthesis?.getVoices === 'function',
                    voices: [],
                    errors: []
                };

                if (result.speechSynthesisExists) {
                    try {
                        const voices = speechSynthesis.getVoices();
                        result.voices = voices.map(v => ({
                            name: v.name,
                            lang: v.lang,
                            default: v.default
                        }));
                    } catch(e) {
                        result.errors.push('getVoices: ' + e.message);
                    }
                }

                return result;
            }
        """)

        print(f"    speechSynthesis 存在: {speech_check['speechSynthesisExists']}")
        print(f"    SpeechSynthesisUtterance 存在: {speech_check['speechSynthesisUtteranceExists']}")
        print(f"    getVoices 函数可用: {speech_check['getVoicesFn']}")
        print(f"    可用语音数量: {len(speech_check['voices'])}")

        if speech_check['voices']:
            print("    可用语音列表:")
            for voice in speech_check['voices'][:10]:
                print(f"      - {voice['name']} ({voice['lang']})")

        if speech_check['errors']:
            print(f"    错误: {speech_check['errors']}")

        # 4. 尝试在手机端播放测试
        print("\n[4] 尝试播放测试...")
        play_result = page.evaluate("""
            () => {
                return new Promise((resolve) => {
                    if (typeof speechSynthesis === 'undefined') {
                        resolve({ error: 'speechSynthesis not available' });
                        return;
                    }

                    // 取消任何正在进行的播放
                    speechSynthesis.cancel();

                    // 创建一个测试 utterance
                    const utterance = new SpeechSynthesisUtterance('测试语音');
                    utterance.lang = 'zh-CN';
                    utterance.rate = 1;

                    // 检查可用的中文语音
                    const voices = speechSynthesis.getVoices();
                    const chineseVoice = voices.find(v => v.lang.startsWith('zh'));
                    if (chineseVoice) {
                        utterance.voice = chineseVoice;
                    }

                    utterance.onstart = () => {
                        resolve({ status: 'started', voice: chineseVoice?.name || 'default' });
                    };

                    utterance.onerror = (event) => {
                        resolve({ status: 'error', error: event.error, message: event.message });
                    };

                    utterance.onend = () => {
                        resolve({ status: 'ended' });
                    };

                    // 尝试播放
                    try {
                        speechSynthesis.speak(utterance);
                        // 在移动端，可能需要等待一下
                        setTimeout(() => {
                            if (speechSynthesis.speaking) {
                                speechSynthesis.cancel();
                                resolve({ status: 'playing', note: 'started but cancelled for test' });
                            }
                        }, 1000);
                    } catch(e) {
                        resolve({ status: 'exception', error: e.message });
                    }
                });
            }
        """)

        print(f"    播放结果: {json.dumps(play_result, ensure_ascii=False, indent=4)}")

        # 5. 检查控制台日志中是否有 TTS 相关日志
        print("\n[5] 控制台日志 (TTS相关)...")
        tts_logs = [log for log in console_logs if 'TTS' in log or 'speech' in log.lower() or '语音' in log]
        if tts_logs:
            for log in tts_logs:
                print(f"    {log}")
        else:
            print("    没有 TTS 相关日志")

        # 6. 总结
        print("\n" + "=" * 60)
        print("测试总结")
        print("=" * 60)

        issues = []
        if not speech_check['speechSynthesisExists']:
            issues.append("❌ speechSynthesis API 不存在")
        if not speech_check['speechSynthesisUtteranceExists']:
            issues.append("❌ SpeechSynthesisUtterance 不存在")
        if len(speech_check['voices']) == 0:
            issues.append("⚠️  没有可用语音 (移动端常见问题)")
        if 'error' in play_result:
            issues.append(f"❌ 播放失败: {play_result.get('error')}")

        if issues:
            print("发现以下问题:")
            for issue in issues:
                print(f"  {issue}")
        else:
            print("✅ TTS 功能在手机端可以正常使用")

        print("\n" + "=" * 60)

        # 截图保存
        page.screenshot(path='mobile_tts_test.png', full_page=True)
        print("截图已保存: mobile_tts_test.png")

        browser.close()

if __name__ == "__main__":
    test_mobile_tts()

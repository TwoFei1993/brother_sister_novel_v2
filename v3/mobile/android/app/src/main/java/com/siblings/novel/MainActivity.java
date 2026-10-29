package com.siblings.novel;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 反馈①：右滑返回手势/返回键 = WebView 退一级历史（配合 manifest 的 enableOnBackInvokedCallback，
        // Android 13+ 预测式返回也走这里）；首页无可退历史时才退出应用（原为直接退回桌面）。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                Bridge bridge = getBridge();
                if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                } else {
                    finish();
                }
            }
        });
    }
}

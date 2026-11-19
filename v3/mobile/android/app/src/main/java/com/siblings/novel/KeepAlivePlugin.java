package com.siblings.novel;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 听书保活桥（JS → 原生前台服务）：
 * start = 启动 MEDIA_PLAYBACK 前台服务（听书播放期间系统不冻结应用，熄屏续播）；
 * stop = 结束前台服务。
 */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        ContextCompat.startForegroundService(
                getContext(), new Intent(getContext(), TtsKeepAliveService.class));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TtsKeepAliveService.class));
        call.resolve();
    }
}

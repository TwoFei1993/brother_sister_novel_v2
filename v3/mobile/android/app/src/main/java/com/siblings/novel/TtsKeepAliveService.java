package com.siblings.novel;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * 听书保活前台服务（用户需求：熄屏后听书不再停止）：
 *
 * - TTS 播放期间由 JS 经 KeepAlive 插件启动——前台服务让系统（含国产 ROM 的
 *   省电冻结策略）把本应用视为「正在播放媒体」而放宽后台限制，WebView 的
 *   JS 定时器/网络请求在熄屏后仍可运行（段间衔接不断）。
 * - 常驻低优先级通知（安卓规范要求）：「听书播放中」+ 可点回应用。
 * - 暂停/停止时 JS 调 stop() 结束服务。
 */
public class TtsKeepAliveService extends Service {
    private static final String CHANNEL_ID = "tts_keepalive";
    private static final int NOTIFICATION_ID = 20261;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // API 29+ 必须声明前台服务类型（manifest 已配 mediaPlayback）
            startForeground(NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return android.app.Service.START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification() {
        androidx.core.app.NotificationCompat.Builder builder =
                new androidx.core.app.NotificationCompat.Builder(this, CHANNEL_ID)
                        .setContentTitle("听书播放中")
                        .setSmallIcon(android.R.drawable.ic_media_play)
                        .setOngoing(true)
                        .setPriority(androidx.core.app.NotificationCompat.PRIORITY_LOW)
                        .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC);
        // 点通知回到应用
        android.content.Intent back = getPackageManager()
                .getLaunchIntentForPackage(getPackageName());
        if (back != null) {
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(
                    this, 0, back,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            builder.setContentIntent(pi);
        }
        return builder.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "听书播放", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("听书播放期间的常驻通知（保证熄屏续播）");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }
}

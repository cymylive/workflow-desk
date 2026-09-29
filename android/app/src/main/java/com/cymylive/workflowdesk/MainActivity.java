package com.cymylive.workflowdesk;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * 直接给 WebView 设置 padding，让它避开状态栏和导航栏。
 *
 * 背景：Android 16+ 对所有应用强制 edge-to-edge（不管 targetSdk），
 * WebView 会画到状态栏下面；CSS env(safe-area-inset-*) 在 Android WebView
 * 里不可用，Capacitor 的 SystemBars 插件也不够可靠。
 *
 * 用 Android 原生 WindowInsets API 给 WebView 物理区域加 padding，
 * WebView 内容区就从状态栏下方开始。不需要前端任何配合，最可靠。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "WorkflowDesk";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyInsetsWithRetry(0);
    }

    private void applyInsetsWithRetry(final int attempt) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;

        if (webView == null) {
            if (attempt < 15) {
                Log.d(TAG, "WebView not ready, retry #" + attempt);
                new Handler(Looper.getMainLooper()).postDelayed(
                    () -> applyInsetsWithRetry(attempt + 1), 200);
            } else {
                Log.w(TAG, "WebView still null after 15 retries, giving up");
            }
            return;
        }

        Log.d(TAG, "WebView found at attempt #" + attempt + ", applying insets listener");

        final int fallbackTop = getSystemDimen("status_bar_height", 24);
        final int fallbackBottom = getSystemDimen("navigation_bar_height", 48);
        final boolean[] insetsFired = { false };

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Log.d(TAG, "[insets] top=" + bars.top + " bottom=" + bars.bottom
                    + " left=" + bars.left + " right=" + bars.right);
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            insetsFired[0] = true;
            return WindowInsetsCompat.CONSUMED;
        });

        webView.requestApplyInsets();

        // 兜底：1 秒后 insets 还没来，用系统资源里的固定高度
        webView.postDelayed(() -> {
            if (!insetsFired[0]) {
                Log.w(TAG, "Insets listener not fired within 1s, using fallback: top="
                        + fallbackTop + " bottom=" + fallbackBottom);
                webView.setPadding(0, fallbackTop, 0, fallbackBottom);
            }
        }, 1000);
    }

    private int getSystemDimen(String name, int defaultDp) {
        int id = getResources().getIdentifier(name, "dimen", "android");
        if (id > 0) {
            int px = getResources().getDimensionPixelSize(id);
            if (px > 0) return px;
        }
        float density = getResources().getDisplayMetrics().density;
        return Math.round(defaultDp * density);
    }
}

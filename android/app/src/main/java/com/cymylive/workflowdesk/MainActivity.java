package com.cymylive.workflowdesk;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * 用 Android 原生 WindowInsets API 获取系统栏高度，
 * 通过 JS 注入 --safe-area-inset-* CSS 变量给前端。
 *
 * 不依赖 Capacitor 的 SystemBars / StatusBar 插件，
 * 避免插件未加载、版本检测失败、Android 版本差异等问题。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "WorkflowDesk";

    private int lastTop = -1, lastBottom = -1, lastLeft = -1, lastRight = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 让 WebView 铺满全屏（Android 15+ 默认已是 edge-to-edge，这里显式声明）
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        } catch (Throwable t) {
            Log.w(TAG, "setDecorFitsSystemWindows failed", t);
        }

        // 监听系统栏 insets 变化
        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (view, insets) -> {
            float density = getResources().getDisplayMetrics().density;

            int topPx = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout()
            ).top;
            int bottomPx = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            int leftPx = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            ).left;
            int rightPx = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            ).right;

            int top = Math.round(topPx / density);
            int bottom = Math.round(bottomPx / density);
            int left = Math.round(leftPx / density);
            int right = Math.round(rightPx / density);

            if (top != lastTop || bottom != lastBottom || left != lastLeft || right != lastRight) {
                lastTop = top;
                lastBottom = bottom;
                lastLeft = left;
                lastRight = right;
                Log.d(TAG, "Insets changed dp: top=" + top + " bottom=" + bottom
                        + " left=" + left + " right=" + right + " density=" + density);
                injectInsets(top, bottom, left, right);
            }

            return insets;
        });

        // WebView 可能晚于首次 insets 回调就绪，延迟补注入几次
        scheduleReinject();
    }

    private void scheduleReinject() {
        final Handler h = new Handler(Looper.getMainLooper());
        long[] delays = { 300, 800, 1500, 3000 };
        for (long d : delays) {
            h.postDelayed(() -> {
                if (lastTop >= 0) {
                    Log.d(TAG, "reinject @" + d + "ms");
                    injectInsets(lastTop, lastBottom, lastLeft, lastRight);
                }
            }, d);
        }
    }

    private void injectInsets(int top, int bottom, int left, int right) {
        if (getBridge() == null || getBridge().getWebView() == null) {
            Log.d(TAG, "WebView not ready, skip inject");
            return;
        }

        String js = "(function(){try{"
                + "var r=document.documentElement.style;"
                + "r.setProperty('--safe-area-inset-top','" + top + "px');"
                + "r.setProperty('--safe-area-inset-bottom','" + bottom + "px');"
                + "r.setProperty('--safe-area-inset-left','" + left + "px');"
                + "r.setProperty('--safe-area-inset-right','" + right + "px');"
                + "console.log('[WorkflowDesk] insets injected: top=" + top
                + " bottom=" + bottom + " left=" + left + " right=" + right + "');"
                + "}catch(e){console.error('[WorkflowDesk] inject error',e)}})();";

        getBridge().getWebView().post(() -> {
            try {
                getBridge().getWebView().evaluateJavascript(js, null);
            } catch (Throwable t) {
                Log.w(TAG, "evaluateJavascript failed", t);
            }
        });
    }
}

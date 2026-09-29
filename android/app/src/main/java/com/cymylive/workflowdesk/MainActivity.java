package com.cymylive.workflowdesk;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * 把系统栏（状态栏 / 导航栏）高度注入成 CSS 变量 --safe-area-inset-*。
 *
 * 三条路径同时走，互为兜底：
 *   1. onCreate 时给 WebView 加 OnApplyWindowInsetsListener（系统栏变化实时更新）
 *   2. 页面加载完成后（onPageLoaded）再注入一次（防止首次回调时 WebView 未就绪）
 *   3. 前端 CSS 里默认给了 32px/48px 兜底（即使上面都失败也能用）
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "WorkflowDesk";

    private int lastTop = -1, lastBottom = -1, lastLeft = -1, lastRight = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyInsetsWithRetry(0);

        // 页面加载完再注入一次（修正 WebView 首次回调时机问题）
        try {
            if (getBridge() != null) {
                getBridge().addWebViewListener(new WebViewListener() {
                    @Override
                    public void onPageLoaded(WebView webView) {
                        super.onPageLoaded(webView);
                        Log.d(TAG, "onPageLoaded, reinject: top=" + lastTop
                                + " bottom=" + lastBottom);
                        if (lastTop >= 0) {
                            injectInsets(lastTop, lastBottom, lastLeft, lastRight);
                        } else {
                            // 监听器还没回调过，用系统资源兜底
                            int t = getSystemDimen("status_bar_height", 32);
                            int b = getSystemDimen("navigation_bar_height", 48);
                            float d = getResources().getDisplayMetrics().density;
                            injectInsets(Math.round(t / d), Math.round(b / d), 0, 0);
                        }
                    }
                });
            } else {
                Log.w(TAG, "getBridge() null in onCreate");
            }
        } catch (Throwable t) {
            Log.w(TAG, "addWebViewListener failed", t);
        }
    }

    private void applyInsetsWithRetry(final int attempt) {
        WebView webView = (getBridge() != null) ? getBridge().getWebView() : null;
        if (webView == null) {
            if (attempt < 15) {
                new Handler(Looper.getMainLooper()).postDelayed(
                    () -> applyInsetsWithRetry(attempt + 1), 200);
            }
            return;
        }

        Log.d(TAG, "WebView ready at attempt " + attempt);

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = getResources().getDisplayMetrics().density;
            int top = Math.round(bars.top / density);
            int bottom = Math.round(bars.bottom / density);
            int left = Math.round(bars.left / density);
            int right = Math.round(bars.right / density);

            if (top != lastTop || bottom != lastBottom
                    || left != lastLeft || right != lastRight) {
                lastTop = top;
                lastBottom = bottom;
                lastLeft = left;
                lastRight = right;
                Log.d(TAG, "[insets] top=" + top + " bottom=" + bottom
                        + " left=" + left + " right=" + right + " density=" + density);
                injectInsets(top, bottom, left, right);
            }
            return windowInsets;
        });

        webView.requestApplyInsets();
    }

    private void injectInsets(int top, int bottom, int left, int right) {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        String js = "(function(){try{"
                + "var r=document.documentElement.style;"
                + "r.setProperty('--safe-area-inset-top','" + top + "px');"
                + "r.setProperty('--safe-area-inset-bottom','" + bottom + "px');"
                + "r.setProperty('--safe-area-inset-left','" + left + "px');"
                + "r.setProperty('--safe-area-inset-right','" + right + "px');"
                + "console.log('[WorkflowDesk] insets injected: top=" + top
                + " bottom=" + bottom + "');"
                + "}catch(e){}})();";

        getBridge().getWebView().post(() -> {
            try {
                getBridge().getWebView().evaluateJavascript(js, null);
            } catch (Throwable t) {
                Log.w(TAG, "evaluateJavascript failed", t);
            }
        });
    }

    private int getSystemDimen(String name, int defaultDp) {
        int id = getResources().getIdentifier(name, "dimen", "android");
        if (id > 0) {
            int px = getResources().getDimensionPixelSize(id);
            if (px > 0) return px;
        }
        return Math.round(defaultPx(defaultDp) * getResources().getDisplayMetrics().density);
    }

    private int defaultPx(int dp) { return dp; }
}

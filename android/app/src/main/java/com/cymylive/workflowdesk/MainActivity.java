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
import com.getcapacitor.WebViewListener;

/**
 * 把系统栏的真实高度注入成 --sat / --sab CSS 变量，覆盖 CSS 里的默认兜底值。
 *
 * 前端 CSS 已经写死 --sat: 28px; --sab: 40px，即使本类完全不工作也能用。
 * 本类的作用是把 28px 修正成设备真实值（更贴合）。
 *
 * 关键：只有 > 0 才覆盖，防止把兜底值踩成 0。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "WorkflowDesk";

    private int lastTop = -1, lastBottom = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        attachInsetsListener(0);

        try {
            if (getBridge() != null) {
                getBridge().addWebViewListener(new WebViewListener() {
                    @Override
                    public void onPageLoaded(WebView webView) {
                        super.onPageLoaded(webView);
                        // 页面重载后再注入一次
                        Log.d(TAG, "onPageLoaded, reinject top=" + lastTop);
                        if (lastTop > 0) inject(lastTop, lastBottom);
                    }
                });
            }
        } catch (Throwable t) {
            Log.w(TAG, "addWebViewListener failed", t);
        }
    }

    private void attachInsetsListener(final int attempt) {
        WebView webView = (getBridge() != null) ? getBridge().getWebView() : null;
        if (webView == null) {
            if (attempt < 20) {
                new Handler(Looper.getMainLooper()).postDelayed(
                    () -> attachInsetsListener(attempt + 1), 200);
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

            if (top != lastTop || bottom != lastBottom) {
                lastTop = top;
                lastBottom = bottom;
                Log.d(TAG, "[insets] top=" + top + " bottom=" + bottom);
                inject(top, bottom);
            }
            return windowInsets;
        });

        webView.requestApplyInsets();
    }

    private void inject(int top, int bottom) {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        // 关键：只有 > 0 才覆盖，避免把 CSS 兜底值踩成 0
        StringBuilder js = new StringBuilder("(function(){try{var r=document.documentElement.style;");
        if (top > 0) {
            js.append("r.setProperty('--sat','").append(top).append("px');");
        }
        if (bottom > 0) {
            js.append("r.setProperty('--sab','").append(bottom).append("px');");
        }
        js.append("console.log('[WorkflowDesk] injected top=").append(top)
          .append(" bottom=").append(bottom).append("');}catch(e){}})();");

        final String script = js.toString();
        getBridge().getWebView().post(() -> {
            try {
                getBridge().getWebView().evaluateJavascript(script, null);
            } catch (Throwable t) {
                Log.w(TAG, "evaluateJavascript failed", t);
            }
        });
    }
}

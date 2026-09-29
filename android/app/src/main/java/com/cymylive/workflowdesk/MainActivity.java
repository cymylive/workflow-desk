package com.cymylive.workflowdesk;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.List;

/**
 * 应用入口。
 *
 * 不再使用 WebView 内嵌界面（Capacitor 在 Android 15+ 上无法正确处理
 * edge-to-edge 安全区）。改为在应用内启动一个 HTTP 服务器，
 * 用户用系统浏览器打开 http://127.0.0.1:8317 —— 浏览器自己处理状态栏。
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "WorkflowDesk";

    private WorkflowServer server;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        final TextView tvStatus = findViewById(R.id.tvStatus);
        final TextView tvHint = findViewById(R.id.tvHint);
        final View cardLocal = findViewById(R.id.cardLocal);
        final View cardLan = findViewById(R.id.cardLan);
        final TextView tvLocalUrl = findViewById(R.id.tvLocalUrl);
        final TextView tvLanUrl = findViewById(R.id.tvLanUrl);

        final String localUrl = "http://127.0.0.1:" + WorkflowServer.PORT;

        // 启动服务（放到后台线程，避免阻塞 UI）
        new Thread(() -> {
            String err = null;
            try {
                server = new WorkflowServer(getApplicationContext());
                server.start(5000, false);
                Log.d(TAG, "server started on port " + WorkflowServer.PORT);
            } catch (Exception e) {
                err = e.getMessage();
                Log.e(TAG, "server start failed", e);
            }

            final String ferr = err;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (ferr != null) {
                    tvStatus.setText("● 启动失败");
                    tvStatus.setTextColor(0xFFE04A5F);
                    tvHint.setText("原因：" + ferr);
                    return;
                }
                tvStatus.setText("● 服务已启动");
                tvStatus.setTextColor(0xFF17A673);
                tvHint.setText("端口 " + WorkflowServer.PORT + "，下面的地址可以直接在浏览器里打开");

                tvLocalUrl.setText(localUrl);
                cardLocal.setVisibility(View.VISIBLE);

                List<String> ips = NetworkUtils.lanIps();
                if (!ips.isEmpty()) {
                    String lanUrl = "http://" + ips.get(0) + ":" + WorkflowServer.PORT;
                    tvLanUrl.setText(lanUrl);
                    cardLan.setVisibility(View.VISIBLE);
                } else {
                    tvLanUrl.setText("未检测到局域网（请连 WiFi）");
                    cardLan.setVisibility(View.VISIBLE);
                }
            });
        }).start();

        // 点「用浏览器打开」
        findViewById(R.id.btnOpenLocal).setOnClickListener(v -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(localUrl));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                toast("没有可用的浏览器");
            }
        });

        // 点「复制局域网地址」
        findViewById(R.id.btnCopyLan).setOnClickListener(v -> {
            String text = tvLanUrl.getText().toString();
            if (text.startsWith("http")) {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("url", text));
                toast("已复制：" + text);
            } else {
                toast("没有可复制的地址");
            }
        });

        // 点地址本身也能打开/复制
        tvLocalUrl.setOnClickListener(v -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(localUrl)));
            } catch (Exception e) {
                toast("没有可用的浏览器");
            }
        });
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (server != null) {
            server.stop();
            Log.d(TAG, "server stopped");
        }
    }
}
